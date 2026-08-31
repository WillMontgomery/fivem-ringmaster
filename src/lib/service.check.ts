/**
 * Contract checks for the command credential — fivem-ringmaster#42.
 *
 *   npx tsx src/lib/service.check.ts
 *
 * A PLAIN SCRIPT, matching `handoff.check.ts`, `origin.check.ts` and
 * `discordRole.check.ts`: this repo has no test framework and adding one to
 * assert three dozen cases would be the larger change. IT IS WIRED INTO
 * `npm run verify` as `check:service`; a check nothing runs is this
 * repository's signature failure mode and has already happened here twice.
 *
 * IT LIVES UNDER src/ so `npm run typecheck` compiles it against the real types
 * — a change to `ServiceDeps`, `ServiceVerdict`, `CommandOutcome` or `Actor`
 * breaks the build here rather than silently leaving the cases asserting a shape
 * that no longer exists.
 *
 * OFFLINE, ENTIRELY. No Discord, no DynamoDB, no SSH, no Next request pipeline.
 * The gate is driven through its `ServiceDeps` seam with fakes, which is the
 * same arrangement `discordRole.check.ts` uses on `GateDeps` and for the same
 * reason: the DECISION being exercised is the shipped one.
 *
 * ============================================================================
 * WHAT IT ACTUALLY EXERCISES, because the distinction decides what a pass is
 * worth:
 *
 *   A. THE RULE — `serviceGate` as shipped: which refusal, which status, which
 *      machine code, for every way a call can be wrong.
 *   B. THE ORDER — that the secret is checked before the allowlist (so the
 *      allowlist is never read back to a stranger), that the role gate is not
 *      reached at all by a caller who failed the secret, the path or the actor
 *      header, and that identity is built before the gate that logs under it.
 *   C. LOUDNESS — every refusal leaves an `error`, every acceptance leaves a
 *      line, and no log line ever contains the secret.
 *   D. ATTRIBUTION — the actor handed back is the named HUMAN. Never the bot,
 *      never a name the caller supplied, and a missing license is not a
 *      refusal.
 *   E. THE SCOPE, WALKED — the routes on disk that call `authorizeWrite` and
 *      the paths in `SERVICE_ROUTES` are the same set, in BOTH directions, and
 *      `/api/maintenance/force` is in neither. A walk rather than a list,
 *      because a list only holds what somebody remembered.
 *
 *      AND THE SET IS NAMED AS WELL AS WALKED, which the walk on its own cannot
 *      do. Two halves that agree are still two halves that agree if a path
 *      leaves BOTH of them — a route reverted to `authorize` and quietly struck
 *      off the list — and that is precisely the state `/api/maintenance/cancel`
 *      was in while `/drain cancel` answered `Not signed in`. So the four paths
 *      are written down here too, and a route that stops being covered fails.
 *   F. THE WIRING — that `lib/actions.ts` still branches through `isServiceCall`
 *      into `serviceGate`, that nothing else in `src/` calls the gate, and that
 *      the role question is still delegated to `enforceDiscordAdmin` rather than
 *      answered a second time here. Read as text: `lib/actions.ts` imports
 *      `@/auth`, which drags in `@auth/dynamodb-adapter` and does not load
 *      under tsx.
 *   G. THE ENVIRONMENT — that the console parses its environment with no
 *      `COMMAND_SECRET` at all (the door simply stays shut), and that the
 *      variable is documented where an operator will look for it.
 *   H. THE OUTCOME — that a command reports what HAPPENED rather than that it
 *      was sent: refused and unreachable are told apart, nothing is ever
 *      reported as confirmed, and every route that kicks goes through the one
 *      classifier.
 * ============================================================================
 *
 * THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL. Deleting the path check fails all
 * of E and three cases in A. Moving the scope test above the secret test fails
 * B. Making an unresolved role check REFUSE fails two cases in A — which is the
 * regression that would ship as "every /brkick in the guild stops working
 * whenever Discord has a bad minute", and it is the owner's ruling on #42.
 * Putting `SERVICE_CALLER` into the actor fails D. Adding
 * `/api/maintenance/force` to `SERVICE_ROUTES` without a route change fails E in
 * the other direction, and taking `/api/maintenance/cancel` off the list AND out
 * of its route — the tidy-looking revert that would put `/drain cancel` back to
 * `Not signed in` — fails E on the named set. Collapsing a refusal and a dead
 * link back into one error fails H.
 */

process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'https://console.example.com'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

/**
 * REMOVED RATHER THAN LEFT ALONE, and section G is the reason. The claim being
 * checked is that this console starts with no command credential configured, so
 * a value inherited from the developer's own shell would turn that assertion
 * into a coin flip that passes on CI and fails on one laptop.
 */
delete process.env.COMMAND_SECRET

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  channelNotConfigured,
  dispatchKick,
  failureMessage,
  failureStatus,
  type CommandOutcome,
} from './commandOutcome'
import { RoleRevokedError, type RoleCheck } from './discordRole'
import { env } from './env'
import {
  COMMAND_SECRET_HEADER,
  SERVICE_ACTOR_HEADER,
  SERVICE_CALLER,
  SERVICE_ROUTES,
  isServiceCall,
  normalisePath,
  serviceGate,
  serviceRequest,
  type ServiceDeps,
  type ServiceLogLevel,
  type ServiceRequest,
  type ServiceVerdict,
} from './service'

/** `src/`, resolved from this file rather than from the working directory. */
const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_DIR = dirname(SRC_DIR)

