/**
 * Contract checks for the match timeline the game writes onto an incident.
 *
 *   npx tsx src/lib/matchTimeline.check.ts
 *
 * ═══ THE ONE THAT MATTERS ═══
 *
 * A weapon renders RED, under a hover card saying the player is very probably
 * cheating, on `weaponIssued === false` AND ON NOTHING ELSE. Get that
 * comparison wrong in the obvious ways — `!weaponIssued`, `weaponIssued ??
 * false`, a truthiness test — and two entire populations turn red:
 *
 *   · every incident filed before 2026-08-20, because the field did not exist
 *     and every kill on those rows has no `weaponIssued` at all, and
 *   · every environmental death, because a fall, a drowning or the storm omits
 *     the field on purpose — there is no weapon claim to make.
 *
 * The second is the one to be frightened of. The console would be telling an
 * admin, in red, with a card, that somebody cheated, because they fell off a
 * roof. Section 1 pins all three readings and it is the reason this file exists.
 *
 * ═══ A PLAIN SCRIPT, LIKE THE OTHERS ═══
 *
 * Matching `discordRole.check.ts` and `handoff.check.ts`: this repo has no test
 * framework and adding one to assert seventy cases would be the larger change.
 * It lives under `src/` so `npm run typecheck` compiles it against the real
 * types — a change to `MatchTimelineEntry` or `WeaponPart` breaks the build
 * here rather than leaving these checks asserting a shape that no longer
 * exists. It runs in `npm run verify` as `check:timeline`.
 *
 * IT IMPORTS THE SHIPPED FUNCTIONS, not copies of them. `lib/matchTimeline` has
 * no runtime imports at all — deliberately, and for exactly this reason — so
 * tsx loads the real module and there is nothing here to drift out of step
 * with it.
 *
 * ═══ WHAT IT CANNOT PROVE, STATED PLAINLY ═══
 *
 * These are unit checks on functions plus a grep over the source. They cannot
 * render React, so they cannot prove that the markup uses what they check.
 * Section 8 closes as much of that gap as a grep can: `weaponIssued` may be
 * READ in exactly one module, and the red class string may EXIST in exactly one
 * module. A component that hardcoded a red class on some unrelated condition
 * would still get past this, and a reviewer is the only thing that catches it.
 *
 * ═══ MUTATION TESTED, WHICH IS THE ONLY REASON TO TRUST ANY OF IT ═══
 *
 * Verified by breaking each on purpose and watching this fail by name. The
 * counts are what was actually observed, not what was expected:
 *
 *   `weaponIssued === false` -> `!== true`        7 cases, sections 1 and 6
 *   `weaponIssued === false` -> `!weaponIssued`   7 cases, sections 1 and 6
 *   drop the `INITIALISM` branch                  5 cases, section 2
 *   `mergeTimeline` stops comparing `at`          3 cases, section 3
 *   `matchProgress` stops testing the deadline    2 cases, section 4
 *   `killLine` compares names before licenses     2 cases, section 6
 *   `matchOffset` counts from the match start    13 cases, sections 7a and 7b
 *   `matchOffset` always prints a plus            6 cases, section 7b
 *   `matchOffset` stops bounding by the match     3 cases, sections 7a and 7b
 *   `matchOffset` stops testing the bound         2 cases, sections 7a and 7b
 *   one signed floor instead of sign + magnitude  1 case,  section 7b
 *   `matchRecordFor` ignores the match window     5 cases, section 7c
 *   `matchRecordFor` takes the latest end         1 case,  section 7c
 *   `matchRecordFor` guesses when ambiguous       1 case,  section 7c
 *   `matchRecordFor` drops the no-matchId return  1 case,  section 7c
 *   the component inlines the red class           1 case,  section 8
 *   a second component reads the issued flag      1 case,  section 8
 *
 * AND THE SAME AGAIN FOR THE WARMUP WORK, OBSERVED THE SAME WAY:
 *
 *   `matchProgress` stops reading the creation   3 cases, section 4
 *   warmup outranks a recorded end               1 case,  section 4
 *   the formed label becomes the start label     3 cases, section 4b
 *   the formed label is deleted, fallback wins   2 cases, section 4b
 *   `isBracket` forgets `match_created`          1 case,  section 4c
 *   `rank` stops putting formed before started   1 case,  section 3
 *   the component restates the bracket set       2 cases, section 8
 *   the component falls back on the creation     2 cases, section 8
 *   the component hardcodes the word             2 cases, section 8
 *   the kill branch stops keying on the kind     1 case,  section 8
 *   the harness stops shifting the creation      1 case,  section 8
 *
 * TWO OF THOSE FIELDS ARE PINNED BY THE COMPILER RATHER THAN BY A CASE, and
 * they were broken on purpose too, because a type nobody instantiates proves
 * nothing. Deleting `matchCreatedAt` from `Incident` fails `npm run typecheck`
 * with 2 errors, both naming the field; deleting it from `MatchFields` fails
 * with 12, one of them inside `matchProgress` itself.
 *
 * FOUR OF THE COMPONENT MUTATIONS ARE THE WHOLE REASON THAT LIST IS LONG. Each
 * leaves every pure function untouched and correct — the word still resolves,
 * the bracket set still has three members, the offset maths is unchanged — and
 * each changes what an admin reads. That is the gap the origin grep below was
 * added to close, and it is why every call-site decision now has one.
 *
 * ONE MUTATION SURVIVED PART OF ITS SECTION AND IT IS WORTH KNOWING WHICH.
 * With `at` no longer compared, "match_start is first" still passed — the tie
 * ranking put it there for the wrong reason. Three other cases caught it. A
 * check that only asserted the ends of the list would have waved it through.
 *
 * AND ONE SURVIVED OUTRIGHT UNTIL A CASE WAS WRITTEN FOR IT. Deleting
 * `matchRecordFor`'s "no matchId, no record" early return failed NOTHING: every
 * case at the time gave the incident a real match number, so the null-to-null
 * join it opens up could not arise. The case that closes it is an incident with
 * no `matchId` against a row whose `matchId` is unreadable — both sides reduce
 * to null through `num`, and without the early return they compare equal.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { IncidentEvent } from './incidents'
import { humanLabel, labelFor } from './labels'
import {
  MATCH_EVENT_LABEL,
  MATCH_PROGRESS_LABEL,
  WEAPON_UNAUTHORIZED_CLASS,
  indefiniteArticle,
  isBracket,
  killDiscrepancy,
  killLine,
  matchOffset,
  matchProgress,
  matchRecordFor,
  mergeTimeline,
  weaponPart,
  weaponTone,
  type ConsoleTimelineEvent,
  type MatchFields,
  type MatchTimelineEntry,
  type OffsetSpan,
} from './matchTimeline'

/**
 * THE STRUCTURAL CLAIM IN `matchTimeline`'s HEADER, PINNED BY THE COMPILER.
 *
 * That module restates the console event's shape rather than importing it, so
 * that it can keep its no-runtime-imports property. This line is what stops the
 * restatement drifting: add a required field to `IncidentEvent` and the
 * assignment stops compiling, which `npm run typecheck` reports. It is erased
 * at runtime — `import type` never loads `lib/incidents`, which reaches
 * DynamoDB and could not be loaded from a check script anyway.
 */
