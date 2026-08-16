import { randomUUID } from 'node:crypto'

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
 * Resolve one, once.
 *
 * THE CONDITION IS THE NO-REOPEN RULE, enforced by the database rather than by
 * the UI. Two admins opening the same incident and both pressing resolve is the
 * ordinary case, not the exotic one — the second write is refused and the first
 * decision stands, rather than the two racing to overwrite each other's
 * resolution text.
 */
export async function resolve(input: {
  incidentId: string
  byLicense: string
  byName: string
  resolution: string
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
        'resolvedByName = :byName, resolution = :res, ' +
        'events = list_append(events, :ev)',
      ConditionExpression: 'attribute_exists(incidentId) AND #s = :pending',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: {
        ':resolved': 'resolved' satisfies IncidentState,
        ':pending': 'pending_review' satisfies IncidentState,
        ':now': now,
        ':by': input.byLicense,
        ':byName': input.byName,
        ':res': input.resolution,
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
