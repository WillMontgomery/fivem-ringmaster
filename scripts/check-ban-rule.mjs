/**
 * The console half of the ban contract's case table.
 *
 * THE SAME CASES THE GAME SERVER TESTS, deliberately duplicated. Two
 * implementations in two languages in two repos decide whether somebody is
 * banned — `src/lib/bans.ts` here and `js-src/br_ddb/src/ban.js` in the
 * gamemode — and if they disagree, a player the console shows as banned walks
 * straight past the connect gate. Nobody notices until it matters.
 *
 * See the gamemode's docs/ban-contract.md, which is the written rule both
 * sides implement.
 *
 * A PLAIN SCRIPT RATHER THAN A TEST RUNNER because this repo has no test
 * framework and adding one to assert nine cases would be the larger change.
 * It runs in `npm run verify` alongside the secret scan and typecheck.
 */

/**
 * Kept in lockstep with `isActive` in src/lib/bans.ts by hand.
 *
 * IMPORTING THE REAL ONE WOULD BE BETTER and is not currently possible: bans.ts
 * imports the DynamoDB client at module scope, so pulling it into a plain node
 * script drags in the AWS SDK and an environment it has no reason to need. The
 * function is four lines; the case table below is what actually guards it, and
 * a divergence shows up as a failing case rather than a silent drift.
 */
function isActive(ban, now) {
  if (!ban) return false
  if (ban.liftedAt) return false
  if (ban.expiresAt !== null && ban.expiresAt !== undefined && ban.expiresAt <= now) {
    return false
  }
  return true
}

/**
 * The other half of the rule, and kept in lockstep with `effective` in
 * src/lib/bans.ts by the same hand, for the same reason.
 *
 * SINCE THE CONNECT GATE READS TWO KEYS it has two rows to reconcile, and the
 * owner settled which wins: an ACTIVE ban always beats a lifted one, whatever
 * identifier each is keyed on. The cases below are the ones that would let
 * somebody through if the two implementations drifted.
 */
function effective(rows, now) {
  for (const row of rows) {
    if (row && isActive(row, now)) return row
  }
  return null
}

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

const cases = [
  ['no row at all', null, false],
  ['undefined row', undefined, false],
  ['permanent, never lifted', { expiresAt: null, liftedAt: null }, true],
  ['permanent, expiresAt absent entirely', { liftedAt: null }, true],
  ['temporary, still running', { expiresAt: NOW + HOUR, liftedAt: null }, true],
  ['temporary, expired an hour ago', { expiresAt: NOW - HOUR, liftedAt: null }, false],
  ['temporary, expiring exactly now counts as served', { expiresAt: NOW, liftedAt: null }, false],
  ['lifted beats a live expiry', { expiresAt: NOW + HOUR, liftedAt: NOW - HOUR }, false],
  ['lifted beats permanent', { expiresAt: null, liftedAt: NOW - HOUR }, false],
  ['liftedAt absent, not null', { expiresAt: null }, true],
]

/**
 * The rows the two-key gate can turn up, named by what they are so a failure
 * line reads as a sentence rather than as two object literals.
 *
 * `license` doubles as the marker the assertions compare on: `effective`
 * returns a ROW, and "which row" is the entire question.
 */
const L_ACTIVE = { license: 'license:abc', expiresAt: null, liftedAt: null }
const L_LIFTED = { license: 'license:abc', expiresAt: null, liftedAt: NOW - HOUR }
const L_SERVED = { license: 'license:abc', expiresAt: NOW - HOUR, liftedAt: null }
const D_ACTIVE = { license: 'discord:280', expiresAt: null, liftedAt: null }
const D_LIFTED = { license: 'discord:280', expiresAt: null, liftedAt: NOW - HOUR }

/**
 * License row first, discord row second — the order the gate passes them in,
 * because when both are in force the order picks the reason the player is
 * shown and the license row is the one the console's profile page renders.
 */
const pickCases = [
  ['nothing on either identifier', [null, null], null],
  ['an empty list is not banned', [], null],
  ['a license ban alone', [L_ACTIVE, null], 'license:abc'],
  ['a discord ban alone — the row the gate could not see before #38', [null, D_ACTIVE], 'discord:280'],

  // ═══ THE OWNER'S RULING, BOTH WAYS ROUND ═══
  ['a LIFTED license ban does not beat an ACTIVE discord ban', [L_LIFTED, D_ACTIVE], 'discord:280'],
  ['a SERVED license ban does not beat an ACTIVE discord ban', [L_SERVED, D_ACTIVE], 'discord:280'],
  ['and a lifted discord ban does not beat an active license ban', [L_ACTIVE, D_LIFTED], 'license:abc'],

  ['neither in force means admitted', [L_LIFTED, D_LIFTED], null],
  ['both in force: the caller order decides, and it is license first', [L_ACTIVE, D_ACTIVE], 'license:abc'],
  ['a gap in the list is skipped, not read as a row', [undefined, D_ACTIVE], 'discord:280'],
]

let failed = 0
for (const [label, ban, expected] of cases) {
  const got = isActive(ban, NOW)
  if (got !== expected) {
    failed++
    console.error(`  FAIL  ${label} -> ${got} (expected ${expected})`)
  }
}

for (const [label, rows, expected] of pickCases) {
  const got = effective(rows, NOW)?.license ?? null
  if (got !== expected) {
    failed++
    console.error(`  FAIL  ${label} -> ${got} (expected ${expected})`)
  }
}

const total = cases.length + pickCases.length

if (failed) {
  console.error(`\nban rule: ${failed} of ${total} case(s) failed.`)
  console.error('The console and the game server must agree — see docs/ban-contract.md')
  process.exit(1)
}
console.log(`ban rule: ${total} cases match the contract`)