const EVENTS_ARE_ASSIGNABLE: ConsoleTimelineEvent = {
  at: 0,
  kind: 'opened',
  byLicense: null,
  byName: 'System',
} satisfies IncidentEvent

let failed = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) return
  failed++
  console.error(`  FAIL  ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

const NOW = Date.UTC(2026, 7, 15, 20, 0, 0)
const MIN = 60_000
function HOURS(n: number): number {
  return n * 3_600_000
}

/** A kill with everything filled in. Cases below override one field at a time. */
function kill(over: Partial<MatchTimelineEntry> = {}): MatchTimelineEntry {
  return {
    at: NOW,
    kind: 'kill',
    killerLicense: 'license:aaa',
    killerName: 'Rebel',
    victimLicense: 'license:bbb',
    victimName: 'Haley',
    weapon: 'WEAPON_MARKSMANRIFLE',
    weaponLabel: 'Marksman Rifle',
    cause: 'gunshot',
    headshot: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. THE UNAUTHORIZED-WEAPON RULE. Absent -> no. true -> no. false -> yes.
// ---------------------------------------------------------------------------

console.log('1. weaponIssued: the only field that may paint a player red')

const issuedCases: Array<[string, Partial<MatchTimelineEntry>, boolean]> = [
  // ── The two that must NEVER be red ────────────────────────────────────────
  ['absent — every row filed before the field existed', {}, false],
  ['absent — an environmental death omits it on purpose', { weapon: 'WEAPON_FALL', weaponLabel: null, cause: 'fall' }, false],
  ['absent — explicitly undefined', { weaponIssued: undefined }, false],
  ['true — a weapon the gamemode issues', { weaponIssued: true }, false],

  // ── The one that must be ──────────────────────────────────────────────────
  ['false — the gamemode does not issue this at all', { weaponIssued: false }, true],
  ['false, with no label — still the same claim', { weaponIssued: false, weaponLabel: null }, true],
  ['false, on an entry that also names a cause', { weaponIssued: false, cause: 'explosion' }, true],
]

for (const [label, over, expected] of issuedCases) {
  const part = weaponPart(kill(over))
  check(`weaponPart: ${label}`, part?.unauthorized === expected, part)

  const red = weaponTone(part) !== ''
  check(`weaponTone: ${label}`, red === expected, weaponTone(part))
}

/*
 * THE TONE IS THE CLASS THE MARKUP USES, not a boolean the markup then
 * reinterprets. Asserted here so that a refactor which keeps `unauthorized`
 * honest and quietly changes what `weaponTone` hands back cannot pass.
 */
check(
  'weaponTone: red is exactly WEAPON_UNAUTHORIZED_CLASS',
  weaponTone(weaponPart(kill({ weaponIssued: false }))) === WEAPON_UNAUTHORIZED_CLASS,
)
check('weaponTone: null weapon is not red', weaponTone(null) === '')
check(
  'weaponTone: the class carries the danger tint and the dotted affordance',
  WEAPON_UNAUTHORIZED_CLASS.includes('text-danger') &&
    WEAPON_UNAUTHORIZED_CLASS.includes('bg-danger/10') &&
    WEAPON_UNAUTHORIZED_CLASS.includes('decoration-dotted'),
  WEAPON_UNAUTHORIZED_CLASS,
)

/*
 * `bg-danger/10` AND NOT SOME OTHER ALPHA. The override block at the end of
 * `globals.css` lists the tinted utilities that must go transparent on Chromium
 * 103, and `check:cef` fails on any that is missing. Picking a fresh alpha here
 * would mean editing that block; this asserts the one that is already in it, so
 * the two checks cannot disagree about which utility this feature uses.
 */
check(
  'weaponTone: the tint is an alpha the CEF override block already covers',
  /\bbg-danger\/10\b/.test(WEAPON_UNAUTHORIZED_CLASS),
  WEAPON_UNAUTHORIZED_CLASS,
)

// ---------------------------------------------------------------------------
// 2. `a` or `an`. Wrong here is not dangerous, merely illiterate.
// ---------------------------------------------------------------------------

console.log('2. the indefinite article')

const articleCases: Array<[string, 'a' | 'an']> = [
  ['Marksman Rifle', 'a'],
  ['Assault Rifle', 'an'],
  ['Pump Shotgun', 'a'],
  ['Heavy Sniper', 'a'],
  ['Micro SMG', 'a'],
  ['Combat MG', 'a'],
  ['Railgun', 'a'],
  ['Knife', 'a'],
  ['Baseball Bat', 'a'],
  ['Grenade', 'a'],
  ['Sticky Bomb', 'a'],
  ['Up-n-Atomizer', 'an'],
  ['Unholy Hellbringer', 'an'],
  ['Antique Cavalry Dagger', 'an'],

  // THE INITIALISMS, which a plain vowel test gets wrong every time. Read out
  // letter by letter, so the article follows the NAME of the first letter.
  ['SMG', 'an'],
  ['RPG', 'an'],
  ['MG', 'an'],
  ['AP Pistol', 'an'],
  ['SNS Pistol', 'an'],
  ['MK II Pistol', 'an'],
  ['PDW', 'a'],
  ['GTA Cannon', 'a'],
  ['BZ Gas', 'a'],

  // Degenerate input still answers something printable.
  ['', 'a'],
  ['   ', 'a'],
]

for (const [label, expected] of articleCases) {
  const got = indefiniteArticle(label)
  check(`indefiniteArticle(${JSON.stringify(label)}) === ${expected}`, got === expected, got)
}

// ---------------------------------------------------------------------------
// 3. THE MERGE. `list_append` does not order, so the console must.
// ---------------------------------------------------------------------------

console.log('3. merging two lists that were never in order')

const events: ConsoleTimelineEvent[] = [
  { at: NOW + 5 * MIN, kind: 'opened', byLicense: 'license:bbb', byName: 'Haley' },
  { at: NOW + HOURS(3), kind: 'resolved', byLicense: 'license:zzz', byName: 'Admin' },
]

/** Stored the way DynamoDB actually hands it back: not in order. */
const stored: MatchTimelineEntry[] = [
  kill({ at: NOW + 8 * MIN, victimName: 'Vex' }),
  { at: NOW + 11 * MIN, kind: 'match_end' },
  kill({ at: NOW + 2 * MIN }),
  { at: NOW, kind: 'match_start' },
  kill({ at: NOW + 6 * MIN, killerName: 'Vex' }),
]

const merged = mergeTimeline(events, stored)
const first = merged[0]

check('mergeTimeline: nothing is dropped', merged.length === events.length + stored.length, merged.length)
check(
  'mergeTimeline: sorted by `at`, oldest first',
  merged.every((r, i) => i === 0 || (merged[i - 1]?.at ?? 0) <= r.at),
  merged.map((r) => r.at - NOW),
)
check(
  'mergeTimeline: match_start is first even though it was stored fourth',
  first?.source === 'match' && first.entry.kind === 'match_start',
  first,
)
check(
  'mergeTimeline: match_end sits before the console rows that follow it',
  merged.findIndex((r) => r.source === 'match' && r.entry.kind === 'match_end') <
    merged.findIndex((r) => r.source === 'console' && r.event.kind === 'resolved'),
)
check(
  'mergeTimeline: the two lists interleave rather than concatenating',
  merged.some((r, i) => i > 0 && merged[i - 1]?.source !== r.source),
)

/* At the same millisecond the brackets still know where they belong. */
const tied = mergeTimeline(
  [{ at: NOW, kind: 'note', byLicense: null, byName: 'System' }],
  [
    { at: NOW, kind: 'match_end' },
    kill({ at: NOW }),
    { at: NOW, kind: 'match_start' },
  ],
)
const tiedHead = tied[0]
const tiedTail = tied[tied.length - 1]
check(
  'mergeTimeline: on a tie, start first and end last',
  tiedHead?.source === 'match' &&
    tiedHead.entry.kind === 'match_start' &&
    tiedTail?.source === 'match' &&
    tiedTail.entry.kind === 'match_end',
  tied.map((r) => (r.source === 'match' ? r.entry.kind : `console:${r.event.kind}`)),
)

/* An unusable timestamp is a display problem, never a reason to lose a kill. */
const broken = mergeTimeline(
  [],
  [
    kill({ at: Number.NaN }),
    kill({ at: NOW + MIN }),
    { at: undefined as unknown as number, kind: 'match_end' },
  ],
)
check('mergeTimeline: a broken `at` keeps its row', broken.length === 3, broken.length)
check(
  'mergeTimeline: a broken `at` sinks to the end rather than poisoning the sort',
  broken[0]?.at === NOW + MIN,
  broken.map((r) => r.at),
)

check('mergeTimeline: both lists empty is an empty list', mergeTimeline([], []).length === 0)
check(
  'mergeTimeline: null and undefined are the same as empty',
  mergeTimeline(null, undefined).length === 0,
)
check(
  'mergeTimeline: no match at all leaves the console events alone',
  mergeTimeline(events, null).length === 2,
)

/*
 * ═══ A WARMUP CASE'S LIST BEGINS WITH `match_created` ═══
 *
 * The shape a weapon-strip case opened on the warmup pad actually has: an
 * anchor, the strips that opened it, and NO `match_start` — the match had not
 * started, which is the whole reason this kind exists. Stored shuffled, like
 * every other list DynamoDB hands back.
 */
const CREATED = NOW - 3 * MIN

const warmupStored: MatchTimelineEntry[] = [
  { at: CREATED + 100_000, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
  { at: CREATED, kind: 'match_created' },
  { at: CREATED + 62_000, kind: 'weapon_strip', weapon: '-1357824103' },
]

const warmupMerged = mergeTimeline(
  [{ at: CREATED + 101_000, kind: 'opened', byLicense: null, byName: 'System' }],
  warmupStored,
)
const warmupHead = warmupMerged[0]

check(
  'mergeTimeline: a warmup list is anchored on match_created, stored second',
  warmupHead?.source === 'match' && warmupHead.entry.kind === 'match_created',
  warmupHead,
)
check(
  'mergeTimeline: and the strips keep their order under it',
  warmupMerged
    .map((r) => (r.source === 'match' ? r.entry.kind : `console:${r.event.kind}`))
    .join(' -> ') === 'match_created -> weapon_strip -> weapon_strip -> console:opened',
  warmupMerged.map((r) => (r.source === 'match' ? r.entry.kind : r.event.kind)),
)
check(
  'mergeTimeline: a strip is never dropped for not being a kill',
  warmupMerged.filter((r) => r.source === 'match' && r.entry.kind === 'weapon_strip')
    .length === 2,
)

/*
 * A MATCH IS FORMED BEFORE IT BEGINS, including at the same millisecond. The
 * game writes one anchor or the other and never both, so this is a shape it
 * does not produce — which is exactly why the sort must not depend on that
 * promise holding.
 */
const bothAnchors = mergeTimeline(
  [],
  [
    kill({ at: NOW }),
    { at: NOW, kind: 'match_start' },
    { at: NOW, kind: 'match_created' },
  ],
)
check(
  'mergeTimeline: on a tie, formed comes before started',
  bothAnchors.map((r) => (r.source === 'match' ? r.entry.kind : '?')).join(' -> ') ===
    'match_created -> match_start -> kill',
  bothAnchors.map((r) => (r.source === 'match' ? r.entry.kind : '?')),
)

// ---------------------------------------------------------------------------
// 4. STILL IN PROGRESS IS THREE STATES, NOT TWO.
// ---------------------------------------------------------------------------

console.log('4. did the match finish, and if not, why not')

const START = NOW
const ENDS_BY = NOW + 20 * MIN

const progressCases: Array<[string, MatchFields, number, string]> = [
  ['no match attributes at all — filed in the lobby', {}, NOW, 'none'],
  ['nulls all round is still no match', { matchStartedAt: null, matchEndedAt: null, matchEndsBy: null }, NOW, 'none'],

  ['the end landed', { matchStartedAt: START, matchEndedAt: START + 11 * MIN, matchEndsBy: ENDS_BY }, NOW + HOURS(3), 'ended'],
  ['the end landed after the deadline — still ended', { matchStartedAt: START, matchEndedAt: ENDS_BY + MIN, matchEndsBy: ENDS_BY }, NOW + HOURS(3), 'ended'],

  ['no end, inside the deadline', { matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, START + 5 * MIN, 'running'],
  ['no end, one millisecond inside the deadline', { matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, ENDS_BY - 1, 'running'],

  // THE BOUNDARY. At the deadline exactly, the match is over and nothing said
  // so — `now < deadline` is running, and this is not less than.
  ['no end, exactly at the deadline', { matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, ENDS_BY, 'unreported'],
  ['no end, hours past the deadline — the server died', { matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, NOW + HOURS(3), 'unreported'],

  // A match with no end AND no deadline cannot be placed, and the console does
  // not guess which of the two middle states it was.
  ['a match with no end and no deadline', { matchStartedAt: START, matchEndedAt: null }, NOW + HOURS(3), 'unknown'],

  // ── WARMUP: THE STATE THAT USED TO BE A FALSEHOOD ─────────────────────────
  //
  // A match is formed into warmup and stamps a start only on entering play, so
  // a case filed on the pad has a creation time and NOTHING ELSE. It answered
  // `none` — documented as "filed outside a match" — about a row that names a
  // matchId and holds the earliest cheat signal this console ever sees.
  ['formed and not started — a case filed on the warmup pad', { matchCreatedAt: START - 2 * MIN }, NOW, 'warmup'],
  ['and the same shape with the other three spelled null', { matchCreatedAt: START - 2 * MIN, matchStartedAt: null, matchEndedAt: null, matchEndsBy: null }, NOW, 'warmup'],
  // The clock decides nothing here: there is no deadline to be inside or past.
  ['warmup does not turn into anything as the clock runs on', { matchCreatedAt: START - 2 * MIN }, NOW + HOURS(9), 'warmup'],
  ['an unreadable creation time is no creation time', { matchCreatedAt: Number.NaN }, NOW, 'none'],
  ['a null creation time is the same as none at all', { matchCreatedAt: null }, NOW, 'none'],

  // ── AND THE CREATION TIME RECLASSIFIES NOTHING ELSE ───────────────────────
  //
  // It rides the same PutItem on EVERY case with a match, so it is present on
  // ordinary rows too. Each of these is one of the cases above with a creation
  // time added, and each must answer exactly what it answered without one.
  ['formed and running is still running', { matchCreatedAt: START - 2 * MIN, matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, START + 5 * MIN, 'running'],
  ['formed and past its deadline is still unreported', { matchCreatedAt: START - 2 * MIN, matchStartedAt: START, matchEndedAt: null, matchEndsBy: ENDS_BY }, NOW + HOURS(3), 'unreported'],
  ['formed, with no end and no deadline, is still unknown', { matchCreatedAt: START - 2 * MIN, matchStartedAt: START, matchEndedAt: null }, NOW + HOURS(3), 'unknown'],

  // THE SAME ROW AFTER THE MATCH RAN. The game's match-end write backfills the
  // start and the deadline, so a warmup case leaves the state on its own — no
  // migration, and nothing in `matchProgress` special-casing it.
  ['the warmup case, backfilled at match end', { matchCreatedAt: START - 2 * MIN, matchStartedAt: START, matchEndedAt: START + 11 * MIN, matchEndsBy: ENDS_BY }, NOW + HOURS(3), 'ended'],
  // Belt and braces: an end with no start still beats warmup, because an end is
  // the strongest thing on the row.
  ['an end that landed outranks the creation time', { matchCreatedAt: START - 2 * MIN, matchEndedAt: START + 11 * MIN }, NOW + HOURS(3), 'ended'],
]

for (const [label, fields, now, expected] of progressCases) {
  const got = matchProgress(fields, now)
  check(`matchProgress: ${label} -> ${expected}`, got === expected, got)
}

check('MATCH_PROGRESS_LABEL: running is the owner\'s wording', MATCH_PROGRESS_LABEL.running === 'still in progress')
check('MATCH_PROGRESS_LABEL: unreported is the owner\'s wording', MATCH_PROGRESS_LABEL.unreported === 'end never reported')
check(
  'MATCH_PROGRESS_LABEL: an ended match gets no chip — the timeline already says so',
  MATCH_PROGRESS_LABEL.ended === undefined && MATCH_PROGRESS_LABEL.none === undefined,
)
check(
  'MATCH_PROGRESS_LABEL: `unknown` claims nothing',
  MATCH_PROGRESS_LABEL.unknown === undefined,
)
/*
 * `warmup` HAS NO CHIP AND THAT IS THE DECISION, NOT AN OVERSIGHT. Both entries
 * above are the owner's own words. There are none for a warmup case, and
 * `docs/hover-text.md` rule 8 says to report a state with no honest wording and
 * wait rather than to write something reasonable-sounding. Asserted so that
 * adding one is a deliberate act with the owner's sentence in hand, rather than
 * a reflex somebody has on a Tuesday.
 */
check(
  'MATCH_PROGRESS_LABEL: `warmup` says nothing until the owner gives it words',
  MATCH_PROGRESS_LABEL.warmup === undefined,
  MATCH_PROGRESS_LABEL.warmup,
)

// ---------------------------------------------------------------------------
// 4b. THE WORD FOR A MATCH THAT WAS FORMED AND HAD NOT STARTED.
// ---------------------------------------------------------------------------

console.log('4b. `match_created` is not `match_start`, and must not read as one')

check(
  'MATCH_EVENT_LABEL: match_created reads "Match formed"',
  MATCH_EVENT_LABEL.match_created === 'Match formed',
  MATCH_EVENT_LABEL.match_created,
)
check(
  'MATCH_EVENT_LABEL: and the start still reads "Match started"',
  MATCH_EVENT_LABEL.match_start === 'Match started',
  MATCH_EVENT_LABEL.match_start,
)
/*
 * THE TWO MAY NOT SHARE A STEM, which is the actual requirement rather than
 * "the strings differ". The game split this into its own kind so the console
 * would stop saying the match started about a match that had not; two labels
 * both beginning "Match st…" would hand that back on a page an admin skims.
 */
check(
  'MATCH_EVENT_LABEL: formed and started do not read alike',
  !MATCH_EVENT_LABEL.match_created?.toLowerCase().includes('start'),
  MATCH_EVENT_LABEL.match_created,
)
/*
 * AND THE MAP ENTRY IS LOAD-BEARING. `labelFor` humanises an unmapped id, so if
 * the chosen word were the mechanical one, deleting the entry would change
 * nothing and this whole section would be asserting the fallback. It is not:
 * the fallback says `Match created`.
 */
check(
  'MATCH_EVENT_LABEL: the entry is not what the fallback would have produced',
  humanLabel('match_created') === 'Match created' &&
    MATCH_EVENT_LABEL.match_created !== humanLabel('match_created'),
  humanLabel('match_created'),
)
check(
  'labelFor: the component\'s lookup returns the word, not the id',
  labelFor(MATCH_EVENT_LABEL, 'match_created') === 'Match formed',
  labelFor(MATCH_EVENT_LABEL, 'match_created'),
)
/*
 * `weapon_strip` IS DELIBERATELY UNMAPPED. The mechanical fallback already
 * renders it legibly, and a map entry spelling the identical string would be a
 * second home for one word. Pinned in both directions so the absence reads as a
 * decision and so the rendered word cannot change without a case failing.
 */
check(
  'MATCH_EVENT_LABEL: weapon_strip is left to the mechanical fallback',
  MATCH_EVENT_LABEL.weapon_strip === undefined,
  MATCH_EVENT_LABEL.weapon_strip,
)
check(
  'labelFor: and that fallback renders a strip as "Weapon strip"',
  labelFor(MATCH_EVENT_LABEL, 'weapon_strip') === 'Weapon strip',
  labelFor(MATCH_EVENT_LABEL, 'weapon_strip'),
)

// ---------------------------------------------------------------------------
// 4c. WHICH ENTRIES ARE THE ENDS OF THE MATCH RATHER THAN THINGS INSIDE IT.
// ---------------------------------------------------------------------------

console.log('4c. the bracket set, which decides the marker tone')

const bracketCases: Array<[string, boolean]> = [
  ['match_created', true],
  ['match_start', true],
  ['match_end', true],
  ['kill', false],
  ['weapon_strip', false],
  // An open set: a kind from a newer gamemode is an event, not an edge.
  ['artifact', false],
  ['', false],
]

for (const [kind, expected] of bracketCases) {
  const got = isBracket({ at: NOW, kind })
  check(`isBracket(${JSON.stringify(kind)}) === ${expected}`, got === expected, got)
}

// ---------------------------------------------------------------------------
// 5. DROPPED KILLS, AS A COUNT.
// ---------------------------------------------------------------------------

console.log('5. kills the buffer could not hold')

const fourKills: MatchTimelineEntry[] = [
  { at: NOW, kind: 'match_start' },
  kill({ at: NOW + MIN }),
  kill({ at: NOW + 2 * MIN }),
  kill({ at: NOW + 3 * MIN }),
  kill({ at: NOW + 4 * MIN }),
  { at: NOW + 5 * MIN, kind: 'match_end' },
]

check(
  'killDiscrepancy: complete list says nothing',
  killDiscrepancy({ matchTimeline: fourKills, matchTimelineComplete: true, matchKillsSeen: 4 }) === null,
)
check(
  'killDiscrepancy: an absent flag says nothing',
  killDiscrepancy({ matchTimeline: fourKills, matchKillsSeen: 47 }) === null,
)
check(
  'killDiscrepancy: the pair, counting only kills and not the brackets',
  JSON.stringify(
    killDiscrepancy({ matchTimeline: fourKills, matchTimelineComplete: false, matchKillsSeen: 47 }),
  ) === JSON.stringify({ shown: 4, seen: 47 }),
  killDiscrepancy({ matchTimeline: fourKills, matchTimelineComplete: false, matchKillsSeen: 47 }),
)
check(
  'killDiscrepancy: a flag with no count is not a number the console can invent',
  killDiscrepancy({ matchTimeline: fourKills, matchTimelineComplete: false }) === null,
)

// ---------------------------------------------------------------------------
// 6. ONE KILL, AS A SENTENCE. Names key on LICENSE, never on the display name.
// ---------------------------------------------------------------------------

console.log('6. who killed whom, and with what')

const ordinary = killLine(kill({ weaponIssued: true }))
check('killLine: the killer is a party', ordinary.killer?.license === 'license:aaa', ordinary.killer)
check('killLine: the victim is a party', ordinary.victim.license === 'license:bbb', ordinary.victim)
check('killLine: the weapon prints its label', ordinary.weapon?.raw === 'Marksman Rifle', ordinary.weapon)
check('killLine: the article comes from the label', ordinary.weapon?.article === 'a', ordinary.weapon)
check('killLine: an ordinary kill is not red', ordinary.weapon?.unauthorized === false)

const noLabel = killLine(kill({ weaponLabel: null }))
check(
  'killLine: with no label the raw id prints VERBATIM',
  noLabel.weapon?.raw === 'WEAPON_MARKSMANRIFLE',
  noLabel.weapon,
)
check(
  'killLine: and gets no article, because none would be honest in front of an id',
  noLabel.weapon?.article === null,
  noLabel.weapon,
)

const noWeapon = killLine(kill({ weapon: null, weaponLabel: null }))
check('killLine: no weapon at all is no weapon clause', noWeapon.weapon === null, noWeapon.weapon)

/* An environmental death: the engine reports the victim as their own killer. */
const fell = killLine(
  kill({
    killerLicense: 'license:bbb',
    killerName: 'Haley',
    weapon: 'WEAPON_FALL',
    weaponLabel: null,
    cause: 'fall',
  }),
)
check('killLine: killer === victim is nobody else involved', fell.killer === null, fell.killer)
check('killLine: and the cause is humanised', fell.cause === 'Fall', fell.cause)
check('killLine: and it is emphatically not red', fell.weapon?.unauthorized === false, fell.weapon)

const noKiller = killLine(kill({ killerLicense: null, killerName: null }))
check('killLine: no killer recorded is also nobody else', noKiller.killer === null, noKiller.killer)

/*
 * THE LICENCE WINS OVER THE NAME, and this is the pair that proves it. Two
 * different people who both call themselves `Rebel` are two people; matching on
 * the display name would collapse them into a suicide.
 */
const sameName = killLine(
  kill({ killerLicense: 'license:aaa', killerName: 'Rebel', victimLicense: 'license:bbb', victimName: 'Rebel' }),
)
check(
  'killLine: same name, different licenses — still two people',
  sameName.killer?.license === 'license:aaa',
  sameName.killer,
)

const sameLicense = killLine(
  kill({ killerLicense: 'license:aaa', killerName: 'Rebel', victimLicense: 'license:aaa', victimName: 'Reb' }),
)
check(
  'killLine: same license, different names — still one person',
  sameLicense.killer === null,
  sameLicense.killer,
)

const noLicenses = killLine(
  kill({ killerLicense: null, killerName: 'Rebel', victimLicense: null, victimName: 'Rebel' }),
)
check(
  'killLine: with no licenses at all the name is the only evidence there is',
  noLicenses.killer === null,
  noLicenses.killer,
)

const unlicensed = killLine(kill({ killerLicense: null }))
check(
  'killLine: a killer with no license is still named, and simply does not link',
  unlicensed.killer?.name === 'Rebel' && unlicensed.killer.license === null,
  unlicensed.killer,
)

check('killLine: headshot is a boolean and false unless said', killLine(kill({})).headshot === false)
check('killLine: headshot true', killLine(kill({ headshot: true })).headshot === true)
check(
  'killLine: a missing name degrades to an em dash rather than to a blank',
  killLine(kill({ victimLicense: null, victimName: null })).victim.name === '—',
)
check(
  'killLine: a nameless victim with a license shows the license',
  killLine(kill({ victimName: '  ' })).victim.name === 'license:bbb',
)

// ---------------------------------------------------------------------------
// 7. OFFSETS. Computed here, never stored.
// ---------------------------------------------------------------------------

console.log('7a. how far from the report, when the report IS the match start')

/*
 * ═══ THE ORIGIN MOVED AND THE WINDOW DID NOT ═══
 *
 * "all the timestamps should be relative to the incident being opened, not the
 * match starting" — the owner, playtest. Zero is now `openedAt`.
 *
 * THESE TWELVE CASES ARE THE ORIGINAL TWELVE, UNCHANGED IN EXPECTATION, and
 * that is deliberate rather than lazy: they are run with `origin === startedAt`,
 * where the new rule and the old one must agree exactly. Everything they were
 * ever about — the padding, the truncation, both ends of the match window, an
 * absent start — is still a live rule, so they are kept rather than rewritten,
 * and 7b below is where the origin actually moves.
 */
const offsetCases: Array<[string, number, unknown, unknown, string | null]> = [
  ['the start itself', START, START, null, '+0:00'],
  ['two minutes and fourteen seconds', START + 134_000, START, null, '+2:14'],
  ['seconds are zero padded', START + 61_000, START, null, '+1:01'],
  ['past an hour, minutes keep counting', START + 3_723_000, START, null, '+62:03'],
  ['sub-second rounds down rather than up', START + 1_999, START, null, '+0:01'],
  ['no start to measure from', START, null, null, null],
  ['no start attribute at all', START, undefined, null, null],
  ['before the match started', START - 1, START, null, null],
  ['inside the bound', START + 60_000, START, START + 120_000, '+1:00'],
  ['exactly on the bound', START + 120_000, START, START + 120_000, '+2:00'],
  // The case this bound exists for: an admin resolves the case days later, and
  // `+4322:17` into a twenty-minute match is a true number about nothing.
  ['past the bound — an event after the match', START + 120_001, START, START + 120_000, null],
  ['no bound means nothing is excluded', START + HOURS(4), START, null, '+240:00'],
]

for (const [label, at, startedAt, bound, expected] of offsetCases) {
  const got = matchOffset(at, { origin: startedAt, startedAt, bound })
  check(`matchOffset: ${label} -> ${expected}`, got === expected, got)
}

// ---------------------------------------------------------------------------

console.log('7b. the report is not the match start, so half the list is negative')

/*
 * THE ORDINARY SHAPE OF A REAL CASE: the match had been running for four
 * minutes when somebody pressed report. Everything the reporter is complaining
 * about is therefore BEFORE zero, which is the whole reason the owner asked for
 * this axis to move.
 */
const FILED = START + 4 * MIN
const CAP = START + 20 * MIN

/** The window every 7b case shares, so only the instant under test varies. */
const span = { origin: FILED, startedAt: START, bound: CAP }

const originCases: Array<[string, number, OffsetSpan, string | null]> = [
  ['the report itself is zero', FILED, span, '+0:00'],

  // ── BEFORE THE REPORT. The half that did not exist until now. ─────────────
  ['a kill a minute before the report', FILED - 60_000, span, '-1:00'],
  ['the match start, four minutes before it', START, span, '-4:00'],
  ['seconds are zero padded on the negative side too', FILED - 61_000, span, '-1:01'],
  ['two minutes and fourteen seconds before', FILED - 134_000, span, '-2:14'],

  // ── AFTER THE REPORT. ────────────────────────────────────────────────────
  ['a kill a minute after the report', FILED + 60_000, span, '+1:00'],
  ['and one at the very end of the match', CAP, span, '+16:00'],

  // ── TRUNCATION IS SYMMETRIC, which a single Math.floor over a signed
  //    difference gets wrong: it renders this one as -0:02. ────────────────
  ['sub-second truncates towards zero before the report', FILED - 1_999, span, '-0:01'],
  ['and after it, the same distance the same way', FILED + 1_999, span, '+0:01'],

  // ── THE WINDOW IS STILL THE MATCH, NOT THE ORIGIN. Both of these are
  //    perfectly ordinary distances from the report and neither is inside the
  //    match, so neither is placed. ───────────────────────────────────────────
  ['before the match started, though after nothing else', START - 1, span, null],
  ['past the bound — the admin resolved it days later', CAP + 1, span, null],
  [
    'no match at all: a report filed in the lobby gets no offsets',
    FILED,
    { origin: FILED, startedAt: null, bound: null },
    null,
  ],
  /*
   * A WARMUP CASE GETS NONE EITHER, AND THAT IS CHOSEN RATHER THAN INHERITED.
   * It has a real match — a `matchId`, a creation time, the strips that opened
   * it — and still no `matchStartedAt`, so the span it hands over has a null
   * start and every row goes unplaced. Falling `startedAt` back on the creation
   * time was considered and refused: the same row has no `matchEndsBy`, so the
   * ruler would open and never close, and the resolve event three days later
   * would print the four-digit minute count `bound` exists to suppress. The
   * component's half of this is asserted in section 8.
   */
  [
    'a warmup case has a match and still no ruler to place it on',
    FILED - 30_000,
    { origin: FILED, startedAt: null, bound: null },
    null,
  ],
  [
    'no origin to measure from is no offset, not an offset from the start',
    FILED,
    { origin: null, startedAt: START, bound: CAP },
    null,
  ],
  [
    'an unusable origin is the same answer',
    FILED,
    { origin: Number.NaN, startedAt: START, bound: CAP },
    null,
  ],
]

for (const [label, at, s, expected] of originCases) {
  const got = matchOffset(at, s)
  check(`matchOffset: ${label} -> ${expected}`, got === expected, got)
}

/*
 * THE SIGN IS ALWAYS PRINTED, on both sides, and it is the only thing telling a
 * reader which way a row points. Asserted as a shape rather than only as
 * strings so that a format change has to come here and say so.
 */
check(
  'matchOffset: every offset before the report carries a leading minus',
  matchOffset(FILED - 30_000, span)?.startsWith('-') === true,
  matchOffset(FILED - 30_000, span),
)
check(
  'matchOffset: every offset after it carries a leading plus',
  matchOffset(FILED + 30_000, span)?.startsWith('+') === true,
  matchOffset(FILED + 30_000, span),
)
check(
  'matchOffset: zero is a plus, not a minus and not bare',
  matchOffset(FILED, span) === '+0:00',
  matchOffset(FILED, span),
)

// ---------------------------------------------------------------------------
// 7c. WHICH MATCH IN THEIR HISTORY THIS INCIDENT WAS FILED DURING.
// ---------------------------------------------------------------------------

/*
 * ═══ THE MATCH NUMBER IS NOT A KEY, AND THAT IS THE WHOLE SECTION ═══
 *
 * It counts up from the game server's boot, so two restarts apart one player
 * holds two rows numbered 412 — one from this afternoon and one from March.
 * `rows.find(r => r.matchId === id)` puts March's placement and kills on this
 * afternoon's case, on a page somebody bans people from, and the result looks
 * entirely plausible. The window on the incident row is what separates them.
 */

console.log('7c. joining the incident to the subject\'s match history')

interface Row {
  matchId: number
  endedAt: number
  kills: number
}

const MARCH = START - 150 * 24 * 3_600_000

/** Two matches numbered 412, five months apart. The trap, as data. */
const twice: Row[] = [
  { matchId: 412, endedAt: START + 11 * MIN, kills: 7 },
  { matchId: 412, endedAt: MARCH, kills: 0 },
  { matchId: 7, endedAt: START - HOURS(2), kills: 3 },
]

const filed = { matchId: 412, matchStartedAt: START, matchEndsBy: START + 20 * MIN }

check(
  'matchRecordFor: the row for this match, not the other one wearing its number',
  matchRecordFor(filed, twice)?.kills === 7,
  matchRecordFor(filed, twice),
)
check(
  'matchRecordFor: and it is decided by the window, not by list order',
  matchRecordFor(filed, [...twice].reverse())?.kills === 7,
  matchRecordFor(filed, [...twice].reverse()),
)
check(
  'matchRecordFor: three matches with one number — the earliest end after the start',
  matchRecordFor(filed, [
    { matchId: 412, endedAt: START + 40 * MIN, kills: 99 },
    { matchId: 412, endedAt: START + 11 * MIN, kills: 7 },
    { matchId: 412, endedAt: MARCH, kills: 0 },
  ])?.kills === 7,
)

check(
  'matchRecordFor: the ordinary case, one row, one number',
  matchRecordFor(filed, [{ matchId: 412, endedAt: START + 11 * MIN, kills: 7 }])?.kills === 7,
)
check(
  'matchRecordFor: a lone row that ended BEFORE the match started is not it',
  matchRecordFor(filed, [{ matchId: 412, endedAt: MARCH, kills: 0 }]) === null,
)
check(
  'matchRecordFor: history that does not contain this match at all',
  matchRecordFor(filed, [{ matchId: 7, endedAt: START - HOURS(2), kills: 3 }]) === null,
)

/*
 * THE THREE ORDINARY WAYS THERE IS NOTHING TO SHOW. None of them is an error and
 * none of them means the player did nothing: the history row is written when the
 * match ENDS, the read behind it is bounded, and a report can be filed in the
 * lobby.
 */
check('matchRecordFor: the match is still running, so no row exists yet', matchRecordFor(filed, []) === null)
check('matchRecordFor: the history read failed', matchRecordFor(filed, null) === null)
check('matchRecordFor: no history attribute at all', matchRecordFor(filed, undefined) === null)
check(
  'matchRecordFor: an incident with no matchId — filed in the lobby, or before the field',
  matchRecordFor({ matchStartedAt: START }, twice) === null,
)
check(
  'matchRecordFor: a null matchId is the same as an absent one',
  matchRecordFor({ matchId: null, matchStartedAt: START }, twice) === null,
)

/*
 * AMBIGUITY IS ANSWERED WITH NOTHING, NOT WITH A GUESS. A row that carries a
 * match number and no start cannot place two candidates, and picking one on a
 * moderation page is the failure this whole function exists to avoid.
 */
check(
  'matchRecordFor: matchId with no start, and one candidate — take it',
  matchRecordFor({ matchId: 7 }, twice)?.kills === 3,
  matchRecordFor({ matchId: 7 }, twice),
)
check(
  'matchRecordFor: matchId with no start, and two candidates — say nothing',
  matchRecordFor({ matchId: 412 }, twice) === null,
  matchRecordFor({ matchId: 412 }, twice),
)

/* Rubbish on either side costs the section, never the render. */
check(
  'matchRecordFor: a row with an unusable endedAt is not the answer',
  matchRecordFor(filed, [{ matchId: 412, endedAt: Number.NaN, kills: 1 }]) === null,
)
check(
  'matchRecordFor: a row with an unusable matchId matches nothing',
  matchRecordFor(filed, [{ matchId: Number.NaN, endedAt: START + MIN, kills: 1 }]) === null,
)
/*
 * THE TWO UNREADABLE NUMBERS ARE NOT THE SAME NUMBER. Both sides reduce to null
 * through `num`, and an equality test written after the early return — rather
 * than instead of it — quietly joins "this incident names no match" to "this row
 * names no match" and puts a stranger's result on the case. Found by mutation:
 * removing the early return failed nothing until this case existed.
 */
check(
  'matchRecordFor: no matchId does not join to a row whose matchId is unreadable',
  matchRecordFor({ matchStartedAt: START }, [
    { matchId: Number.NaN, endedAt: START + MIN, kills: 5 },
  ]) === null,
)

// ---------------------------------------------------------------------------
// 8. THE GREP. Which files are allowed to make the claim at all.
// ---------------------------------------------------------------------------

console.log('8. only one module may read `weaponIssued` or spell the red class')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const sources = walk(SRC).map((f) => ({
  path: relative(ROOT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}))

/**
 * `lib/matchTimeline` READS the field. This file names it in its cases. The
 * preview harness contains it as FIXTURE DATA, which is the point of a harness.
 * Anything else reading it is a second copy of the comparison in section 1, in
 * a file nothing tests.
 */
const MAY_READ_WEAPON_ISSUED = new Set([
  'src/lib/matchTimeline.ts',
  'src/lib/matchTimeline.check.ts',
  'src/app/preview/incident/page.tsx',
])

const readers = sources
  .filter((s) => s.text.includes('weaponIssued'))
  .map((s) => s.path)

check(
  'no second reader of `weaponIssued` has appeared',
  readers.every((p) => MAY_READ_WEAPON_ISSUED.has(p)),
  readers.filter((p) => !MAY_READ_WEAPON_ISSUED.has(p)),
)

const spellers = sources
  .filter((s) => s.text.includes(WEAPON_UNAUTHORIZED_CLASS))
  .map((s) => s.path)

check(
  'the red class string exists in exactly one module',
  spellers.length === 1 && spellers[0] === 'src/lib/matchTimeline.ts',
  spellers,
)

const component = sources.find((s) => s.path === 'src/components/IncidentTimeline.tsx')
check('the timeline component is where this thinks it is', component !== undefined)
check(
  'the timeline component gets its red from `weaponTone`, not from a literal',
  component?.text.includes('weaponTone(') === true,
)

/*
 * `docs/hover-text.md` rule 6: the native `title` attribute is banned outright.
 * Cheap to assert on the two files this task added, and the reason the weapon
 * explanation is a hover card with an `sr-only` twin instead of a tooltip.
 */
for (const path of ['src/components/IncidentTimeline.tsx', 'src/components/ui/timeline.tsx']) {
  const file = sources.find((s) => s.path === path)
  check(`${path}: no native title attribute`, !/\stitle=["{]/.test(file?.text ?? ''))
}

check(
  'the hover card also exists in the DOM for a reader who cannot hover',
  component?.text.includes('sr-only') === true,
)

/*
 * THE ZERO POINT, ASSERTED AT THE CALL SITE AND NOT ONLY IN THE MATHS.
 *
 * `matchOffset` is thoroughly covered: pointing it at `startedAt` instead of
 * `origin` fails thirteen cases above. But every one of those hands the
 * function a span the test built, so none of them can see which field the
 * COMPONENT actually puts in it. Swapping `incident.openedAt` for
 * `incident.matchStartedAt` in IncidentTimeline.tsx passed the entire suite
 * -- verified by doing it -- which would have quietly restored the exact
 * behaviour the owner asked to have changed.
 *
 * A grep is a blunt instrument and cannot prove the value is used correctly.
 * It can prove the right field was named, which is the half that regressed.
 */
check(
  'the component counts from the incident, not from the match start',
  /origin:\s*incident\.openedAt/.test(component?.text ?? ''),
)

/*
 * ═══ THE SAME BLUNT INSTRUMENT, AIMED AT THE THINGS #35 ADDED ═══
 *
 * Every case above hands a pure function arguments the test built, so not one
 * of them can see what the COMPONENT passes or which branch it takes. That gap
 * has already cost this repo once — swapping the offset origin passed the whole
 * suite — so each decision below that lives at a call site gets a grep, and the
 * greps are written to fail on the specific mutation, not on any edit.
 */

/*
 * THE FAR END OF THE RULER IS THE MATCH START AND NOT THE CREATION TIME, which
 * is the decision 7b argues and the one nothing else can see. `startedAt:
 * incident.matchStartedAt ?? incident.matchCreatedAt` is the obvious, plausible
 * "improvement": it would give a warmup case offsets, and it would give the
 * resolve event on a match that never ended a four-digit minute count. The
 * second grep is the one that matters — the component must not read the field
 * at all.
 */
check(
  'the component measures the window from the match start',
  /startedAt:\s*incident\.matchStartedAt\s*,/.test(component?.text ?? ''),
)
check(
  'and it does not quietly fall back on the creation time',
  !/matchCreatedAt/.test(component?.text ?? ''),
)

/*
 * THE BRACKET SET IS ASKED FOR, NOT RESTATED. It had two members spelled inline
 * in this component and now has three; a set that grows in JSX is a set nothing
 * checks, and `match_created` drawn in the muted tone would read as one more
 * thing that happened rather than as the edge of the match.
 */
check(
  'the timeline component gets its brackets from `isBracket`, not from a comparison',
  component?.text.includes('isBracket(') === true,
)
check(
  'and no match-kind literal is left in the markup to drift from it',
  !/['"]match_(created|start|end)['"]/.test(component?.text ?? ''),
  (component?.text.match(/['"]match_(created|start|end)['"]/g) ?? []).join(' '),
)

/*
 * THE NEW KIND GOES THROUGH THE MAP LIKE EVERY OTHER KIND. `MATCH_EVENT_LABEL`
 * is where "Match formed" is argued and pinned; a component that hardcoded the
 * word would render the same page today and would not be the thing section 4b
 * is testing.
 */
check(
  'the component looks its match labels up rather than writing them',
  /labelFor\(MATCH_EVENT_LABEL,/.test(component?.text ?? ''),
)
check(
  'and it spells none of them itself',
  !/Match (formed|started|ended)/.test(component?.text ?? ''),
  (component?.text.match(/Match (formed|started|ended)/g) ?? []).join(' '),
)

/*
 * A STRIP IS NOT A KILL, AND THE KILL SENTENCE MUST NOT REACH IT. A
 * `weapon_strip` entry carries a `weapon` and no `weaponIssued` — the kind IS
 * the claim — so running one through the kill branch would put it under the
 * comparison in section 1 and render the single most incriminating entry on the
 * row in ordinary ink, as though the weapon had been checked and cleared. The
 * kill branch is keyed on the kind, exactly.
 */
check(
  'the kill sentence is drawn for kills and for nothing else',
  /kind === 'kill'/.test(component?.text ?? ''),
)

/*
 * THE HARNESS MOVES THE CREATION TIME WITH EVERYTHING ELSE.
 *
 * `/preview/incident?artifacts=aged` pushes a whole case 200 days back to put it
 * past the artifact bucket's expiry, and `shifted` exists so that every stamp on
 * it travels together — the file's own words: a case whose opening event
 * happened after the note on it is "a shape no real row can have, and the
 * harness's whole job is to avoid showing one". A creation time left behind
 * makes the pair `aged` + `warmup` an incident filed last spring whose match was
 * formed this afternoon, which no server can produce and which nothing else
 * here would notice.
 */
const preview = sources.find((s) => s.path === 'src/app/preview/incident/page.tsx')
check('the incident harness is where this thinks it is', preview !== undefined)
check(
  'the harness shifts the creation time with the rest of the case',
  /matchCreatedAt:\s*move\(/.test(preview?.text ?? ''),
)

// ---------------------------------------------------------------------------
// Landmarks. Printed on every run so a change shows up as different words
// rather than as nothing — the same reason check-contrast.mjs prints its
// extremes. THIS IS A PRINT AND NOT AN ASSERTION: it reassembles the sentence
// from the parts `killLine` hands back, which is what the markup does with
// them, but nothing here renders React.
// ---------------------------------------------------------------------------

function sentence(e: MatchTimelineEntry): string {
  const line = killLine(e)
  const weapon = line.weapon
    ? `${line.weapon.article ? `${line.weapon.article} ` : ''}${line.weapon.raw}`
    : null
  const red = line.weapon?.unauthorized === true ? '  [RED]' : ''
  const head = line.headshot ? '  [headshot]' : ''

  if (line.killer) {
    return `${line.killer.name} killed ${line.victim.name}${weapon ? ` with ${weapon}` : ''}${head}${red}`
  }
  const detail = line.weapon?.unauthorized ? line.weapon.raw : (line.cause ?? line.weapon?.raw ?? null)
  return `${line.victim.name}${detail ? ` — ${detail}` : ''}${head}${red}`
}

console.log('\nlandmarks — the sentence each shape produces')
const landmarks: Array<[string, MatchTimelineEntry]> = [
  ['issued weapon', kill({ weaponIssued: true })],
  ['issued, vowel', kill({ weaponLabel: 'Assault Rifle', weaponIssued: true, headshot: true })],
  ['issued, initialism', kill({ weaponLabel: 'SMG', weaponIssued: true })],
  ['UNISSUED', kill({ weaponLabel: 'Railgun', weaponIssued: false })],
  ['no label', kill({ weaponLabel: null, weaponIssued: true })],
  ['pre-#30 row', kill({ weaponLabel: 'SMG' })],
  ['fell off a roof', kill({ killerLicense: 'license:bbb', killerName: 'Haley', weapon: 'WEAPON_FALL', weaponLabel: null, cause: 'fall' })],
]
for (const [label, entry] of landmarks) {
  console.log(`  ${label.padEnd(18)} ${sentence(entry)}`)
}

console.log(
  `\n  merged order      ${mergeTimeline(events, stored)
    .map((r) => (r.source === 'match' ? r.entry.kind : r.event.kind))
    .join(' -> ')}`,
)
console.log(
  `  progress states   ${(['none', 'warmup', 'ended', 'running', 'unreported', 'unknown'] as const)
    .map((s) => `${s}=${MATCH_PROGRESS_LABEL[s] ?? '(no chip)'}`)
    .join('  ')}`,
)
/*
 * THE FIVE KINDS AS THE PAGE WORDS THEM, printed side by side, because the one
 * failure this section is here to make loud is two of them reading alike.
 */
console.log(
  `  match kinds       ${['match_created', 'match_start', 'match_end', 'kill', 'weapon_strip']
    .map((k) => `${k}=${labelFor(MATCH_EVENT_LABEL, k)}`)
    .join('  ')}`,
)
/*
 * A WARMUP CASE, LEFT TO RIGHT. No offsets on any of it, which is the point:
 * there is no start and no deadline, so there is no ruler. If a fallback to the
 * creation time ever lands, every dash here becomes a number and says so.
 */
console.log(
  `  warmup timeline   ${warmupMerged
    .map((r) => {
      const label = r.source === 'match' ? r.entry.kind : r.event.kind
      const off = matchOffset(r.at, { origin: CREATED + 101_000, startedAt: null, bound: null })
      return `${label}=${off ?? '—'}`
    })
    .join('  ')}`,
)
/*
 * THE RULER, PRINTED. A match that started four minutes before the report, read
 * left to right: the start, a kill before it, the report, a kill after it, the
 * end. If the origin ever slides back to the match start this line goes all
 * plus and says so out loud.
 */
console.log(
  `  offsets           ${[
    ['match start', START],
    ['a kill', FILED - 90_000],
    ['REPORT', FILED],
    ['a kill', FILED + 45_000],
    ['match end', CAP],
  ]
    .map(([label, at]) => `${String(label)}=${matchOffset(at as number, span) ?? '—'}`)
    .join('  ')}`,
)
console.log(`  event shape       ${JSON.stringify(EVENTS_ARE_ASSIGNABLE)}`)

console.log()
if (failed > 0) {
  console.error(`check:timeline — ${failed} failing case(s)`)
  process.exit(1)
}
console.log('check:timeline — all cases pass')
