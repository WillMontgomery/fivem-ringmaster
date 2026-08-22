/**
 * ═══ WHAT HAPPENED IN THE MATCH, AS THE GAME WROTE IT DOWN ═══
 *
 * The gamemode (`dev` @ 11c969b) now records the match an incident was filed
 * during, straight onto the incident row in `ringmaster-incidents`. This module
 * is every decision the console makes about that data, kept away from the
 * markup so it can be checked — see `matchTimeline.check.ts`, which runs in
 * `npm run verify`.
 *
 * NO RUNTIME IMPORTS, deliberately, the same property `serverPhase` and
 * `labels` keep. `lib/incidents` reaches DynamoDB, so a type import from it
 * would be free and a value import would drag the AWS SDK into a check script
 * and into the client bundle. The console event's shape is therefore restated
 * here structurally as {@link ConsoleTimelineEvent} rather than imported, which
 * also keeps the dependency pointing one way: `incidents` imports these types,
 * and this imports nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIVE RULES THAT ARE EASY TO GET WRONG
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. `list_append` DOES NOT ORDER. DynamoDB appends where it likes under
 *    concurrent updates, so the stored list is not sorted and must never be
 *    rendered in stored order. {@link mergeTimeline} sorts, and it is the only
 *    thing that may.
 *
 * 2. EVERY STORED TIME IS ABSOLUTE MILLISECONDS. Nothing on the row is
 *    relative. `+2:14` is a thing this console computes at render time from
 *    `openedAt` — see {@link matchOffset} — and never a thing it reads.
 *
 * 3. RED ONLY ON AN EXPLICIT `weaponIssued === false`. Absent and `true` are
 *    both ordinary. This is not defensiveness, it is two real populations:
 *    every incident filed before 2026-08-20 has no `weaponIssued` at all, and
 *    environmental deaths — fall, drowning, storm — omit the field on purpose
 *    because there is no weapon claim to make. Painting either of those red
 *    accuses somebody of cheating for falling off a cliff. {@link weaponPart}
 *    is where the comparison lives, once, and `check:timeline` pins all three
 *    readings.
 *
 * 4. AN ABSENT MATCH END IS NOT "STILL RUNNING". `matchEndsBy` is written at
 *    filing time, while the game is still alive to write it, so a match whose
 *    end never landed can be told apart from one that is genuinely in flight —
 *    the deadline has passed and nothing wrote the end, which means a crash or
 *    a restart ate it. {@link matchProgress} returns those as different states
 *    and the console must not merge them.
 *
 * 5. A MATCH BEING FORMED IS NOT A MATCH STARTING. A match is minted into
 *    warmup and stamps `matchStartedAt` only on entering play, so a case filed
 *    on the warmup pad carries `matchCreatedAt` and NOTHING ELSE — no start, no
 *    deadline, no end. That row is not "filed outside a match": it names a
 *    `matchId` and it is the earliest a weapon-strip case can possibly be
 *    filed. {@link matchProgress} answers `warmup` for it, `match_created` is
 *    the timeline entry the game anchors it on, and neither may be collapsed
 *    into the start. The game keeps the two apart in `br_ddb`'s `incident.js`
 *    for the same reason this does: one field holding two facts is a field
 *    nothing can render honestly.
 */

/** A number, or null for anything that is not one. Absent, null and NaN alike. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** A non-empty trimmed string, or null. `''` from the game means "not set". */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * One entry in `matchTimeline`, as it comes out of DynamoDB.
 *
 * A FLAT INTERFACE WITH OPTIONAL FIELDS, NOT A DISCRIMINATED UNION, and that is
 * a considered choice rather than laziness. Two reasons:
 *
 *   · The row is unvalidated. `ddb.get` casts, so a union would be a claim
 *     about data this console did not write and cannot enforce — a `kill` entry
 *     that somehow arrived without a `victimName` would be typed as having one.
 *   · `kind` is an open set. A newer gamemode build may append a kind this
 *     console has never heard of, and a union of literals plus a `string`
 *     member defeats narrowing on every other member. An open `kind` with
 *     {@link isKill} as the one narrowing predicate keeps the reader honest.
 */
export interface MatchTimelineEntry {
  /** Absolute milliseconds. */
  at: number
  /**
   * `match_created`, `match_start`, `match_end`, `kill`, `weapon_strip` — and
   * whatever a newer build adds.
   *
   * `weapon_strip` CARRIES A `weapon` AND NOTHING ELSE. No label, because the
   * gamemode has no name for a weapon it does not hand out; no `weaponIssued`,
   * because the kind IS the claim; no parties, because a strip is a fact about
   * the subject's own ped and the row already names them.
   */
  kind: string

