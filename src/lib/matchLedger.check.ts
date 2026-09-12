/**
 * Contract checks for assembling one match out of its per-player rows.
 *
 *   npx tsx src/lib/matchLedger.check.ts
 *
 * A PLAIN SCRIPT, matching the others in this directory. IT IS WIRED INTO
 * `npm run verify` as `check:matchledger`.
 *
 * ═══ WHAT IS ACTUALLY AT RISK HERE ═══
 *
 * Not the arithmetic. The risk is that the page presents a value the game never
 * recorded as though it had. #51: "None of it backfills... The page must not
 * render a missing value as a real one; a zero is a claim." #293: "Every match
 * already played will show zero spent, no squad grouping, and no start time."
 *
 * The owner cannot fix that by hand — he has said he will not edit DynamoDB —
 * and no migration can invent a spend that was never counted. So the ONLY
 * defence is that the reader keeps "absent" and "zero" apart, forever, for every
 * match played before `03cce2d`. That distinction is one `optNum` versus `num`
 * in `ledgerFrom`, it is invisible in a screenshot, and `num()` is what the rest
 * of this file's neighbours use — which is exactly the shape of change somebody
 * makes while tidying.
 *
 * SO THE ROWS BELOW ARE THE TWO REAL SHAPES, written as br_ddb writes them:
 * `legacyRow` omits the three attributes, `modernRow` carries them at zero. If
 * those two ever produce the same ledger, this file fails.
 */

import { bySquad, ledgerFrom, mostKills } from './matchLedger'

let failed = 0
let ran = 0

function check(label: string, ok: boolean, detail?: unknown): void {
  ran++
  if (ok) return
  failed++
  console.error(`  FAIL  ${label}`)
  if (detail !== undefined) {
    console.error(`        got: ${JSON.stringify(detail)}`)
  }
}

const ID = 0xd93aa
const ENDED = 1_757_700_000_000
const STARTED = ENDED - 18 * 60_000

/**
 * A row as br_ddb writes one TODAY.
 *
 * Every attribute on `HISTORY_NUMBERS` is present — the committed bundle's list
 * is `["matchId","endedAt","startedAt","placement","total","kills","downs",
 * "revives","damage","survivedMs","xpEarned","voltsEarned","voltsSpent"]` — plus
 * `mode` and `squadId` as explicit strings and `won` as a boolean.
 */
function modernRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pk: 'license:aaa',
    matchId: ID,
    endedAt: ENDED,
    startedAt: STARTED,
    mode: 'squad',
    squadId: 'md93aasq1',
    placement: 1,
    total: 24,
    kills: 4,
    downs: 1,
    revives: 2,
    damage: 812,
    survivedMs: 17 * 60_000,
    xpEarned: 430,
    voltsEarned: 260,
    voltsSpent: 0,
    won: true,
    ...over,
  }
}

/**
 * A row as br_ddb wrote one BEFORE `03cce2d`.
 *
 * THE THREE ATTRIBUTES ARE ABSENT, not zero, and that is the only difference
 * that matters. br_ddb's item builder only writes the keys on its allowlists, so
 * a row written before the names were added to them simply has no such
 * attributes — which is what makes the distinction recoverable at read time.
 */
function legacyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const row = modernRow(over)
  delete row.startedAt
  delete row.squadId
  delete row.voltsSpent
  return row
}

// ---------------------------------------------------------------------------
console.log('\nA. a match recorded since #293')
// ---------------------------------------------------------------------------

const modern = ledgerFrom(ID, [
  modernRow({ pk: 'license:aaa', placement: 1, kills: 4, won: true }),
  modernRow({ pk: 'license:bbb', placement: 1, kills: 7, won: true }),
  modernRow({
    pk: 'license:ccc',
    squadId: 'md93aasq2',
    placement: 3,
    kills: 2,
    won: false,
    voltsSpent: 140,
  }),
])!

check('the ledger exists', modern !== null)
check('it is named in hex', modern.tag === 'd93aa', modern.tag)
check('the start time is read', modern.startedAt === STARTED, modern.startedAt)
check('the end time is read', modern.endedAt === ENDED, modern.endedAt)
check('the field size is the game`s count, not the row count', modern.total === 24, modern.total)
check('the squad grouping is recorded', modern.squadsRecorded === true)
check('the spend is recorded', modern.spendRecorded === true)

/**
 * A REAL ZERO IS SHOWN AS A ZERO. This is the other half of the absent/zero
 * pair and it is just as easy to get wrong in the opposite direction: a player
 * who bought nothing spent nothing, and blanking that would hide a real fact.
 */
