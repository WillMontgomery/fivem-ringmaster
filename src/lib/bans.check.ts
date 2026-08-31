/**
 * Contract checks for reconciling a Discord-keyed placeholder ban onto a
 * license — fivem-ringmaster#38.
 *
 *   npx tsx src/lib/bans.check.ts
 *
 * A PLAIN SCRIPT, matching `handoff.check.ts`, `grants.check.ts` and
 * `scripts/check-ban-rule.mjs`: this repo has no test framework and adding one
 * to assert two dozen cases would be the larger change. IT IS WIRED INTO
 * `npm run verify` as `check:banreconcile`; a check nothing runs is this
 * repository's signature failure mode and has already happened here once.
 *
 * IT LIVES UNDER src/ so `npm run typecheck` compiles it against the real
 * types — a change to `Ban`, `BanStore` or `ReconcileOutcome` breaks the build
 * here rather than leaving the checks asserting a shape that no longer exists.
 *
 * ═══ WHAT IT ACTUALLY EXERCISES ═══
 *
 * `reconcileDiscordBan` as shipped, driven through its `BanStore` seam with a
 * fake that reproduces DynamoDB's conditional put and conditional delete —
 * including the part that matters, which is a write landing in the gap between
 * our read and ours. Not a second copy of the rules.
 *
 * ═══ THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL ═══
 *
 * Deleting the placeholder before writing the license row fails the ordering
 * case. Dropping `discordEntryId` fails the one that keeps a later Discord
 * unban able to find the ban at all. Reconciling over a live license ban fails
 * `deferred`. Stamping `Date.now()` onto the moved row instead of keeping the
 * placeholder's `at` fails the provenance case. Reconciling a lifted
 * placeholder fails `not-active`.
 *
 * ═══ WHAT IT DOES NOT COVER ═══
 *
 * The ingest route that calls this, and the game-side gate. The gate's half is
 * in the gamemode: `js-src/br_ddb/scripts/test.mjs` drives the real handler
 * with a stubbed SDK, and `tools/test_ringmaster.lua` drives the deferral.
 */

process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'http://localhost:3000'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

import {
  reconcileDiscordBan,
  type Ban,
  type BanStore,
  type ReconcileOutcome,
} from './bans'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

const DISCORD_ID = '280000000000000000'
const PLACEHOLDER = `discord:${DISCORD_ID}`
const LICENSE = 'license:abc123'

let failed = 0
let ran = 0

function check(label: string, got: unknown, expected: unknown): void {
  ran++
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) {
    failed++
    console.error(
      `  FAIL  ${label}\n          got      ${JSON.stringify(got)}` +
        `\n          expected ${JSON.stringify(expected)}`,
    )
  }
}

/**
 * A ban row. `at` defaults to something recognisably NOT `NOW`, because half of
 * what these checks are about is whether the moved row keeps the moment the
 * Discord ban actually happened.
 */
function ban(over: Partial<Ban> = {}): Ban {
  return {
    license: PLACEHOLDER,
    at: NOW - 3 * HOUR,
    by: null,
    byName: 'A Moderator',
    reason: 'Banned in Discord',
    expiresAt: null,
    playerName: 'Someone',
    liftedAt: null,
    liftedBy: null,
    liftedByName: null,
    liftReason: null,
    discordEntryId: '999000000000000000',
    ...over,
  }
}

/**
 * The row at a key, or a failure naming the key.
 *
 * NOT `store.rows[k]!`. `noUncheckedIndexedAccess` is on in this repo, and the
 * non-null assertion would turn "the row we expected is not there" — the exact
 * thing several of these cases exist to catch — into a TypeError somewhere else.
 */
function rowAt(store: { rows: Record<string, Ban> }, key: string): Ban {
  const r = store.rows[key]
  if (!r) throw new Error(`expected a row at ${key}, found none`)
  return r
}

/** The SDK's shape for a refused condition, near enough for `name`. */
function conditionFailure(): Error {
  const e = new Error('The conditional request failed')
  e.name = 'ConditionalCheckFailedException'
  return e
}

/**
 * A DynamoDB that reproduces the two conditions and records the ORDER.
 *
 * THE ORDER IS AN ASSERTION AND NOT DEBUG OUTPUT. Writing the license row
 * before deleting the placeholder is the whole safety argument: a crash between
 * them leaves two rows that refuse the same person, and the other order has a
 * window in which nobody is banned at all.
 *
 * `interpose` runs immediately before each WRITE, and is told which one, which
 * is the only way to reproduce somebody else getting there first — separately
 * for the put and for the delete, because those are two different races with
 * two different consequences.
 */
