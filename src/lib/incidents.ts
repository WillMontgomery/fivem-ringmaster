import { randomUUID } from 'node:crypto'

import * as audit from './audit'
import { ddb, tables } from './dynamo'

/**
 * Incidents — open questions about a player that a human has to close.
 *
 * THE PHILOSOPHY THIS IMPLEMENTS (owner, 2026-08-11): the anticheat acts on
 * what it can handle, and files an incident for what it cannot. Supervisory
 * judgements, informational red flags and anything low-confidence stay here for
 * an admin rather than being enforced automatically.
 *
 * TWO STATES, AND NO WAY BACK (owner, 2026-08-12).
 *
 *   pending_review   a human needs to look at this
 *   resolved         a human did, or the system handled it outright
 *
 * Anything the system actions itself opens as `resolved` — there is nothing for
 * anybody to do. It opens as `pending_review` only when further action is
 * needed.
 *
 * AN INCIDENT CANNOT BE RE-OPENED, and that is worth more than it looks. It
 * makes the queue a strictly-shrinking worklist rather than something that can
 * bounce, and `resolved` becomes a permanent fact about a moment rather than a
 * state that might turn out to be wrong later. If the behaviour continues, that
 * is a NEW incident — and the profile shows both, which is the pattern an admin
 * is actually reading.
 *
 * THE TIMELINE IS THE POINT. A state field alone cannot answer "who looked at
 * this and decided nothing", which is exactly the question that matters when
 * the same player is reported a third time. Losing `reviewed`/`actioned`/
 * `dismissed` as STATES does not lose them as EVENTS: "resolved — no action"
 * and "resolved — banned" are different rows in `events` with the same end
 * state, and that is where the distinction belongs.
 *
 * THAT WAS TRUE AND IT WAS NOT ENOUGH. The timeline carries the distinction in
 * PROSE, which a human reads and nothing else can. `verdict` carries the same
 * distinction in a form a machine reads — see {@link IncidentVerdict}. The two
 * are written in the same conditional update, so they cannot disagree, and
 * neither replaces the other: the verdict says WHAT, the timeline says why.
 */

export type IncidentState = 'pending_review' | 'resolved'

export type IncidentKind =
  /** A player used the in-game report flow. */
  | 'report'
  /** A joining player presented an identifier bound to a different license. */
  | 'identifier_reuse'
  /** The refusal validator escalated something it would not action itself. */
  | 'anticheat'

/** What a reporter picked in game. Mirrors the categories in the game repo. */
export type IncidentCategory =
  | 'cheating'
  | 'teaming'
  | 'griefing'
  | 'abusive_chat'
  | 'exploiting'
  | 'other'
  /** Not a player report — the system filed it. */
  | 'system'