check(
  'a player who spent nothing has a real zero, not a null',
  modern.participants.find((p) => p.license === 'license:aaa')?.voltsSpent === 0,
  modern.participants.find((p) => p.license === 'license:aaa')?.voltsSpent,
)
check(
  'and a player who spent something carries the figure',
  modern.participants.find((p) => p.license === 'license:ccc')?.voltsSpent === 140,
)

// ---------------------------------------------------------------------------
console.log('\nB. a match recorded before #293, which never backfills')
// ---------------------------------------------------------------------------

const legacy = ledgerFrom(ID, [
  legacyRow({ pk: 'license:aaa', placement: 1, won: true }),
  legacyRow({ pk: 'license:bbb', placement: 2, won: false }),
])!

/**
 * THE THREE ASSERTIONS THIS WHOLE FILE EXISTS FOR. Each one is a `null`/`false`
 * where a careless read would produce a `0`/`true`, and each would render on the
 * page as a number the owner would reasonably believe.
 */
check(
  'no start time, and it is null rather than zero',
  legacy.startedAt === null,
  legacy.startedAt,
)
check('no spend recorded at all', legacy.spendRecorded === false)
check(
  'every spend is null, so no row can show a zero it did not earn',
  legacy.participants.every((p) => p.voltsSpent === null),
  legacy.participants.map((p) => p.voltsSpent),
)
check('no squad grouping recorded', legacy.squadsRecorded === false)
check(
  'and every squad id is null',
  legacy.participants.every((p) => p.squadId === null),
)

/**
 * THE MODE STILL SAYS SQUAD, and that pairing is what makes the absence
 * readable. `squadsRecorded === false` with `mode === 'squad'` is "the grouping
 * is missing"; the same flag with `mode === 'solo'` is "there were no squads".
 * A page that only looked at the flag could not tell those apart.
 */
check('the mode is still known', legacy.mode === 'squad', legacy.mode)

/**
 * A MATCH THAT NEVER STARTED IS THE SAME AS A ROW THAT NEVER RECORDED ONE.
 * `persist.lua` stores 0 for a match dissolved on the warmup pad and says 0 is
 * "the one value every reader already has to treat as not recorded".
 */
const dissolved = ledgerFrom(ID, [modernRow({ startedAt: 0 })])!
check(
  'a stored zero start time reads as not recorded',
  dissolved.startedAt === null,
  dissolved.startedAt,
)

// ---------------------------------------------------------------------------
console.log('\nC. a solo match')
// ---------------------------------------------------------------------------

const solo = ledgerFrom(ID, [
  modernRow({ pk: 'license:aaa', mode: 'solo', squadId: '', placement: 1, won: true }),
  modernRow({ pk: 'license:bbb', mode: 'solo', squadId: '', placement: 2, won: false }),
])!

/**
 * br_ddb WRITES THE EMPTY STRING FOR A SOLO, not an absent attribute:
 * `squadId: String(t.squadId ?? '')`. So `''` has to normalise to the same null
 * the grouping code reads, or a solo match would be grouped under a squad called
 * "".
 */
check('an empty squad id is no squad', solo.participants.every((p) => p.squadId === null))
check('so a solo match records no grouping', solo.squadsRecorded === false)
check(
  'and the spend is still recorded, because that is a different question',
  solo.spendRecorded === true,
)

// ---------------------------------------------------------------------------
console.log('\nD. ordering')
// ---------------------------------------------------------------------------

const ordered = ledgerFrom(ID, [
  modernRow({ pk: 'license:third', placement: 3 }),
  // Placement 0 — the row never got one. This is the case that must not sort
  // above the winner.
  modernRow({ pk: 'license:none', placement: 0 }),
  modernRow({ pk: 'license:first', placement: 1 }),
  modernRow({ pk: 'license:second', placement: 2 }),
])!

check(
  'placements ascend and the unplaced sort last',
  ordered.participants.map((p) => p.license).join(',') ===
    'license:first,license:second,license:third,license:none',
  ordered.participants.map((p) => `${p.license}@${p.placement}`),
)

/**
 * DETERMINISTIC ACROSS TWO ASSEMBLIES OF THE SAME ROWS IN A DIFFERENT ORDER.
 * A scan returns partitions in whatever order it reaches them, so a sort that
 * depended on input order would reshuffle the page between two loads of the same
 * match — which is the kind of thing that makes a reader distrust a page they
 * cannot otherwise fault.
 */
const shuffled = ledgerFrom(ID, [
  modernRow({ pk: 'license:second', placement: 2 }),
  modernRow({ pk: 'license:none', placement: 0 }),
  modernRow({ pk: 'license:first', placement: 1 }),
  modernRow({ pk: 'license:third', placement: 3 }),
])!
check(
  'the same rows in a different order assemble identically',
  JSON.stringify(shuffled.participants.map((p) => p.license)) ===
    JSON.stringify(ordered.participants.map((p) => p.license)),
)