type Interpose = (op: 'put' | 'remove') => void

function fakeStore(
  rows: Record<string, Ban>,
  interpose?: Interpose,
): BanStore & { log: string[]; rows: Record<string, Ban> } {
  const log: string[] = []

  return {
    rows,
    log,

    async get(id) {
      log.push(`get ${id}`)
      return rows[id] ?? null
    },

    async put(row, guard) {
      interpose?.('put')
      const current = rows[row.license]
      if (guard === 'absent') {
        if (current) throw conditionFailure()
      } else if (!current || current.at !== guard.at) {
        throw conditionFailure()
      }
      log.push(`put ${row.license}`)
      rows[row.license] = row
    },

    async remove(id, guard) {
      interpose?.('remove')
      const current = rows[id]
      if (!current || current.at !== guard.at) throw conditionFailure()
      log.push(`remove ${id}`)
      delete rows[id]
    },
  }
}

function run(
  rows: Record<string, Ban>,
  interpose?: Interpose,
): Promise<{ outcome: ReconcileOutcome; store: ReturnType<typeof fakeStore> }> {
  const store = fakeStore(rows, interpose)
  return reconcileDiscordBan(
    { discordId: DISCORD_ID, license: LICENSE, now: NOW },
    store,
  ).then((outcome) => ({ outcome, store }))
}

/**
 * TOP-LEVEL AWAIT IS NOT AVAILABLE HERE, and the reason is worth a line rather
 * than a puzzle: this package is CommonJS, tsx transpiles a `.ts` under it to
 * CJS, and esbuild refuses a top-level await in that format. Same shape as
 * `handoff.check.ts`.
 */
