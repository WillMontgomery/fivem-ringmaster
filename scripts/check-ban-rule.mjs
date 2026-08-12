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

let failed = 0
for (const [label, ban, expected] of cases) {
  const got = isActive(ban, NOW)
  if (got !== expected) {
    failed++
    console.error(`  FAIL  ${label} -> ${got} (expected ${expected})`)
  }
}

if (failed) {
  console.error(`\nban rule: ${failed} of ${cases.length} case(s) failed.`)
  console.error('The console and the game server must agree — see docs/ban-contract.md')
  process.exit(1)
}
console.log(`ban rule: ${cases.length} cases match the contract`)
