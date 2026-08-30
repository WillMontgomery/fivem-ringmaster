import { randomUUID } from 'node:crypto'

import * as audit from './audit'
import { ddb, tables } from './dynamo'
import type { MatchTimelineEntry } from './matchTimeline'

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

/**
 * WHY A CASE CLOSED WHEN NOBODY DECIDED ANYTHING ON IT.
 *
 * A permanent ban closes every other open case about the same player (owner:
 * "for any permanent bans that take place — all other incidents against the
 * freshly banned player should be resolved … with a note saying why, with a
 * hyperlink to the original incident where they were banned from, if there was
 * one"). Those closures carry a REAL `ban` verdict — see the note on
 * {@link closeOthersOnPermanentBan} for why that is the truthful shape and not a
 * convenient one — and this attribute is what distinguishes them from the one
 * case an admin actually banned FROM.
 *
 * IT IS A SIBLING OF `verdict`, NEVER A KEY INSIDE IT. The verdict map is a
 * cross-repository contract with exactly two shapes for a ban (`action`, and
 * `expiresAt` if and only if the action is a ban); the game's reader ignores
 * anything else, and a third key inside that map would be this console adding a
 * field to a structure another repository documents. Provenance is a fact about
 * the CLOSURE, not about the verdict, and it lives beside it.
 *
 * ABSENT IS THE ORDINARY CASE and means what it has always meant: a human
 * closed this case, on this case.
 */
export interface ClosedByBan {
  /**
   * The incident the ban was issued from, or null.
   *
   * NULL IS NOT A MISSING VALUE. A ban issued from the profile page rather than
   * as an incident verdict is an ON-DEMAND ban (owner: "for the bans issued from
   * the profile page — there's nothing to link to, so let's just say banned
   * on-demand"), and there is no case to point at because no case was involved.
   * The UI renders those words rather than a dead link or an "n/a".
   */
  fromIncidentId: string | null
}

/** One thing that happened to this incident. Append-only. */
export interface IncidentEvent {
  at: number
  /**
   * Machine-readable; the UI maps it to prose.
   *
   * `corroborated` IS NOT A NOTE, AND IT USED TO BE ONE. {@link corroborate}
   * wrote `note` with `byName: 'System'`, which put the game's "it is still
   * happening" on the timeline wearing an admin's handwriting — the same word,
   * the same marker, nothing on the row saying where it came from. The owner,
   * reading a real case: "corroboration doesn't show on the incident timeline".
   * It was showing. It was showing as a note.
   *
   * THE SET IS OPEN EVERYWHERE IT IS READ, which is why widening it costs
   * nothing downstream. `labelFor` humanises a kind no map names, `isCaseBracket`
   * and `isResolution` answer false for anything they do not recognise, and
   * `mergeTimeline` drops nothing. A row of this kind therefore renders with a
   * default marker and no verdict chip, which is what it should have.
   *
   * ROWS ALREADY WRITTEN STAY `note` AND ARE NOT BACKFILLED. There is no way to
   * tell an old corroboration from an admin's note without guessing at
   * `byName === 'System'`, and guessing is what this field exists to stop — the
   * same argument `verdict` makes about cases closed before it existed.
   */
  kind: 'opened' | 'note' | 'resolved' | 'corroborated'
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
   * Set only when this case was closed by a permanent ban issued somewhere else.
   *
   * See {@link ClosedByBan}. Written in the same conditional update as `state`
   * and `verdict`, so a row can never be an auto-closure with its provenance
   * still in flight.
   */
  closedByBan?: ClosedByBan | null

