/**
 * Contract checks for the pause-menu handoff token — #23.
 *
 *   npx tsx src/lib/handoff.check.ts
 *
 * A PLAIN SCRIPT, matching `discordRole.check.ts` and `scripts/check-ban-rule.mjs`:
 * this repo has no test framework and adding one to assert two dozen cases
 * would be the larger change.
 *
 * IT LIVES UNDER src/ so `npm run typecheck` compiles it against the real
 * types — a change to `HandoffRecord`, `HandoffStore` or `RedeemResult` breaks
 * the build here rather than silently leaving the checks asserting a shape that
 * no longer exists. IT IS WIRED INTO `npm run verify` as `check:handoff`; a
 * check nothing runs is this repository's signature failure mode and has
 * already happened here once.
 *
 * WHAT IT ACTUALLY EXERCISES. `mint` and `redeem` as shipped, driven through
 * the `HandoffStore` seam with a fake that reproduces DynamoDB's conditional
 * delete — including the part that matters, which is that the condition is
 * evaluated and the row removed as one indivisible step. `/api/handoff/redeem`
 * calls the same two functions and adds only the session write.
 *
 * THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL. Removing the expiry comparison
 * fails three; making the consume a read-then-delete fails the concurrency
 * pair; keying the record on the token instead of the admin fails the
 * cross-identity cases; dropping the format validation fails five.
 */

process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'http://localhost:3000'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HANDOFF_LANDING,
  HANDOFF_REFUSED,
  HANDOFF_TTL_MS,
  MINT_BUDGET_MS,
  MINT_ROLE_TIMEOUT_MS,
  createRateLimiter,
  hashToken,
  mint,
  parseToken,
  redeem,
  sessionCookieName,
  type HandoffRecord,
  type HandoffStore,
} from './handoff'

/** `src/`, resolved from this file rather than from the working directory. */
const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const ADMIN_A = '100000000000000001'
const ADMIN_B = '200000000000000002'

let failed = 0

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`  ok   ${label}`)
    return
  }
  failed += 1
  console.error(`  FAIL ${label}`, detail === undefined ? '' : detail)
}

/**
 * A fake store that behaves like the real conditional delete.
 *
 * THE WHOLE POINT IS `take`. It reads and removes in one synchronous step with
 * no `await` between the comparison and the deletion, which is what DynamoDB's
 * `ConditionExpression` guarantees and what a look-up-then-delete does not. Two
 * overlapping callers therefore interleave here exactly as they would against
 * the real table: the second finds the row already gone.
 *
 * It also counts writes, because "a mint replaced the previous token" is a
 * property of there being ONE row, not of two rows where the newer wins.
 */
function fakeStore(): HandoffStore & { rows: Map<string, HandoffRecord> } {
  const rows = new Map<string, HandoffRecord>()

  return {
    rows,
    async put(rec) {
      rows.set(rec.discordId, rec)
    },
    async take(discordId, tokenHash) {
      const row = rows.get(discordId)
      if (!row || row.tokenHash !== tokenHash) return null
      rows.delete(discordId)
      return row
    },
  }
}

