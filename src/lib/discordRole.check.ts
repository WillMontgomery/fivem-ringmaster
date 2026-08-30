/**
 * Contract checks for the Discord admin-role re-check.
 *
 *   npx tsx src/lib/discordRole.check.ts
 *
 * A PLAIN SCRIPT, matching scripts/check-ban-rule.mjs and
 * scripts/check-chip-suppression.mjs: this repo has no test framework, and
 * adding one to assert two dozen cases would be the larger change.
 *
 * IT LIVES UNDER src/ RATHER THAN scripts/ FOR TWO REASONS, one of them
 * temporary. The lasting one is that `npm run typecheck` covers `src/**` — so
 * this file is compiled against the real types on every verify, and a change to
 * `RoleCheck`, `GateDeps` or the audit action union breaks the build here
 * rather than silently leaving the checks asserting a shape that no longer
 * exists. The temporary one is that another agent owns `scripts/` and
 * package.json in this checkout, so it could not be wired into `npm run verify`
 * from here. IT IS NOT YET IN `verify`, AND THAT IS THE GAP: it needs
 *
 *   "check:discordrole": "tsx src/lib/discordRole.check.ts"
 *
 * added to package.json and appended to the `verify` chain. Written down here
 * rather than assumed, because a check nothing runs is this repository's
 * signature failure mode.
 *
 * WHAT IT ACTUALLY EXERCISES. `enforceDiscordAdmin` is the shipped decision —
 * which verdicts deny, what is audited, whether the session is torn down, what
 * the caller sees — driven here through its injected dependencies with fakes.
 * It is not a re-implementation: `lib/actions.ts` calls this same function with
 * the real Discord fetch, the real Auth.js sign-out and the real audit table,
 * and its only other content is the four-line adapter that supplies them.
 *
 * THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL. Each one asserts an outcome that a
 * plausible wrong implementation would get wrong — fail-closed on a timeout,
 * treating an unknown-guild 404 as a revocation, denying without ending the
 * session, ending the session without recording it. Deleting the body of
 * `enforceDiscordAdmin` fails eleven of them; inverting the fail-open decision
 * fails four; dropping the 10007/10004 distinction fails three.
 */

import type { Actor, AuditHandle, AuditOutcome } from './audit'
import {
  checkAdminRole,
  enforceDiscordAdmin,
  NO_TOKEN_REASON,
  readMemberResponse,
  RoleRevokedError,
  type GateDeps,
  type RoleCheck,
} from './discordRole'

/**
 * `checkAdminRole` reads env(), which throws on a missing variable by design.
 * Seeded here rather than loaded from .env.test because tsx does not read
 * dotenv files.
 *
 * SET ONCE, BEFORE ANYTHING ELSE, BECAUSE env() CACHES ON FIRST USE — which is
 * deliberate over there and is why the no-token behaviour of `checkAdminRole`
 * is NOT driven through `checkAdminRole` here. Two different values of
 * DISCORD_BOT_TOKEN cannot coexist in one process, and reaching into that cache
 * to fake it would be testing the test harness. What matters is the coupling —
 * that the reason `checkAdminRole` returns with no token is exactly the reason
 * `enforceDiscordAdmin` treats as "unconfigured" — and both ends now name the
 * same exported constant, so the substring drift that coupling used to invite
 * cannot happen. The gate half is asserted against that constant below.
 *
 * The token value is not a credential and is deliberately not credential-SHAPED:
 * scripts/check-secrets.mjs matches Discord's real token layout, and a
 * plausible-looking fixture would trip it for no reason.
 */
process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'http://localhost:3000'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'
process.env.DISCORD_BOT_TOKEN = 'check-token-placeholder'

const ADMIN_ROLE = '222222222222222222'
const OTHER_ROLE = '999999999999999999'