const SECRET = 'a-real-command-secret-value-24'
const ADMIN = '100000000000000001'
const LICENSE = 'license:abc123def456'
const NAME = 'Wilhelmina'

let failed = 0
function fail(label: string, detail: string): void {
  failed++
  console.error(`  FAIL  ${label} — ${detail}`)
}
function expect(label: string, got: unknown, want: unknown): void {
  if (got !== want) fail(label, `got ${String(got)}, expected ${String(want)}`)
}

const HELD: RoleCheck = { state: 'held' }
const TIMED_OUT: RoleCheck = {
  state: 'unresolved',
  why: 'Discord did not answer within 5000ms',
}
const NO_TOKEN: RoleCheck = {
  state: 'unresolved',
  why: 'DISCORD_BOT_TOKEN is not set, so the Discord role re-check is disabled',
}

interface Spy {
  deps: ServiceDeps
  logs: Array<{ level: ServiceLogLevel; message: string }>
  /** Which dependencies were reached, in order. The order is half the test. */
  calls: string[]
}

/**
 * Fakes for everything outside the gate.
 *
 * THE DEFAULTS ARE THE HAPPY PATH so that each case below states only the one
 * thing it is about — a table where every row restates the whole world is a
 * table nobody edits correctly.
 *
 * `enforceRole` IS FAKED AT ITS CONTRACT, NOT AT DISCORD. It stands in for
 * `enforceDiscordAdmin`, whose own polarity — `revoked` throws, `unresolved`
 * returns — is walked branch by branch in `discordRole.check.ts`. What is
 * asserted HERE is that `serviceGate` honours that contract: a throw refuses, a
 * return proceeds, and there is no second opinion in between. Faking Discord
 * instead would re-test somebody else's file and still not prove this one.
 */
function spy(over: Partial<ServiceDeps> = {}): Spy {
  const logs: Array<{ level: ServiceLogLevel; message: string }> = []
  const calls: string[] = []

  const base: ServiceDeps = {
    secret: () => SECRET,
    license: async (id) => {
      calls.push(`license:${id}`)
      return LICENSE
    },
    name: async (id) => {
      calls.push(`name:${id}`)
      return NAME
    },
    enforceRole: async ({ discordId }) => {
      calls.push(`role:${discordId}`)
      return HELD
    },
    log: (level, message) => {
      logs.push({ level, message })
    },
  }

  return { deps: { ...base, ...over }, logs, calls }
}

/** An `enforceRole` that answers the way a given verdict would. */
function roleAnswers(verdict: RoleCheck): Partial<ServiceDeps> {
  return { enforceRole: async () => verdict }
}

/** An `enforceRole` that refuses the way `enforceDiscordAdmin` refuses. */
function roleRefuses(why: 'not-a-member' | 'role-removed'): Partial<ServiceDeps> {
  return {
    enforceRole: async () => {
      throw new RoleRevokedError(why)
    },
  }
}

function call(over: Partial<ServiceRequest> = {}): ServiceRequest {
  return {
    secret: SECRET,
    actor: ADMIN,
    path: '/api/kick',
    action: 'kick',
    ...over,
  }
}

function refusal(v: ServiceVerdict): string {
  return v.ok ? 'allowed' : `${v.status} ${v.error}`
}