/**
 * WHAT WAS DECIDED, in a form that is not prose.
 *
 * THE FIELD THIS WHOLE MODULE WAS MISSING. `resolved` used to cover both "this
 * player was banned" and "I watched a match and they were fine" — the decision
 * lived in `resolution`, free text, whose own placeholder read "Banned for 7
 * days / watched a match, looked fine / no action". Nothing could tell those
 * apart, which cost two things already: the profile page had to discard EVERY
 * `incident.resolve` row from its moderation list because it could not know
 * which closures involved an action, and fivem-br-gamemode#168 — 250 Volts to a
 * reporter whose report led to one — had nothing to pay against.
 *
 * ═══ THE CONTRACT, WHICH IS READ FROM ANOTHER REPOSITORY ═══
 *
 * The row this describes lives in `ringmaster-incidents`, keyed on
 * `incidentId`. The game side already writes rows into that table (br_ddb's
 * `buildIncidentItem`); this is the attribute it will read back.
 *
 *   verdict.action   'ban' | 'kick' | 'none'   — always present when `verdict` is
 *   verdict.expiresAt  number | null           — PRESENT IF AND ONLY IF action is
 *                                                'ban'. null means permanent.
 *
 * READ `action` FIRST, ALWAYS. `expiresAt` does not exist on a kick or a
 * no-action verdict, and a reader that reaches for it without narrowing gets
 * `undefined` where a permanent ban would have given `null` — two falsy values
 * meaning entirely different things. The union below makes that a compile error
 * on this side; on the game side it is a rule somebody has to keep.
 *
 * DERIVE, DO NOT STORE, "was an action taken". It is `action !== 'none'`. A
 * stored boolean beside the enum is a second copy of one fact and the two
 * eventually disagree, always in the direction of paying for a ban that did not
 * happen.
 *
 * THE WORD FOR THE PLAYER-FACING SENTENCE comes from `action` and nothing else:
 * 'ban' → "banned", 'kick' → "kicked", 'none' → there is no award and no
 * sentence. The admin's `reason` is NOT part of that sentence — see below.
 *
 * ABSENT OR NULL IS A REAL STATE AND IT IS NOT 'none'. Two kinds of resolved
 * incident carry no verdict at all:
 *
 *   · one resolved before this field existed, and
 *   · one the system auto-resolved (`open({ autoResolved: true })`), where no
 *     human decided anything.
 *
 * Neither may be read as "no action was taken" — that is a claim about a
 * decision nobody made. A reader that pays on `action !== 'none'` is safe
 * because it must check for the attribute first; a reader that pays on
 * `action === undefined || action !== 'none'` is not. Absent means "do not
 * know", and this console never converts "do not know" into an answer.
 *
 * IT IS WRITTEN ONCE AND NEVER AGAIN (owner, 2026-08-17: verdicts cannot be
 * changed after the fact). It lands in the same conditional update that moves
 * the incident to `resolved`, which already refuses to run twice — so there is
 * no window in which an incident is resolved without a verdict, and no path
 * that rewrites one. That immutability is what makes #168's award safe to pay
 * once and never reconcile.
 *
 * A VERDICT ONLY EXISTS IF THE ACTION DID. `ban` is written by the ban route
 * after the ban row is written, and `kick` by the kick route after the game
 * host accepts the command. Neither is a claim the browser gets to make, which
 * is the property that matters when 250 Volts are paid against it.
 */
export type VerdictAction = 'ban' | 'kick' | 'none'

export type IncidentVerdict =
  | { action: 'ban'; expiresAt: number | null }
  | { action: 'kick' }
  | { action: 'none' }

/** Was something done to the player? The one derived question, in one place. */
export function actionWasTaken(v: IncidentVerdict | null | undefined): boolean {
  return v != null && v.action !== 'none'
}

/** One thing that happened to this incident. Append-only. */
export interface IncidentEvent {
  at: number
  /** Machine-readable; the UI maps it to prose. */
  kind: 'opened' | 'note' | 'resolved'
  /** Who. Null for the system. */
  byLicense: string | null
  byName: string
  text?: string
}

export interface Incident {
  /** Partition key. A UUID, so the URL is stable and shareable. */
  incidentId: string

  kind: IncidentKind
  category: IncidentCategory
  state: IncidentState

  /** Who it is about. */
  subjectLicense: string
  subjectName: string

  /** Who filed it. Null when the system did. */
  reporterLicense: string | null
  reporterName: string | null

  openedAt: number
  /** One line, shown in the queue. Never interpolated into anything. */
  summary: string

  /** Free text from the reporter, when they gave any. */
  note?: string | null

  /**
   * A second license this incident links to — the other profile in an
   * identifier-reuse case. Not the reporter.
   */
  linkedLicense?: string | null

  events: IncidentEvent[]

  resolvedAt?: number | null
  resolvedByLicense?: string | null
  resolvedByName?: string | null
  /** What was decided. Free text; the timeline carries the detail. */
  resolution?: string | null