async function main(): Promise<void> {
console.log('ban reconciliation')

// ── nothing to do ────────────────────────────────────────────────────────────
{
  const { outcome, store } = await run({})
  check('no placeholder is not an error', outcome, 'no-placeholder')
  check('and writes nothing', store.log.slice(1), [])
}

{
  // A LIFTED PLACEHOLDER IS LEFT EXACTLY WHERE IT IS. There is no door to move,
  // only a record — and moving it onto a license would write a ban row for
  // somebody who is not banned, which reads on the moderation list as a ban
  // nobody issued.
  const rows = { [PLACEHOLDER]: ban({ liftedAt: NOW - HOUR }) }
  const { outcome, store } = await run(rows)
  check('a lifted placeholder is not reconciled', outcome, 'not-active')
  check('and is not deleted either', Object.keys(store.rows), [PLACEHOLDER])
}

{
  const rows = { [PLACEHOLDER]: ban({ expiresAt: NOW - HOUR }) }
  const { outcome } = await run(rows)
  check('nor is a served one', outcome, 'not-active')
}

// ── the move ─────────────────────────────────────────────────────────────────
{
  const rows: Record<string, Ban> = { [PLACEHOLDER]: ban() }
  const { outcome, store } = await run(rows)

  check('an active placeholder moves onto the license', outcome, 'reconciled')
  check(
    'license row first, placeholder second — a crash between leaves BOTH doors shut',
    store.log,
    [`get ${PLACEHOLDER}`, `get ${LICENSE}`, `put ${LICENSE}`, `remove ${PLACEHOLDER}`],
  )
  check('and the placeholder is gone', Object.keys(store.rows), [LICENSE])

  const moved = rowAt(store, LICENSE)
  check('keyed on the license now', moved.license, LICENSE)
  check('with the Discord ban’s own moment, not this one', moved.at, NOW - 3 * HOUR)
  check('its issuer', moved.byName, 'A Moderator')
  check('its reason — the sentence a player is shown', moved.reason, 'Banned in Discord')
  check('its expiry', moved.expiresAt, null)

  // ═══ THE ONE THAT KEEPS AN UNBAN POSSIBLE ═══
  //
  // blitz-bot's `liftableBy` lifts a game ban only when `discordEntryId` is
  // present. Drop it here and a later Discord unban finds a row it will not
  // touch — banned forever, by nobody's decision.
  check('and the marker a Discord unban needs to find it', moved.discordEntryId, '999000000000000000')

  check('provenance, since the placeholder no longer exists to name', moved.reconciledFrom, PLACEHOLDER)
}

{
  // A LIFTED LICENSE BAN IS NOT A REASON TO STOP. The owner's ruling is that an
  // active ban takes precedence over a lifted one, and the reconciled row must
  // not inherit the lift fields off the row it replaces — that would move the
  // ban onto the license and leave it switched off.
  const rows: Record<string, Ban> = {
    [PLACEHOLDER]: ban(),
    [LICENSE]: ban({
      license: LICENSE,
      at: NOW - 30 * HOUR,
      reason: 'An old ban, lifted',
      liftedAt: NOW - 20 * HOUR,
      liftedBy: LICENSE,
      liftedByName: 'Someone Else',
      liftReason: 'Appealed',
      discordEntryId: null,
    }),
  }
  const { outcome, store } = await run(rows)

  check('a lifted license ban is replaced, not respected', outcome, 'reconciled')
  const moved = rowAt(store, LICENSE)
  check('and the lift does not survive the move', moved.liftedAt, null)
  check('nor does the lifter', moved.liftedByName, null)
  check('nor the reason they gave', moved.liftReason, null)
  check('the ban in force is the Discord one', moved.reason, 'Banned in Discord')
}

{
  const rows: Record<string, Ban> = {
    [PLACEHOLDER]: ban(),
    [LICENSE]: ban({ license: LICENSE, expiresAt: NOW - HOUR, reason: 'Served' }),
  }
  const { outcome, store } = await run(rows)
  check('a served license ban is replaced too', outcome, 'reconciled')
  check('by the one that is actually in force', rowAt(store, LICENSE).reason, 'Banned in Discord')
}

// ── waiting ──────────────────────────────────────────────────────────────────
{
  /**
   * THE LICENSE ALREADY CARRIES A BAN IN FORCE, SO NOTHING MOVES AND NOTHING IS
   * LOST. There is no rule anywhere saying which of two active bans is the
   * better record, so overwriting is a guess. Deleting the placeholder and
   * keeping the license row is worse than a guess: if the license ban is
   * temporary and the Discord one is permanent, the person walks back in when
   * the shorter one runs out.
   *
   * Both rows stay, the gate reads both on every connect, and the next connect
   * after the license ban is lifted or served finishes the job.
   */
  const rows: Record<string, Ban> = {
    [PLACEHOLDER]: ban(),
    [LICENSE]: ban({
      license: LICENSE,
      reason: 'Cheating, VOD evidence',
      discordEntryId: null,
    }),
  }
  const { outcome, store } = await run(rows)

  check('a live license ban defers the move', outcome, 'deferred')
  check('nothing is written', store.log, [`get ${PLACEHOLDER}`, `get ${LICENSE}`])
  check('both rows survive', Object.keys(store.rows).sort(), [PLACEHOLDER, LICENSE].sort())
  check('and the console ban is untouched', rowAt(store, LICENSE).reason, 'Cheating, VOD evidence')
}

// ── somebody else got there first ────────────────────────────────────────────
{
  // A ban issued from the console between our read of the license row and our
  // write of it. Ours was decided before theirs, so ours loses.
  const rows: Record<string, Ban> = { [PLACEHOLDER]: ban() }
  const { outcome, store } = await run(rows, (op) => {
    if (op !== 'put') return
    rows[LICENSE] = ban({ license: LICENSE, at: NOW, reason: 'Issued in the gap' })
  })

  check('a ban landing in the gap refuses our write', outcome, 'conflict')
  check('theirs stands', rowAt(store, LICENSE).reason, 'Issued in the gap')
  check('and the placeholder is NOT deleted on a refused move', PLACEHOLDER in store.rows, true)
}

{
  /**
   * A SECOND, NEWER DISCORD BAN ON THE SAME ACCOUNT, arriving between our read
   * of the placeholder and our delete of it. Deleting it would destroy a ban
   * outright: by then nothing else points at that key.
   *
   * The license row is already written, so this is not a failure to enforce
   * anything — it is a duplicate left behind, and the next connect tries again.
   */
  const rows: Record<string, Ban> = { [PLACEHOLDER]: ban() }
  const { outcome, store } = await run(rows, (op) => {
    if (op !== 'remove') return
    rows[PLACEHOLDER] = ban({ at: NOW, reason: 'A second, newer Discord ban' })
  })

  check('a newer placeholder arriving refuses the delete', outcome, 'conflict')
  check('the license row was still written', LICENSE in store.rows, true)
  check('and the newer Discord ban survives', rowAt(store, PLACEHOLDER).reason, 'A second, newer Discord ban')
}

}

void main().then(
  () => {
    if (failed > 0) {
      console.error(`\ncheck:banreconcile — ${failed} of ${ran} failing case(s)`)
      process.exit(1)
    }
    console.log(`check:banreconcile — ${ran} cases pass`)
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:banreconcile — threw', e)
    process.exit(1)
  },
)