  /**
   * ═══ THE MATCH THIS WAS FILED DURING, WRITTEN BY THE GAME ═══
   *
   * The gamemode (`dev` @ 11c969b) records the match around an incident onto
   * the same row, in the same `PutItem` that files it. Everything below is
   * OPTIONAL AND ALWAYS WILL BE: every incident filed before 2026-08-20 has
   * none of it, and a report filed in the lobby has no match to describe.
   *
   * THE CONSOLE NEVER WRITES ANY OF IT, and the game never writes `events`.
   * Two attributes, two writers, no overlap — which is what lets the game's
   * grant stay a conditional `PutItem` that cannot reach inside an existing
   * case. They are merged for display only; see `lib/matchTimeline`.
   *
   * EVERY TIME HERE IS ABSOLUTE MILLISECONDS. Nothing stored is relative, and
   * offsets are computed at render time.
   *
   * `matchEndsBy` IS THE FIELD THAT MAKES AN ABSENT END READABLE. It is written
   * at filing time, while the game is still alive to write it, so a match with
   * no `matchEndedAt` can be told apart into "still running" and "the server
   * died before it could say". Without it an unfinished match reads as running
   * forever. `matchProgress` is the one reader.
   *
   * ═══ THREE TIMES, THREE FACTS, AND THEY ARE NOT INTERCHANGEABLE ═══
   *
   * `matchCreatedAt` is when the match was FORMED. `matchStartedAt` is when it
   * went live. `matchEndedAt` is when it finished. A match is minted into
   * warmup and only stamps a start on entering play, so the three are three
   * different instants and the middle one is ABSENT on a case filed on the
   * warmup pad. The gamemode keeps them apart on purpose (`br_ddb`'s
   * `incident.js`): one field holding two facts would make `matchStartedAt`
   * mean "the lobby opened" on some rows and "the match began" on others, with
   * nothing on either row saying which.
   */
  /**
   * THE GAME'S OWN MATCH NUMBER, and the join key to the player's history.
   *
   * WRITTEN SINCE THE MATCH FIELDS EXISTED — `buildIncidentItem` in the
   * gamemode's br_ddb puts it on the row in the same `PutItem` that files the
   * case. This console simply never read it, which is why the incident page
   * could show every kill in a match and not one thing the subject did in it.
   * `matchRecordFor` in `lib/matchTimeline` is the only reader.
   *
   * NOT UNIQUE ACROSS RESTARTS, which is the trap. It counts up from the
   * server's boot, so a player who has been here across two restarts can hold
   * two rows numbered 412 — from different days, with different results. The
   * join therefore never matches on this alone; `matchStartedAt` above is what
   * separates them, and the case is pinned by `check:timeline`.
   */
  matchId?: number | null
  /**
   * WHEN THE MATCH WAS FORMED, not when it began. Written by the `PutItem` at
   * filing, so it is present for every case with a match — including the one
   * shape that has nothing else: a case filed during warmup, which has no
   * start, no deadline and no end until the match actually runs.
   *
   * IT IS THE ONLY MATCH TIME A WARMUP CASE CARRIES, and reading it as a start
   * is the mistake the gamemode split the field to prevent. `matchProgress` is
   * the one reader.
   */
  matchCreatedAt?: number | null
  /**
   * WHEN THE MATCH WENT LIVE. Absent on a case filed before it did — the game
   * backfills it on the match-end write, so the same row gains a start and a
   * deadline later and stops being a warmup case.
   */
  matchStartedAt?: number | null
  /** Null until the match-end write lands. Absent is not the same as null. */
  matchEndedAt?: number | null
  matchEndsBy?: number | null
  /**
   * Appended with `list_append`, WHICH DOES NOT ORDER. Never render in stored
   * order — `mergeTimeline` sorts, and it is the only thing that may.
   */
  matchTimeline?: MatchTimelineEntry[] | null
  /** False when the ring buffer dropped kills. Absent means it did not. */
  matchTimelineComplete?: boolean
  /** How many kills really happened, when the list holds fewer. */
  matchKillsSeen?: number