  /** Kill entries only, from here down — except `weapon`, which a strip has. */
  killerLicense?: string | null
  killerName?: string | null
  victimLicense?: string | null
  victimName?: string | null
  /** The weapon id, e.g. `WEAPON_MARKSMANRIFLE`. */
  weapon?: string | null
  /** The display name, e.g. `Marksman Rifle`. May be absent. */
  weaponLabel?: string | null
  /**
   * `true` when the gamemode issues this weapon, `false` when it does not
   * recognise it at all, and ABSENT when the cause was not a weapon claim.
   * Read rule 3 in this file's header before touching anything that reads it.
   */
  weaponIssued?: boolean
  /** How they died — `fall`, `drowning`, `storm`, a weapon cause, … */
  cause?: string | null
  headshot?: boolean
}

/**
 * The console's own event, structurally.
 *
 * `IncidentEvent` from `lib/incidents` satisfies this — its `kind` is a
 * narrower union, which is assignable to `string`. Restated rather than
 * imported so this module keeps its no-imports property; the assignability is
 * asserted in the check.
 */
export interface ConsoleTimelineEvent {
  at: number
  kind: string
  byLicense: string | null
  byName: string
  text?: string
}

/** The match attributes on an incident row. Every one of them optional. */
export interface MatchFields {
  /** The game's match number. See {@link matchRecordFor} for why it is not a key. */
  matchId?: number | null
  /** When the match was FORMED. Rule 5 — not an early `matchStartedAt`. */
  matchCreatedAt?: number | null
  matchStartedAt?: number | null
  matchEndedAt?: number | null
  matchEndsBy?: number | null
  matchTimeline?: MatchTimelineEntry[] | null
  matchTimelineComplete?: boolean
  matchKillsSeen?: number
}

export function isKill(e: MatchTimelineEntry): boolean {
  return e.kind === 'kill'
}

/**
 * The ends of the match, as opposed to something that happened inside it.
 *
 * WHAT IT DECIDES: the marker tone on the timeline — a bracket is drawn in the
 * accent, everything else muted. Nothing about the sentence.
 *
 * A FUNCTION HERE RATHER THAN A COMPARISON IN THE JSX, and the reason is
 * exactly the one this module's header gives. The set had two members and was
 * spelled inline in `IncidentTimeline`; `match_created` is a third, and a set
 * that grows in markup is a set nothing checks. `check:timeline` pins the
 * membership and asserts the component asks this rather than asking itself.
 *
 * `match_created` IS A BRACKET BECAUSE IT IS THE OPENING ONE. Rule 5: the game
 * anchors a warmup case's timeline on it precisely because there is no start,
 * so on that row it is the beginning, and a beginning drawn in the muted tone
 * would read as one more thing that happened rather than as the edge.
 */
export function isBracket(e: MatchTimelineEntry): boolean {
  return (
    e.kind === 'match_created' || e.kind === 'match_start' || e.kind === 'match_end'
  )
}

/**
 * English for the kinds the game writes.
 *
 * Past tense to match the console's own three — `Opened`, `Note`, `Resolved` —
 * so one merged list does not read as though it came from two places. Consulted
 * through `labelFor`, so a kind from a newer build degrades to a humanised id
 * rather than to a blank.
 *
 * ═══ `match_created` READS "FORMED", AND THE WORD IS THE WHOLE POINT ═══
 *
 * The game gave this a kind of its own precisely so the console would stop
 * having to say "the match started" about a match that had not. Anything
 * sharing a stem with `match_start` gives that back: on a row that has both,
 * two lines beginning "Match st…" are two beginnings, and on a warmup row a
 * reader who skims sees a start that never happened. "Formed" is also the
 * gamemode's own word for it — `br_ddb`'s `incident.js` says the console "can
 * say 'formed' where that is what happened", and `docs/security.md` there
 * describes the field as when the match was formed.
 *
 * IT IS NOT WHAT THE FALLBACK WOULD PRODUCE, and that is deliberate rather than
 * incidental. `labelFor` humanises an unmapped id, so an absent entry here
 * renders `Match created` — legible, machine-flavoured, and close enough to
 * "started" to defeat the reason the kind exists. Because the two differ, this
 * map entry is load-bearing and deleting it is visible.
 *
 * `weapon_strip` IS DELIBERATELY NOT IN THIS MAP. `labelFor` already humanises
 * it to `Weapon strip`, and a map entry spelling the identical string would be
 * a second place for one word to live and to rot. If it ever wants wording that
 * is not the mechanical one, that is the owner's to give.
 */
