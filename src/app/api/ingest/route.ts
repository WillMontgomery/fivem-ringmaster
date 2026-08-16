import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@/lib/env'
import { ingestEnvelope } from '@/lib/ingest'
import * as incidents from '@/lib/incidents'
import * as players from '@/lib/players'
import { applyEvents, applySnapshot } from '@/lib/state'

/**
 * Where the game server pushes.
 *
 * Reachable only over the VPC peering link, never through Cloudflare, and
 * excluded from the session middleware — the sender has no session and never
 * will. Its credential is a shared secret in a header.
 *
 * THE HARD CONSTRAINT IS TIME. `PerformHttpRequest` on the game side has a
 * hardcoded 5-second no-response timeout that is not configurable, so a slow
 * answer here becomes a stalled outbox there. Everything below validates,
 * acknowledges, and does nothing else that could block — no DynamoDB write, no
 * network call, no work proportional to anything but the payload already in
 * hand.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ~1MB. A full 2048-player snapshot is well under this; anything over is a bug or an attack. */
const MAX_BYTES = 1_048_576

/**
 * Constant-time comparison of the shared secret.
 *
 * Hashed first so both sides are always 32 bytes: `timingSafeEqual` throws on
 * a length mismatch, and catching that throw would itself leak the length of
 * the real secret through timing. Comparing digests removes the question.
 */
function secretMatches(presented: string | null): boolean {
  if (!presented) return false

  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(env().INGEST_SECRET).digest()

  return timingSafeEqual(a, b)
}