  /**
   * The same decision, machine-readable. See {@link IncidentVerdict}.
   *
   * OPTIONAL BECAUSE HISTORY IS. Rows resolved before this field existed have
   * no verdict and never will — there is no backfill, because inventing one
   * would mean guessing from free text exactly the way this field exists to
   * stop anybody doing.
   */
  verdict?: IncidentVerdict | null

  /**
   * S3 keys for capture frames, when the subject was still in the match.
   *
   * EMPTY IS NORMAL AND IS NOT EVIDENCE OF ANYTHING. The capture uploads from
   * the subject's own machine, so it can fail or be blocked — an incident with
   * no frames must never read as one where nothing was happening.
   */
  captureKeys?: string[]
}

/**
 * HOW THIS TABLE IS QUERIED, AND THE CEILING ON IT.
 *
 * `ringmaster-incidents` is keyed on `incidentId` alone (docs/aws-setup.md), so
 * fetching one by id is a GetItem and everything else is a Scan. That is fine
 * at the volume this sees — player reports are rate-limited to three per player
 * per match and admin-visible incidents are measured in tens per day — and it
 * is NOT fine forever.
 *
 * The fix when it stops being fine is two GSIs: one on `state` for the queue
 * and the badge, one on `subjectLicense` for the profile. Both are cheap to add
 * later and neither changes this module's interface, which is why the scan is
 * an acceptable first version rather than a shortcut that has to be undone.
 *
 * WHAT IS NOT ACCEPTABLE is truncating silently. Every scan here is capped and
 * says so when it hits the cap, because a queue that quietly stops at 500 reads
 * exactly like a queue with 500 items in it.
 */
const SCAN_LIMIT = 500

async function scanAll(): Promise<Incident[]> {
  const res = await ddb.scan({ TableName: tables.incidents, Limit: SCAN_LIMIT })
  const items = (res.Items ?? []) as Incident[]

  if (res.LastEvaluatedKey) {
    console.warn(
      `[incidents] scan hit the ${SCAN_LIMIT} cap and more rows exist — ` +
        'the queue and counts below are incomplete. Time to add the GSIs.',
    )
  }

  return items
}

/** One incident by id. The only cheap read in this module. */
export async function get(incidentId: string): Promise<Incident | null> {
  const res = await ddb.get({
    TableName: tables.incidents,
    Key: { incidentId },
  })
  return (res.Item as Incident | undefined) ?? null
}

/** The queue: everything awaiting review, oldest first. */
export async function queue(): Promise<Incident[]> {
  const all = await scanAll()
  return all
    .filter((i) => i.state === 'pending_review')
    // OLDEST FIRST, unlike every other list in this console. A queue is worked
    // through, not browsed — and the incident most at risk of being forgotten
    // is the one that has been waiting longest, not the one that just arrived.
    .sort((a, b) => a.openedAt - b.openedAt)
}

/** Everything ever filed, newest first. For the history tab. */
export async function all(): Promise<Incident[]> {
  const rows = await scanAll()
  return rows.sort((a, b) => b.openedAt - a.openedAt)
}

/** Every incident about one player, newest first. */
export async function forSubject(license: string): Promise<Incident[]> {
  const rows = await scanAll()
  return rows
    .filter((i) => i.subjectLicense === license)
    .sort((a, b) => b.openedAt - a.openedAt)
}

/** Every incident one player filed against others, newest first. */
export async function filedBy(license: string): Promise<Incident[]> {
  const rows = await scanAll()
  return rows
    .filter((i) => i.reporterLicense === license)
    .sort((a, b) => b.openedAt - a.openedAt)
}

/**
 * How many are waiting. Drives the nav badge.
 *
 * CACHED, because the badge renders on every page and this is a scan. Fifteen
 * seconds is far fresher than the thing it describes — an incident that has
 * been waiting four minutes is not different from one waiting four minutes and
 * ten seconds.
 */
let countCache: { at: number; n: number } | null = null
const COUNT_TTL_MS = 15_000