async function main(): Promise<void> {
  // =========================================================================
  // A. THE RULE
  // =========================================================================

  /** [label, request, deps override, expected `status code` or 'allowed'] */
  const ruleCases: Array<
    [string, Partial<ServiceRequest>, Partial<ServiceDeps>, string]
  > = [
    // ---- The door is not wired up at all. ----
    [
      'COMMAND_SECRET unset — the whole path is closed',
      {},
      { secret: () => undefined },
      '503 not-configured',
    ],
    [
      'COMMAND_SECRET unset, and a correct-looking secret does not help',
      { secret: SECRET },
      { secret: () => undefined },
      '503 not-configured',
    ],

    // ---- The credential. ----
    ['no secret presented', { secret: null }, {}, '401 auth'],
    ['empty secret presented', { secret: '' }, {}, '401 auth'],
    ['wrong secret, same length', { secret: 'b-real-command-secret-value-24' }, {}, '401 auth'],
    /**
     * THE LENGTH TRAP. `timingSafeEqual` throws on buffers of different sizes,
     * so a comparison that skipped the hashing step would turn this case into
     * an unhandled 500 — and the difference between a 401 and a 500 is a
     * length oracle for the real secret.
     */
    ['wrong secret, one character', { secret: 'x' }, {}, '401 auth'],
    ['wrong secret, far longer than the real one', { secret: 'x'.repeat(4096) }, {}, '401 auth'],
    ['the ingest secret is not this secret', { secret: 'check-ingest-secret-value' }, {}, '401 auth'],

    // ---- The scope. ----
    ['ban is in scope', { path: '/api/bans', action: 'ban' }, {}, 'allowed'],
    ['kick is in scope', { path: '/api/kick', action: 'kick' }, {}, 'allowed'],
    ['maintenance is in scope', { path: '/api/maintenance', action: 'process' }, {}, 'allowed'],
    /**
     * CANCEL IS IN SCOPE AND FORCE IS NOT, WHICH IS THE PAIR THIS LIST EXISTS
     * FOR. They sit under one path prefix and are opposite actions: cancel stops
     * a restart, force skips the drain and performs one now. An exact match is
     * what lets the credential open the first without opening the second, and
     * these two cases are what would notice a prefix test creeping back in.
     */
    ['maintenance cancel is in scope', { path: '/api/maintenance/cancel', action: 'process' }, {}, 'allowed'],
    ['force deploy is NOT in scope', { path: '/api/maintenance/force' }, {}, '403 scope'],
    ['ban lift is NOT in scope', { path: '/api/bans/lift' }, {}, '403 scope'],
    ['incident resolve is NOT in scope', { path: '/api/incidents/resolve' }, {}, '403 scope'],
    ['spectate is NOT in scope', { path: '/api/spectate' }, {}, '403 scope'],
    ['ingest is NOT in scope', { path: '/api/ingest' }, {}, '403 scope'],
    ['handoff mint is NOT in scope', { path: '/api/handoff/mint' }, {}, '403 scope'],
    ['an unparseable request URL left no path', { path: '' }, {}, '403 scope'],
    ['a path that merely starts the same', { path: '/api/kicked' }, {}, '403 scope'],
    ['a trailing slash is not a way around an exact match', { path: '/api/kick/' }, {}, 'allowed'],

    // ---- The human being acted for. ----
    /**
     * "REFUSE IF NO ROLE IS PRESENT" AT ITS CHEAPEST POINT. The caller is a bot
     * relaying for a human and there is no session to read an identity off, so
     * a call with no usable id in the request is a call nobody can be attributed
     * with — refused before Discord is asked anything.
     */
    ['no actor header', { actor: null }, {}, '400 actor'],
    ['empty actor header', { actor: '' }, {}, '400 actor'],
    ['actor is not a Discord id', { actor: 'wilhelmina' }, {}, '400 actor'],
    ['actor is a license', { actor: LICENSE }, {}, '400 actor'],
    ['actor has a stray space', { actor: ` ${ADMIN}` }, {}, '400 actor'],

    // ---- The live role check on that human. ----
    [
      'the named admin is not in the Discord server',
      {},
      roleRefuses('not-a-member'),
      '403 role-revoked',
    ],
    [
      'the named admin no longer holds the role',
      {},
      roleRefuses('role-removed'),
      '403 role-revoked',
    ],
    /**
     * FAIL OPEN, AND THIS IS THE CASE WORTH RE-READING — it is the owner's
     * ruling on #42 and it reversed what this file first shipped.
     *
     * "endpoint should refuse if no role is present, but fail open as the bot
     * should have already validated this." A DEFINITIVE no refuses (the two
     * cases above). An UNRESOLVED answer — no token, a timeout, a 429, a guild
     * we cannot see — never refuses, because `blitz-bot` does not relay a
     * command from somebody it does not believe is an admin, and a Discord
     * outage must not take every moderation command in the guild down with it.
     * Same polarity as `enforceDiscordAdmin`, because it IS that function.
     */
    ['Discord did not answer', {}, roleAnswers(TIMED_OUT), 'allowed'],
    [
      'no bot token, so the role check is disabled',
      {},
      roleAnswers(NO_TOKEN),
      'allowed',
    ],
    /**
     * A THROW THAT IS NOT `RoleRevokedError` IS NOT AN OUTAGE, IT IS A BUG, and
     * it refuses. `unresolved` never reaches here — `enforceDiscordAdmin`
     * handles it by returning — so a throw means the gate came apart and we do
     * not know that it ran at all.
     */
    [
      'the role gate threw rather than answering',
      {},
      {
        enforceRole: async () => {
          throw new Error('Invalid environment')
        },
      },
      '503 role-error',
    ],

    // ---- Identity. ----
    [
      'the grants lookup failed, so there is nobody to attribute it to',
      {},
      {
        license: async () => {
          throw new Error('DynamoDB is unavailable')
        },
      },
      '503 store',
    ],
    [
      'no grants row is normal and is not a refusal',
      {},
      { license: async () => null },
      'allowed',
    ],
    [
      'Discord did not give a name, which costs a label and not the call',
      {},
      { name: async () => null },
      'allowed',
    ],
    [
      'the name lookup threw, which costs a label and not the call',
      {},
      {
        name: async () => {
          throw new Error('timeout')
        },
      },
      'allowed',
    ],
  ]

  for (const [label, req, over, want] of ruleCases) {
    const s = spy(over)
    const verdict = await serviceGate(call(req), s.deps)
    expect(`rule: ${label}`, refusal(verdict), want)

    // C. LOUDNESS, asserted on every single case rather than on a chosen few.
    const errors = s.logs.filter((l) => l.level === 'error')
    if (want === 'allowed') {
      if (errors.length > 0) {
        fail(`loudness: ${label}`, `an ALLOWED call logged an error: ${errors[0]?.message}`)
      }
      if (s.logs.length === 0) {
        fail(`loudness: ${label}`, 'an allowed call left no trace at all')
      }
    } else if (errors.length === 0) {
      fail(
        `loudness: ${label}`,
        'a REFUSED call logged nothing at error level — this credential can ban ' +
          'players and restart the game server',
      )
    }

    // And no log line ever carries the secret, presented or configured.
    for (const { message } of s.logs) {
      if (message.includes(SECRET)) {
        fail(`loudness: ${label}`, 'a log line contains the configured secret')
      }
      if (typeof req.secret === 'string' && req.secret.length >= 8 && message.includes(req.secret)) {
        fail(`loudness: ${label}`, 'a log line echoes the presented secret')
      }
    }
  }

  /**
   * THE RULE RESTATED AS A PROPERTY rather than a table, so a future edit to the
   * cases above cannot quietly drop the invariant: for EVERY path that is not on
   * the allowlist, a perfect credential and a real admin are still refused.
   */
  for (const path of [
    '/api/maintenance/force',
    '/api/bans/lift',
    '/api/incidents/resolve',
    '/api/incidents/artifact',
    '/api/spectate',
    '/api/host',
    '/api/session/keepalive',
    '/api/handoff/mint',
    '/api/ingest',
    '/api/state',
    '/',
  ]) {
    const verdict = await serviceGate(call({ path }), spy().deps)
    if (verdict.ok) fail(`property: ${path}`, 'was opened by the command credential')
  }

  /** And every path that IS on the list is opened by it, or the list is a fiction. */
  for (const path of SERVICE_ROUTES) {
    const verdict = await serviceGate(call({ path }), spy().deps)
    if (!verdict.ok) {
      fail(`property: ${path}`, `is on SERVICE_ROUTES but was refused: ${refusal(verdict)}`)
    }
  }

  /**
   * AND THE FAIL-OPEN HELD AS A PROPERTY TOO, over every unresolved reason the
   * `RoleCheck` type can carry. A future edit that refuses on one particular
   * `why` — the missing token is the tempting one — is the same regression as
   * refusing on all of them, arrived at more quietly.
   */
  for (const why of [
    'Discord did not answer within 5000ms',
    'DISCORD_BOT_TOKEN is not set, so the Discord role re-check is disabled',
    'Discord answered 429',
    'Discord answered 404 with code 10004 — a guild this bot cannot see',
    'member payload had no roles array',
    'could not reach Discord: fetch failed',
  ]) {
    const verdict = await serviceGate(
      call(),
      spy(roleAnswers({ state: 'unresolved', why })).deps,
    )
    if (!verdict.ok) {
      fail(
        `fail-open: ${why}`,
        `an unresolved role check REFUSED (${refusal(verdict)}) — the owner's ruling ` +
          `on #42 is that only a definitive no refuses`,
      )
    }
  }

  // =========================================================================
  // B. THE ORDER
  // =========================================================================

  {
    /**
     * A STRANGER LEARNS ONE THING AND IT IS `auth`. If the scope check ran
     * first, anybody could map the allowlist by watching 403 turn into 401.
     */
    const s = spy()
    const verdict = await serviceGate(
      call({ secret: 'not-the-secret', path: '/api/maintenance/force' }),
      s.deps,
    )
    expect('order: a wrong secret hides the allowlist', refusal(verdict), '401 auth')
  }

  {
    // Nothing outside this box is touched for a caller who failed the secret.
    const s = spy()
    await serviceGate(call({ secret: 'not-the-secret' }), s.deps)
    expect('order: a wrong secret costs no lookup at all', s.calls.length, 0)
  }

  {
    const s = spy()
    await serviceGate(call({ path: '/api/maintenance/force' }), s.deps)
    expect('order: an out-of-scope path costs no lookup at all', s.calls.length, 0)
  }

  {
    const s = spy()
    await serviceGate(call({ actor: 'wilhelmina' }), s.deps)
    expect('order: a malformed actor costs no lookup at all', s.calls.length, 0)
  }

  {
    /**
     * IDENTITY, THEN THE ROLE GATE — `authorize()`'s order, and required rather
     * than merely tidy: `enforceDiscordAdmin` logs and audits under the `Actor`,
     * so it cannot run before there is one.
     */
    const s = spy()
    await serviceGate(call(), s.deps)
    expect(
      'order: license, then name, then the role gate',
      s.calls.join(','),
      `license:${ADMIN},name:${ADMIN},role:${ADMIN}`,
    )
  }

  {
    /**
     * A FAILED GRANTS READ STOPS BEFORE THE ROLE GATE. Not for cost — it is one
     * read — but because the refusal is already decided, and asking Discord
     * about somebody we are about to refuse writes a `discord.*` audit row for a
     * write that never happened.
     */
    const s = spy({
      license: async () => {
        throw new Error('DynamoDB is unavailable')
      },
    })
    await serviceGate(call(), s.deps)
    if (s.calls.some((c) => c.startsWith('role:'))) {
      fail(
        'order: a failed grants read costs no role check',
        `reached ${s.calls.join(', ')} after the lookup had already failed`,
      )
    }
  }

  // =========================================================================
  // D. ATTRIBUTION — the acting human, never the bot
  // =========================================================================

  {
    const verdict = await serviceGate(call(), spy().deps)
    if (!verdict.ok) {
      fail('attribution', `the happy path was refused: ${refusal(verdict)}`)
    } else {
      expect('attribution: license', verdict.actor.license, LICENSE)
      expect('attribution: name', verdict.actor.name, NAME)
      expect('attribution: discord id', verdict.actor.discordId, ADMIN)
    }
  }

  {
    /**
     * THE ROW MUST NOT SAY `blitz-bot`. That is the whole reason the actor
     * header exists, and it is the one thing a future refactor is most likely
     * to undo by reaching for something convenient that is already in scope.
     */
    for (const over of [
      {},
      { license: async () => null },
      { name: async () => null },
      roleAnswers(TIMED_OUT),
    ] as Array<Partial<ServiceDeps>>) {
      const verdict = await serviceGate(call(), spy(over).deps)
      if (!verdict.ok) continue
      if (verdict.actor.name === SERVICE_CALLER) {
        fail('attribution', 'the audit row would name the bot rather than the admin')
      }
      if (verdict.actor.discordId !== ADMIN) {
        fail('attribution', 'the Discord id on the row is not the one the caller named')
      }
    }
  }

  {
    /**
     * AND THE ROLE GATE IS ASKED ABOUT THE SAME PERSON THE ROW WILL NAME. A gate
     * run over one id while the row is stamped with another is the shape of a
     * bug nobody would ever see in a log.
     */
    // An array rather than a nullable `let`: TypeScript cannot see that a
    // callback ran, so a `let` assigned only inside one narrows to `null` and
    // every read of it afterwards is a compile error.
    const asked: Array<{
      discordId: string
      name: string
      discordOnActor: string | null
    }> = []

    const verdict = await serviceGate(
      call(),
      spy({
        enforceRole: async ({ discordId, actor }) => {
          asked.push({
            discordId,
            name: actor.name,
            discordOnActor: actor.discordId,
          })
          return HELD
        },
      }).deps,
    )

    if (!verdict.ok) fail('attribution: the gate subject', 'the happy path was refused')
    expect('attribution: the gate is asked exactly once', asked.length, 1)
    expect('attribution: the gate is asked about the actor id', asked[0]?.discordId, ADMIN)
    expect('attribution: the gate sees the same name the row gets', asked[0]?.name, NAME)
    expect('attribution: the gate sees the same discord id', asked[0]?.discordOnActor, ADMIN)
  }

  {
    // A missing name falls back to something unambiguous, not to a blank.
    const verdict = await serviceGate(call(), spy({ name: async () => null }).deps)
    if (!verdict.ok) fail('attribution: unnamed admin', 'was refused')
    else {
      expect('attribution: unnamed admin falls back to the id', verdict.actor.name, ADMIN)
      expect('attribution: unnamed admin keeps the license', verdict.actor.license, LICENSE)
    }
  }

  {
    // A null license is stamped as null rather than invented.
    const verdict = await serviceGate(call(), spy({ license: async () => null }).deps)
    if (!verdict.ok) fail('attribution: no grants row', 'was refused')
    else expect('attribution: no grants row', verdict.actor.license, null)
  }

  // =========================================================================
  // The request adapter — headers and path, read off a real Request
  // =========================================================================

  {
    const req = new Request('https://console.example.com/api/kick?x=1', {
      method: 'POST',
      headers: {
        [COMMAND_SECRET_HEADER]: SECRET,
        [SERVICE_ACTOR_HEADER]: ADMIN,
      },
    })

    expect('adapter: a call carrying the header is a command call', isServiceCall(req), true)

    const parsed = serviceRequest('kick', req)
    expect('adapter: secret', parsed.secret, SECRET)
    expect('adapter: actor', parsed.actor, ADMIN)
    // The query string is not part of the path, or every allowlist entry would
    // be one `?` away from being bypassed.
    expect('adapter: path', parsed.path, '/api/kick')

    const verdict = await serviceGate(parsed, spy().deps)
    expect('adapter: end to end', refusal(verdict), 'allowed')
  }

  {
    const plain = new Request('https://console.example.com/api/kick', { method: 'POST' })
    expect(
      'adapter: a browser request is not a command call',
      isServiceCall(plain),
      false,
    )
  }

  /**
   * THE WIRE NAME IS PINNED, and it is pinned BECAUSE it no longer matches the
   * variable. `COMMAND_SECRET_HEADER` was renamed with the environment variable
   * and its VALUE deliberately was not: that string is what the bot already
   * sends and what docs/deploy.md tells an operator to curl. A tidying pass that
   * "finished the rename" by editing the value would break the bot silently, in
   * a diff that looks like housekeeping.
   */
  expect('adapter: the header on the wire is unchanged', COMMAND_SECRET_HEADER, 'x-ringmaster-service')
  expect('adapter: the actor header on the wire is unchanged', SERVICE_ACTOR_HEADER, 'x-ringmaster-actor')

  expect('adapter: trailing slash normalises', normalisePath('/api/kick/'), '/api/kick')
  expect('adapter: root survives normalising', normalisePath('/'), '/')

  // =========================================================================
  // E. THE SCOPE, WALKED — routes on disk against SERVICE_ROUTES
  // =========================================================================

  {
    const routes = routeFiles()

    if (routes.length === 0) {
      fail('scope', 'found no route files at all — the walk is broken')
    }

    const allowed = new Set<string>(SERVICE_ROUTES)
    const wired = new Set<string>()
    let writeRoutes = 0

    for (const route of routes) {
      const unsafe = route.methods.some((m) =>
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m),
      )
      if (unsafe) writeRoutes++

      if (!/\bauthorizeWrite\s*\(/.test(route.code)) continue
      wired.add(route.path)

      if (!allowed.has(route.path)) {
        fail(
          'scope',
          `${route.file} calls authorizeWrite() at ${route.path}, which is not on ` +
            `SERVICE_ROUTES. Widening the credential is a decision — make it in ` +
            `lib/service.ts, not by importing a function`,
        )
      }
    }

    /**
     * AND THE OTHER DIRECTION, which is the half a list of routes cannot do: a
     * path on the allowlist with no route calling the gate is a door standing
     * open onto nothing, and the next person to read `SERVICE_ROUTES` would
     * believe the bot can use it.
     */
    for (const path of allowed) {
      if (!wired.has(path)) {
        fail(
          'scope',
          `${path} is on SERVICE_ROUTES but no route file calls authorizeWrite() ` +
            `there — either wire it up or take it off the list`,
        )
      }
    }

    /** The specific regressions, named so they fail with the right sentence. */
    for (const path of ['/api/maintenance/force', '/api/bans/lift']) {
      if (wired.has(path)) {
        fail('scope', `${path} now goes through the command credential; it must not`)
      }
    }

    /**
     * AND THE SET ITSELF, WRITTEN DOWN — the one thing the walk above cannot
     * assert about itself.
     *
     * The walk proves the two halves AGREE. It cannot prove they are right,
     * because a path removed from `SERVICE_ROUTES` and from its route in the
     * same commit leaves them agreeing perfectly about a smaller door — which is
     * exactly the state cancel was in: `/api/maintenance/cancel` was on neither
     * side, everything here passed, and `/drain cancel` answered `Not signed
     * in`. A check that cannot fail on the bug it was written for is decoration.
     *
     * SO THE COMMANDS ARE NAMED, NOT JUST THE PATHS. Each entry says which
     * blitz-bot command stops working when that route stops being covered, so
     * the failure is read as "the bot loses X" rather than as a list that needs
     * bringing into line with the code.
     */
    const EXPECTED: Array<[string, string]> = [
      ['/api/kick', "the live kick blitz-bot relays when Discord's own /kick or /ban fires"],
      /**
       * ON THE LIST FOR `/brban`, WHICH BLITZ-BOT NO LONGER HAS. That command
       * was designed and then cut — Discord's own `/ban` fires an audit event
       * the bot already listens for, so a slash command would have been a second
       * trigger for one listener — and the ban row is written straight to
       * DynamoDB by the bot today. So this path is open and unused.
       *
       * LEFT OPEN RATHER THAN CLOSED HERE, DELIBERATELY. Narrowing the
       * credential is the same kind of decision as widening it and belongs to
       * whoever owns the bot's roadmap, not to a check being edited for an
       * unrelated route. It is written down so it is a known state rather than a
       * discovery.
       */
      ['/api/bans', '/brban — designed, then cut from blitz-bot; open and unused'],
      ['/api/maintenance', '/drain start'],
      ['/api/maintenance/cancel', '/drain cancel'],
    ]

    for (const [path, command] of EXPECTED) {
      if (!allowed.has(path)) {
        fail(
          'scope',
          `${path} is no longer on SERVICE_ROUTES — ${command} is refused 403 \`scope\``,
        )
      }
      if (!wired.has(path)) {
        fail(
          'scope',
          `${path} no longer calls authorizeWrite() — ${command} is answered ` +
            `\`Not signed in\`, which is fivem-ringmaster#42's cancel bug again`,
        )
      }
    }

    /**
     * AND NOTHING BEYOND THEM. The other direction of the same assertion:
     * widening the credential is a decision, and a decision leaves a diff in
     * THIS file as well as in lib/service.ts.
     */
    for (const path of allowed) {
      if (!EXPECTED.some(([p]) => p === path)) {
        fail(
          'scope',
          `${path} was added to SERVICE_ROUTES without being added here — say ` +
            `which blitz-bot command needs it, or take it back off`,
        )
      }
    }

    /**
     * A FLOOR ON WHAT WAS FOUND, for the reason `origin.check.ts` states: a
     * detector that silently stopped matching would report perfect scoping of
     * nothing. There were 10 state-changing routes when this was written, of
     * which 4 take the credential.
     */
    if (writeRoutes < 8) {
      fail(
        'scope',
        `only ${writeRoutes} state-changing route(s) detected; there were 10 when ` +
          `this was written, so the detector has probably stopped detecting`,
      )
    }
    expect('scope: exactly the four routes are wired', wired.size, SERVICE_ROUTES.length)
  }

  // =========================================================================
  // F. THE WIRING — one branch, in one place; one answer about the role
  // =========================================================================

  {
    /**
     * READ AS TEXT, NOT IMPORTED. `lib/actions.ts` imports `@/auth`, which
     * imports `@auth/dynamodb-adapter` — a package tsx cannot resolve, so
     * importing it here would turn this whole file into a script that does not
     * run. Section E already proves the routes call `authorizeWrite`; this
     * proves `authorizeWrite` is still the thing that consults the gate.
     */
    const actions = readFileSync(join(SRC_DIR, 'lib', 'actions.ts'), 'utf8')

    for (const needle of ['authorizeWrite', 'isServiceCall', 'serviceGate']) {
      if (!actions.includes(needle)) {
        fail('wiring', `lib/actions.ts no longer references ${needle}`)
      }
    }

    /**
     * ONE ANSWER TO "MAY THIS PERSON WRITE", AND IT LIVES IN lib/discordRole.ts.
     *
     * The polarity the owner ruled on is `enforceDiscordAdmin`'s, and this path
     * gets it by CALLING that function rather than by agreeing with it. A future
     * edit that goes back to asking `checkAdminRole` here and branching on the
     * result would pass every case above — the fakes would follow it — and
     * would reintroduce exactly the drift this delegation prevents. So the
     * delegation itself is asserted, in the only place it can be: the source.
     */
    const service = readFileSync(join(SRC_DIR, 'lib', 'service.ts'), 'utf8')
    for (const needle of ['enforceDiscordAdmin', 'RoleRevokedError']) {
      if (!service.includes(needle)) {
        fail(
          'wiring',
          `lib/service.ts no longer references ${needle} — the command path must run ` +
            `the SAME role gate as the session path, not a second copy of its rules`,
        )
      }
    }

    /**
     * ONE CALLER OF THE GATE, ANYWHERE IN `src/`. A second one is a second
     * policy: somewhere that decided for itself what to do with a refusal, or
     * called the gate with a path it chose rather than the one the request
     * arrived on.
     */
    const callers: string[] = []
    for (const full of sourceFiles(SRC_DIR)) {
      const rel = relative(REPO_DIR, full).split(sep).join('/')
      if (rel.endsWith('src/lib/service.ts') || rel.endsWith('src/lib/service.check.ts')) {
        continue
      }
      if (/\bserviceGate\s*\(/.test(stripComments(readFileSync(full, 'utf8')))) {
        callers.push(rel)
      }
    }

    if (callers.join(',') !== 'src/lib/actions.ts') {
      fail(
        'wiring',
        `serviceGate() is called from ${callers.join(', ') || 'nowhere'}; it should ` +
          `be called from src/lib/actions.ts and nowhere else`,
      )
    }
  }

  // =========================================================================
  // G. THE ENVIRONMENT — unset is a supported state, and it is documented
  // =========================================================================

  {
    /**
     * THE CONSOLE STARTS WITHOUT IT. Asserted against the real schema rather
     * than against the comment above it, because "optional" is the property
     * that decides whether adding this feature can stop an already-deployed
     * box at boot.
     */
    let parsed: ReturnType<typeof env> | null = null
    try {
      parsed = env()
    } catch (e) {
      fail(
        'env',
        `the environment no longer parses without COMMAND_SECRET: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (parsed) {
      expect('env: unset is undefined, not empty', parsed.COMMAND_SECRET, undefined)
    }

    // With it unset, the gate is shut. The two halves have to agree.
    const shut = await serviceGate(call(), spy({ secret: () => undefined }).deps)
    expect('env: unset closes the door', refusal(shut), '503 not-configured')

    /**
     * AND A SHORT ONE IS STILL REFUSED. `.optional()` means "absent or valid",
     * never "absent or anything", and a schema that lost its `.min(16)` would
     * accept a four-character secret on a credential that can ban players.
     * Read as text: `env()` caches its first answer, so the schema cannot be
     * re-parsed in-process with a different environment.
     */
    const envSrc = readFileSync(join(SRC_DIR, 'lib', 'env.ts'), 'utf8')
    if (!/COMMAND_SECRET:\s*z\s*\.string\(\)\s*\.min\(16\)\s*\.optional\(\)/.test(envSrc)) {
      fail(
        'env',
        'COMMAND_SECRET is not declared as z.string().min(16).optional() in lib/env.ts',
      )
    }

    /**
     * AND THE OLD NAME IS GONE FROM THE SOURCE ENTIRELY. The owner was told the
     * variable is `COMMAND_SECRET` and has already set it on both boxes; a
     * `SERVICE_SECRET` left in one file would be a console reading an
     * environment variable nobody has set, failing shut, with the log line
     * naming a variable the operator cannot find in either `.env`.
     */
    for (const rel of ['src/lib/env.ts', 'src/lib/service.ts', '.env.example']) {
      const text = readFileSync(join(REPO_DIR, rel), 'utf8')
      if (text.includes('SERVICE_SECRET')) {
        fail('env', `${rel} still names SERVICE_SECRET; the variable is COMMAND_SECRET`)
      }
    }
  }

  {
    /**
     * DOCUMENTED WHERE AN OPERATOR LOOKS. A secret that only exists in a schema
     * is a secret nobody sets, and the first symptom is a bot that answers
     * "the console refused" to every command.
     */
    for (const doc of ['docs/deploy.md', '.env.example']) {
      const text = readFileSync(join(REPO_DIR, doc), 'utf8')
      if (!text.includes('COMMAND_SECRET')) {
        fail(
          'docs',
          `${doc} does not mention COMMAND_SECRET — if it still says SERVICE_SECRET, ` +
            `that is the rename, and an operator following it will set a variable ` +
            `this console does not read`,
        )
      }
    }

    const deploy = readFileSync(join(REPO_DIR, 'docs', 'deploy.md'), 'utf8')
    for (const needle of [COMMAND_SECRET_HEADER, SERVICE_ACTOR_HEADER, SERVICE_CALLER]) {
      if (!deploy.includes(needle)) {
        fail('docs', `docs/deploy.md does not name ${needle}`)
      }
    }
  }

  // =========================================================================
  // H. THE OUTCOME — what happened, not that it was sent
  // =========================================================================

  {
    /**
     * THE OWNER'S SECOND COMMENT ON #42: the answer should be "done/failed", not
     * "acknowledged". These cases pin the three states that are actually
     * distinguishable and the one that is not — see lib/commandOutcome.ts.
     */
    const dispatched = await dispatchKick(async () => ({ ok: true }))
    expect('outcome: the host took the command', dispatched.outcome, 'dispatched')
    if (dispatched.outcome === 'dispatched') {
      expect('outcome: and it is not claimed as confirmed', dispatched.confirmed, false)
    }

    /** ANSWERED AND SAID NO. A reason the admin can act on, passed through. */
    const refused = await dispatchKick(async () => ({
      ok: false,
      error: 'that is not a license',
    }))
    expect('outcome: a refusal is a refusal', describe(refused), 'failed/refused')
    if (refused.outcome === 'failed') {
      expect('outcome: the refusal carries the host reason', refused.detail, 'that is not a license')
      expect('outcome: a refusal is a 502', failureStatus(refused), 502)
    }

    for (const [label, answer] of [
      ['no reason at all', { ok: false }],
      ['a blank reason', { ok: false, error: '   ' }],
    ] as Array<[string, { ok: boolean; error?: string }]>) {
      const o = await dispatchKick(async () => answer)
      if (o.outcome !== 'failed') fail(`outcome: ${label}`, 'was not reported as failed')
      else expect(`outcome: ${label} falls back`, o.detail, 'kick refused')
    }

    /**
     * NEVER ANSWERED AT ALL, WHICH IS THE DISTINCTION THIS SECTION EXISTS FOR.
     * Both routes used to write `throw new Error(res.error ?? 'kick refused')`
     * and lose it one line after receiving it, so a dead SSH link was reported
     * to the admin as the game server having refused them.
     */
    const unreachable = await dispatchKick(async () => {
      throw new Error('ssh: connect to host 10.0.0.4 port 22: Connection timed out')
    })
    expect('outcome: an unreachable host is not a refusal', describe(unreachable), 'failed/unreachable')
    if (unreachable.outcome === 'failed') {
      expect('outcome: unreachable is a 502 too', failureStatus(unreachable), 502)
      if (/refused/i.test(failureMessage(unreachable))) {
        fail(
          'outcome',
          'an unreachable host is described to the admin as a refusal, which sends ' +
            'them looking for a rule that did not fire',
        )
      }
    }

    const thrownNonError = await dispatchKick(async () => {
      throw 'a string, because someone will'
    })
    expect('outcome: a non-Error throw is still typed', describe(thrownNonError), 'failed/unreachable')

    const unconfigured = channelNotConfigured()
    expect('outcome: no channel', describe(unconfigured), 'failed/not-configured')
    if (unconfigured.outcome === 'failed') {
      expect('outcome: no channel is a 503', failureStatus(unconfigured), 503)
    }

    /**
     * AND `done` IS NOT REACHABLE, WHICH IS THE HONEST PART. Nothing in this
     * console learns whether the player was really removed — there is no
     * consumer of an outcome event anywhere — so no branch may produce one.
     * The day one exists, this assertion is what says so out loud.
     */
    for (const o of [dispatched, refused, unreachable, unconfigured]) {
      if ((o.outcome as string) === 'done') {
        fail(
          'outcome',
          'something reported `done`, which nothing in this system can know — see ' +
            'the header of lib/commandOutcome.ts',
        )
      }
    }
  }

  {
    /**
     * EVERY ROUTE THAT KICKS GOES THROUGH THE ONE CLASSIFIER, walked rather than
     * listed. Two routes send this command today and they used to classify it
     * twice; a third would otherwise be free to invent a third answer.
     */
    for (const route of routeFiles()) {
      if (!/\bkickPlayer\s*\(/.test(route.code)) continue
      if (!/\bdispatchKick\s*\(/.test(route.code)) {
        fail(
          'outcome',
          `${route.file} calls kickPlayer() without dispatchKick() — a refusal and an ` +
            `unreachable host would be reported as the same thing`,
        )
      }
      /**
       * AND NOTHING ANSWERS `accepted` ANY MORE. That field is the
       * "acknowledged" the owner objected to: it said the command was sent, on a
       * request whose own audit row says nobody knows what happened to it.
       */
      if (/\baccepted\s*:/.test(route.code)) {
        fail(
          'outcome',
          `${route.file} still answers with \`accepted\` — the response reports the ` +
            `outcome now, and receipt dressed as success is what #42 removed`,
        )
      }
    }
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/** `failed/refused`, `dispatched`, and so on — one string an `expect` can read. */
function describe(o: CommandOutcome): string {
  return o.outcome === 'failed' ? `failed/${o.failure}` : o.outcome
}

/**
 * Every `route.ts` under `src/app`, with the HTTP methods it exports and its
 * source.
 *
 * LIFTED FROM `origin.check.ts`, INCLUDING THE DESTRUCTURED-EXPORT CASE.
 * `api/auth/[...nextauth]/route.ts` is `export const { GET, POST } = handlers`,
 * and a detector that only understood `export async function POST` would report
 * that route as read-only.
 */
function routeFiles(): Array<{
  file: string
  path: string
  methods: string[]
  code: string
}> {
  const out: Array<{ file: string; path: string; methods: string[]; code: string }> = []
  const appDir = join(SRC_DIR, 'app')

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (entry !== 'route.ts' && entry !== 'route.tsx') continue

      const src = readFileSync(full, 'utf8')
      const methods = new Set<string>()

      for (const m of src.matchAll(
        /export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Z]+)\b/g,
      )) {
        if (m[1]) methods.add(m[1])
      }
      for (const m of src.matchAll(/export\s+(?:const|let|var)\s*\{([^}]*)\}/g)) {
        for (const name of (m[1] ?? '').split(',')) {
          const id = name.split(':').pop()?.trim()
          if (id && /^[A-Z]+$/.test(id)) methods.add(id)
        }
      }

      const rel = relative(appDir, dirname(full)).split(sep).filter(Boolean)
      const path =
        '/' + rel.map((s) => s.replace(/^\[\.{0,3}(.+)\]$/, 'x')).join('/')

      out.push({
        file: relative(REPO_DIR, full).split(sep).join('/'),
        path,
        methods: [...methods],
        // Comments out, so prose ABOUT `authorizeWrite` — of which the three
        // wired routes have a paragraph each, and the unwired ones may yet — is
        // never mistaken for a call to it.
        code: stripComments(src),
      })
    }
  }

  walk(appDir)
  return out
}

/**
 * Block comments and whole-line `//` only. A trailing `//` strip would cut into
 * string and regex literals containing `//`, and the direction that error runs
 * in is a check that stops seeing what it is looking for.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

void main().then(
  () => {
    if (failed > 0) {
      console.error(`\ncheck:service — ${failed} failing case(s)`)
      console.error(
        'The command credential is the only non-human write path into this ' +
          'console. See src/lib/service.ts.',
      )
      process.exit(1)
    }
    console.log(
      'check:service — rule, order, loudness, attribution, scope, wiring, ' +
        'environment and outcome assertions all pass',
    )
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:service — threw', e)
    process.exit(1)
  },
)