export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get('x-ringmaster-secret'))) {
    // No detail. A sender that got this wrong is either misconfigured (and the
    // game-side log says so plainly) or is not the game server.
    return Response.json({ ok: false }, { status: 401 })
  }

  const raw = await req.text()
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: 'too large' }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return Response.json({ ok: false, error: 'malformed json' }, { status: 400 })
  }

  const parsed = ingestEnvelope.safeParse(json)
  if (!parsed.success) {
    // 400 is a `nack` on the game side, which is correct: a console that
    // cannot understand the server should say so loudly rather than display a
    // confidently wrong player list. The reason goes in the response because
    // the only reader is our own game server, over a private link.
    return Response.json(
      { ok: false, error: 'schema', detail: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const env_ = parsed.data
  const now = Date.now()

  // Synchronous and cheap: both are in-memory table updates over a payload
  // already parsed. Deliberately NOT deferred to a background task -- "process
  // async" means never blocking the response on I/O, and there is none here.
  // Faking asynchrony with a floating promise would only add a window where an
  // acknowledged push has not been applied.
  if (env_.kind === 'snapshot') {
    const fresh = applySnapshot(env_, now)
    return Response.json({ ok: true, applied: fresh }, { status: 202 })
  }

  const applied = applyEvents(env_, now)

  /**
   * Persist identity to the registry, without making the game wait for it.
   *
   * THE ACKNOWLEDGEMENT IS NOT THE PERSISTENCE. The game's PerformHttpRequest
   * carries a hardcoded five-second ceiling, and a DynamoDB write plus a
   * reverse-index update per identifier can outlast a slow moment on the link.
   * Blocking the 202 on that would turn a slow write into a failed push, which
   * the outbox would then RETRY — re-sending events we already applied.
   *
   * So the response goes out on the in-memory apply (which is what makes the
   * board correct) and the durable write proceeds behind it. A lost write costs
   * one sighting of a player who will reconnect; a lost acknowledgement costs a
   * retry storm.
   */
  void persistIdentity(env_, now).catch((e) => {
    console.error('[ingest] registry write failed', e)
  })

  void applyIncidentEvents(env_, now).catch((e) => {
    console.error('[ingest] incident event apply failed', e)
  })

  return Response.json(
    { ok: true, applied, received: env_.events.length },
    { status: 202 },
  )
}

/**
 * Write player_seen events into the durable registry.
 *
 * `player_seen` fires the first time the GAME meets a license in a given
 * process, which is exactly when the identifier set is worth recording — and
 * when a mismatch against a previous visit is worth noticing.
 */
async function persistIdentity(
  env_: { events: Array<{ kind: string; data: unknown }> },
  now: number,
): Promise<void> {
  for (const ev of env_.events) {
    /**
     * SESSION CLOSE. Without this every player's session count sat at zero
     * forever: recordDisconnect had no caller anywhere and the game emitted no
     * disconnect event, so playtime — which is accumulated on close rather than
     * derived from first-to-last-seen — never accumulated anything.
     */
    if (ev.kind === 'player_left') {
      const d = ev.data as { license?: string }
      if (d.license) await players.recordDisconnect(d.license, now)
      continue
    }

    if (ev.kind !== 'player_seen') continue

    const d = ev.data as {
      license?: string
      name?: string
      identifiers?: Record<string, string>
    }
    if (!d.license) continue

    const { sharedWith } = await players.recordConnect({
      license: d.license,
      name: d.name ?? 'Unknown',
      identifiers: (d.identifiers ?? {}) as Partial<Record<players.IdKind, string>>,
      now,
    })

    /**
     * An identifier that already belongs to somebody else.
     *
     * This is the mismatch signal: same Discord account, different game
     * license. It has innocent explanations (a shared console, a reinstall
     * that reissued a license) and dishonest ones, which is exactly why it
     * becomes an INCIDENT for a human rather than an automatic action.
     *
     * Logged for now; the incident record lands with the incidents table.
     */
    if (sharedWith.length > 0) {
      console.warn('[registry] identifier reuse', {
        license: d.license,
        name: d.name,
        sharedWith,
      })
    }
  }
}

/**
 * Health, for a human with curl on the game box wondering whether the endpoint
 * is reachable at all. Says nothing about the server it observes and needs no
 * secret — it answers exactly the question "is this listening".
 */
export function GET(): Response {
  return Response.json({ ok: true, service: 'ringmaster-ingest' })
}

/**
 * Apply the incident events the game sends on the evidence channel.
 *
 * THESE HAD NO CONSUMER AT ALL. br_ringmaster has emitted `incident_filed` and
 * `incident_corroborated` since the pipeline was built, and nothing on this
 * side listened — so the game reported `filed 1, corroborated 3` while the
 * console showed one case with a one-line timeline and no sign that anything
 * had happened since. Both halves were correct and the wire between them was
 * connected to nothing.
 *
 * WHY THE GAME WRITES THE CASE AND THIS ONLY APPENDS. The game's DynamoDB grant
 * is append-only — PutItem conditional on the id being absent — so it can file a
 * case and cannot reach inside one. Corroboration is an UpdateItem on an
 * existing row, which is this console's to make. The game sends a fact; this
 * records it.
 *
 * FAILURE IS TOLERABLE HERE IN A WAY IT IS NOT FOR THE CASE ITSELF. A
 * corroboration says "still happening" about a case that is already durable, so
 * losing one costs a number. That is why it rides the lossy event channel while
 * the case does not.
 */
async function applyIncidentEvents(
  env_: { events: Array<{ kind: string; data: unknown }> },
  now: number,
): Promise<void> {
  for (const ev of env_.events) {
    if (ev.kind === 'incident_filed') {
      // THE DOORBELL. The row is already written by the game, so there is
      // nothing to store — but the open count is cached for fifteen seconds to
      // keep the nav badge off a scan, and a new case should not wait that out.
      incidents.invalidateCount()
      continue
    }

    if (ev.kind !== 'incident_corroborated') continue

    const d = ev.data as {
      incidentId?: string
      seq?: number
      count?: number
      reason?: string
      severity?: string
    }
    if (!d.incidentId) continue

    // Written as a timeline note rather than a counter, because "it happened
    // again, and again" is the shape an admin reads. A number that went from 1
    // to 3 says the same thing and says nothing about when.
    const parts = [
      typeof d.count === 'number' ? `${d.count} refusals this match` : null,
      d.reason ? `last: ${d.reason}` : null,
      d.severity ? `worst: ${d.severity}` : null,
    ].filter(Boolean)

    await incidents.corroborate({
      incidentId: d.incidentId,
      at: now,
      text: parts.length > 0 ? parts.join(' · ') : 'Still happening.',
    })
  }
}