export const MATCH_EVENT_LABEL: Record<string, string> = {
  match_created: 'Match formed',
  match_start: 'Match started',
  match_end: 'Match ended',
  kill: 'Kill',
}

/**
 * English for the three the CONSOLE writes about itself.
 *
 * THE OWNER'S OWN WORDING, PLAYTEST 2026-08-22: "'Opened' and 'Resolved' on the
 * timeline should be called 'Incident opened' and 'Incident resolved'". Both
 * strings are verbatim.
 *
 * WHY THAT READS BETTER ON A MERGED LIST, which is the argument for keeping it.
 * This list has two writers, and the game's half already names its subject on
 * every row it contributes — `Match formed`, `Match started`, `Match ended`.
 * Beside those, a bare `Opened` was the only bracket on the page that did not
 * say what had opened, on a list whose other brackets are all about the match.
 *
 * `note` IS UNQUALIFIED AND STAYS THAT WAY. It is not a bracket, the owner did
 * not rename it, and "Incident note" would be prose nobody asked for.
 *
 * MOVED OUT OF `IncidentTimeline` TO GET HERE, for this module's stated reason:
 * a label spelled in markup is a label nothing checks. `check:timeline` pins
 * these strings and asserts the component looks them up rather than writing
 * them.
 */
export const CONSOLE_EVENT_LABEL: Record<string, string> = {
  opened: 'Incident opened',
  note: 'Note',
  resolved: 'Incident resolved',
}

/**
 * The ends of the CASE, as opposed to something recorded along the way.
 *
 * {@link isBracket} is this function for the match; this is it for the
 * incident. What it decides is the marker tone and nothing else.
 *
 * ═══ RED, AND THE OWNER ASKED FOR IT BY COLOUR ═══
 *
 * "'Opened' and 'Resolved' … with red dots next to them, not black dots." Those
 * two rows were taking the `default` marker tone, whose dot is `--border` — so
 * the two events that bracket the entire record were the faintest marks on the
 * list, fainter than the kills. The match brackets already own the accent; the
 * case's own brackets take the danger token.
 *
 * IT IS NOT A SEVERITY CLAIM, and that is worth writing down because red means
 * "something was done to a person" everywhere else in this console — see
 * `verdictTone` in `lib/incidentChip`. Here it is structural: these are the
 * edges of the record, drawn like edges. A case closed with "no action" gets
 * exactly the same dot as one that ended in a ban, because the dot is not about
 * the verdict.
 *
 * A FUNCTION RATHER THAN A COMPARISON IN THE JSX, for `isBracket`'s reason: a
 * set spelled in markup is a set nothing can check, and this one is two thirds
 * of the console's own kinds — the day a fourth arrives, the question of which
 * side it falls on should fail a test rather than be answered by whoever is
 * editing the component.
 */
export function isCaseBracket(e: ConsoleTimelineEvent): boolean {
  return e.kind === 'opened' || e.kind === 'resolved'
}

// ---------------------------------------------------------------------------
// Merging the two lists
// ---------------------------------------------------------------------------

export type TimelineRow =
  | { at: number; source: 'console'; index: number; event: ConsoleTimelineEvent }
  | { at: number; source: 'match'; index: number; entry: MatchTimelineEntry }

/**
 * Where a row sorts against another at the SAME millisecond.
 *
 * The bracket events are the only ones with an inherent position: a match
 * cannot start after something that happened inside it, and cannot end before
 * one. Everything else ties at 1 and falls through to source and index, which
 * is what makes the order stable rather than merely deterministic-looking.
 *
 * `match_created` OUTRANKS `match_start` BECAUSE A MATCH IS FORMED BEFORE IT
 * BEGINS. The game only writes one of the two — `match_created` is the anchor
 * when there is no start to anchor on — so a row carrying both is not a shape
 * it produces today. This orders them anyway, because the cost is one line and
 * the alternative is a sort that is correct only while an upstream promise
 * holds.
 */
function rank(row: TimelineRow): number {
  if (row.source !== 'match') return 1
  if (row.entry.kind === 'match_created') return -1
  if (row.entry.kind === 'match_start') return 0
  if (row.entry.kind === 'match_end') return 2
  return 1
}

/** A missing or broken `at` sinks to the end rather than poisoning the sort. */
function sortableAt(v: unknown): number {
  return num(v) ?? Number.POSITIVE_INFINITY
}