async function main(): Promise<void> {
  // --- the token itself ---------------------------------------------------

  {
    const store = fakeStore()
    const { token, expiresAt } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    check('token names the admin it was minted for', token.startsWith(`${ADMIN_A}.`), token)
    check(
      'the secret half is 32 bytes of base64url',
      /^[A-Za-z0-9_-]{43}$/.test(token.slice(ADMIN_A.length + 1)),
      token,
    )
    check('expiry is issue time plus the TTL', expiresAt === 1_000 + HANDOFF_TTL_MS, expiresAt)

    const row = store.rows.get(ADMIN_A)
    check('the raw token is never stored', row?.tokenHash === hashToken(token), row)
    check(
      'no field on the record contains the secret half',
      !JSON.stringify(row).includes(token.slice(ADMIN_A.length + 1)),
      row,
    )
    check(
      'the TTL attribute is epoch SECONDS, not milliseconds',
      row?.expires === Math.ceil((1_000 + HANDOFF_TTL_MS) / 1000),
      row,
    )
  }

  /**
   * TWO MINTS MUST NOT PRODUCE THE SAME TOKEN. `randomBytes`, not a counter and
   * not derived from the license — the property `matchId` failed in the game
   * repo. A thousand is not proof of entropy, but a token derived from the
   * identity or from a sequence collapses here immediately.
   */
  {
    const store = fakeStore()
    const seen = new Set<string>()
    for (let i = 0; i < 1_000; i += 1) {
      const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })
      seen.add(token)
    }
    check('1000 mints for one admin at one instant are 1000 distinct tokens', seen.size === 1_000, seen.size)
  }

  // --- malformed input ----------------------------------------------------

  {
    const store = fakeStore()
    await mint({ discordId: ADMIN_A, now: 1_000, store })

    const rubbish: unknown[] = [
      null,
      undefined,
      '',
      42,
      {},
      [],
      ADMIN_A, // an id with no secret at all
      `${ADMIN_A}.`, // the separator and nothing after it
      `.${'a'.repeat(43)}`, // a secret with no identity
      `${ADMIN_A}.short`,
      `${ADMIN_A}.${'a'.repeat(44)}`, // one character too long
      `${ADMIN_A}.${'a'.repeat(42)}+`, // base64, not base64url
      `not-a-snowflake.${'a'.repeat(43)}`,
      `${ADMIN_A}x.${'a'.repeat(43)}`,
      `${'9'.repeat(40)}.${'a'.repeat(43)}`, // id longer than any snowflake
      `${ADMIN_A}.${'a'.repeat(43)}\n`,
      `${'a'.repeat(200)}`,
    ]

    let allMalformed = true
    for (const bad of rubbish) {
      const res = await redeem(bad, { now: 2_000, store })
      if (res.ok || res.reason !== 'malformed') {
        allMalformed = false
        check(`malformed input refused: ${JSON.stringify(bad)?.slice(0, 40)}`, false, res)
      }
    }
    check('every malformed shape is refused as malformed', allMalformed)
    check(
      'malformed input never reaches the store',
      store.rows.has(ADMIN_A),
      'the pending row was consumed by a rubbish token',
    )

    check('parseToken rejects a non-string', parseToken(12345) === null)
    check(
      'parseToken splits on the FIRST separator',
      parseToken(`${ADMIN_A}.${'a'.repeat(21)}.${'b'.repeat(21)}`) === null,
    )
  }

  // --- the happy path -----------------------------------------------------

  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    const res = await redeem(token, { now: 1_500, store })
    check('a valid token redeems', res.ok, res)
    check('it redeems as the admin it names', res.ok && res.discordId === ADMIN_A, res)
    check('redeeming consumes the row', store.rows.size === 0, store.rows)
  }

  // --- single use ---------------------------------------------------------

  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    const first = await redeem(token, { now: 1_500, store })
    const second = await redeem(token, { now: 1_600, store })

    check('the first redemption wins', first.ok, first)
    check('the second is refused', !second.ok, second)
    check(
      'an already-consumed token is indistinguishable from one that never existed',
      !second.ok && second.reason === 'refused',
      second,
    )
  }

  /**
   * TWO SIMULTANEOUS REDEMPTIONS — ONLY ONE WINS.
   *
   * Both start before either finishes, which is the shape a double-spawned
   * iframe or a retried navigation actually produces. The guarantee comes from
   * the conditional write, so this is exercised through the store rather than
   * asserted about it.
   */
  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    const [a, b] = await Promise.all([
      redeem(token, { now: 1_500, store }),
      redeem(token, { now: 1_500, store }),
    ])

    const winners = [a, b].filter((r) => r.ok).length
    check('two simultaneous redemptions: exactly one wins', winners === 1, { a, b })
    check('the loser is refused, not errored', winners === 1 && [a, b].some((r) => !r.ok && r.reason === 'refused'), { a, b })
    check('nothing survives the race', store.rows.size === 0, store.rows)
  }

  /** Ten at once, for the same reason. One session, not ten. */
  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    const all = await Promise.all(
      Array.from({ length: 10 }, () => redeem(token, { now: 1_500, store })),
    )
    check('ten simultaneous redemptions: exactly one wins', all.filter((r) => r.ok).length === 1, all)
  }

  // --- expiry -------------------------------------------------------------

  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })

    const res = await redeem(token, { now: 1_000 + HANDOFF_TTL_MS + 1, store })
    check('an expired token is refused', !res.ok, res)
    check('and is refused as expired', !res.ok && res.reason === 'expired', res)
    check(
      'an expired token is CONSUMED, not left for the TTL sweeper',
      store.rows.size === 0,
      store.rows,
    )
  }

  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const res = await redeem(token, { now: 1_000 + HANDOFF_TTL_MS, store })
    check('expiry is exclusive — the exact deadline is already too late', !res.ok, res)
  }

  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const res = await redeem(token, { now: 1_000 + HANDOFF_TTL_MS - 1, store })
    check('one millisecond before the deadline still works', res.ok, res)
  }

  /**
   * A row whose expiry attribute is missing or the wrong type must not be read
   * as "never expires". This is the shape a partial write or a hand-edited row
   * produces, and `NaN > now` is false in a way that is easy to get backwards.
   */
  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const row = store.rows.get(ADMIN_A) as HandoffRecord
    store.rows.set(ADMIN_A, { ...row, expiresAt: undefined as unknown as number })

    const res = await redeem(token, { now: 1_500, store })
    check('a record with no enforceable expiry is refused', !res.ok, res)
  }

  // --- identity binding ---------------------------------------------------

  /**
   * A TOKEN BOUND TO A CANNOT OPEN A SESSION AS B, and the check is written as
   * an attack rather than as an assertion about internals: take A's real,
   * valid, unspent token and try to spend it while B has a token pending.
   */
  {
    const store = fakeStore()
    const a = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const b = await mint({ discordId: ADMIN_B, now: 1_000, store })

    const asB = await redeem(`${ADMIN_B}.${a.token.slice(ADMIN_A.length + 1)}`, {
      now: 1_500,
      store,
    })
    check("A's secret relabelled as B is refused", !asB.ok, asB)
    check("B's pending token survives the attempt", store.rows.has(ADMIN_B), store.rows)

    const asA = await redeem(`${ADMIN_A}.${b.token.slice(ADMIN_B.length + 1)}`, {
      now: 1_500,
      store,
    })
    check("B's secret relabelled as A is refused", !asA.ok, asA)

    const honest = await redeem(a.token, { now: 1_500, store })
    check("A's own token still redeems as A", honest.ok && honest.discordId === ADMIN_A, honest)

    const honestB = await redeem(b.token, { now: 1_500, store })
    check("B's own token still redeems as B", honestB.ok && honestB.discordId === ADMIN_B, honestB)
  }

  /** The identity returned comes from the row, so a swapped row cannot lie. */
  {
    const store = fakeStore()
    const { token } = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const row = store.rows.get(ADMIN_A) as HandoffRecord
    store.rows.set(ADMIN_A, { ...row, discordId: ADMIN_B })

    const res = await redeem(token, { now: 1_500, store })
    check('a row whose identity disagrees with its key is refused', !res.ok, res)
  }

  // --- a mint invalidates the previous unredeemed token --------------------

  /**
   * The retry case, stated as behaviour: the game times out, the mint actually
   * succeeded, the game retries. There must be exactly one live token
   * afterwards and it must be the one the game is holding.
   */
  {
    const store = fakeStore()
    const orphan = await mint({ discordId: ADMIN_A, now: 1_000, store })
    const held = await mint({ discordId: ADMIN_A, now: 1_100, store })

    check('a re-mint leaves exactly one row', store.rows.size === 1, store.rows)

    const stale = await redeem(orphan.token, { now: 1_200, store })
    check('the orphaned token is dead immediately, not at its TTL', !stale.ok, stale)

    const fresh = await redeem(held.token, { now: 1_200, store })
    check('the token the game is holding still works', fresh.ok, fresh)
  }

  /** Minting for A must not disturb B. */
  {
    const store = fakeStore()
    const b = await mint({ discordId: ADMIN_B, now: 1_000, store })
    await mint({ discordId: ADMIN_A, now: 1_100, store })
    await mint({ discordId: ADMIN_A, now: 1_200, store })

    const res = await redeem(b.token, { now: 1_300, store })
    check("re-minting for A does not touch B's token", res.ok, res)
  }

  /** A snowflake is required at the mint, not merely at the redeem. */
  {
    const store = fakeStore()
    let threw = false
    try {
      await mint({ discordId: 'not-a-snowflake', store })
    } catch {
      threw = true
    }
    check('mint refuses an id that is not a snowflake', threw)
    check('and writes nothing when it refuses', store.rows.size === 0, store.rows)
  }

  // --- rate limiting ------------------------------------------------------

  {
    const limiter = createRateLimiter({ perKey: 2, globalMax: 3, windowMs: 1_000 })

    check('first request allowed', limiter.allow(ADMIN_A, 0))
    check('second allowed', limiter.allow(ADMIN_A, 10))
    check('third for the same admin refused', !limiter.allow(ADMIN_A, 20))
    check('a different admin is unaffected', limiter.allow(ADMIN_B, 30))
    check('the global cap refuses a fourth across all admins', !limiter.allow('300000000000000003', 40))
    check('the window rolls over', limiter.allow(ADMIN_A, 1_100))
  }

  // --- the constants the game side is told to rely on ----------------------

  {
    check('the TTL is short — under two minutes', HANDOFF_TTL_MS <= 120_000, HANDOFF_TTL_MS)
    check('and long enough to survive a cold frame', HANDOFF_TTL_MS >= 30_000, HANDOFF_TTL_MS)

    /**
     * THE BUDGET MUST FIT UNDER THE GAME'S HARD CEILING. `PerformHttpRequest`
     * has a hardcoded, non-configurable 5-second no-response timeout — see the
     * header of src/app/api/ingest/route.ts. A budget at or above it is a mint
     * the game can never observe succeeding, and the number is published to
     * whoever writes the game half, so it fails here rather than there.
     */
    check('the mint budget fits under the game 5s ceiling', MINT_BUDGET_MS < 5_000, MINT_BUDGET_MS)
    check(
      'the Discord call inside a mint fits inside the budget',
      MINT_ROLE_TIMEOUT_MS < MINT_BUDGET_MS,
      { MINT_ROLE_TIMEOUT_MS, MINT_BUDGET_MS },
    )
    check(
      'a token outlives the mint that issued it by a wide margin',
      HANDOFF_TTL_MS > MINT_BUDGET_MS * 10,
      { HANDOFF_TTL_MS, MINT_BUDGET_MS },
    )

    check('success lands on the live players page', HANDOFF_LANDING === '/', HANDOFF_LANDING)
    check('failure lands on the login page', HANDOFF_REFUSED === '/login', HANDOFF_REFUSED)
    check(
      'the failure destination carries no query parameter to leak into',
      !HANDOFF_REFUSED.includes('?'),
      HANDOFF_REFUSED,
    )
  }

  /**
   * THE COOKIE THIS ROUTE ISSUES MUST BE THE ONE THE APP READS.
   *
   * `/api/handoff/redeem` reproduces Auth.js's cookie names by hand, because
   * `@auth/core/lib/utils/cookie` is not a public export path. If that copy
   * drifts from what `auth()` reads, the redeem succeeds and produces a console
   * that is signed out — a failure with no error anywhere. `src/middleware.ts`
   * holds the same two names for its own reasons, so the two hand copies are
   * checked against each other here.
   */
  {
    check('secure cookie name', sessionCookieName(true) === '__Secure-authjs.session-token', sessionCookieName(true))
    check('plain cookie name', sessionCookieName(false) === 'authjs.session-token', sessionCookieName(false))

    const middleware = readFileSync(join(SRC_DIR, 'middleware.ts'), 'utf8')
    check(
      'the secure name matches the one the middleware sniffs for',
      middleware.includes(sessionCookieName(true)),
    )
    check(
      'the plain name matches the one the middleware sniffs for',
      middleware.includes(sessionCookieName(false)),
    )
  }

  /**
   * THE SHIPPED STORE, NOT ONLY THE FAKE.
   *
   * Everything above drives `HandoffStore` through a fake that reproduces
   * DynamoDB's conditional delete — which proves `redeem` is correct GIVEN an
   * atomic consume, and proves nothing about whether the real one asks for one.
   * That is the gap where a look-up-then-delete would slip in unnoticed, so the
   * actual `dynamoStore` is driven here against a stubbed client.
   *
   * `lib/dynamo`'s exported `ddb` is a Proxy that constructs its client on
   * first property access and stashes it on `globalThis`, so seeding that slot
   * first is enough to intercept without a network or a table.
   */
  {
    const calls: Record<string, unknown>[] = []
    let refuse = false

    ;(globalThis as unknown as { ddb: unknown }).ddb = {
      async put(args: Record<string, unknown>) {
        calls.push({ op: 'put', ...args })
        return {}
      },
      async delete(args: Record<string, unknown>) {
        calls.push({ op: 'delete', ...args })
        if (refuse) {
          throw Object.assign(new Error('refused'), {
            name: 'ConditionalCheckFailedException',
          })
        }
        return { Attributes: { discordId: ADMIN_A, tokenHash: 'h', expiresAt: 9e12 } }
      },
    }

    const { dynamoStore } = await import('./handoff')

    const got = await dynamoStore.take(ADMIN_A, 'h')
    const del = calls.find((c) => c.op === 'delete') as Record<string, unknown>

    check('the shipped consume is a single delete', calls.length === 1, calls)
    check(
      'it is CONDITIONAL on the hash — this is the single-use rule',
      del?.ConditionExpression === 'tokenHash = :h',
      del,
    )
    check(
      'the condition is bound to the hash it was asked for',
      (del?.ExpressionAttributeValues as Record<string, unknown>)?.[':h'] === 'h',
      del,
    )
    check(
      'it is keyed by the admin, so a token can only be spent as its own subject',
      (del?.Key as Record<string, unknown>)?.discordId === ADMIN_A,
      del,
    )
    check('it returns the row it deleted', del?.ReturnValues === 'ALL_OLD', del)
    check('and hands that row back', got?.discordId === ADMIN_A, got)

    refuse = true
    calls.length = 0
    const lost = await dynamoStore.take(ADMIN_A, 'h')
    check(
      'a refused condition is an ordinary null, not a throw',
      lost === null,
      lost,
    )
  }

  /**
   * NOTHING IN `src/` LOGS A REQUEST URL.
   *
   * The token travels in a query string because an iframe `src` is a GET, and
   * the argument that this is acceptable rests on that fact. It is asserted
   * rather than remembered: a `console.*` call that takes `req.url`, a
   * pathname or a search param would put a live credential in `journalctl`,
   * and it would be added by somebody debugging something else entirely.
   */
  {
    const offenders = grepLoggedUrls(SRC_DIR)
    check(
      'no console.* call in src/ logs a request URL',
      offenders.length === 0,
      offenders,
    )
  }
}

/**
 * Walk `src/` for a logging call whose arguments mention a request URL.
 *
 * Deliberately crude and deliberately narrow: it looks at the single line of a
 * `console.*` call for `req.url`, `request.url`, `nextUrl`, `searchParams` or a
 * `?t=`-shaped interpolation. A multi-line call would slip past it, which is
 * why this is a tripwire on the obvious mistake rather than a proof.
 */
function grepLoggedUrls(root: string): string[] {
  const hits: string[] = []
  const risky = /(req|request)\.url|nextUrl|searchParams|\?t=/

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry)) continue
      // This file names the patterns it looks for, the same exemption
      // scripts/check-secrets.mjs gives itself.
      if (entry === 'handoff.check.ts') continue

      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/\bconsole\.(log|error|warn|info|debug)\s*\(/.test(line)) return
          if (!risky.test(line)) return
          hits.push(`${full}:${i + 1}`)
        })
    }
  }

  walk(root)
  return hits
}

void main().then(
  () => {
    if (failed > 0) {
      console.error(`\ncheck:handoff — ${failed} failing case(s)`)
      process.exit(1)
    }
    console.log('check:handoff — all cases pass')
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:handoff — threw', e)
    process.exit(1)
  },
)