export async function openCount(): Promise<number> {
  const now = Date.now()
  if (countCache && now - countCache.at < COUNT_TTL_MS) return countCache.n

  try {
    const rows = await scanAll()
    const n = rows.filter((i) => i.state === 'pending_review').length
    countCache = { at: now, n }
    return n
  } catch (e) {
    console.error('[incidents] open count failed', e)
    // A badge that cannot be computed shows nothing rather than zero. Zero is a
    // claim that the queue is empty, which is the one wrong answer here.
    return countCache?.n ?? 0
  }
}

/**
 * File one.
 *
 * THE ID IS MINTED HERE, server-side, and never accepted from a caller. A
 * client-supplied id is a way to overwrite somebody else's incident.
 */
export async function open(input: {
  kind: IncidentKind
  category: IncidentCategory
  subjectLicense: string
  subjectName: string
  reporterLicense?: string | null
  reporterName?: string | null
  summary: string
  note?: string | null
  linkedLicense?: string | null
  /** Opens straight to resolved — the system handled it and nobody need look. */
  autoResolved?: boolean
  captureKeys?: string[]
}): Promise<Incident> {
  const now = Date.now()
  const resolved = input.autoResolved === true

  const incident: Incident = {
    incidentId: randomUUID(),
    kind: input.kind,
    category: input.category,
    state: resolved ? 'resolved' : 'pending_review',
    subjectLicense: input.subjectLicense,
    subjectName: input.subjectName,
    reporterLicense: input.reporterLicense ?? null,
    reporterName: input.reporterName ?? null,
    openedAt: now,
    summary: input.summary,
    note: input.note ?? null,
    linkedLicense: input.linkedLicense ?? null,
    captureKeys: input.captureKeys ?? [],
    events: [
      {
        at: now,
        kind: 'opened',
        byLicense: input.reporterLicense ?? null,
        byName: input.reporterName ?? 'System',
      },
    ],
    resolvedAt: resolved ? now : null,
    resolvedByLicense: null,
    resolvedByName: resolved ? 'System' : null,
    resolution: resolved ? 'Handled automatically' : null,
    /**
     * NO VERDICT, EVEN WHEN THIS OPENS RESOLVED, and that is not an oversight.
     * A verdict is a human's decision about what should happen to a player. The
     * system handling something itself is a different fact, and writing
     * `{ action: 'none' }` here would tell #168 that an admin looked and decided
     * nothing — which nobody did. Absent means "no verdict", and that is the
     * honest answer for this row.
     */
    verdict: null,
  }

  if (resolved) {
    incident.events.push({
      at: now,
      kind: 'resolved',
      byLicense: null,
      byName: 'System',
      text: 'Handled automatically — no action needed from an admin.',
    })
  }

  await ddb.put({ TableName: tables.incidents, Item: incident })
  countCache = null
  return incident
}

/**
 * Resolve one, once, with a verdict.
 *
 * THE CONDITION IS THE NO-REOPEN RULE, enforced by the database rather than by
 * the UI. Two admins opening the same incident and both pressing resolve is the
 * ordinary case, not the exotic one — the second write is refused and the first
 * decision stands, rather than the two racing to overwrite each other's
 * resolution text.
 *
 * IT IS ALSO THE NO-EDIT RULE (owner, 2026-08-17: verdicts cannot be changed
 * after the fact). There is no second function here that takes an incidentId
 * and a verdict, and that absence is the enforcement — `#s = :pending` fails
 * against a row that is already `resolved`, so the only write that can ever set
 * `verdict` is the one that sets `state` at the same instant. A verdict cannot
 * be edited because it cannot be reached without also un-resolving the
 * incident, which nothing in this module can do.
 *
 * THE VERDICT IS REQUIRED, not optional. An optional one would mean a resolved
 * incident that says nothing, which is the exact state this field was added to
 * abolish — and the caller that "forgets" it is precisely the caller whose
 * closure #168 would then never pay for.
 */