/**
 * The console's events and the game's entries, as one list, oldest first.
 *
 * TWO WRITERS, ONE READER. The game never writes `events` and the console never
 * writes `matchTimeline` — they are separate attributes with separate grants —
 * so nothing upstream can put them in one order. This is the only place they
 * meet, and it sorts because rule 1 says the stored order is not an order.
 *
 * NOTHING IS DROPPED. A row whose `at` is absent or unparseable still renders;
 * it sorts to the end and its timestamp renders as an em dash, which is the
 * console's existing answer for an instant it cannot format. Silently
 * discarding a kill because its clock was odd would be the worse failure.
 */
export function mergeTimeline(
  events: readonly ConsoleTimelineEvent[] | null | undefined,
  entries: readonly MatchTimelineEntry[] | null | undefined,
): TimelineRow[] {
  const rows: TimelineRow[] = []

  ;(events ?? []).forEach((event, index) => {
    rows.push({ at: event?.at, source: 'console', index, event })
  })
  ;(entries ?? []).forEach((entry, index) => {
    rows.push({ at: entry?.at, source: 'match', index, entry })
  })

  return rows.sort((a, b) => {
    const at = sortableAt(a.at) - sortableAt(b.at)
    if (at !== 0) return at
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    if (a.source !== b.source) return a.source === 'console' ? -1 : 1
    return a.index - b.index
  })
}

/**
 * The furthest a row may sit from the incident opening and still be given a
 * number. One hour, on BOTH sides.
 *
 * ═══ THE LIMIT USED TO BE THE MATCH, AND IT CUT THE WRONG ROWS ═══
 *
 * An offset was drawn only for rows inside `[matchStartedAt, matchEndedAt ??
 * matchEndsBy]`. On an ordinary case that is invisible — the report is filed
 * mid-match, so everything is inside it. On a WARMUP-FILED case (rule 5, and
 * the cases worth the most) it deleted the top half of the page: the incident
 * is opened before the match enters play, so the anchor, every strip that
 * provoked the report, the opening event itself and often the resolve all fell
 * before `matchStartedAt` and lost their number, while the rows after the start
 * kept theirs. THE OWNER, ON A REAL PAGE: "Yes they are missing. Look at the
 * timestamps here - several are missing '-0:33' etc."
 *
 * ═══ BUT THAT WINDOW'S REASON WAS NEVER THE MATCH ═══
 *
 * What it actually protected against is a MAGNITUDE. An incident is resolved
 * hours or days after it is filed, and `+4322:17` on the resolve row is
 * arithmetically true and factually nonsense — not because the row is outside
 * the match, but because a four-digit minute count is not a duration anybody
 * reads. So the limit stays and stops being about the match: a row is placed
 * while it is within an hour of the opening, and the largest thing this module
 * can print is therefore `±59:59`.
 *
 * ONE HOUR IS THREE MATCHES. `matchEndsBy` is twenty minutes out on this
 * gamemode, so nothing that happened inside the match an incident was filed
 * during can fall outside this — the whole match fits with forty minutes to
 * spare whichever end of it the report landed on. It is a limit on nonsense,
 * not a limit on evidence.
 *
 * SYMMETRIC, WHICH THE OLD RULE WAS ONLY BY ACCIDENT. `matchStartedAt` was the
 * only thing bounding the negative side, and dropping it with nothing in its
 * place would let a stored entry belonging to a DIFFERENT match wearing the same
 * number — the failure {@link matchRecordFor} exists to describe — print
 * `-182:14` on this one. One comparison now answers both ends.
 */
const OFFSET_REACH_MS = 60 * 60_000