let failed = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) return
  failed++
  console.error(`  FAIL  ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

// ---------------------------------------------------------------------------
// 1. Reading one HTTP answer. The 404 rows are the dangerous ones.
// ---------------------------------------------------------------------------

const responseCases: Array<[string, number, unknown, RoleCheck['state'], string?]> = [
  ['200 with the admin role present', 200, { roles: [OTHER_ROLE, ADMIN_ROLE] }, 'held'],
  ['200 with the role missing', 200, { roles: [OTHER_ROLE] }, 'revoked', 'role-removed'],
  ['200 with an empty role list', 200, { roles: [] }, 'revoked', 'role-removed'],
  // A 200 we cannot read is not evidence about the person.
  ['200 with no roles array at all', 200, { user: { id: '1' } }, 'unresolved'],
  ['200 with roles as a string', 200, { roles: ADMIN_ROLE }, 'unresolved'],
  ['200 with a null body (unparseable)', 200, null, 'unresolved'],

  // THE DISTINCTION THAT DECIDES WHETHER A MISCONFIGURATION LOGS OUT EVERY
  // ADMIN AT ONCE. Only 10007 is about the person.
  ['404 unknown member (10007)', 404, { code: 10007 }, 'revoked', 'not-a-member'],
  ['404 unknown guild (10004)', 404, { code: 10004 }, 'unresolved'],
  ['404 missing access (50001)', 404, { code: 50001 }, 'unresolved'],
  ['404 with no code', 404, {}, 'unresolved'],
  ['404 with an unparseable body', 404, null, 'unresolved'],

  // Everything else is about Discord or about us, never about them.
  ['401 bad bot token', 401, { code: 0 }, 'unresolved'],
  ['403 missing access', 403, { code: 50001 }, 'unresolved'],
  ['429 rate limited', 429, { retry_after: 1 }, 'unresolved'],
  ['500 from Discord', 500, null, 'unresolved'],
  ['502 from something in front of Discord', 502, null, 'unresolved'],
]

for (const [label, status, body, expected, why] of responseCases) {
  const got = readMemberResponse(status, body, ADMIN_ROLE)
  check(`readMemberResponse: ${label}`, got.state === expected, got)
  if (why !== undefined && got.state === 'revoked') {
    check(`readMemberResponse: ${label} — why`, got.why === why, got)
  }
}

/**
 * A property rather than a row, so a future case table cannot drift away from
 * the sentence it encodes: NO STATUS OTHER THAN 200 MAY EVER RETURN `held`.
 * Holding the role is a claim only a readable member payload can support.
 */
for (const status of [201, 204, 301, 400, 401, 403, 404, 409, 429, 500, 503]) {
  for (const body of [null, {}, { roles: [ADMIN_ROLE] }, { code: 10007 }]) {
    const got = readMemberResponse(status, body, ADMIN_ROLE)
    check(`no non-200 may say held (${status})`, got.state !== 'held', { status, got })
  }
}

/**
 * And the mirror: a definitive REVOKED may only come from a readable 200 whose
 * roles exclude the role, or from a 10007. Nothing else may deny.
 */
for (const status of [401, 403, 429, 500, 502, 503]) {
  const got = readMemberResponse(status, { code: 10007 }, ADMIN_ROLE)
  check(`only a 404 may carry 10007 (${status})`, got.state === 'unresolved', got)
}

// ---------------------------------------------------------------------------
// 2. The gate. Role present -> proceed. Role gone -> refuse, end, audit.
//    Discord silent -> proceed, loudly.
// ---------------------------------------------------------------------------

const ACTOR: Actor = {
  license: 'license:abc123',
  name: 'Test Admin',
  discordId: '333333333333333333',
}

interface Recorded {
  began: Array<{ action: string; reason?: string | null; detail?: unknown }>
  resolved: Array<{ ts: number; outcome: AuditOutcome; error?: string | null }>
  signOuts: number
  logs: Array<{ level: 'warn' | 'error'; message: string }>
}

function harness(
  verdict: RoleCheck | (() => Promise<RoleCheck>),
  opts: { signOutThrows?: boolean; auditThrows?: boolean } = {},
): { deps: GateDeps; rec: Recorded } {
  const rec: Recorded = { began: [], resolved: [], signOuts: 0, logs: [] }
  let nextTs = 1_000

  const deps: GateDeps = {
    check: typeof verdict === 'function' ? verdict : async () => verdict,
    endSession: async () => {
      if (opts.signOutThrows) throw new Error('session store unreachable')
      rec.signOuts++
    },
    audit: {
      begin: async (input): Promise<AuditHandle> => {
        if (opts.auditThrows) throw new Error('audit table unreachable')
        rec.began.push({
          action: input.action,
          reason: input.reason,
          detail: input.detail,
        })
        return { commandId: `cmd-${nextTs}`, ts: nextTs++ }
      },
      resolve: async (ts, outcome, error) => {
        rec.resolved.push({ ts, outcome, error })
      },
    },
    log: (level, message) => rec.logs.push({ level, message }),
  }

  return { deps, rec }
}

async function gate(
  deps: GateDeps,
  discordId: string | null = ACTOR.discordId,
): Promise<{ threw: RoleRevokedError | null; result: RoleCheck | null }> {
  try {
    const result = await enforceDiscordAdmin({
      discordId,
      actor: ACTOR,
      action: 'ban',
      deps,
    })
    return { threw: null, result }
  } catch (e) {
    if (e instanceof RoleRevokedError) return { threw: e, result: null }
    throw e
  }
}

/**
 * EVERYTHING AWAITED LIVES IN HERE rather than at the top level, and it is a
 * packaging constraint rather than a style choice: package.json has no
 * `"type": "module"`, so tsx compiles a `.ts` file as CommonJS and esbuild
 * refuses top-level await. Renaming this to `.mts` would fix that and would
 * drop it out of `npm run typecheck`, whose tsconfig include globs cover the
 * .ts and .tsx extensions and not .mts — which is the one thing this file's
 * location is buying.
 */
async function main(): Promise<void> {
// --- role present: the write proceeds, and nothing is written down ---------
{
  const { deps, rec } = harness({ state: 'held' })
  const { threw, result } = await gate(deps)

  check('held: does not throw', threw === null)
  check('held: reports held', result?.state === 'held', result)
  check('held: does not end the session', rec.signOuts === 0, rec.signOuts)
  check('held: writes no audit row', rec.began.length === 0, rec.began)
  // The ordinary case is the overwhelmingly common one. A log line per ban
  // would bury the two that matter.
  check('held: logs nothing', rec.logs.length === 0, rec.logs)
}

// --- role removed: refuse, end the session, audit it ----------------------
{
  const { deps, rec } = harness({ state: 'revoked', why: 'role-removed' })
  const { threw } = await gate(deps)

  check('role-removed: refuses the write', threw instanceof RoleRevokedError)
  check('role-removed: names the cause', threw?.why === 'role-removed', threw?.why)
  check('role-removed: ends the session', rec.signOuts === 1, rec.signOuts)
  check('role-removed: audits it once', rec.began.length === 1, rec.began)
  check(
    'role-removed: uses the discord.revoked action',
    rec.began[0]?.action === 'discord.revoked',
    rec.began[0],
  )
  check(
    'role-removed: records which write was refused',
    (rec.began[0]?.detail as { attempted?: string } | undefined)?.attempted ===
      'ban',
    rec.began[0]?.detail,
  )
  check(
    'role-removed: the audit row lands on ok once the session is gone',
    rec.resolved.length === 1 && rec.resolved[0]?.outcome === 'ok',
    rec.resolved,
  )
  check(
    'role-removed: logs at error level',
    rec.logs.some((l) => l.level === 'error'),
    rec.logs,
  )
  // The message an operator reads at 2am has to name the person and the cause.
  check(
    'role-removed: the log names the admin',
    rec.logs.some((l) => l.message.includes('Test Admin')),
    rec.logs,
  )
}

// --- not in the guild at all ---------------------------------------------
{
  const { deps, rec } = harness({ state: 'revoked', why: 'not-a-member' })
  const { threw } = await gate(deps)

  check('not-a-member: refuses the write', threw instanceof RoleRevokedError)
  check('not-a-member: names the cause', threw?.why === 'not-a-member', threw?.why)
  check('not-a-member: ends the session', rec.signOuts === 1, rec.signOuts)
  check(
    'not-a-member: reason distinguishes it from a role removal',
    rec.began[0]?.reason === 'No longer a member of the Discord server',
    rec.began[0]?.reason,
  )
}

// --- Discord unreachable: the write PROCEEDS, and it is recorded ----------
{
  const { deps, rec } = harness({
    state: 'unresolved',
    why: 'Discord did not answer within 5000ms',
  })
  const { threw, result } = await gate(deps)

  check('timeout: does NOT refuse the write', threw === null)
  check('timeout: reports unresolved', result?.state === 'unresolved', result)
  check('timeout: does not end the session', rec.signOuts === 0, rec.signOuts)
  check(
    'timeout: leaves a discord.unresolved row',
    rec.began.length === 1 && rec.began[0]?.action === 'discord.unresolved',
    rec.began,
  )
  check(
    'timeout: the row says the write was allowed',
    (rec.began[0]?.detail as { allowed?: boolean } | undefined)?.allowed === true,
    rec.began[0]?.detail,
  )
  check(
    'timeout: logged as loudly as a denial (error, not warn)',
    rec.logs.some((l) => l.level === 'error'),
    rec.logs,
  )
}

// --- unconfigured: still proceeds, warns, and does NOT spam the audit log --
{
  // NO_TOKEN_REASON, not a hand-copied sentence. If the gate ever stops
  // recognising the exact string `checkAdminRole` returns, an unconfigured
  // console writes a `discord.unresolved` row for every ban forever — and this
  // is the case that catches it.
  const { deps, rec } = harness({ state: 'unresolved', why: NO_TOKEN_REASON })
  const { threw } = await gate(deps)

  check('no token: does not refuse the write', threw === null)
  check('no token: writes no audit row', rec.began.length === 0, rec.began)
  check(
    'no token: warns rather than erroring',
    rec.logs.length === 1 && rec.logs[0]?.level === 'warn',
    rec.logs,
  )
  check(
    'no token: the warning names the variable to set',
    rec.logs[0]?.message.includes('DISCORD_BOT_TOKEN') === true,
    rec.logs,
  )
}

// --- and any OTHER unresolved reason must still be an audited event --------
{
  // The mirror of the case above, so "unconfigured" cannot quietly widen into
  // "anything that mentions Discord".
  const { deps, rec } = harness({
    state: 'unresolved',
    why: `${NO_TOKEN_REASON} (but actually a 500)`,
  })
  await gate(deps)

  check(
    'a near-miss on the no-token reason is still audited',
    rec.began.length === 1 && rec.began[0]?.action === 'discord.unresolved',
    rec.began,
  )
}

// --- a session with no Discord id is unresolved, never a denial -----------
{
  const { deps, rec } = harness({ state: 'held' })
  const { threw, result } = await gate(deps, null)

  check('no discord id: does not refuse the write', threw === null)
  check('no discord id: unresolved', result?.state === 'unresolved', result)
  check('no discord id: does not end the session', rec.signOuts === 0)
  check('no discord id: is recorded', rec.began.length === 1, rec.began)
}

// --- the session teardown itself failing --------------------------------
{
  const { deps, rec } = harness(
    { state: 'revoked', why: 'role-removed' },
    { signOutThrows: true },
  )
  const { threw } = await gate(deps)

  // THE REFUSAL STILL STANDS. Losing the sign-out must not lose the denial.
  check('signOut throws: still refuses the write', threw instanceof RoleRevokedError)
  check(
    'signOut throws: the audit row lands on failed, not ok',
    rec.resolved.length === 1 && rec.resolved[0]?.outcome === 'failed',
    rec.resolved,
  )
  check(
    'signOut throws: the failure reaches the operator log',
    rec.logs.filter((l) => l.level === 'error').length >= 2,
    rec.logs,
  )
}

// --- the audit write itself failing -------------------------------------
{
  const { deps, rec } = harness(
    { state: 'revoked', why: 'role-removed' },
    { auditThrows: true },
  )
  const { threw } = await gate(deps)

  // A DynamoDB fault is not a reason to let a revoked admin ban somebody.
  check('audit throws: still refuses the write', threw instanceof RoleRevokedError)
  check(
    'audit throws: says so in the log',
    rec.logs.some((l) => l.message.includes('could not record a revocation')),
    rec.logs,
  )
}

{
  // And the mirror on the fail-open side: a bookkeeping failure must not turn
  // an allowed write into a refusal through an error path nobody chose.
  const { deps, rec } = harness(
    { state: 'unresolved', why: 'Discord answered 503' },
    { auditThrows: true },
  )
  const { threw } = await gate(deps)

  check('audit throws on unresolved: write still proceeds', threw === null)
  check(
    'audit throws on unresolved: says so in the log',
    rec.logs.some((l) => l.message.includes('could not record an unresolved check')),
    rec.logs,
  )
}

// ---------------------------------------------------------------------------
// 3. The timeout is really wired to the fetch, not merely documented.
// ---------------------------------------------------------------------------
{
  const realFetch = globalThis.fetch

  // A server that never answers, but honours the abort signal exactly as a
  // real socket does. Without this the "timeout" case can only ever be
  // asserted from a hand-written verdict, which proves nothing about the code.
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      signal.addEventListener('abort', () => reject(signal.reason))
    })) as typeof globalThis.fetch

  /**
   * NODE UNREFS THE TIMER BEHIND `AbortSignal.timeout`, so it does not on its
   * own keep the process alive. In production the pending socket does that; in
   * here the fake fetch holds no handle at all, and without this interval the
   * event loop empties, node exits 0 mid-check, and the whole script "passes"
   * by printing nothing. That is precisely the shape of a check that has
   * quietly stopped checking, so it is worth the two lines and the paragraph.
   */
  const keepAlive = setInterval(() => {}, 10)

  try {
    const started = Date.now()
    const got = await checkAdminRole('333333333333333333', 60)
    const elapsed = Date.now() - started

    check('a hanging Discord resolves to unresolved', got.state === 'unresolved', got)
    check(
      'a hanging Discord is abandoned at the budget, not waited out',
      elapsed < 2_000,
      elapsed,
    )
    check(
      'the unresolved reason names the timeout',
      got.state === 'unresolved' && got.why.includes('60ms'),
      got,
    )
  } finally {
    clearInterval(keepAlive)
    globalThis.fetch = realFetch
  }
}

/**
 * The request itself: the right endpoint, the right auth scheme, and no cache.
 *
 * PINNED BECAUSE THE ENDPOINT IS THE FEATURE. `GET /users/{id}` — which the
 * avatar code next door uses with the same token — would answer 200 for anyone
 * with a Discord account and carries no `roles` at all, so a copy-paste from
 * lib/discord.ts would produce a check that always says "held" and never fails
 * anything. Nothing else in the build would notice.
 */
{
  const realFetch = globalThis.fetch

  let seenUrl = ''
  let seenAuth = ''
  let seenCache: string | undefined
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    seenUrl = String(url)
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
    seenCache = init?.cache
    return Promise.resolve(
      new Response(JSON.stringify({ roles: [ADMIN_ROLE] }), { status: 200 }),
    )
  }) as typeof globalThis.fetch

  try {
    const got = await checkAdminRole('333333333333333333')
    check('live path: a member holding the role reads as held', got.state === 'held', got)
    check(
      'live path: hits the guild-member endpoint, not /users/{id}',
      seenUrl === 'https://discord.com/api/v10/guilds/111111111111111111/members/333333333333333333',
      seenUrl,
    )
    check('live path: authenticates as a bot', seenAuth.startsWith('Bot '), seenAuth.slice(0, 4))
    check('live path: is never cached', seenCache === 'no-store', seenCache)
  } finally {
    globalThis.fetch = realFetch
  }
}

/**
 * A real 404 from Discord, end to end, because the 10007/10004 split is the
 * one detail in this feature that fails catastrophically rather than quietly:
 * get it wrong and every admin is signed out at once and told their role was
 * removed. `readMemberResponse` is checked exhaustively above; this proves the
 * live path actually routes a 404 body into it rather than short-circuiting on
 * `!res.ok` the way lib/discord.ts does for avatars.
 */
{
  const realFetch = globalThis.fetch

  const answer = (status: number, body: unknown) => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status }),
      )) as typeof globalThis.fetch
  }

  try {
    answer(404, { code: 10007, message: 'Unknown Member' })
    const gone = await checkAdminRole('333333333333333333')
    check('live path: 10007 is a revocation', gone.state === 'revoked', gone)

    answer(404, { code: 10004, message: 'Unknown Guild' })
    const misconfigured = await checkAdminRole('333333333333333333')
    check(
      'live path: 10004 must NOT sign anybody out',
      misconfigured.state === 'unresolved',
      misconfigured,
    )

    answer(429, { retry_after: 3 })
    const limited = await checkAdminRole('333333333333333333')
    check('live path: a 429 is unresolved', limited.state === 'unresolved', limited)

    // HTML from a proxy in front of Discord. `res.json()` would throw here.
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      )) as typeof globalThis.fetch
    const html = await checkAdminRole('333333333333333333')
    check('live path: an HTML error page is unresolved', html.state === 'unresolved', html)
  } finally {
    globalThis.fetch = realFetch
  }
}
}

void main().then(
  () => {
    if (failed > 0) {
      console.error(`\ncheck:discordrole — ${failed} failing case(s)`)
      process.exit(1)
    }
    console.log('check:discordrole — all cases pass')
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:discordrole — threw', e)
    process.exit(1)
  },
)
