/**
 * Contract checks for the way a match id is written down.
 *
 *   npx tsx src/lib/matchTag.check.ts
 *
 * A PLAIN SCRIPT, matching `profileLink.check.ts` and `origin.check.ts`: this
 * repo has no test framework. IT IS WIRED INTO `npm run verify` as
 * `check:matchtag`; a check nothing runs is this repository's signature failure
 * mode.
 *
 * ═══ WHAT THIS IS ACTUALLY GUARDING ═══
 *
 * Not "does `toString(16)` work". The thing that can break is AGREEMENT: the
 * gamemode prints every match id through `BR.MatchTag`, and if this console's
 * formatter ever drifts from it, a moderator reads two different names for one
 * match and nothing on either side looks wrong. #291: "Ringmaster and the game
 * logs should convert together, or moderation reads two numbers for one match."
 *
 * SO THE CASES BELOW ARE LIFTED FROM THE GAMEMODE'S OWN SUITE where they exist
 * there — `tools/test_roster.lua` pins `BR.MatchTag(0xa3f1) == '0a3f1'` under
 * the name "a short id is padded, never trimmed", and that exact case is
 * restated here. The value is in the duplication: two suites in two repos
 * asserting one string.
 */

import { MATCH_ID_MAX, matchFromTag, matchHref, matchTag } from './matchTag'

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

// ---------------------------------------------------------------------------
// 1. The format, against the gamemode's authority
// ---------------------------------------------------------------------------

console.log('\nA. five lower-case hex characters, zero padded')

// THE CASE THE GAMEMODE'S OWN SUITE PINS, by name.
check(
  'a short id is padded, never trimmed — BR.MatchTag(0xa3f1) is `0a3f1`',
  matchTag(0xa3f1) === '0a3f1',
  matchTag(0xa3f1),
)

check(
  'a full-width id is the five characters it already is',
  matchTag(0xa70bf) === 'a70bf',
  matchTag(0xa70bf),
)

check(
  'the top of the id space',
  matchTag(MATCH_ID_MAX) === 'fffff',
  matchTag(MATCH_ID_MAX),
)

check('the bottom of the id space', matchTag(1) === '00001', matchTag(1))

// LOWER CASE IS PART OF THE FORMAT, not a preference. `%05x` is lower case and
// `%05X` is not; a console showing `A70BF` against a game log showing `a70bf` is
// the same defect in a smaller font.
check(
  'hex digits above 9 are lower case, because `%05x` is',
  matchTag(0xabcde) === 'abcde',
  matchTag(0xabcde),
)

/**
 * THE ID THE OWNER SAW ON THE LIVE BOARD, which is what started this.
 *
 * "The live players view also still just says `match 889770`." 889770 is
 * 0xd93aa — a perfectly ordinary 20-bit draw, printed in decimal by a console
 * whose game server was already printing it as `d93aa`. This case is here so
 * that the exact number from the complaint is a passing assertion rather than a
 * memory.
 *
 * IT ALSO CAUGHT ITS OWN AUTHOR: this assertion was first written `d92aa`, by
 * hand, and failed on the first run. That is the argument for pinning a literal
 * rather than recomputing the expectation from the code under test.
 */
check(
  'the number from the complaint, `match 889770`, is `d93aa`',
  matchTag(889770) === 'd93aa',
  matchTag(889770),
)

/**
 * A PRE-#291 ID STILL RENDERS, and this is the case most likely to be
 * "corrected" into a rejection later.
 *
 * Match ids were a pure increment from 0 before #291, so every match already
 * played carries a small number — 412 is the one every fixture in this repo
 * uses. Those are real matches that real incidents point at, and they must
 * render rather than blank.
 */
check(
  'an id from the old increment renders as a padded tag',
  matchTag(412) === '0019c',
  matchTag(412),
)

// ---------------------------------------------------------------------------
// 2. What is NOT an id, and is never invented
// ---------------------------------------------------------------------------

console.log('\nB. never `00000`')

/**
 * ZERO IS THE WHOLE REASON THIS FUNCTION RETURNS NULL AT ALL.
 *
 * `historyRowFor` in br_stats writes `matchId = ctx.matchId or 0`, and br_ddb's
 * `num()` coerces an absent number to 0 — so a 0 on a row means the id was
 * ABSENT. `match.lua` excludes 0 from the id space in as many words ("0 IS
 * EXCLUDED and that is load bearing") and `server/loot.lua` reserves `00000` for
 * the communal warmup pad. A console that rendered `match 00000` would be
 * naming a match after a missing value, on a page people ban from.
 */
check('zero is not an id, it is an absent one', matchTag(0) === null, matchTag(0))
check('and a negative is not an id either', matchTag(-1) === null, matchTag(-1))
check('nor is a float', matchTag(412.5) === null, matchTag(412.5))
check('nor NaN', matchTag(Number.NaN) === null, matchTag(Number.NaN))
check('nor Infinity', matchTag(Number.POSITIVE_INFINITY) === null)
check('null passes through as null', matchTag(null) === null)
check('undefined passes through as null', matchTag(undefined) === null)

