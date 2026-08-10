import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@/lib/env'
import { ingestEnvelope } from '@/lib/ingest'
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
  return Response.json(
    { ok: true, applied, received: env_.events.length },
    { status: 202 },
  )
}

/**
 * Health, for a human with curl on the game box wondering whether the endpoint
 * is reachable at all. Says nothing about the server it observes and needs no
 * secret — it answers exactly the question "is this listening".
 */
export function GET(): Response {
  return Response.json({ ok: true, service: 'ringmaster-ingest' })
}
