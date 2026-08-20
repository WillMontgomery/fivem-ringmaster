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
 * THE FOUR RULES THAT ARE EASY TO GET WRONG
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
  /** `match_start`, `match_end`, `kill` — and whatever a newer build adds. */
  kind: string

  /** Kill entries only, from here down. */
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
 * English for the kinds the game writes.
 *
 * Past tense to match the console's own three — `Opened`, `Note`, `Resolved` —
 * so one merged list does not read as though it came from two places. Consulted
 * through `labelFor`, so a kind from a newer build degrades to a humanised id
 * rather than to a blank.
 */
export const MATCH_EVENT_LABEL: Record<string, string> = {
  match_start: 'Match started',
  match_end: 'Match ended',
  kill: 'Kill',
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
 */
function rank(row: TimelineRow): number {
  if (row.source !== 'match') return 1
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
 * The window an offset may be quoted in, and the instant it counts from.
 *
 * TWO DIFFERENT JOBS, WHICH IS WHY THEY ARE THREE FIELDS RATHER THAN TWO. The
 * MATCH decides whether a row can be placed at all — `startedAt` and `bound`
 * are its two ends. The INCIDENT decides where zero is. Collapsing them, which
 * is what this was before, is precisely the thing the owner asked to stop.
 */
export interface OffsetSpan {
  /**
   * The zero point: `incident.openedAt`.
   *
   * "all the timestamps should be relative to the incident being opened, not
   * the match starting" — the owner, playtest. It USED to be `startedAt`, and
   * the reason that was wrong is the reason an admin opens the page: the kills
   * worth reading are the ones that provoked the report, so the number that
   * matters is how long BEFORE the report each happened.
   */
  origin: unknown
  /** `matchStartedAt`. Nothing before the match is placed inside it. */
  startedAt: unknown
  /** `matchEndedAt ?? matchEndsBy`. Nothing after the match is either. */
  bound: unknown
}

/**
 * How far this sits from the moment the incident was opened. `+2:14`, `-1:30`.
 *
 * COMPUTED, NEVER READ — rule 2.
 *
 * ═══ A NEGATIVE IS THE POINT, NOT AN EDGE CASE ═══
 *
 * An incident is filed AFTER whatever provoked it, so most of the interesting
 * rows on this list happened before its zero. `-1:30` reads "a minute and a
 * half before the report", and `+0:00` is the report itself. The sign is
 * always printed, on both sides, so no row is ambiguous about which way it
 * points.
 *
 * THE MATCH IS STILL THE WINDOW, and that has not changed. Only rows inside
 * `[startedAt, bound]` get an offset at all, because an offset is a position
 * in a match: an incident is RESOLVED hours or days later, and `+182:14` on a
 * twenty-minute match is a number that is arithmetically true and factually
 * nonsense. `bound` is `matchEndedAt ?? matchEndsBy` — the last instant that
 * can honestly be inside the match — and with no bound at all nothing is
 * excluded at that end. With no `startedAt` there is no match to be inside, so
 * nothing gets an offset; that is what a report filed in the lobby looks like.
 *
 * SUB-SECOND TRUNCATES TOWARDS ZERO, on both sides, which is why the sign and
 * the magnitude are computed separately. A single `Math.floor` over a signed
 * difference rounds a row 1.999s BEFORE the report to `-0:02` — away from
 * zero, and inconsistent with the `+0:01` the same distance after it.
 */
export function matchOffset(at: unknown, span: OffsetSpan): string | null {
  const t = num(at)
  const origin = num(span.origin)
  const start = num(span.startedAt)
  if (t === null || origin === null || start === null || t < start) return null

  const end = num(span.bound)
  if (end !== null && t > end) return null

  const delta = t - origin
  const s = Math.floor(Math.abs(delta) / 1000)
  const sign = delta < 0 ? '-' : '+'
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Did the match finish?
// ---------------------------------------------------------------------------

/**
 * THREE STATES, NOT TWO — rule 4.
 *
 *   none        no match attributes at all: filed outside a match, or a row
 *               written before the game recorded any of this
 *   ended       `matchEndedAt` landed
 *   running     no end yet, and the deadline has not passed
 *   unreported  no end, and the deadline HAS passed — the server died holding
 *               the write
 *   unknown     a match with no end and no deadline. Cannot be placed, so the
 *               console says nothing rather than guessing which of the two
 *               middle states it was.
 */
export type MatchProgress = 'none' | 'ended' | 'running' | 'unreported' | 'unknown'

export function matchProgress(m: MatchFields, now: number): MatchProgress {
  const started = num(m.matchStartedAt)
  const ended = num(m.matchEndedAt)
  const deadline = num(m.matchEndsBy)

  if (started === null && ended === null && deadline === null) return 'none'
  if (ended !== null) return 'ended'
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