// ---------------------------------------------------------------------------
console.log('\nE. grouping by squad')
// ---------------------------------------------------------------------------

const grouped = bySquad([
  { ...base('license:a'), squadId: 'md93aasq2', placement: 4 },
  { ...base('license:b'), squadId: 'md93aasq1', placement: 1 },
  { ...base('license:c'), squadId: null, placement: 9 },
  { ...base('license:d'), squadId: 'md93aasq2', placement: 5 },
])

check(
  'the winning squad comes first and the ungrouped come last',
  grouped.map(([id]) => id).join(',') === 'md93aasq1,md93aasq2,',
  grouped.map(([id]) => id),
)
check('squad members stay together', grouped[1]![1].length === 2)

/**
 * THE HEX TAG IN THE SQUAD ID DOES NOT DISTURB THE INDEX. Squad ids are minted
 * `m<tag>sq<n>` since #291, so the match half is now hex — and `squadIndex` in
 * MatchCard reads only the `sq(\d+)$` suffix. Pinned here because a squad id
 * containing the letters a-f is exactly the input somebody would assume breaks
 * a parser that used to see only digits.
 */
check(
  'a hex-tagged squad id still groups and orders',
  bySquad([
    { ...base('license:x'), squadId: 'mfffffsq10', placement: 2 },
    { ...base('license:y'), squadId: 'mfffffsq2', placement: 1 },
  ]).map(([id]) => id).join(',') === 'mfffffsq2,mfffffsq10',
)

// ---------------------------------------------------------------------------
console.log('\nF. most kills')
// ---------------------------------------------------------------------------

check(
  'the top scorer',
  mostKills([
    { ...base('license:a'), kills: 2 },
    { ...base('license:b'), kills: 7 },
    { ...base('license:c'), kills: 1 },
  ])
    .map((p) => p.license)
    .join(',') === 'license:b',
)

check(
  'a tie names everybody, because there is no tiebreak that is not invented',
  mostKills([
    { ...base('license:a'), kills: 3 },
    { ...base('license:b'), kills: 3 },
    { ...base('license:c'), kills: 1 },
  ]).length === 2,
)

/**
 * NOBODY LED A MATCH WITH NO KILLS. Returning the alphabetically first player as
 * the leader of nothing is a claim about that person, on a page somebody
 * moderates from.
 */
check(
  'a match where nobody got a kill has no most-kills',
  mostKills([
    { ...base('license:a'), kills: 0 },
    { ...base('license:b'), kills: 0 },
  ]).length === 0,
)

check('and neither does an empty field', mostKills([]).length === 0)

// ---------------------------------------------------------------------------
console.log('\nG. nothing to assemble')
// ---------------------------------------------------------------------------

check('no rows, no ledger', ledgerFrom(ID, []) === null)
/**
 * AN ID WITH NO TAG CANNOT BE A LEDGER, because the page could neither title it
 * nor be addressed by it. Unreachable through the route, which parses the tag
 * first; pinned so the type stays honest.
 */
check('an id of zero has no ledger', ledgerFrom(0, [modernRow()]) === null)

// ---------------------------------------------------------------------------
console.log('\nH. names')
// ---------------------------------------------------------------------------

const named = ledgerFrom(
  ID,
  [modernRow({ pk: 'license:aaa' }), modernRow({ pk: 'license:bbb' })],
  new Map([['license:aaa', 'Vex']]),
)!

check(
  'a known license gets its name',
  named.participants.find((p) => p.license === 'license:aaa')?.name === 'Vex',
)
/**
 * AND AN UNKNOWN ONE GETS NULL RATHER THAN A PLACEHOLDER. The history rows carry
 * no name at all (`persist.lua` writes the license and nothing else), so the
 * registry is the only source and it can genuinely never have seen somebody. The
 * page renders the license for them; inventing "Unknown player" here would put a
 * person on the page who is not one.
 */
check(
  'an unknown license gets null, and the page shows the license',
  named.participants.find((p) => p.license === 'license:bbb')?.name === null,
)

// ---------------------------------------------------------------------------

/** A minimal participant, for the pure grouping and ranking functions. */
function base(license: string) {
  return {
    license,
    name: null,
    squadId: null,
    placement: 0,
    kills: 0,
    downs: 0,
    revives: 0,
    damage: 0,
    survivedMs: 0,
    xpEarned: 0,
    voltsEarned: 0,
    voltsSpent: null,
    won: false,
  }
}

if (failed) {
  console.error(`\ncheck:matchledger — ${failed} failing case(s) of ${ran}`)
  process.exit(1)
}

console.log(`\ncheck:matchledger - all ${ran} cases pass`)