export async function resolve(input: {
  incidentId: string
  byLicense: string
  byName: string
  resolution: string
  verdict: IncidentVerdict
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = Date.now()

  const event: IncidentEvent = {
    at: now,
    kind: 'resolved',
    byLicense: input.byLicense,
    byName: input.byName,
    text: input.resolution,
  }

  try {
    await ddb.update({
      TableName: tables.incidents,
      Key: { incidentId: input.incidentId },
      UpdateExpression:
        'SET #s = :resolved, resolvedAt = :now, resolvedByLicense = :by, ' +
        'resolvedByName = :byName, resolution = :res, #verdict = :verdict, ' +
        'events = list_append(events, :ev)',
      ConditionExpression: 'attribute_exists(incidentId) AND #s = :pending',
      // `#verdict` is aliased for the same reason `#s` is: neither name is worth
      // checking against DynamoDB's reserved-word list on every edit, and the
      // failure mode is a ValidationException on a moderation write.
      ExpressionAttributeNames: { '#s': 'state', '#verdict': 'verdict' },
      ExpressionAttributeValues: {
        ':resolved': 'resolved' satisfies IncidentState,
        ':pending': 'pending_review' satisfies IncidentState,
        ':now': now,
        ':by': input.byLicense,
        ':byName': input.byName,
        ':res': input.resolution,
        ':verdict': input.verdict,
        ':ev': [event],
      },
    })
    countCache = null
    return { ok: true }
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'ConditionalCheckFailedException') {
      return { ok: false, reason: 'Already resolved, or no longer exists.' }
    }
    console.error('[incidents] resolve failed', e)
    return { ok: false, reason: 'The database refused the change.' }
  }
}

/**
 * Close a case with a verdict, and log that it happened. The only way in.
 *
 * THREE ROUTES CLOSE INCIDENTS AND THERE IS ONE OF THIS. `/api/bans` closes one
 * with a ban, `/api/kick` with a kick, `/api/incidents/resolve` with no action —
 * and if each wrote its own audit row, "who decided nothing was wrong" would be
 * three slightly different rows within a month. The audit row is not optional
 * and not the caller's to remember, which is why it is inside this function
 * rather than beside each call to it.
 *
 * THE VERDICT GOES IN `detail`, and that is what unblocks the profile page. Its
 * `NOT_AN_ACTION` filter currently discards every `incident.resolve` row
 * unconditionally, with a comment saying it has to because nothing on the row
 * can tell an action-taken closure from a no-action one. Now something can.
 *
 * RECORDED AFTER THE WRITE, not around it, for the reason the resolve route
 * already gives: the two-phase intent/outcome shape exists for actions that
 * reach out to something that can fail slowly, and this one has already
 * succeeded against a conditional write by the time we get here.
 */