/**
 * How far this sits from the moment the incident was opened. `+2:14`, `-1:30`.
 *
 * COMPUTED, NEVER READ — rule 2.
 *
 * ═══ ONE INSTANT DECIDES EVERY NUMBER ON THE LIST ═══
 *
 * `incident.openedAt`, and nothing else. "all the timestamps should be relative
 * to the incident being opened, not the match starting" — the owner, playtest.
 * A row before it reads negative, a row after it reads positive, and the opening
 * event itself reads `+0:00` because it IS the origin.
 *
 * NO MATCH ATTRIBUTE IS READ HERE ANY MORE, and that is the change rather than
 * an omission. The ruler belongs to the case, so a case with no match at all — a
 * report filed in the lobby — is placed exactly like every other: it has an
 * opening, therefore it has a zero, therefore its notes and its close carry
 * numbers. There is no longer a shape whose rows are silently unplaceable.
 *
 * A NEGATIVE IS THE POINT, NOT AN EDGE CASE. An incident is filed AFTER whatever
 * provoked it, so most of the interesting rows on this list happened before its
 * zero. `-1:30` reads "a minute and a half before the report". The sign is
 * always printed, on both sides, so no row is ambiguous about which way it
 * points.
 *
 * THE RESOLVE ROW GETS ONE WHEN IT DESERVES ONE, and that is not a special case
 * — it is what falls out of the rule. Closed a minute after filing, it reads
 * `+1:11` and a reader learns something they would otherwise have to subtract
 * two wall clocks to get. Closed the next morning it is past
 * {@link OFFSET_REACH_MS} and carries nothing, which is the reading the match
 * bound was really there to suppress.
 *
 * SUB-SECOND TRUNCATES TOWARDS ZERO, on both sides, which is why the sign and
 * the magnitude are computed separately. A single `Math.floor` over a signed
 * difference rounds a row 1.999s BEFORE the report to `-0:02` — away from
 * zero, and inconsistent with the `+0:01` the same distance after it.
 */
