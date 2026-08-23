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
 * AND AGAIN FOR THE CONSOLE'S OWN ROWS (playtest 2026-08-22 — the owner's two
 * strings and the red dots), observed the same way:
 *
 *   `opened` goes back to "Opened"                3 cases, sections 4d and 8
 *   `resolved` becomes "Case resolved"            2 cases, section 4d
 *   the `note` entry is deleted                   1 case,  section 4d
 *   `isCaseBracket` becomes "not a note"          3 cases, section 4d
 *   `isCaseBracket` forgets `resolved`            1 case,  section 4d
 *   every console row is painted danger           2 cases, section 8
 *   the component hardcodes "Incident opened"     2 cases, section 8
 *   the component re-declares the label map       1 case,  section 8
 *   the tone prop is dropped (dots go back)       2 cases, section 8
 *   the dot is painted `--destructive` instead    1 case,  section 8
 *
 * AND AGAIN FOR THE RULER ITSELF — the owner's second instruction, that the
 * offsets count from the incident opening and stop being cut off by the match
 * window. The old table's four `matchOffset` lines were replaced rather than
 * added to: three of them named mutations of a bound that no longer exists.
 * Observed, not expected:
 *
 *   the reach test is deleted outright            5 cases, sections 7a/7b/7b2
 *   the reach is off by one at its edge           2 cases, section 7a
 *   the reach stops being symmetric               1 case,  section 7a
 *   a LOWER bound comes back                     12 cases, sections 7a/7b/7b2
 *   the reach shrinks to a minute                14 cases, sections 7a/7b/7b2
 *   the reach grows to a day                      5 cases, sections 7a/7b/7b2
 *   one signed floor instead of sign + magnitude  4 cases, sections 7a and 7b
 *   the sign is always a plus                    11 cases, sections 7a/7b/7b2
 *   the seconds stop being zero padded           18 cases, sections 7a/7b/7b2
 *   an absent origin falls back on the epoch      1 case,  section 7a
 *   the component measures from the start again   1 case,  section 8
 *   the component rebuilds the old match bound    1 case,  section 8
 *   the console rows lose their offset            1 case,  section 8
 *   the match rows lose theirs                    1 case,  section 8
 *   the two arguments are swapped at the call     1 case,  section 8
 *
 * AND AGAIN FOR THE VERDICT FOLD (owner, 2026-08-22 — the verdict "isn't
 * supposed to have it's own section on a resolved incident"). 33 mutants
 * applied, 32 caught, 1 survived. Observed, not expected:
 *
 *   the verdict chip is deleted outright            1 case,  section 8
 *   the chip is drawn on every console row          2 cases, section 8
 *   the chip lands on both ends of the case         2 cases, section 8
 *   the chip spells its own tint                    1 case,  section 8
 *   the absent-verdict chip is dropped              2 cases, section 8
 *   the absent-verdict chip reads "no action"       1 case,  section 8
 *   the permanent branch is deleted                 1 case,  section 8
 *   the expiry span stops naming the instant        1 case,  section 8
 *   the expiry is read before the action            1 case,  section 8
 *   the label is the raw id rather than the map     1 case,  section 8
 *   the closedByBan sentence is dropped             4 typecheck errors
 *   the provenance link is dug out of the text      1 case,  section 8
 *   the on-demand wording becomes an "n/a"          1 case,  section 8
 *   the component stops calling the guard           1 case,  section 8
 *   `isResolution` picks the opening instead       26 cases, sections 4e/4f
 *   `isResolution` widens to every case bracket    28 cases, sections 4e/4f
 *   `isResolution` becomes "not a note"            31 cases, sections 4e/4f
 *   `withClosure` becomes a no-op                   9 cases, section 4f
 *   `withClosure` stops checking the state          2 cases, section 4f
 *   `withClosure` stops checking for an existing   26 cases, sections 4e/4f
 *   `withClosure` falls back on the epoch           1 case,  section 4f
 *   `withClosure` leaves an absent closer blank     1 case,  section 4f
 *   `withClosure` writes an empty resolution        1 case,  section 4f
 *   `withClosure` invents a kind of its own         8 cases, section 4f
 *   `verdictTone` paints every verdict quiet        4 cases, section 4e
 *   `verdictTone` paints every verdict loud         3 cases, section 4e
 *   `verdictTone` paints a never-recorded one loud  2 cases, section 4e
 *   the fold lands AND the card stays               2 cases, section 8
 *   the label map stops being handed down           1 case,  section 8
 *
 * THREE MORE SURVIVED THE FIRST RUN AND THEY ARE ALL THE SAME BLIND SPOT, which
 * is the one the fold ITSELF opened. The resolution text, the closing instant
 * and the closing admin were each rendered TWICE until the card went. Dropping
 * `{event.text}`, dropping `{event.byName}` and dropping the `<LocalTime>` from
 * the row each left every case in 4e green — because 4e proves the ROW CARRIES
 * all three and nothing here can see whether the markup draws them. Two greps at
 * the end of section 8 close it, and the second run caught all three.
 *
 *   the row stops rendering the resolution text     1 case,  section 8
 *   the meta line stops naming who closed it        1 case,  section 8
 *   the meta line stops printing the instant        1 case,  section 8
 *
 * ONE SURVIVOR IS LEFT ON PURPOSE AND IT IS WORTH NAMING. Moving the chip out of
 * the title onto a line of its own passes everything. It is a layout choice
 * rather than a lost fact — the chip is still drawn, still on the closing row,
 * still with the right words and colour — and a grep that pinned the chip's
 * exact position in the markup would fail on any reflow of the row. Deliberately
 * not pinned.
 *
 * FOUR OF THOSE FIFTEEN SURVIVED THE FIRST RUN, and each is a different kind of
 * blind spot worth naming. `origin ?? 0` survived because the reach catches an
 * epoch-sized number anyway — it is invisible on every realistic instant and
 * needed a case at 500ms to see. The other three are the React gap: dropping
 * `<Offset>` from the console rows, dropping it from the match rows, and handing
 * `matchOffset` its two arguments the other way round all leave every pure
 * function correct and change what an admin reads. Section 8 has a grep for each
 * now.
 *
 * THE LAST FIVE OF THE PLAYTEST BATCH ARE THE COMPONENT ONES AND THEY ARE WHY
 * SECTION 8 GREW AGAIN.
 * Each leaves `CONSOLE_EVENT_LABEL` and `isCaseBracket` correct and untouched,
 * and each changes what an admin reads — which is exactly the gap that had
 * already cost this file once, when the offset origin was swapped and the whole
 * suite stayed green.
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

import { verdictTone } from './incidentChip'
import type { Incident, IncidentEvent, VerdictAction } from './incidents'
import { humanLabel, labelFor } from './labels'
import {
  CONSOLE_EVENT_LABEL,
  MATCH_EVENT_LABEL,
  MATCH_PROGRESS_LABEL,
  WEAPON_UNAUTHORIZED_CLASS,
  indefiniteArticle,
  isBracket,
  isCaseBracket,
  isResolution,
  killDiscrepancy,
  killLine,
  matchOffset,
  matchProgress,
  matchRecordFor,
  mergeTimeline,
  weaponPart,
  weaponTone,
  withClosure,
  type CaseClosure,
  type ConsoleTimelineEvent,
  type MatchFields,
  type MatchTimelineEntry,
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
// 4d. THE CONSOLE'S OWN THREE: what they are called, and which are edges.
// ---------------------------------------------------------------------------

console.log("4d. the console's own rows, in the owner's words")

/*
 * VERBATIM, BECAUSE THE OWNER GAVE THE STRINGS: "'Opened' and 'Resolved' on the
 * timeline should be called 'Incident opened' and 'Incident resolved'". Pinned
 * character for character — a label the owner dictated is not one a later pass
 * gets to improve into "Case opened".
 */
check(
  'CONSOLE_EVENT_LABEL: opened reads "Incident opened"',
  CONSOLE_EVENT_LABEL.opened === 'Incident opened',
  CONSOLE_EVENT_LABEL.opened,
)
check(
  'CONSOLE_EVENT_LABEL: resolved reads "Incident resolved"',
  CONSOLE_EVENT_LABEL.resolved === 'Incident resolved',
  CONSOLE_EVENT_LABEL.resolved,
)
/*
 * `note` IS NOT RENAMED. The instruction named two rows and this is the third;
 * "Incident note" would be wording nobody asked for, which is the house rule
 * this console is built to.
 */
check(
  'CONSOLE_EVENT_LABEL: the note is left alone',
  CONSOLE_EVENT_LABEL.note === 'Note',
  CONSOLE_EVENT_LABEL.note,
)
/*
 * AND ALL THREE ENTRIES ARE LOAD-BEARING, the same assertion 4b makes about
 * `match_created`. `labelFor` humanises an unmapped id, so if a label happened
 * to equal the mechanical fallback, deleting the entry would change nothing and
 * these cases would be pinning the fallback instead of the decision. The two
 * renamed ones fall back to `Opened` and `Resolved` — which is exactly what the
 * owner asked to stop reading.
 */
check(
  'CONSOLE_EVENT_LABEL: the renamed entries are not what the fallback produces',
  humanLabel('opened') === 'Opened' &&
    humanLabel('resolved') === 'Resolved' &&
    CONSOLE_EVENT_LABEL.opened !== humanLabel('opened') &&
    CONSOLE_EVENT_LABEL.resolved !== humanLabel('resolved'),
  [humanLabel('opened'), humanLabel('resolved')],
)
check(
  "labelFor: the component's lookup returns the words, not the ids",
  labelFor(CONSOLE_EVENT_LABEL, 'opened') === 'Incident opened' &&
    labelFor(CONSOLE_EVENT_LABEL, 'resolved') === 'Incident resolved',
  [
    labelFor(CONSOLE_EVENT_LABEL, 'opened'),
    labelFor(CONSOLE_EVENT_LABEL, 'resolved'),
  ],
)

/*
 * THE RED DOTS. "with red dots next to them, not black dots" — so the set is
 * exactly the two the owner named, and a note is not in it. An unknown kind
 * from a newer console is not either: an edge is a claim about structure, and
 * the safe answer for a row nothing here recognises is "something that
 * happened", which is what the `default` tone draws.
 */
const caseBracketCases: Array<[string, boolean]> = [
  ['opened', true],
  ['resolved', true],
  ['note', false],
  ['', false],
  ['reopened', false],
]

for (const [kind, expected] of caseBracketCases) {
  const got = isCaseBracket({ at: NOW, kind, byLicense: null, byName: 'System' })
  check(
    `isCaseBracket(${JSON.stringify(kind)}) === ${expected}`,
    got === expected,
    got,
  )
}

/*
 * THE TWO BRACKET SETS ARE ABOUT DIFFERENT LISTS AND MUST NOT OVERLAP. They are
 * consulted on different row types — `isBracket` on the game's entries,
 * `isCaseBracket` on the console's — and one answering true for the other's
 * kinds would mean a merge of the two predicates had quietly happened.
 */
check(
  'the case brackets are not the match brackets',
  !isCaseBracket({ at: NOW, kind: 'match_start', byLicense: null, byName: 'x' }) &&
    !isBracket({ at: NOW, kind: 'opened' }),
)

// ---------------------------------------------------------------------------
// 4e. THE ROW THE VERDICT LANDS ON, now that the verdict has no card.
// ---------------------------------------------------------------------------

console.log('4e. the closing row, and everything the deleted card used to say')

/**
 * THE CLOSURE FIELD NAMES, PINNED BY THE COMPILER — the same trick
 * {@link EVENTS_ARE_ASSIGNABLE} plays on the event shape one screen up.
 * `CaseClosure` restates four attributes of `Incident` so that `matchTimeline`
 * can keep its no-runtime-imports property; rename or retype any of the four on
 * `Incident` and this assignment stops compiling rather than leaving
 * `withClosure` reading a field that is no longer there.
 */
const CLOSURE_IS_ASSIGNABLE: CaseClosure = {
  state: 'resolved',
  resolvedAt: NOW,
  resolvedByName: 'Preview Admin',
  resolution: 'Watched two matches from spectate — nothing unusual',
} satisfies Pick<Incident, 'state' | 'resolvedAt' | 'resolvedByName' | 'resolution'>

/*
 * ═══ WHICH ROW IS THE CLOSING ONE ═══
 *
 * A SET OF EXACTLY ONE, AND THE OPENING IS NOT IN IT. `isCaseBracket` answers
 * true for both ends of the case because both ends get a red dot; this answers
 * true for one, because only one of them was decided. A predicate that drifted
 * into `isCaseBracket`'s membership would put a verdict chip on the row that
 * says the case was FILED — the console announcing a decision at the moment the
 * report arrived, which is the one sentence this page must never render.
 */
const resolutionCases: Array<[string, boolean]> = [
  ['resolved', true],
  ['opened', false],
  ['note', false],
  ['', false],
  // An open set: a kind from a newer console is not the thing that closed this.
  ['reopened', false],
  ['closed', false],
]

for (const [kind, expected] of resolutionCases) {
  const got = isResolution({ at: NOW, kind, byLicense: null, byName: 'System' })
  check(
    `isResolution(${JSON.stringify(kind)}) === ${expected}`,
    got === expected,
    got,
  )
}

check(
  'the closing row is a case bracket, and a strict subset of them',
  resolutionCases.every(
    ([kind]) =>
      !isResolution({ at: NOW, kind, byLicense: null, byName: 'x' }) ||
      isCaseBracket({ at: NOW, kind, byLicense: null, byName: 'x' }),
  ) && isCaseBracket({ at: NOW, kind: 'opened', byLicense: null, byName: 'x' }) &&
    !isResolution({ at: NOW, kind: 'opened', byLicense: null, byName: 'x' }),
)

/**
 * A CASE CLOSED THE WAY `incidents.resolve` CLOSES ONE, which is the shape the
 * whole fold rests on: ONE string is written into `resolution` AND into the
 * closing event's `text`, in a single update, with one `at` and one name. The
 * preview harness's `closed()` is written the same way for the same reason.
 */
const CLOSED_AT = NOW + 30 * MIN
function closedCase(
  resolution: string,
  over: Partial<CaseClosure> = {},
): CaseClosure & { events: ConsoleTimelineEvent[] } {
  return {
    state: 'resolved',
    resolvedAt: CLOSED_AT,
    resolvedByName: 'Preview Admin',
    resolution,
    events: [
      { at: NOW, kind: 'opened', byLicense: 'license:rep', byName: 'Marla' },
      { at: NOW + MIN, kind: 'note', byLicense: null, byName: 'System', text: 'Refusals doubled to 8 across 2 matches.' },
      {
        at: CLOSED_AT,
        kind: 'resolved',
        byLicense: 'license:admin',
        byName: 'Preview Admin',
        text: resolution,
      },
    ],
    ...over,
  }
}

/** The one row on the list that closed the case, or null if there is not exactly one. */
function closingRow(
  c: CaseClosure & { events: ConsoleTimelineEvent[] },
): ConsoleTimelineEvent | null {
  const found = withClosure(c.events, c).filter((e) => isResolution(e))
  return found.length === 1 ? (found[0] ?? null) : null
}

/*
 * ═══ THE FOUR STATES THAT HAD TO SURVIVE THE FOLD ═══
 *
 * The card carried four things. Three of them — the text, the instant and the
 * admin — were already on this row, which is WHY the owner was reading them
 * twice and why the card went. These cases are what says so out loud: for every
 * verdict state, the closing row still carries all three, so deleting the card
 * deleted a duplicate rather than a fact.
 *
 * THE FOURTH IS THE VERDICT ITSELF and it is the one thing that actually moved.
 * Its COLOUR is asserted here, from the shared `verdictTone` the queue and the
 * profile also read; its WORDS are a chip in JSX, which nothing in this file can
 * render, so section 8 greps them instead.
 */
const VERDICT_FIXTURE: Record<VerdictAction, string> = {
  ban: 'Banned',
  kick: 'Kicked',
  none: 'No action',
}

const foldCases: Array<{
  name: string
  incident: CaseClosure & { events: ConsoleTimelineEvent[] }
  action: VerdictAction | null
  loud: boolean
}> = [
  {
    name: 'ban with an expiry',
    incident: closedCase('Repeated griefing — 7 days'),
    action: 'ban',
    loud: true,
  },
  {
    name: 'permanent ban',
    incident: closedCase('Aimbot through walls in match 412 — clip in #reports'),
    action: 'ban',
    loud: true,
  },
  {
    name: 'no action',
    incident: closedCase('Watched two matches from spectate — nothing unusual'),
    action: 'none',
    loud: false,
  },
  {
    name: 'legacy row, no verdict recorded',
    incident: closedCase('Banned for 7 days'),
    action: null,
    loud: false,
  },
  {
    name: 'closed by a permanent ban issued elsewhere',
    incident: closedCase('Closed automatically by a permanent ban.'),
    action: 'ban',
    loud: true,
  },
]

for (const { name, incident, action, loud } of foldCases) {
  const row = closingRow(incident)
  check(`${name}: there is exactly one closing row`, row !== null, row)
  check(
    `${name}: the card's text is on it`,
    row?.text === incident.resolution,
    [row?.text, incident.resolution],
  )
  check(
    `${name}: the card's instant is on it`,
    row?.at === incident.resolvedAt,
    [row?.at, incident.resolvedAt],
  )
  check(
    `${name}: the card's author is on it`,
    row?.byName === incident.resolvedByName,
    [row?.byName, incident.resolvedByName],
  )
  /*
   * THE ROW IS ALSO STILL AN EDGE, which is not incidental: the chip now sits
   * on a row whose marker is the danger dot, and a fold that quietly changed
   * the kind would take the red dot with it.
   */
  check(
    `${name}: it is still drawn as an edge of the record`,
    row !== null && isCaseBracket(row),
  )
  /*
   * AND THE COLOUR IS THE SHARED ONE. `verdictTone` is what the queue and the
   * profile read; a chip that painted a `none` or an absent verdict in the loud
   * colour would teach admins that deciding nothing is a failure — see #28.
   */
  const tone = verdictTone(action)
  check(
    `${name}: the chip takes the ${loud ? 'action' : 'quiet'} tone`,
    loud ? tone.includes('text-danger') : tone.includes('text-muted-foreground'),
    tone,
  )
  if (action !== null) {
    check(
      `${name}: the chip's word comes from the map, not from the id`,
      labelFor(VERDICT_FIXTURE, action) === VERDICT_FIXTURE[action],
      labelFor(VERDICT_FIXTURE, action),
    )
  }
}

/*
 * THE TWO TONES ARE DIFFERENT TONES, which is the assertion that stops the pair
 * above passing against a `verdictTone` that returned one string for everything.
 */
check(
  'verdictTone: an action and a decision do not wear the same colour',
  verdictTone('ban') !== verdictTone('none') &&
    verdictTone('kick') === verdictTone('ban') &&
    verdictTone(null) === verdictTone('none'),
  [verdictTone('ban'), verdictTone('kick'), verdictTone('none'), verdictTone(null)],
)

// ---------------------------------------------------------------------------
// 4f. THE SHAPE WITH NO CLOSING ROW — a guard, not a fix for a known bug.
// ---------------------------------------------------------------------------

console.log('4f. a resolved case whose events forgot to say so')

/*
 * ═══ WHAT THIS IS AND IS NOT ═══
 *
 * NOTHING IN THIS REPOSITORY PRODUCES THE SHAPE. `incidents.resolve` appends the
 * closing event in the same conditional update that sets the state, `open`
 * appends one when it opens straight to resolved, and the preview harness builds
 * its closed fixtures through one function so they cannot drift. It could not be
 * dated either — if a deploy older than the closing-event writer ever closed a
 * case, that row is still in the table and nothing here can tell.
 *
 * IT IS BUILT BECAUSE OF WHAT THE FOLD COSTS IF IT EXISTS. With the verdict on
 * the closing row, a resolved case with no closing row loses its verdict, its
 * resolution text, its closing time and its closing admin from the page at once,
 * silently, with no gap where they used to be. The guard is a dozen lines and is
 * a no-op on every shape above.
 */
const forgetful = closedCase('Banned for 7 days')
const noClosingRow = {
  ...forgetful,
  events: forgetful.events.filter((e) => !isResolution(e)),
}

check(
  'the shape this guards is genuinely missing its row',
  noClosingRow.events.filter((e) => isResolution(e)).length === 0,
)

const rebuilt = withClosure(noClosingRow.events, noClosingRow)
check(
  'withClosure: the case gets a closing row back',
  rebuilt.filter((e) => isResolution(e)).length === 1,
  rebuilt.map((e) => e.kind),
)
const synth = rebuilt.find((e) => isResolution(e))
check(
  'withClosure: it carries the stored resolution as its text',
  synth?.text === 'Banned for 7 days',
  synth?.text,
)
check(
  'withClosure: it carries the stored instant',
  synth?.at === CLOSED_AT,
  synth?.at,
)
check(
  'withClosure: it carries the admin who closed it',
  synth?.byName === 'Preview Admin',
  synth?.byName,
)
/*
 * IT IS THE EXISTING KIND, WHICH IS THE WHOLE OF THE "NO NEW TEXT" RULE. The row
 * reads "Incident resolved" because `CONSOLE_EVENT_LABEL` says so, exactly like
 * a real one; a synthesised kind would fall through `labelFor` to a humanised id
 * and put a word on the page that nobody wrote.
 */
check(
  'withClosure: the row wears the existing label, not an invented one',
  labelFor(CONSOLE_EVENT_LABEL, synth?.kind) === CONSOLE_EVENT_LABEL.resolved,
  labelFor(CONSOLE_EVENT_LABEL, synth?.kind),
)
check(
  'withClosure: and the existing red dot with it',
  synth !== undefined && isCaseBracket(synth),
)

/*
 * AND IT DOES NOTHING AT ALL THE REST OF THE TIME. Three no-ops, because a guard
 * that fires on an ordinary row would be duplicating the close on every page in
 * the console — the louder failure of the two, and the one a reader would blame
 * on this function.
 */
check(
  'withClosure: a case that already has its row is untouched',
  withClosure(forgetful.events, forgetful) !== forgetful.events &&
    JSON.stringify(withClosure(forgetful.events, forgetful)) ===
      JSON.stringify(forgetful.events),
  withClosure(forgetful.events, forgetful).map((e) => e.kind),
)
check(
  'withClosure: a pending case is not closed by it',
  JSON.stringify(
    withClosure(noClosingRow.events, { ...noClosingRow, state: 'pending_review' }),
  ) === JSON.stringify(noClosingRow.events),
  withClosure(noClosingRow.events, { ...noClosingRow, state: 'pending_review' }).map(
    (e) => e.kind,
  ),
)
check(
  'withClosure: an empty list on a pending case stays empty',
  withClosure(undefined, { state: 'pending_review' }).length === 0,
)

/*
 * THE DEGENERATE CORNERS, which exist because the shape itself is hypothetical
 * and its corners are therefore no less likely than its middle.
 *
 * AN ABSENT INSTANT SINKS AND SAYS NOTHING. `mergeTimeline` sorts a row it
 * cannot place to the end, `LocalTime` draws an em dash for one it cannot
 * format, and `matchOffset` declines to number it. All three are existing
 * behaviour reached by an existing route, which is the point: no new rendering
 * decision was added for this.
 */
const undated = withClosure([], { state: 'resolved', resolution: 'Something was decided' })
check(
  'withClosure: a closure with no instant still produces the row',
  undated.length === 1 && isResolution(undated[0] as ConsoleTimelineEvent),
)
check(
  'withClosure: and that row carries no offset rather than a wrong one',
  matchOffset(undated[0]?.at, NOW) === null,
  matchOffset(undated[0]?.at, NOW),
)
check(
  'withClosure: and it sinks to the end of the merge rather than to the epoch',
  mergeTimeline(
    withClosure(
      [{ at: NOW, kind: 'opened', byLicense: null, byName: 'Marla' }],
      { state: 'resolved', resolution: 'Something was decided' },
    ),
    [{ at: NOW + MIN, kind: 'match_end' }],
  )
    .map((r) => (r.source === 'match' ? r.entry.kind : r.event.kind))
    .join(' -> ') === 'opened -> match_end -> resolved',
)
/*
 * AN ABSENT NAME TAKES THE CONSOLE'S EXISTING WORD FOR AN ACTOR-LESS EVENT.
 * `byName` is required on an event and `System` is what `lib/incidents` already
 * writes on every event it appends without a human — not a sentence this fold
 * invented.
 */
const nameless = withClosure([], { state: 'resolved', resolvedAt: CLOSED_AT })
check(
  'withClosure: an absent closer is the System, in the word already used for one',
  nameless[0]?.byName === 'System',
  nameless[0]?.byName,
)
check(
  'withClosure: an absent resolution leaves the row with no text at all',
  nameless[0]?.text === undefined,
  nameless[0]?.text,
)
check(
  'withClosure: whitespace is not a resolution either',
  withClosure([], { state: 'resolved', resolvedAt: CLOSED_AT, resolution: '   ' })[0]
    ?.text === undefined,
)

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

console.log('7a. the arithmetic, the padding and how far the ruler reaches')

/*
 * ═══ THE RULER IS THE CASE, AND THE MATCH IS NO LONGER PART OF IT ═══
 *
 * `matchOffset` used to take a three-field span — an origin plus the match's two
 * ends — and drew a number only for rows inside `[matchStartedAt, matchEndedAt
 * ?? matchEndsBy]`. THE OWNER KILLED THAT WINDOW after reading a real page:
 * "Yes they are missing. Look at the timestamps here - several are missing
 * '-0:33' etc." Section 7b is the page they were looking at.
 *
 * WHAT SURVIVES IS A LIMIT ON MAGNITUDE, and these cases are where its two edges
 * are pinned. The old window's real job was suppressing `+4322:17` on a case
 * resolved days later; that is a number nobody can read, not a row in the wrong
 * match, so the limit is now a distance from the opening — an hour, either side,
 * argued at `OFFSET_REACH_MS`. THE CASES THAT USED TO SAY OTHERWISE ARE MARKED
 * BELOW rather than deleted, because what they pinned is exactly what changed.
 */
const offsetCases: Array<[string, unknown, unknown, string | null]> = [
  ['the opening itself is zero', START, START, '+0:00'],
  ['two minutes and fourteen seconds after it', START + 134_000, START, '+2:14'],
  ['seconds are zero padded', START + 61_000, START, '+1:01'],
  ['sub-second rounds down rather than up', START + 1_999, START, '+0:01'],
  ['no origin to measure from', START, null, null],
  ['no origin attribute at all', START, undefined, null],
  ['an unusable origin is the same answer', START, Number.NaN, null],
  ['and an unusable instant is too', Number.NaN, START, null],
  /*
   * A MISSING ORIGIN IS NOT AN ORIGIN OF ZERO, and this case is the only thing
   * that can tell the two apart. `openedAt` is typed as a number and arrives off
   * an unvalidated row, so `t - (origin ?? 0)` is the plausible edit; every
   * instant in this decade is then an epoch offset far past the reach and comes
   * back null anyway, which hides it everywhere except here. Survived a mutation
   * run until this line existed.
   */
  ['an instant near the epoch with no origin is still nothing', 500, null, null],

  /*
   * ── THE REACH, AT BOTH EDGES ──────────────────────────────────────────────
   *
   * WAS `['past an hour, minutes keep counting', START + 3_723_000, '+62:03']`
   * AND `['no bound means nothing is excluded', START + HOURS(4), '+240:00']`.
   * Both pinned a ruler that never stopped once the match window was absent,
   * which is the reading that produced `+4322:17` on a warmup case's close. A
   * three-digit minute count is not a duration a reader parses, so the largest
   * thing this can now print is `±59:59` and these four cases say where the
   * edge is.
   */
  ['a second under the reach still counts', START + 3_599_999, START, '+59:59'],
  ['an hour exactly does not', START + HOURS(1), START, null],
  ['four hours later is the reading the reach exists to suppress', START + HOURS(4), START, null],
  ['the reach is symmetric — a second under it, before', START - 3_599_999, START, '-59:59'],
  ['and an hour before, exactly, is not placed either', START - HOURS(1), START, null],

  /*
   * WAS `['before the match started', START - 1, null]`, AND IT IS THE WHOLE
   * BUG. A row one millisecond before the match entered play is one millisecond
   * before the opening on this fixture, and it is now drawn. On the owner's page
   * that case was eight consecutive rows.
   */
  ['a millisecond before the opening is drawn, not dropped', START - 1, START, '-0:00'],
]

for (const [label, at, origin, expected] of offsetCases) {
  const got = matchOffset(at, origin)
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

const originCases: Array<[string, number, unknown, string | null]> = [
  ['the report itself is zero', FILED, FILED, '+0:00'],

  // ── BEFORE THE REPORT. The half the reader actually came for. ─────────────
  ['a kill a minute before the report', FILED - 60_000, FILED, '-1:00'],
  ['the match start, four minutes before it', START, FILED, '-4:00'],
  ['seconds are zero padded on the negative side too', FILED - 61_000, FILED, '-1:01'],
  ['two minutes and fourteen seconds before', FILED - 134_000, FILED, '-2:14'],

  // ── AFTER THE REPORT. ────────────────────────────────────────────────────
  ['a kill a minute after the report', FILED + 60_000, FILED, '+1:00'],
  ['and one at the very end of the match', CAP, FILED, '+16:00'],

  // ── TRUNCATION IS SYMMETRIC, which a single Math.floor over a signed
  //    difference gets wrong: it renders this one as -0:02. ────────────────
  ['sub-second truncates towards zero before the report', FILED - 1_999, FILED, '-0:01'],
  ['and after it, the same distance the same way', FILED + 1_999, FILED, '+0:01'],

  /*
   * ── THE THREE SHAPES THAT USED TO GO BLANK ────────────────────────────────
   *
   * WAS `['before the match started, though after nothing else', START - 1,
   * null]`, `['no match at all: a report filed in the lobby gets no offsets',
   * null]` and `['a warmup case has a match and still no ruler to place it on',
   * null]`. All three were the same mechanism — no `matchStartedAt`, or an
   * instant before it — and all three are now placed, because the opening is the
   * only thing the ruler needs and every incident has one.
   */
  ['a row before the match started is placed against the report', START - 1, FILED, '-4:00'],
  ['a report filed in the lobby has an opening, so it has a ruler', FILED, FILED, '+0:00'],
  ['and a warmup case is placed on the same one', FILED - 30_000, FILED, '-0:30'],

  /*
   * AND THE ONE THAT STILL GOES BLANK, WHICH IS THE POINT OF KEEPING A LIMIT.
   * WAS `['past the bound — the admin resolved it days later', CAP + 1, null]`:
   * the same answer, now for a reason that also holds on a case whose match
   * never recorded an end.
   */
  ['the admin resolved it the next morning', FILED + HOURS(14), FILED, null],
]

for (const [label, at, origin, expected] of originCases) {
  const got = matchOffset(at, origin)
  check(`matchOffset: ${label} -> ${expected}`, got === expected, got)
}

/*
 * THE SIGN IS ALWAYS PRINTED, on both sides, and it is the only thing telling a
 * reader which way a row points. Asserted as a shape rather than only as
 * strings so that a format change has to come here and say so.
 */
check(
  'matchOffset: every offset before the report carries a leading minus',
  matchOffset(FILED - 30_000, FILED)?.startsWith('-') === true,
  matchOffset(FILED - 30_000, FILED),
)
check(
  'matchOffset: every offset after it carries a leading plus',
  matchOffset(FILED + 30_000, FILED)?.startsWith('+') === true,
  matchOffset(FILED + 30_000, FILED),
)
check(
  'matchOffset: zero is a plus, not a minus and not bare',
  matchOffset(FILED, FILED) === '+0:00',
  matchOffset(FILED, FILED),
)

// ---------------------------------------------------------------------------

console.log("7b2. the owner's own page, row by row")

/*
 * ═══ THE TIMELINE THE OWNER SCREENSHOTTED, REBUILT ═══
 *
 * A WARMUP-FILED CASE THAT RAN TO COMPLETION. The anticheat opened it while the
 * match was still on the pad, an admin closed it fifty-five seconds later, the
 * match entered play at `+1:11`, and it ended fifteen minutes after that. The
 * game's close write backfilled `matchStartedAt`, so the row carries a start —
 * a start that arrives AFTER most of its own timeline.
 *
 * THIRTEEN ROWS, EIGHT OF WHICH THE OLD RULE LEFT BLANK. Everything at or after
 * `OWNER_STARTED` got a number and everything before it did not, which is what
 * the owner was looking at when they said several were missing. The eight
 * include the match's own anchor, the three strips that opened the case, the
 * opening event — the origin itself, where `+0:00` is true by construction — and
 * the close.
 *
 * ASSERTED AS ONE COLUMN RATHER THAN AS THIRTEEN CASES, because the ordering and
 * the numbers are one fact: a mutation that shifted the ruler by a row would
 * have to produce a whole plausible column to get past this.
 */
const OWNER_OPENED = NOW
const OWNER_CREATED = OWNER_OPENED - 33_000
/** The bus left the pad seventy-one seconds after the case was filed. */
const OWNER_STARTED = OWNER_OPENED + 71_000
const OWNER_ENDED = OWNER_OPENED + 901_000

const ownerStored: MatchTimelineEntry[] = [
  { at: OWNER_OPENED + 29_000, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
  { at: OWNER_ENDED, kind: 'match_end' },
  { at: OWNER_CREATED, kind: 'match_created' },
  { at: OWNER_OPENED - 20_000, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
  { at: OWNER_STARTED, kind: 'weapon_strip', weapon: '-1357824103' },
  { at: OWNER_OPENED + 12_000, kind: 'weapon_strip', weapon: '-1357824103' },
  { at: OWNER_OPENED + 64_000, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
  {
    at: OWNER_OPENED + 900_000,
    kind: 'kill',
    killerLicense: 'license:ccc',
    killerName: 'ChillyCat2121',
    victimLicense: 'license:ccc',
    victimName: 'ChillyCat2121',
    cause: 'left',
  },
]

const ownerEvents: ConsoleTimelineEvent[] = [
  { at: OWNER_OPENED, kind: 'opened', byLicense: null, byName: 'Anticheat' },
  { at: OWNER_OPENED + 40_000, kind: 'note', byLicense: null, byName: 'System', text: '3 refusals' },
  { at: OWNER_OPENED + 55_000, kind: 'resolved', byLicense: 'license:xeon', byName: 'Xeon' },
  { at: OWNER_OPENED + 71_000, kind: 'note', byLicense: null, byName: 'System', text: '4 refusals' },
  { at: OWNER_OPENED + 73_000, kind: 'note', byLicense: null, byName: 'System', text: '5 refusals' },
]

const ownerRows = mergeTimeline(ownerEvents, ownerStored)
const ownerColumn = ownerRows.map((r) => matchOffset(r.at, OWNER_OPENED) ?? '(blank)')

check(
  "the owner's thirteen rows, in order, with the column they now carry",
  ownerColumn.join(' ') ===
    '-0:33 -0:20 +0:00 +0:12 +0:29 +0:40 +0:55 +1:04 +1:11 +1:11 +1:13 +15:00 +15:01',
  ownerColumn.join(' '),
)

/*
 * THE EIGHT THAT WERE BLANK, NAMED BY THE RULE THAT BLANKED THEM. Anything
 * restoring a lower bound of any kind fails here with a count.
 */
const ownerBefore = ownerRows.filter((r) => r.at < OWNER_STARTED)
check(
  'the eight rows before the match entered play all carry a number now',
  ownerBefore.length === 8 &&
    ownerBefore.every((r) => matchOffset(r.at, OWNER_OPENED) !== null),
  ownerBefore.map((r) => matchOffset(r.at, OWNER_OPENED)),
)

/*
 * THE OPENING IS THE ORIGIN, so `+0:00` on it is true by construction rather
 * than by arithmetic — and it was one of the eight.
 */
check(
  "the case's own opening reads +0:00 rather than nothing",
  matchOffset(OWNER_OPENED, OWNER_OPENED) === '+0:00',
)

/*
 * ═══ AND THE CLOSE CARRIES ONE, WHICH IS A DECISION AND NOT AN ACCIDENT ═══
 *
 * It was suppressed before — by the bound, whose stated reason was a case
 * resolved days later. On this page it is fifty-five seconds after the report,
 * and it is exactly the row an offset makes readable: an admin banned somebody
 * inside a minute of the anticheat filing. The rule does not know or care which
 * kind it is; it draws what is close enough to read, and a close the next
 * morning is still blank — the case two blocks up.
 */
const ownerClose = ownerRows.find((r) => r.source === 'console' && r.event.kind === 'resolved')
check(
  'the close reads +0:55 rather than nothing',
  ownerClose !== undefined && matchOffset(ownerClose.at, OWNER_OPENED) === '+0:55',
  ownerClose === undefined ? 'missing' : matchOffset(ownerClose.at, OWNER_OPENED),
)
check(
  'and the same close a day later still reads nothing',
  matchOffset(OWNER_OPENED + HOURS(19), OWNER_OPENED) === null,
)

/*
 * A CASE WITH NO MATCH AT ALL IS ON THE SAME RULER. Nothing about `MatchFields`
 * is consulted, so a lobby report's three console rows are placed exactly like
 * the thirteen above. This used to be the documented reason a whole shape had no
 * offsets anywhere.
 */
const lobbyRows = mergeTimeline(
  [
    { at: NOW, kind: 'opened', byLicense: null, byName: 'Marla' },
    { at: NOW + 133_000, kind: 'note', byLicense: null, byName: 'System', text: 'seen again' },
    { at: NOW + 340_000, kind: 'resolved', byLicense: null, byName: 'Preview Admin' },
  ],
  null,
)
check(
  'a report filed in the lobby is placed like every other case',
  lobbyRows.map((r) => matchOffset(r.at, NOW)).join(' ') === '+0:00 +2:13 +5:40',
  lobbyRows.map((r) => matchOffset(r.at, NOW)).join(' '),
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
  /origin=\{incident\.openedAt\}/.test(component?.text ?? ''),
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
 * ═══ AND THE RULER HAS NO SECOND END TO GET WRONG ═══
 *
 * WAS TWO GREPS PINNING `startedAt: incident.matchStartedAt` AND THE ABSENCE OF
 * `matchCreatedAt`. That pair held the old shape in place: a window from the
 * match start, deliberately not widened to the creation time. The owner's
 * instruction retired the window, so what needs pinning is now the opposite —
 * that no match attribute reaches the offset call at all.
 *
 * IT IS THE SAME MUTATION EITHER WAY. `startedAt`, `?? matchCreatedAt` and a
 * `bound` rebuilt out of `matchEndedAt ?? matchEndsBy` are all plausible, all
 * invisible to every case in section 7, and all of them put the owner's eight
 * blank rows back. One grep over four names refuses the lot; 7b2 is what says
 * why. `matchTimeline` and `matchId` are deliberately not in it — the component
 * reads the list and the record, which is a different job.
 */
const WINDOW_FIELDS = /match(StartedAt|EndedAt|EndsBy|CreatedAt)/
check(
  'no match attribute takes any part in where the offsets count from',
  !WINDOW_FIELDS.test(component?.text ?? ''),
  (component?.text.match(new RegExp(WINDOW_FIELDS, 'g')) ?? []).join(' '),
)

/*
 * ═══ AND BOTH HALVES OF THE LIST HAVE TO ASK FOR ONE ═══
 *
 * THREE MUTATIONS SURVIVED EVERYTHING ABOVE UNTIL THESE THREE LINES EXISTED,
 * and all three are the gap this section is for: nothing here renders React, so
 * a component that simply stopped drawing the column on the console rows — or on
 * the match rows, or that handed `matchOffset` its two arguments the other way
 * round and sign-flipped every number on the page — left `matchOffset` correct
 * and every case in section 7 green.
 *
 * THE CONSOLE HALF IS THE ONE THAT MATTERS. It carries the opening, every note
 * and the close, which are three of the rows the owner was counting.
 */
check(
  "the console's own rows ask for an offset",
  /<Offset at=\{event\.at\} origin=\{origin\} \/>/.test(component?.text ?? ''),
)
check(
  "and the game's rows ask for one too",
  /<Offset at=\{entry\.at\} origin=\{origin\} \/>/.test(component?.text ?? ''),
)
check(
  'and the instant is measured against the origin, not the origin against the instant',
  /matchOffset\(at, origin\)/.test(component?.text ?? ''),
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
 * ═══ THE CONSOLE'S OWN THREE, WHICH USED TO LIVE IN THIS COMPONENT ═══
 *
 * `CONSOLE_EVENT_LABEL` was a const in the markup file, which is precisely the
 * arrangement this module's header argues against and the reason the owner's
 * two strings were free to be anything. It is in `lib` now, section 4d pins the
 * words, and these two close the same gap section 4b closes for the match
 * labels: 4d cannot see what the component actually renders, and a component
 * that re-declared the map or hardcoded a row would pass every case above.
 */
check(
  'the component looks its own labels up rather than writing them',
  /labelFor\(CONSOLE_EVENT_LABEL,/.test(component?.text ?? ''),
)
check(
  'and it does not keep a second copy of the map',
  !/const CONSOLE_EVENT_LABEL/.test(component?.text ?? ''),
)
check(
  'and it spells neither of the owner\'s two words itself',
  !/Incident (opened|resolved)/.test(component?.text.replace(/\/\*[\s\S]*?\*\//g, '') ?? ''),
  (component?.text.replace(/\/\*[\s\S]*?\*\//g, '').match(/Incident (opened|resolved)/g) ?? []).join(' '),
)

/*
 * THE RED DOTS COME FROM THE PREDICATE, NOT FROM A COMPARISON IN THE JSX. This
 * is `isBracket`'s grep aimed at the console's half of the list: the set is two
 * of three kinds, and `event.kind === 'opened' || …` written inline is a rule
 * section 4d cannot see. The second case is the one that catches the plausible
 * mutation — painting every console row red, which would leave the notes
 * shouting and the predicate unused.
 */
check(
  'the timeline component gets its case brackets from `isCaseBracket`',
  component?.text.includes('isCaseBracket(') === true,
)
check(
  'and no console-kind literal is left in the markup to drift from it',
  !/['"](opened|resolved|note)['"]/.test(component?.text ?? ''),
  (component?.text.match(/['"](opened|resolved|note)['"]/g) ?? []).join(' '),
)
check(
  'the danger tone is applied conditionally rather than to every console row',
  /tone=\{isCaseBracket\(event\) \? 'danger' : 'default'\}/.test(
    component?.text ?? '',
  ),
)

/*
 * ═══ THE VERDICT, WHICH IS ON THIS LIST NOW AND NOT IN A CARD UNDER IT ═══
 *
 * The owner, 2026-08-22: the verdict "isn't supposed to have it's own section on
 * a resolved incident". Section 4e proves the three duplicated facts survive the
 * fold and 4f proves the row always exists; NEITHER CAN SEE A CHIP, because
 * nothing here renders React. Every case in 4e passes with the chip deleted
 * outright, which is the definition of a test that has pinned nothing — so the
 * chip, its two ban spans, the absent-verdict wording and the provenance link
 * each get a grep, and each grep is written to fail on one mutation rather than
 * on any edit.
 */
check(
  'the closing row is chosen by `isResolution`, not by a comparison',
  component?.text.includes('isResolution(') === true,
)
check(
  'the verdict rides on that row and on no other',
  /closure=\{isResolution\(row\.event\) \? incident : null\}/.test(
    component?.text ?? '',
  ),
)
check(
  'the chip is drawn only where the caller passed a closure',
  /\{closure && \(\s*<Verdict verdict=\{closure\.verdict\} verdictLabel=\{verdictLabel\} \/>/.test(
    component?.text ?? '',
  ),
)
/*
 * THE COLOUR IS THE SHARED ONE. A chip that spelled its own tint would be the
 * page holding a second opinion about what a ban is — #28's original failure,
 * and the thing `verdictTone` exists to stop. Both readings are named: the
 * recorded verdict's action, and the absent verdict's null.
 */
check(
  'the chip takes its colour from `verdictTone`, not from a literal',
  /verdictTone\(verdict\.action\)/.test(component?.text ?? '') &&
    /verdictTone\(null\)/.test(component?.text ?? ''),
)
check(
  'and the word from the map it is handed, not from the id',
  /labelFor\(verdictLabel, verdict\.action\)/.test(component?.text ?? ''),
)
/*
 * THE FOUR STATES, AS THE PAGE ACTUALLY WORDS THEM. `expiresAt === null` MEANS
 * PERMANENT and is the same value that means "not applicable" on the other two
 * verdicts, which is why the action is read first — reversing those two nests
 * puts "— permanent" on every kick.
 */
check(
  'a permanent ban still says so',
  /expiresAt === null \? \(\s*<span className="ml-1 normal-case">— permanent<\/span>/.test(
    component?.text ?? '',
  ),
)
check(
  'a ban with an expiry still says until when',
  /— until <LocalTime ms=\{verdict\.expiresAt\} \/>/.test(component?.text ?? ''),
)
check(
  'the expiry is reached through the action, not through `expiresAt` alone',
  /verdict\.action === 'ban' \?/.test(component?.text ?? ''),
)
/*
 * AND THE ROW WITH NO VERDICT KEEPS ITS SENTENCE, VERBATIM. `lib/incidentChip`
 * names this chip as the ONLY place the console states the difference between a
 * recorded verdict of `none` and no verdict at all — deleting it does not
 * degrade the page, it deletes a distinction, which is why the string is pinned
 * character for character rather than by shape.
 */
check(
  'the absent verdict still reads "resolved · no verdict recorded"',
  component?.text.includes('resolved · no verdict recorded') === true,
)
/*
 * THE PROVENANCE IS THE OTHER THING THAT MOVED, and its link is built from the
 * structured field rather than found in the resolution text — an id
 * interpolated into free text is an id in a value that gets copied around.
 */
check(
  'the provenance sentence came with it',
  component?.text.includes('The ban that closed this was issued') === true,
)
check(
  'and its link is built from `closedByBan`, not from the resolution text',
  /href=\{`\/incidents\/\$\{closure\.closedByBan\.fromIncidentId\}`\}/.test(
    component?.text ?? '',
  ),
)
check(
  "and the case with nothing to point at still says the owner's word",
  /'on-demand'/.test(component?.text ?? ''),
)

/*
 * ═══ AND THE CARD IS ACTUALLY GONE ═══
 *
 * THE ONE MUTATION EVERY CHECK ABOVE WOULD WAVE THROUGH: fold the verdict onto
 * the row AND leave the card where it was. The page would then say the same
 * things three times instead of twice, every case in 4e would pass, every grep
 * above would pass, and the owner's complaint would be worse rather than fixed.
 * These three name what the card was made of.
 */
const detail = sources.find((s) => s.path === 'src/components/IncidentDetail.tsx')
check('the incident page is where this thinks it is', detail !== undefined)
check(
  'the verdict has no section of its own on the incident page',
  !/<h2[^>]*>Verdict<\/h2>/.test(detail?.text ?? ''),
)
check(
  'and the page no longer repeats the resolution the closing row carries',
  !/\{incident\.resolution\}/.test(detail?.text ?? '') &&
    !/\{incident\.resolvedByName\}/.test(detail?.text ?? ''),
)
check(
  'and the provenance sentence is not spelled in two places',
  !detail?.text.includes('The ban that closed this was issued'),
)
/*
 * THE LABEL MAP REACHES THE TIMELINE, which is what makes the chip's word the
 * one `VERDICT_LABEL` says. A client component cannot import it — `lib/incidents`
 * reaches DynamoDB — so it travels as a prop, and a fold that forgot to pass it
 * would be a type error today and a silently humanised id the moment the prop
 * gained a default.
 */
check(
  'the timeline is handed the verdict labels by the page above it',
  /<IncidentTimeline[\s\S]{0,200}verdictLabel=\{verdictLabel\}/.test(
    detail?.text ?? '',
  ),
)

/*
 * THE CLOSING ROW IS GUARANTEED BEFORE THE MERGE, not conjured during it.
 * Section 4f pins `withClosure` itself; this pins that the component calls it —
 * a mutation that reverted the call to `incident.events` leaves every case in 4f
 * green and puts the fold's whole failure mode back.
 */
check(
  'the component merges the events the closure guard hands it',
  /mergeTimeline\(\s*withClosure\(incident\.events, incident\),/.test(
    component?.text ?? '',
  ),
)

/*
 * ═══ AND THE THREE FACTS THAT USED TO BE SAID TWICE ═══
 *
 * THIS IS THE GAP THE FOLD ITSELF OPENED, AND THREE MUTANTS WALKED STRAIGHT
 * THROUGH IT. The resolution text, the closing instant and the closing admin
 * were each rendered in TWO places — this row and the card — right up until the
 * card went. They are rendered in ONE place now, so a component that stops
 * drawing any of them no longer loses a duplicate: it deletes the fact from the
 * console. Dropping `{event.text}`, dropping `{event.byName}` and dropping the
 * `<LocalTime>` each left every case in 4e green, because 4e can prove the ROW
 * CARRIES all three and cannot see whether the markup draws them.
 *
 * THE COST OF THE FOLD IS THEREFORE TWO GREPS. That is a fair price and it is
 * worth naming as a price: this file gained a reason to fail on a formatting
 * edit to the row, which it did not have while the card was there to say the
 * same things a second time.
 */
check(
  'the row still draws the text the card used to repeat',
  /\{event\.text \? \(\s*<span className="text-muted-foreground"> — \{event\.text\}<\/span>/.test(
    component?.text ?? '',
  ),
)
check(
  'and the meta line still names both the instant and the admin',
  /<LocalTime ms=\{event\.at\} \/> · \{event\.byName\}/.test(component?.text ?? ''),
)

/*
 * AND THE TONE HAS TO EXIST WHERE THE PRIMITIVE DEFINES IT. `TimelineMarker`'s
 * variants are a `cva` object; a tone the component names and the primitive
 * does not have compiles (cva types it as the union, so this would in fact be a
 * type error) but the dot would still be worth pinning to the danger TOKEN
 * rather than to some other red — `--destructive` is a different colour in this
 * palette and is the one a hurried edit reaches for.
 */
const marker = sources.find((s) => s.path === 'src/components/ui/timeline.tsx')
check('the timeline primitive is where this thinks it is', marker !== undefined)
check(
  'the danger tone paints the dot from the danger token',
  /danger:\s*"text-danger \[--timeline-dot:var\(--danger\)\]"/.test(
    marker?.text ?? '',
  ),
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
 * THE CONSOLE'S THREE, WITH THE DOT EACH ONE GETS. Printed rather than only
 * asserted for the same reason as the line above: the owner dictated two of
 * these strings, and a change to either should show up in a diff of this
 * output as different words rather than as nothing.
 */
console.log(
  `  console kinds     ${['opened', 'note', 'resolved']
    .map(
      (k) =>
        `${k}=${labelFor(CONSOLE_EVENT_LABEL, k)}` +
        `[${isCaseBracket({ at: NOW, kind: k, byLicense: null, byName: 'System' }) ? 'red' : 'default'}]`,
    )
    .join('  ')}`,
)
/*
 * A WARMUP CASE, LEFT TO RIGHT. EVERY ONE OF THESE USED TO BE A DASH — there was
 * no start and no deadline, so there was no ruler and the whole shape went
 * unplaced. The opening is the ruler now, so a case that never left the pad
 * reads like any other. If a lower bound of any kind comes back, this line goes
 * to dashes and says so.
 */
console.log(
  `  warmup timeline   ${warmupMerged
    .map((r) => {
      const label = r.source === 'match' ? r.entry.kind : r.event.kind
      return `${label}=${matchOffset(r.at, CREATED + 101_000) ?? '—'}`
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
    .map(([label, at]) => `${String(label)}=${matchOffset(at as number, FILED) ?? '—'}`)
    .join('  ')}`,
)
/*
 * AND THE OWNER'S PAGE, WHICH IS THE ONE THIS CHANGE IS ABOUT. Read left to
 * right: everything up to and including the close happened before the match
 * entered play, and every one of those columns was empty.
 */
console.log(
  `  warmup-filed case ${ownerRows
    .map(
      (r) =>
        `${r.source === 'match' ? r.entry.kind : r.event.kind}` +
        `=${matchOffset(r.at, OWNER_OPENED) ?? '—'}`,
    )
    .join('  ')}`,
)
console.log(`  event shape       ${JSON.stringify(EVENTS_ARE_ASSIGNABLE)}`)
console.log(`  closure shape     ${JSON.stringify(CLOSURE_IS_ASSIGNABLE)}`)
/*
 * THE CLOSING ROW AS THE PAGE BUILDS IT, in both the ordinary shape and the one
 * `withClosure` guards against, side by side. Printed rather than only asserted
 * for the reason the two lines above are: the fold's entire claim is that these
 * two read alike, and a change to either should show up in a diff of this output
 * as different words rather than as nothing.
 */
for (const [label, c] of [
  ['as resolve wrote it', closedCase('Banned for 7 days')],
  ['rebuilt by the guard', noClosingRow],
] as const) {
  const row = closingRow(c)
  console.log(
    `  closing row       ${label.padEnd(20)} ${labelFor(CONSOLE_EVENT_LABEL, row?.kind)} — ${row?.text ?? '(none)'}  ·  ${row?.byName ?? '(none)'}  ·  ${matchOffset(row?.at, NOW) ?? '—'}`,
  )
}
/*
 * AND THE COLOUR EACH VERDICT WEARS. Two of the four are loud and two are quiet;
 * if that ever becomes four of four, the console is telling admins that deciding
 * nothing is a failure, which is #28 all over again.
 */
console.log(
  `  verdict tones     ${(['ban', 'kick', 'none'] as const)
    .map((a) => `${a}=${verdictTone(a).includes('text-danger') ? 'loud' : 'quiet'}`)
    .join('  ')}  none-recorded=${verdictTone(null).includes('text-danger') ? 'loud' : 'quiet'}`,
)

console.log()
if (failed > 0) {
  console.error(`check:timeline — ${failed} failing case(s)`)
  process.exit(1)
}
console.log('check:timeline — all cases pass')