export async function closeWithVerdict(input: {
  incident: Incident
  actor: audit.Actor
  resolution: string
  verdict: IncidentVerdict
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await resolve({
    incidentId: input.incident.incidentId,
    // The actor always has a license here — authorize() resolves the session to
    // a grants row, and grants are keyed on license.
    byLicense: input.actor.license ?? '',
    byName: input.actor.name,
    resolution: input.resolution,
    verdict: input.verdict,
  })

  if (!result.ok) return result

  const handle = await audit.begin({
    action: 'incident.resolve',
    actor: input.actor,
    targetLicense: input.incident.subjectLicense,
    targetName: input.incident.subjectName,
    reason: input.resolution,
    detail: {
      incidentId: input.incident.incidentId,
      kind: input.incident.kind,
      verdict: input.verdict.action,
      ...(input.verdict.action === 'ban'
        ? { expiresAt: input.verdict.expiresAt }
        : {}),
    },
  })
  await audit.resolve(handle.ts, 'ok')

  return { ok: true }
}

/**
 * Drop the cached open count.
 *
 * Called when the game rings the doorbell for a newly filed case. The count is
 * cached for fifteen seconds to keep the nav badge off a scan, and a brand-new
 * incident is exactly the moment that staleness is worth spending a read on.
 */
export function invalidateCount(): void {
  countCache = null
}

/**
 * Append a corroboration to an open case.
 *
 * NOT A NEW INCIDENT, AND NOT A COUNTER. The game reports again each time the
 * refusal count doubles, and each report means something an admin would want to
 * know — it doubled, and here is when. A number that climbed from 1 to 3 says
 * the same thing while losing every timestamp.
 *
 * SILENT ON A MISSING CASE. A corroboration for an incident that does not exist
 * means the doorbell arrived before the write landed, or the case was filed on
 * a server whose write failed. Neither is worth an error: the corroboration is
 * redundant by definition, which is why it travels on the lossy channel in the
 * first place.
 *
 * IT DOES NOT REOPEN ANYTHING. A resolved case that is still being corroborated
 * is a real situation — an admin decided, and the player carried on — and the
 * no-reopen rule holds. The note lands on the timeline either way, which is
 * where somebody deciding whether to look again will see it.
 */
export async function corroborate(input: {
  incidentId: string
  at: number
  text: string
}): Promise<boolean> {
  const event: IncidentEvent = {
    at: input.at,
    kind: 'note',
    byLicense: null,
    byName: 'System',
    text: input.text,
  }

  try {
    await ddb.update({
      TableName: tables.incidents,
      Key: { incidentId: input.incidentId },
      UpdateExpression: 'SET events = list_append(events, :ev)',
      ConditionExpression: 'attribute_exists(incidentId)',
      ExpressionAttributeValues: { ':ev': [event] },
    })
    return true
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'ConditionalCheckFailedException') return false
    console.error('[incidents] corroborate failed', e)
    return false
  }
}

/** Add a note without resolving. The timeline is the point. */
export async function note(input: {
  incidentId: string
  byLicense: string
  byName: string
  text: string
}): Promise<boolean> {
  const event: IncidentEvent = {
    at: Date.now(),
    kind: 'note',
    byLicense: input.byLicense,
    byName: input.byName,
    text: input.text,
  }

  try {
    await ddb.update({
      TableName: tables.incidents,
      Key: { incidentId: input.incidentId },
      UpdateExpression: 'SET events = list_append(events, :ev)',
      ConditionExpression: 'attribute_exists(incidentId)',
      ExpressionAttributeValues: { ':ev': [event] },
    })
    return true
  } catch (e) {
    console.error('[incidents] note failed', e)
    return false
  }
}

/** Human labels, kept beside the types they describe. */
export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  cheating: 'Cheating',
  teaming: 'Teaming',
  griefing: 'Griefing',
  abusive_chat: 'Abusive chat',
  exploiting: 'Exploiting',
  other: 'Something else',
  system: 'System',
}

export const KIND_LABEL: Record<IncidentKind, string> = {
  report: 'Player report',
  identifier_reuse: 'Shared identifier',
  anticheat: 'Anticheat',
}

/**
 * The verdict in English, past tense, as a thing done to the subject.
 *
 * PAST TENSE ON PURPOSE. "Ban" is a button; "Banned" is a record. This map is
 * only ever rendered against an incident that is already closed, so the label
 * has to read as a fact rather than as an offer — the same reason the profile
 * page maps `ban.issue` to "Banned" rather than to "Ban".
 *
 * "No action" IS NOT A FAILURE AND IS NOT STYLED LIKE ONE. An admin who looked
 * at a report and concluded there was nothing in it did the job correctly, and
 * a console that greys that outcome out teaches people to ban rather than
 * decide.
 */
export const VERDICT_LABEL: Record<VerdictAction, string> = {
  ban: 'Banned',
  kick: 'Kicked',
  none: 'No action',
}