export function matchOffset(at: unknown, origin: unknown): string | null {
  const t = num(at)
  const zero = num(origin)
  if (t === null || zero === null) return null

  const delta = t - zero
  const magnitude = Math.abs(delta)
  if (magnitude >= OFFSET_REACH_MS) return null

  const s = Math.floor(magnitude / 1000)
  const sign = delta < 0 ? '-' : '+'
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Did the match finish?
// ---------------------------------------------------------------------------

/**
 * THREE STATES, NOT TWO — rule 4. AND `none` IS NOT ONE OF THEM — rule 5.
 *
 *   none        no match attributes at all: filed outside a match, or a row
 *               written before the game recorded any of this
 *   warmup      the match was FORMED and had not begun. `matchCreatedAt` and
 *               nothing else. See below — this used to answer `none`.
 *   ended       `matchEndedAt` landed
 *   running     no end yet, and the deadline has not passed
 *   unreported  no end, and the deadline HAS passed — the server died holding
 *               the write
 *   unknown     a match with no end and no deadline. Cannot be placed, so the
 *               console says nothing rather than guessing which of the two
 *               middle states it was.
 *
 * ═══ WHY `warmup` HAD TO STOP BEING `none` ═══
 *
 * `none` is documented above as "filed outside a match", AND THAT WAS A FALSE
 * STATEMENT ABOUT A ROW CARRYING A `matchId`. A match is minted into warmup and
 * stamps `matchStartedAt` only on entering play, so a case opened on the warmup
 * pad arrived here with a creation time and nothing else and was classified as
 * though no match existed. It does exist; the offender is standing in it.
 *
 * AND THOSE ARE THE CASES WORTH THE MOST, which is why a wrong word about them
 * is not a cosmetic problem. vMenu is a development tool that is not going to
 * production, so there is no benign route to a weapon this gamemode never
 * issued: a `weapon_strip` is a cheat signal, and one filed during warmup is
 * the earliest signal available — before the offender has touched a real
 * player.
 *
 * THE SAME ROW LEAVES THIS STATE ON ITS OWN. The game's match-end write
 * backfills `matchStartedAt` and `matchEndsBy`, so a warmup case that ran to
 * completion answers `ended` afterwards, from the same attributes, with no
 * migration and nothing here to special-case.
 *
 * `warmup` GETS NO CHIP, and {@link MATCH_PROGRESS_LABEL} is where that is
 * argued rather than here.
 */
export type MatchProgress =
  | 'none'
  | 'warmup'
  | 'ended'
  | 'running'
  | 'unreported'
  | 'unknown'

export function matchProgress(m: MatchFields, now: number): MatchProgress {
  const started = num(m.matchStartedAt)
  const ended = num(m.matchEndedAt)
  const deadline = num(m.matchEndsBy)

  if (ended !== null) return 'ended'
  /*
   * NO START AND NO DEADLINE IS THE WARMUP SHAPE OR IT IS NOTHING, and the
   * creation time is the only thing that can tell those two apart. Read here
   * rather than at the top so that every row which HAS a start or a deadline
   * keeps the answer it had before this field existed — a creation time on an
   * ordinary match is extra context, never a reclassification.
   */
  if (started === null && deadline === null) {
    return num(m.matchCreatedAt) === null ? 'none' : 'warmup'
  }
  if (deadline === null) return 'unknown'
  return now < deadline ? 'running' : 'unreported'
}

/**
 * The chip, in the owner's own words from the brief.
 *
 * ONLY THE TWO STATES THAT ARE NOT SELF-EVIDENT GET ONE. A match that ended has
 * a `match_end` row in the list saying so, and `none`/`unknown` are the states
 * where the console has nothing to claim — a chip there would be the console
 * announcing its own ignorance, which is not data.
 *
 * ═══ `warmup` GETS NO CHIP EITHER, AND THAT IS A DECISION, NOT AN OMISSION ═══
 *
 * The two entries below are the OWNER'S OWN WORDS. There are no owner's words
 * for a warmup case, and `docs/hover-text.md` rule 8 is explicit about what to
 * do with a state that has none: "report it and wait", not write something
 * reasonable-sounding. So the state is classified honestly and the page says
 * only what the game gave it to say — a `Match formed` row where a `Match
 * started` row would otherwise be.
 *
 * IF THE OWNER WANTS ONE, THIS IS THE LINE IT GOES ON, and it costs a string.
 * `--phase-warmup` is already a token in `globals.css` and its ten-percent
 * background tint is already listed in the CEF override block at the end of
 * that file, so the colour would not cost a gate either. The wording is the
 * only thing missing and it is not ours to invent.
 *
 * THE UTILITY IS DESCRIBED HERE RATHER THAN SPELLED. Tailwind 4 scans source
 * TEXT, so a class name written in prose is extracted, emitted and then
 * correctly reported by `check:cef` — see {@link WEAPON_UNAUTHORIZED_CLASS},
 * which cost this file a failing gate once already.
 */
export const MATCH_PROGRESS_LABEL: Partial<Record<MatchProgress, string>> = {
  running: 'still in progress',
  unreported: 'end never reported',
}

/**
 * Kills the buffer dropped, as two numbers.
 *
 * A COUNT, NOT AN APOLOGY. `matchTimelineComplete === false` means the ring
 * buffer overflowed and some kills are simply not on the row; `matchKillsSeen`
 * is how many the game actually counted. The console shows both and says
 * nothing about it.
 *
 * NULL WHEN THE PAIR IS INCOMPLETE. Without `matchKillsSeen` there is no
 * discrepancy to state — only a flag saying one exists — and "12 of ? kills" is
 * a sentence about the console rather than about the match. The game writes the
 * two together; a row with one and not the other is a shape it does not
 * produce.
 */
export function killDiscrepancy(m: MatchFields): { shown: number; seen: number } | null {
  if (m.matchTimelineComplete !== false) return null
  const seen = num(m.matchKillsSeen)
  if (seen === null) return null
  return { shown: (m.matchTimeline ?? []).filter(isKill).length, seen }
}

// ---------------------------------------------------------------------------
// What the subject actually did in that match
// ---------------------------------------------------------------------------

/**
 * The two fields the join needs off a match-history row.
 *
 * RESTATED STRUCTURALLY, like {@link ConsoleTimelineEvent} above and for the
 * same reason: `ProfileMatch` lives in `lib/profile` and `GameMatch` in
 * `lib/gameProfile`, which reaches DynamoDB. This module imports nothing, and
 * the generic below hands the caller back its OWN row type rather than this
 * one, so nothing is narrowed on the way through.
 */
export interface MatchRecordRow {
  matchId: number
  endedAt: number
}

/**
 * The row in this player's history that IS the match this incident was filed
 * during. Null when there is no such row, which is ordinary.
 *
 * ═══ WHY THIS IS NOT `rows.find(r => r.matchId === incident.matchId)` ═══
 *
 * THE MATCH NUMBER IS NOT A KEY. It counts up from the game server's boot, so
 * two restarts apart a player can hold two history rows both numbered 412 — one
 * from this afternoon, one from March. Matching on it alone puts March's
 * placement and kills on this afternoon's incident, on a page somebody bans
 * people from, and nothing about the result would look wrong.
 *
 * SO THE MATCH WINDOW BREAKS THE TIE. `matchStartedAt` is on the incident row,
 * written by the game at filing time; a match cannot have ended before it
 * started, so any candidate whose `endedAt` precedes it is a different match
 * wearing the same number. Of what survives, the EARLIEST end is this one —
 * anything later is a subsequent match that reached the same number again.
 *
 * AND WHEN IT CANNOT TELL, IT SAYS NOTHING. Two candidates and no
 * `matchStartedAt` to place them by is a genuine ambiguity, and a console that
 * picks one is a console guessing on a moderation page. Null is the honest
 * answer and the section renders it as an em dash, exactly like no row at all.
 *
 * NULL IS NOT "THEY DID NOTHING", and every caller has to keep that straight.
 * The rows are written when a match ENDS, so a case filed mid-match has none
 * yet; the history read is bounded, so an old enough incident is past the end
 * of it; and a report filed in the lobby has no match to look for.
 */
export function matchRecordFor<T extends MatchRecordRow>(
  incident: MatchFields,
  rows: readonly T[] | null | undefined,
): T | null {
  const id = num(incident.matchId)
  if (id === null) return null

  const start = num(incident.matchStartedAt)
  const candidates = (rows ?? []).filter((r) => {
    if (num(r?.matchId) !== id) return false
    if (start === null) return true
    const ended = num(r?.endedAt)
    return ended !== null && ended >= start
  })

  const [only] = candidates
  if (only === undefined) return null
  if (candidates.length === 1) return only
  if (start === null) return null

  return candidates.reduce((best, r) => (r.endedAt < best.endedAt ? r : best), only)
}

// ---------------------------------------------------------------------------
// One kill, as a sentence
// ---------------------------------------------------------------------------

export interface TimelineParty {
  /**
   * THE KEY A PROFILE IS FOUND BY, and the only one. Display names are chosen
   * by the player and are not unique — two people called `Rebel` are two
   * people, and linking by name sends an admin to whichever profile the search
   * happened to return. Null when the game recorded no license, in which case
   * the name renders as plain text and links nowhere.
   */
  license: string | null
  name: string
}

export interface WeaponPart {
  /**
   * What to print. `weaponLabel` when the game gave one, otherwise the raw
   * weapon id, VERBATIM.
   *
   * The raw id is deliberately not prettified. `lib/labels` makes the argument
   * at length: a value this build has never heard of should stay legible AND
   * stay visibly foreign, rather than being dressed up as English by a
   * transform that is guessing. `WEAPON_MARKSMANRIFLE` on the page is a
   * gamemode that has not shipped a label yet; `Weapon Marksmanrifle` is the
   * console pretending it knows.
   */
  raw: string
  /**
   * `a` / `an`, or null when {@link raw} is an unlabelled id and no article is
   * honest in front of it.
   */
  article: 'a' | 'an' | null
  /** EXPLICIT `weaponIssued === false`, and nothing else. Rule 3. */
  unauthorized: boolean
}

export interface KillLine {
  /**
   * Null when there is nobody else involved — no killer recorded, or the killer
   * IS the victim, which is how an environmental death arrives.
   */
  killer: TimelineParty | null
  victim: TimelineParty
  weapon: WeaponPart | null
  /** Humanised `cause`, when there is one. `fall` -> `Fall`. */
  cause: string | null
  headshot: boolean
}

/**
 * Letters whose NAME starts with a vowel sound, for an all-caps initialism.
 *
 * `an SMG`, `an RPG`, `an AP Pistol`, `an MG` — because they are read out
 * letter by letter ("es-em-gee") and the article follows the sound, not the
 * spelling. `a PDW`, `a GTA`. This is the standard set and it is worth having
 * written down: reaching for a plain vowel test here produces "a SMG".
 */
const VOWEL_SOUNDING_INITIAL = /^[aefhilmnorsx]/i

/** Two or more characters, no lowercase, at least one letter. `SMG`, `AP`. */
const INITIALISM = /^(?=.*[A-Z])[A-Z0-9]{2,}$/

/**
 * `a` or `an`, for a weapon's display name.
 *
 * MECHANICAL AND STATED, because the alternative is a hand-maintained list of
 * every weapon the gamemode might ever issue, kept in a repository that does
 * not own the weapon list. Two rules:
 *
 *   · An all-caps first token is read letter by letter, so the article follows
 *     the name of its first LETTER.
 *   · Anything else follows its first letter being a vowel.
 *
 * WHERE IT IS WRONG IT IS WRONG QUIETLY. A word spelled with a vowel and
 * pronounced with a consonant — a "yoo-" word — takes `a` in careful English
 * and gets `an` here. No weapon in the gamemode's list is one, and a rule with
 * an exception table is a rule that rots the first time somebody adds a gun.
 */
export function indefiniteArticle(label: string): 'a' | 'an' {
  const first = (text(label) ?? '').split(/[\s-]+/)[0] ?? ''
  if (first === '') return 'a'
  if (INITIALISM.test(first)) return VOWEL_SOUNDING_INITIAL.test(first) ? 'an' : 'a'
  return /^[aeiou]/i.test(first) ? 'an' : 'a'
}

/**
 * The weapon half of the sentence, and the ONE place `weaponIssued` is read.
 *
 * `unauthorized` is `=== false`. Not `!weaponIssued`, not `weaponIssued ??
 * false`, not a truthiness test — those three all turn an ABSENT field into an
 * accusation, and absent is the majority of the table. Rule 3.
 */
export function weaponPart(e: MatchTimelineEntry): WeaponPart | null {
  const label = text(e.weaponLabel)
  const raw = label ?? text(e.weapon)
  if (raw === null) return null

  return {
    raw,
    article: label === null ? null : indefiniteArticle(label),
    unauthorized: e.weaponIssued === false,
  }
}

/**
 * `Rebel killed Haley with a Marksman Rifle`, in parts.
 *
 * PARTS RATHER THAN A STRING because two of them are links and one of them may
 * be red. A function returning the finished sentence would force the component
 * to take it apart again, and the taking-apart is where a name would end up
 * matched by text instead of by license.
 */
export function killLine(e: MatchTimelineEntry): KillLine {
  const victimLicense = text(e.victimLicense)
  const victimName = text(e.victimName)
  const killerLicense = text(e.killerLicense)
  const killerName = text(e.killerName)

  /**
   * IS THERE ANOTHER PERSON HERE? Compared by license where both sides have
   * one, and only by name when NEITHER does. Falling back to a name comparison
   * while a license is present would merge two players who happen to share a
   * display name into one — the exact failure the license key exists to stop.
   */
  const sameParty =
    killerLicense !== null && victimLicense !== null
      ? killerLicense === victimLicense
      : killerLicense === null &&
        victimLicense === null &&
        killerName !== null &&
        killerName === victimName

  const killer =
    !sameParty && (killerName !== null || killerLicense !== null)
      ? { license: killerLicense, name: killerName ?? killerLicense ?? '—' }
      : null

  return {
    killer,
    victim: { license: victimLicense, name: victimName ?? victimLicense ?? '—' },
    weapon: weaponPart(e),
    cause: causeLabel(e.cause),
    headshot: e.headshot === true,
  }
}

/** `fall` -> `Fall`. A one-word id, sentence case, nothing more. */
function causeLabel(raw: unknown): string | null {
  const value = text(raw)
  if (value === null) return null
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-.\s]+/)
    .filter((t) => t !== '')
    .map((t) => (t.length > 1 && t === t.toUpperCase() && /[A-Z]/.test(t) ? t : t.toLowerCase()))
  const [first = '', ...rest] = words
  if (first === '') return null
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/**
 * THE RED, AND THE ONLY SOURCE OF IT.
 *
 * `bg-danger/10` IS ALREADY IN THE CEF OVERRIDE BLOCK at the end of
 * `globals.css`, which is why this uses that alpha and not a fresh one. An
 * opacity modifier on a token cannot be resolved at build time, so on Chromium
 * 103 — the engine behind the in-game pause menu — the fallback Tailwind emits
 * is the bare token AT FULL OPACITY: danger text on a danger fill, which is a
 * solid lozenge with an invisible label. The override drops it to transparent
 * there, and `npm run check:cef` fails if a tint appears without an entry.
 *
 * DO NOT NAME AN UNUSED UTILITY IN A COMMENT EITHER, which cost this file a
 * failing gate once already. Tailwind 4 scans source text rather than parsing
 * it, so a class written in prose to say "not this one" is extracted as a real
 * candidate, emitted into the stylesheet, and then correctly reported by
 * `check:cef` as a tint with no override. Pick an alpha the block already
 * covers, and describe the alternative in words rather than in a class name.
 *
 * THE DOTTED UNDERLINE IS THE AFFORDANCE, and it is not decoration.
 * `docs/hover-text.md`: `cursor-help` alone only pays out once the pointer is
 * already on the word, so a hover card whose existence is invisible is a fact
 * nobody finds. The ban chip on the profile carries the same underline for the
 * same reason.
 */
export const WEAPON_UNAUTHORIZED_CLASS =
  'rounded-sm bg-danger/10 px-1 font-medium text-danger underline decoration-dotted underline-offset-2'

/**
 * What the weapon text wears. Empty string for every reading but one.
 *
 * A FUNCTION RATHER THAN A TERNARY IN THE MARKUP so that the three readings —
 * absent, `true`, `false` — are pinned by `check:timeline` against the thing
 * the component actually renders, and so that there is exactly one expression
 * in this repository that can turn a weapon red.
 */
export function weaponTone(w: WeaponPart | null): string {
  return w?.unauthorized === true ? WEAPON_UNAUTHORIZED_CLASS : ''
}