  /**
   * ═══ THERE IS NO ARTIFACT FIELD ON THIS ROW, AND THAT IS DELIBERATE ═══
   *
   * `captureKeys?: string[]` used to sit here. It was removed on the owner's
   * instruction, 2026-08-20: "yeah let's not have captureKeys if we don't need
   * it."
   *
   * WHY A FIELD WAS WORSE THAN NO FIELD. Its only writer was the game, which
   * set it to `[]` at filing time and could never add to it — the game's grant
   * on `ringmaster-incidents` is `PutItem` conditional on the id being absent,
   * so it can file a case and cannot reach inside one. Nothing read it. An
   * always-empty list that looks authoritative is a trap for the next person,
   * who reads `captureKeys.length === 0` and concludes there are no frames.
   *
   * WHERE THE FRAMES ACTUALLY COME FROM: `lib/artifacts.ts`. The keys are fixed
   * and enumerable by design, so the console probes S3 for them instead. That
   * module also carries the sentence this field's comment existed for —
   * "EMPTY IS NORMAL AND IS NOT EVIDENCE OF ANYTHING" — because the reasoning
   * outlived the field and is now the carousel's governing rule.
   */
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
 *
 * ═══ WHY THIS IS A VIEW PLUS A REFRESHER RATHER THAN ONE `await` ═══
 *
 * It used to be a single `openCount(): Promise<number>` that the app shell
 * awaited on every navigation. The cache made that cheap most of the time and
 * expensive on a fifteen-second rhythm — but "most of the time" is the wrong
 * property for something on the critical path of every page load, because the
 * miss lands on whoever happens to navigate next and a scan is the most
 * expensive read in this module.
 *
 * SO IT IS SPLIT THE WAY `hostView` AND `maintenanceView` ARE SPLIT, which is
 * the pattern this codebase already uses for exactly this shape of problem: a
 * synchronous reader that hands out what we last learned and never blocks, and
 * a refresher somebody else drives on its own cadence. The shell reads the
 * view; `/api/state` drives the refresh on the poll that is already running.
 */
let countCache: { at: number; n: number } | null = null
const COUNT_TTL_MS = 15_000

/**
 * A recount already on the wire.
 *
 * WITHOUT THIS THE POLL WOULD STAMPEDE. `/api/state` is answered every two
 * seconds per open console, and the scan can take longer than that — so once
 * the TTL lapses, every console in flight would start its own scan of the same
 * table and each would overwrite the same cache entry. Sharing the promise
 * means the table is scanned once per TTL for the whole process no matter how
 * many browsers are watching.
 */
let countInFlight: Promise<void> | null = null

/**
 * The last count we actually managed, or `null` if we never have.
 *
 * SYNCHRONOUS AND NEVER A DATABASE READ — that is the entire point. Callers on
 * a render path use this and get last-known-good with no await.
 *
 * `null` IS NOT `0` AND THE DIFFERENCE IS THE WHOLE CONTRACT. Zero is a claim
 * that the queue is empty; null is "we have not managed to count". They must
 * not render the same way by accident, so this hands back the distinction and
 * lets the badge decide. See `NavBadges`.
 */
export function openCountView(): number | null {
  return countCache?.n ?? null
}

/**
 * Recount if what we hold has aged past the TTL.
 *
 * NEVER THROWS AND NEVER ZEROES. A failed scan leaves the previous value
 * exactly where it was rather than replacing it with a zero or a null: the
 * queue did not empty because DynamoDB was briefly unreachable, and a badge
 * that blinks out on a transient error teaches people to distrust it. The only
 * thing a failure costs is freshness, and the next tick tries again.
 *
 * RESOLVES WHEN THE CACHE IS CURRENT, so a caller that wants the freshest
 * available number can await it before reading the view. Nothing on a
 * navigation path does.
 */
export async function refreshOpenCount(): Promise<void> {
  if (countCache && Date.now() - countCache.at < COUNT_TTL_MS) return
  if (countInFlight) return countInFlight

  countInFlight = (async () => {
    try {
      const rows = await scanAll()
      countCache = {
        at: Date.now(),
        n: rows.filter((i) => i.state === 'pending_review').length,
      }
    } catch (e) {
      console.error('[incidents] open count failed', e)
    } finally {
      countInFlight = null
    }
  })()

  return countInFlight
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
 *
 * `closedByBan` RIDES ON THE SAME WRITE and does not get one of its own, which
 * is the same argument as the verdict's one line up: a second write would mean a
 * window in which a row is closed with a `ban` verdict and no sign that the ban
 * was issued on another case — and something reading it in that window would
 * count one ban twice. There is exactly one update that can move an incident to
 * `resolved`, and everything that describes the closure goes in it.
 *
 * REFUSAL IS DISTINGUISHED FROM FAILURE in the return, because they are
 * different events and one caller acts on the difference. A refusal is the
 * no-reopen rule working — somebody else closed this case first — and is an
 * ordinary outcome; a failure is the database. See
 * {@link closeOthersOnPermanentBan}, which counts them separately because a
 * sweep nobody is watching has to be able to say which of the two it hit.
 */
export async function resolve(input: {
  incidentId: string
  byLicense: string
  byName: string
  resolution: string
  verdict: IncidentVerdict
  /** Provenance, when the decision was not taken on THIS case. */
  closedByBan?: ClosedByBan
}): Promise<
  { ok: true } | { ok: false; reason: string; refused: boolean }
> {
  const now = Date.now()

  const event: IncidentEvent = {
    at: now,
    kind: 'resolved',
    byLicense: input.byLicense,
    byName: input.byName,
    text: input.resolution,
  }

  /**
   * Built rather than written out because ONE of the assignments is optional and
   * an unused `:placeholder` is a ValidationException on a moderation write —
   * DynamoDB rejects an ExpressionAttributeValues entry the expression never
   * names. The set below and the values below it are added together or not at
   * all.
   */
  const sets = [
    '#s = :resolved',
    'resolvedAt = :now',
    'resolvedByLicense = :by',
    'resolvedByName = :byName',
    'resolution = :res',
    '#verdict = :verdict',
    'events = list_append(events, :ev)',
  ]

  const values: Record<string, unknown> = {
    ':resolved': 'resolved' satisfies IncidentState,
    ':pending': 'pending_review' satisfies IncidentState,
    ':now': now,
    ':by': input.byLicense,
    ':byName': input.byName,
    ':res': input.resolution,
    ':verdict': input.verdict,
    ':ev': [event],
  }

  if (input.closedByBan) {
    sets.push('closedByBan = :cbb')
    values[':cbb'] = input.closedByBan
  }

  try {
    await ddb.update({
      TableName: tables.incidents,
      Key: { incidentId: input.incidentId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(incidentId) AND #s = :pending',
      // `#verdict` is aliased for the same reason `#s` is: neither name is worth
      // checking against DynamoDB's reserved-word list on every edit, and the
      // failure mode is a ValidationException on a moderation write.
      ExpressionAttributeNames: { '#s': 'state', '#verdict': 'verdict' },
      ExpressionAttributeValues: values,
    })
    countCache = null
    return { ok: true }
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'ConditionalCheckFailedException') {
      return {
        ok: false,
        reason: 'Already resolved, or no longer exists.',
        refused: true,
      }
    }
    console.error('[incidents] resolve failed', e)
    return {
      ok: false,
      reason: 'The database refused the change.',
      refused: false,
    }
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
 *
 * EXCEPT WHEN NOBODY IS WATCHING, which is the one case that inverts it. A
 * closure an admin asked for reports its own refusal to the admin who asked —
 * they are looking at a toast about it. An AUTOMATIC closure (`closedByBan`) has
 * no such reader: it happens in a loop after a ban, and if the write is refused
 * or the database fails, an after-the-fact audit row is never written and the
 * attempt leaves no trace anywhere. So that path records the intent FIRST and
 * stamps the outcome afterwards, which is what lib/audit's two-phase shape is
 * for and what its header says a success-only log costs. Same function, same
 * `incident.resolve` row, same fields — only the order changes.
 */
export async function closeWithVerdict(input: {
  incident: Incident
  actor: audit.Actor
  resolution: string
  verdict: IncidentVerdict
  /**
   * Present only when this closure follows a permanent ban issued on another
   * case (or on no case at all). See {@link ClosedByBan}.
   */
  closedByBan?: ClosedByBan
}): Promise<{ ok: true } | { ok: false; reason: string; refused: boolean }> {
  const automatic = input.closedByBan !== undefined

  const intent: Parameters<typeof audit.begin>[0] = {
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
      /**
       * THE SAME TELL THE ENFORCEMENT KICK CARRIES, and deliberately the same
       * string. Banning a connected player writes a `player.kick` row with
       * `becauseOf: 'ban.issue'` meaning "this is the ban being carried out, not
       * a second decision" — and a case closed BY that ban is the same claim
       * about the same act. lib/actionsTaken.ts drops both on one rule, which is
       * what keeps one ban reading as one ban on a moderator's profile no matter
       * how many cases it closed.
       *
       * The originating case does NOT carry it: that closure IS the admin's
       * decision, and it folds into its `ban.issue` row by `incidentId` exactly
       * as it always has.
       */
      ...(automatic ? { becauseOf: 'ban.issue' } : {}),
    },
  }

  const early = automatic ? await audit.begin(intent) : null

  const result = await resolve({
    incidentId: input.incident.incidentId,
    // The actor always has a license here — authorize() resolves the session to
    // a grants row, and grants are keyed on license.
    byLicense: input.actor.license ?? '',
    byName: input.actor.name,
    resolution: input.resolution,
    verdict: input.verdict,
    ...(input.closedByBan ? { closedByBan: input.closedByBan } : {}),
  })

  if (!result.ok) {
    if (early) await audit.resolve(early.ts, 'failed', result.reason)
    return result
  }

  const handle = early ?? (await audit.begin(intent))
  await audit.resolve(handle.ts, 'ok')

  return { ok: true }
}

/**
 * How many other cases one permanent ban may close.
 *
 * BOUNDED BECAUSE THE INPUT IS NOT. A prolific cheater accumulates reports
 * faster than anybody closes them — reports are rate-limited per player per
 * match, not per subject — so "every open case about this player" is a number
 * nothing in this system caps. Each closure is two round trips inside an HTTP
 * request that has ALREADY banned somebody, and a request that runs long enough
 * to be killed would leave the admin looking at an error for a ban that
 * succeeded.
 *
 * OVER THE CAP IS REPORTED, NEVER SILENT — the same rule `SCAN_LIMIT` follows a
 * few hundred lines up, and for the same reason: a sweep that quietly stops at
 * fifty reads exactly like a player who only had fifty. What is left over stays
 * `pending_review`, which is where it already was and where a human can still
 * see it.
 *
 * EXPORTED SO THE CAP CAN BE CHECKED RATHER THAN ASSUMED. `check:verdict` drives
 * the real sweep over more cases than this and asserts what it leaves behind; a
 * ceiling written down in two places would be a ceiling the check eventually
 * stops describing.
 */
export const AUTO_CLOSE_LIMIT = 50

/**
 * The sentence written onto every case this closes.
 *
 * PLACEHOLDER — THE OWNER HAS NOT GIVEN THE WORDS. It is the minimum factual
 * statement: what happened, and that it happened elsewhere. It deliberately does
 * NOT claim the report was accurate, does not name the case the ban came from
 * (the link does that, from a structured field, so no incident id is ever
 * interpolated into free text) and does not say what the reporter earned.
 *
 * ADMIN-FACING, LIKE EVERY OTHER `resolution`. It is stored on the row and in
 * the audit log's `reason`; the game's projection of an incident (`projectVerdict`
 * in the gamemode's br_ddb) carries `action`, `expiresAt`, `resolvedAt` and three
 * derived booleans, and no free text at all — so nothing here reaches a reporter.
 */
export const AUTO_CLOSE_RESOLUTION =
  'Closed automatically — a permanent ban was issued against this player while ' +
  'this case was open.'

/** What one sweep did. Every number is reported; none of them is inferred. */
export interface AutoCloseOutcome {
  /**
   * FALSE MEANS NOTHING BELOW HAPPENED. A temporary ban does not close anything
   * — no read, no write, no audit row — and this is how the caller knows the
   * zeroes mean "not attempted" rather than "nothing to do".
   */
  permanent: boolean
  /** Other cases still awaiting review, before the cap. */
  found: number
  closed: number
  /** The conditional update refused: a human closed it first. Not an error. */
  refused: number
  /** The database failed. Those cases are untouched and still pending. */
  failed: number
  /** Found beyond {@link AUTO_CLOSE_LIMIT} and deliberately not attempted. */
  leftOpen: number
  /** The lookup itself failed, so nothing was even considered. */
  lookupFailed: boolean
}

/**
 * Close every OTHER open case about a player who has just been banned forever.
 *
 * ═══ THE OWNER'S REQUIREMENT ═══
 *
 * "for any permanent bans that take place - all other incidents against the
 * freshly banned player should be resolved as 'no action' and a note saying why,
 * with a hyperlink to the original incident where they were banned from, if
 * there was one."
 *
 * ═══ WHY THE VERDICT IS `ban` AND NOT `none` ═══
 *
 * `none` HAS A MEANING THIS IS NOT. It is read from another repository, where it
 * means an admin looked and decided nothing was needed — and it is NOT payable,
 * so writing it here would deny 250 Volts to every reporter who correctly
 * flagged a player who turned out to warrant a permanent ban. The owner ruled
 * that those reports get paid: they were accurate, they simply were not the case
 * the ban was issued from.
 *
 * SO THE VERDICT IS WHAT ACTUALLY HAPPENED. The outcome of these cases is that
 * the player was permanently banned, and `{ action: 'ban', expiresAt: null }` is
 * that sentence in the contract's own words. It needs no change to the contract,
 * it reads as `payable` through the game's real reader, and it is true.
 *
 * A THIRD VERDICT VALUE WAS THE OBVIOUS ALTERNATIVE AND IS WORSE. Something like
 * `banned_elsewhere` would be more precise here and would be read by the game as
 * an action it does not recognise — which its reader correctly narrows to `null`,
 * i.e. "do not know", i.e. NOT payable. It would break the one property the
 * owner asked for while looking like the careful choice, and it would change a
 * contract `check:verdict` exists to hold still.
 *
 * WHAT CARRIES THE DIFFERENCE INSTEAD is `closedByBan` on the row: same verdict,
 * plus where the decision was actually made. See {@link ClosedByBan}.
 *
 * ═══ WHAT THIS WILL NOT DO ═══
 *
 * ONLY A PERMANENT BAN, decided by `expiresAt === null` ON THE ROW THAT WAS
 * ACTUALLY WRITTEN — not on the `days` a browser sent, and not on anything the
 * caller computed. A temporary ban returns immediately having read nothing.
 *
 * ONLY THIS PLAYER'S CASES, matched on `subjectLicense` against the license the
 * ban was issued for. There is no name matching and no fuzzy anything: these
 * closures are irreversible, so the selection is an equality test on the same
 * identifier every table in this console is keyed on.
 *
 * NEVER THE CASE THE BAN CAME FROM. That one is closed by the ban route with the
 * admin's own reason, and it is excluded here by id rather than left to the
 * conditional update to refuse — a refusal would be indistinguishable from
 * losing a race, and the number this returns would be a lie about the one case
 * the admin was actually looking at.
 *
 * NEVER A CASE THAT IS ALREADY RESOLVED, twice over: they are filtered out
 * before the loop, and `resolve()`'s condition would refuse them anyway. This is
 * not a second way to resolve an incident — it is the same single conditional
 * update, which is what makes "a bulk close cannot resolve a closed case" a
 * property of the database rather than of this loop.
 *
 * ═══ AND WHEN THE BAN IS LIFTED ═══
 *
 * NOTHING REOPENS. Incidents have two states and no way back (owner,
 * 2026-08-12) and verdicts cannot be changed after the fact (owner, 2026-08-17),
 * so a lift cannot walk these back and must not try. It does not strand them
 * either: the verdict remains true — that player WAS permanently banned when
 * this case was closed — the lift is a `ban.lift` row on the same profile, and
 * `lift()` in lib/bans keeps the ban row rather than deleting it. An expiry
 * cannot arise at all: this only ever runs when there is no expiry to reach.
 *
 * NEVER THROWS. It runs after a ban that has already happened to a person; an
 * exception here would surface as a failed request for a successful ban and
 * invite a retry that double-writes the log. Every failure is counted and
 * returned.
 */
export async function closeOthersOnPermanentBan(input: {
  /** The ban row as written. `expiresAt === null` is what "permanent" means. */
  ban: { license: string; expiresAt: number | null }
  /** The case the ban was issued from, or null for an on-demand ban. */
  fromIncidentId: string | null
  actor: audit.Actor
}): Promise<AutoCloseOutcome> {
  const outcome: AutoCloseOutcome = {
    permanent: input.ban.expiresAt === null,
    found: 0,
    closed: 0,
    refused: 0,
    failed: 0,
    leftOpen: 0,
    lookupFailed: false,
  }

  if (!outcome.permanent) return outcome

  let open: Incident[]
  try {
    open = (await forSubject(input.ban.license)).filter(
      (i) =>
        i.state === 'pending_review' &&
        i.incidentId !== input.fromIncidentId,
    )
  } catch (e) {
    console.error('[incidents] auto-close lookup failed', e)
    outcome.lookupFailed = true
    return outcome
  }

  outcome.found = open.length

  /**
   * OLDEST FIRST, like the queue itself. If the cap bites, the cases that get
   * closed are the ones that have been waiting longest — the same reason
   * `queue()` sorts the other way from every other list in this module.
   */
  const targets = [...open]
    .sort((a, b) => a.openedAt - b.openedAt)
    .slice(0, AUTO_CLOSE_LIMIT)

  outcome.leftOpen = open.length - targets.length

  /**
   * SEQUENTIAL, NOT `Promise.all`. Each iteration is a conditional write plus
   * two audit writes against tables sized for tens of actions a day, and firing
   * fifty of those at once is how a moderation action becomes the thing that
   * throttles a table. It also keeps the audit rows in an order a human can
   * read.
   *
   * PARTIAL FAILURE IS A REAL OUTCOME AND IT IS SAFE. There is no transaction
   * across these cases and there should not be — each close is one atomic
   * conditional update, so the third one failing leaves the first two closed,
   * the third exactly as it was, and the rest still to try. Nothing is ever
   * half-written, every attempt leaves an `incident.resolve` audit row saying
   * whether it landed, and anything that did not close is still `pending_review`
   * in the queue where a human will find it.
   */
  for (const incident of targets) {
    try {
      const res = await closeWithVerdict({
        incident,
        actor: input.actor,
        resolution: AUTO_CLOSE_RESOLUTION,
        verdict: { action: 'ban', expiresAt: null },
        closedByBan: { fromIncidentId: input.fromIncidentId },
      })

      if (res.ok) outcome.closed++
      else if (res.refused) outcome.refused++
      else outcome.failed++
    } catch (e) {
      /**
       * THE ONE FAILURE THAT LEAVES NO ROW. `closeWithVerdict` swallows a failed
       * incident write and reports it, but `audit.begin` throws — deliberately,
       * because an unlogged admin action is what that table exists to prevent.
       * Here that means the audit row itself could not be written, so the
       * operator log is the only place left to say so, and the case stays
       * pending.
       */
      console.error('[incidents] auto-close failed', {
        incidentId: incident.incidentId,
        e,
      })
      outcome.failed++
    }
  }

  return outcome
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
 * no-reopen rule holds. The row lands on the timeline either way, which is
 * where somebody deciding whether to look again will see it.
 *
 * ═══ AND IT IS ITS OWN KIND, WHICH IT WAS NOT ═══
 *
 * This wrote `kind: 'note'`. Everything worked: the game emitted
 * `incident_corroborated`, the ingest route applied it, the row grew, the
 * timeline rendered it. It rendered it as "Note", identically to a sentence an
 * admin typed, and the only thing separating the two on the page was
 * `byName: 'System'` in the meta line under it. So the console was recording
 * corroboration and showing nothing that says corroboration, which is what the
 * owner reported as it not showing at all.
 *
 * NOTHING ELSE ON THE PATH CHANGED, and that is the measure of how narrow this
 * is. Same event, same UpdateExpression, same attribute, same append. One
 * string on the row is different, and the renderer's existing fallback turns it
 * into a word — see {@link IncidentEvent.kind} for why widening the set is safe
 * at every reader.
 */
export async function corroborate(input: {
  incidentId: string
  at: number
  text: string
}): Promise<boolean> {
  const event: IncidentEvent = {
    at: input.at,
    kind: 'corroborated',
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