/**
 * ABOVE THE SPACE IT WIDENS RATHER THAN TRUNCATES, deliberately — see the
 * header. The current game cannot mint one, but truncating would silently
 * rename a row that does exist, and `%05x` in Lua widens too.
 */
check(
  'an id above the space widens rather than truncating',
  matchTag(MATCH_ID_MAX + 1) === '100000',
  matchTag(MATCH_ID_MAX + 1),
)

// ---------------------------------------------------------------------------
// 3. Reading a tag back
// ---------------------------------------------------------------------------

console.log('\nC. base 16, and strict about it')

check('a tag reads back as its number', matchFromTag('0a3f1') === 0xa3f1, matchFromTag('0a3f1'))
check('unpadded reads the same', matchFromTag('a3f1') === 0xa3f1, matchFromTag('a3f1'))

/**
 * THE CASE THAT MAKES BASE 16 LOAD BEARING. `0019c` is match 412. Parsed as
 * decimal it would be 19,100-something — a different match, or no match, with
 * nothing to say which happened. `BR.MatchFromTag` states the same hazard:
 * "parsing it as decimal would silently answer about a different match for any
 * id made only of digits."
 */
check(
  'a digits-only tag is hex, not decimal',
  matchFromTag('0019c') === 412,
  matchFromTag('0019c'),
)
check(
  'and a tag that is ALL digits is still hex',
  matchFromTag('00412') === 0x412,
  matchFromTag('00412'),
)

check('upper case is accepted, because people paste', matchFromTag('A3F1') === 0xa3f1)
check('surrounding whitespace is trimmed', matchFromTag('  a3f1  ') === 0xa3f1)

// STRICTER THAN parseInt, which is why parseInt is not used bare.
check('a `0x` prefix is not a tag', matchFromTag('0xa3f1') === null, matchFromTag('0xa3f1'))
check('trailing rubbish is not a tag', matchFromTag('a3f1zzz') === null, matchFromTag('a3f1zzz'))
check(
  'a non-hex letter is not a tag',
  matchFromTag('0g3f1') === null,
  matchFromTag('0g3f1'),
)
check('a sign is not a tag', matchFromTag('-a3f1') === null, matchFromTag('-a3f1'))
check('the empty string is not a tag', matchFromTag('') === null)
check('zero is not a tag', matchFromTag('00000') === null, matchFromTag('00000'))
check('and neither is a bare 0', matchFromTag('0') === null)
check('null and undefined pass through', matchFromTag(null) === null && matchFromTag(undefined) === null)
check(
  'an absurdly long run of hex is not a padded tag',
  matchFromTag('0000000000a3f1') === null,
)

console.log('\nD. the round trip')

/**
 * EVERY TAG READS BACK AS THE ID THAT MADE IT. This is the property the URL
 * depends on: the page resolves `/matches/<tag>` to a number and then looks for
 * rows carrying that number, so a round trip that lost a bit would render a page
 * about a different match under the right heading.
 */
const ROUND_TRIP = [
  1, 2, 15, 16, 255, 256, 412, 4095, 0xa3f1, 0xa70bf, 889770, 0xfffff,
]
for (const id of ROUND_TRIP) {
  const tag = matchTag(id)
  check(
    `${id} survives the round trip through its tag`,
    tag !== null && matchFromTag(tag) === id,
    { id, tag, back: tag === null ? null : matchFromTag(tag) },
  )
}

// ---------------------------------------------------------------------------
// 4. The href
// ---------------------------------------------------------------------------

console.log('\nE. one match, one URL')

check('the href is the tag under /matches', matchHref(0xa3f1) === '/matches/0a3f1', matchHref(0xa3f1))
check(
  'the href carries the tag and never the decimal id',
  matchHref(412) === '/matches/0019c',
  matchHref(412),
)
check('no id, no href', matchHref(0) === null && matchHref(null) === null)

/**
 * THE HREF IS A BARE PATH WITH NO QUERY, matching `profileHref`. #51: "Match the
 * href pattern the console already uses for profile links rather than inventing
 * a style."
 */
check(
  'the href has no query string',
  !(matchHref(0xa3f1) ?? '').includes('?'),
  matchHref(0xa3f1),
)

/**
 * EVERY TAG IS URL SAFE ALREADY, so encoding never changes one. Worth pinning:
 * if the tag format ever grew a character that needed escaping, the URL and the
 * printed form would stop being the same five characters and the copy-paste
 * property would go with it.
 */
for (const id of ROUND_TRIP) {
  const tag = matchTag(id)!
  check(`the tag for ${id} needs no escaping`, encodeURIComponent(tag) === tag, tag)
}

// ---------------------------------------------------------------------------

if (failed) {
  console.error(`\ncheck:matchtag — ${failed} failing case(s) of ${ran}`)
  process.exit(1)
}

console.log(`\ncheck:matchtag - all ${ran} cases pass`)
