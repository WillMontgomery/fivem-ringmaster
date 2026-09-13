/**
 * Who is pushing, and where their state lands. infradocs#23.
 *
 *   npx tsx src/lib/ingestAuth.check.ts
 *
 * A PLAIN SCRIPT, matching `service.check.ts` and the dozen beside it: this
 * repo has no test framework. IT IS WIRED INTO `npm run verify` as
 * `check:ingestauth`; a check nothing runs is this repository's signature
 * failure mode.
 *
 * ============================================================================
 * THE ONE CLAIM EVERYTHING HERE EXISTS TO DEFEND
 * ============================================================================
 *
 * A SERVER'S IDENTITY IS PROVEN, NOT DECLARED. The console now ingests from two
 * game servers, `dev` and `prod`, and which one a push belongs to is decided by
 * WHICH SECRET AUTHENTICATED IT, never by a field in the body, never by source
 * address, and never by a body field cross-checked against the credential
 * "just to log a warning". A misconfigured or hostile sender must not be able
 * to post itself into the prod view by claiming to be prod, and the only way to
 * be sure of that is for no code path to exist that could read such a claim.
 *
 * So section D walks the two routes ON DISK. Nothing in `lib/` can prove the
 * absence of a body-read in `app/`, and the absence is the property.
 *
 * ============================================================================
 * WRITTEN TO BE ABLE TO FAIL
 * ============================================================================
 *
 * Collapsing the credential set back to one secret fails A and B. Letting
 * `resolveServerId` return on the first match fails nothing here and everything
 * in the header comment of `lib/ingestAuth.ts`, which is why the no-early-exit
 * rule is asserted structurally in D as well. Keying live state on one global
 * object again fails every case in C. Dropping the legacy `INGEST_SECRET`
 * fallback fails A2, A11 and B5, which is the regression that would take the
 * owner's live prod feed down on deploy.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_SERVER_ID,
  parseIngestCredentials,
  resolveServerId,
  type IngestCredential,
} from './ingestAuth'
import type { SnapshotEnvelope } from './ingest'
import {
  applyEvents,
  applySnapshot,
  knownServers,
  liveView,
  resetServers,
} from './state'

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const PROD = 'prod-secret-0123456789abcdef'
const DEV = 'dev-secret-0123456789abcdef'
const OLD = 'legacy-secret-0123456789abcd'

let failed = 0
let ran = 0

function fail(label: string, detail: string): void {
  failed++
  console.error(`  FAIL  ${label} - ${detail}`)
}

function expect(label: string, got: unknown, want: unknown): void {
  ran++
  if (got !== want) fail(label, `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
}

/** The parse threw, and the message names the thing an operator must fix. */
function expectThrow(label: string, body: () => unknown, mentions: string): void {
  ran++
  try {
    body()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!message.includes(mentions)) {
      fail(label, `threw, but the message does not mention \`${mentions}\`: ${message}`)
    }
    return
  }
  fail(label, 'did not throw, and should have')
}

function ids(creds: IngestCredential[]): string {
  return creds.map((c) => c.serverId).join(',')
}

// ===========================================================================
// A. HOW THE CREDENTIAL SET IS CONFIGURED
// ===========================================================================

expect(
  'A1  INGEST_SECRETS carries one entry per server',
  ids(parseIngestCredentials({ secrets: JSON.stringify({ prod: PROD, dev: DEV }) })),
  'prod,dev',
)

/**
 * A2 IS THE DEPLOY. The owner has a live prod server pushing today with
 * `INGEST_SECRET` and nothing else set, and a closed beta next week. A deploy
 * that stops accepting that push is the worst outcome available here.
 */
expect(
  'A2  a lone INGEST_SECRET is still a credential, and it is prod',
  ids(parseIngestCredentials({ legacy: OLD })),
  'prod',
)

expect(
  'A3  the legacy secret survives alongside a new set, so prod can be rotated',
  ids(parseIngestCredentials({ secrets: JSON.stringify({ prod: PROD, dev: DEV }), legacy: OLD })),
  'prod,dev,prod',
)

expectThrow(
  'A4  no ingest credential at all is a boot failure, not a silent 401 on every push',
  () => parseIngestCredentials({}),
  'INGEST_SECRET',
)

expectThrow(
  'A5  malformed JSON names the variable',
  () => parseIngestCredentials({ secrets: '{"prod": ' }),
  'INGEST_SECRETS',
)

expectThrow(
  'A6  an array is not a server-to-secret map',
  () => parseIngestCredentials({ secrets: '["a","b"]' }),
  'INGEST_SECRETS',
)

expectThrow(
  'A7  a non-string secret',
  () => parseIngestCredentials({ secrets: JSON.stringify({ prod: 12345 }) }),
  'prod',
)

expectThrow(
  'A8  a secret under the sixteen-character floor INGEST_SECRET already had',
  () => parseIngestCredentials({ secrets: JSON.stringify({ prod: 'short' }) }),
  'prod',
)

expectThrow(
  'A9  a server id that is not a plain lowercase token',
  () => parseIngestCredentials({ secrets: JSON.stringify({ 'PROD/../etc': PROD }) }),
  'server id',
)

/**
 * A10 IS THE AMBIGUITY THAT WOULD MAKE IDENTITY A COIN FLIP. One value mapped
 * to two servers means a push carrying it belongs to both, and whichever the
 * loop happened to see last would win. Refused at parse, where an operator is
 * looking at the variable they just edited.
 */
expectThrow(
  'A10 the same secret for two different servers',
  () => parseIngestCredentials({ secrets: JSON.stringify({ prod: PROD, dev: PROD }) }),
  'more than one server',
)

/**
 * A11 IS THE MIGRATION STATE, and it must NOT throw. An operator moving prod
 * into `INGEST_SECRETS` will paste the value they already have, then leave
 * `INGEST_SECRET` in place until they are sure. Same value, same server, one
 * credential.
 */
expect(
  'A11 the same secret repeated for the same server is one credential, not a conflict',
  ids(parseIngestCredentials({ secrets: JSON.stringify({ prod: PROD }), legacy: PROD })),
  'prod',
)

// ===========================================================================
// B. RESOLVING A PRESENTED SECRET TO A SERVER
// ===========================================================================

const both = parseIngestCredentials({
  secrets: JSON.stringify({ prod: PROD, dev: DEV }),
})

expect('B1  the prod secret resolves to prod', resolveServerId(PROD, both), 'prod')
expect('B2  the dev secret resolves to dev', resolveServerId(DEV, both), 'dev')
expect('B3  an unknown secret resolves to nothing', resolveServerId('not-a-configured-secret', both), null)
expect('B4  no header at all resolves to nothing', resolveServerId(null, both), null)
expect('B5  the legacy secret alone still authenticates, as prod', resolveServerId(OLD, parseIngestCredentials({ legacy: OLD })), 'prod')

// A PREFIX IS NOT A MATCH. The comparison is over sha256 digests, so "most of
// the secret" is exactly as wrong as none of it.
expect('B6  a prefix of a real secret resolves to nothing', resolveServerId(PROD.slice(0, -1), both), null)
expect('B7  the empty string resolves to nothing', resolveServerId('', both), null)

expect('B8  prod keeps resolving to prod when its secret appears twice', resolveServerId(PROD, parseIngestCredentials({ secrets: JSON.stringify({ prod: PROD, dev: DEV }), legacy: PROD })), 'prod')

expect('B9  the default server is the one the live prod box already is', DEFAULT_SERVER_ID, 'prod')

// ===========================================================================
// C. STATE FROM ONE SERVER DOES NOT APPEAR UNDER THE OTHER
// ===========================================================================

function snapshot(bootEpoch: string, names: string[], takenGameMs: number): SnapshotEnvelope {
  return {
    v: 1,
    kind: 'snapshot',
    server: { bootEpoch, resource: 'br_ringmaster', wallMs: 1_700_000_000_000, gameMs: 1000 },
    snapshot: {
      takenGameMs,
      counts: { connected: names.length, inMatch: 0 },
      truncated: false,
      matches: [],
      anticheat: null,
      ddb: null,
      players: names.map((name, i) => ({
        src: i + 1,
        name,
        license: `license:${name}`,
        matchId: null,
        squadId: null,
        state: 'LOBBY',
        hp: 200,
        armour: 0,
        kills: 0,
        downs: 0,
        revives: 0,
        damage: 0,
        placement: null,
        pos: null,
        posAt: 0,
        bucket: 0,
        connectedAt: 500,
      })),
    },
  }
}

resetServers()

const NOW = 1_700_000_005_000

applySnapshot('prod', snapshot('boot-prod', ['Alice'], 5000), NOW)
applySnapshot('dev', snapshot('boot-dev', ['Bob', 'Carol'], 5000), NOW)

expect('C1  prod shows only prod players', liveView(NOW, 'prod').players.map((p) => p.name).join(','), 'Alice')
expect('C2  dev shows only dev players', liveView(NOW, 'dev').players.map((p) => p.name).join(','), 'Bob,Carol')
expect('C3  the counts do not bleed', liveView(NOW, 'prod').counts.connected, 1)
expect('C4  the boot epoch is the sending server\'s', liveView(NOW, 'dev').bootEpoch, 'boot-dev')

/**
 * C5 IS WHY THE DEDUPE KEY COULD NOT STAY GLOBAL. `bootEpoch` is unique per
 * resource start and `seq` restarts at 0 with it, but neither is unique ACROSS
 * servers: two boxes deployed from the same commit at the same minute can
 * mint colliding epochs, and a shared `seen` set would then read the second
 * server's events as the first's retries and drop them.
 */
applyEvents(
  'prod',
  {
    v: 1,
    kind: 'events',
    server: { bootEpoch: 'same-epoch', resource: 'br_ringmaster', wallMs: 1_700_000_000_000, gameMs: 1000 },
    events: [{ seq: 1, kind: 'player_seen', at: 2000, data: { license: 'license:Alice', name: 'Alice' } }],
  },
  NOW,
)

const devApplied = applyEvents(
  'dev',
  {
    v: 1,
    kind: 'events',
    server: { bootEpoch: 'same-epoch', resource: 'br_ringmaster', wallMs: 1_700_000_000_000, gameMs: 1000 },
    events: [{ seq: 1, kind: 'player_seen', at: 2000, data: { license: 'license:Bob', name: 'Bob' } }],
  },
  NOW,
)

expect('C5  an identical (bootEpoch, seq) on the other server is not a duplicate', devApplied, 1)
expect('C6  prod counted one event', liveView(NOW, 'prod').stats.eventsApplied, 1)
expect('C7  dev counted its own', liveView(NOW, 'dev').stats.eventsApplied, 1)
expect('C8  and neither counted a duplicate', liveView(NOW, 'prod').stats.eventsDuplicate, 0)

expect('C9  liveView with no server named is the default one', liveView(NOW).bootEpoch, liveView(NOW, DEFAULT_SERVER_ID).bootEpoch)

expect('C10 both servers are listed for the dropdown to read', knownServers().join(','), 'dev,prod')

/**
 * C11: A SERVER THAT HAS NEVER PUSHED IS NOT AN ERROR, it is an empty board.
 * The dropdown will be able to name a configured server before it has ever
 * sent anything, and `online: false` is the honest answer.
 */
expect('C11 a server that has never pushed reads as offline, not as a throw', liveView(NOW, 'staging').online, false)

// ===========================================================================
// D. THE ROUTES, ON DISK: the identity is never read off the payload
// ===========================================================================

function source(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), 'utf8')
}

const ingestRoute = source('app/api/ingest/route.ts')
const mintRoute = source('app/api/handoff/mint/route.ts')

function expectSource(label: string, text: string, needle: string | RegExp, want: boolean): void {
  ran++
  const found = typeof needle === 'string' ? text.includes(needle) : needle.test(text)
  if (found === want) return
  fail(label, want ? `expected to find ${String(needle)}` : `found ${String(needle)}, and should not have`)
}

expectSource('D1  /api/ingest resolves identity from the credential', ingestRoute, 'resolveServerId(', true)

/**
 * D2 IS THE WHOLE POINT OF SECTION D. `serverId` may be assigned exactly once
 * in that route, from `resolveServerId`. Any other assignment is a second
 * source of identity, and the second source is always the untrusted one.
 */
const assignments = [...ingestRoute.matchAll(/\bserverId\s*=\s*([^\n]*)/g)].map((m) => m[1]?.trim() ?? '')
expect('D2  /api/ingest assigns serverId exactly once', assignments.length, 1)
expectSource(
  'D3  and it assigns it from the resolved credential',
  assignments[0] ?? '',
  /^resolveServerId\(/,
  true,
)

// THE BODY IS NEVER ASKED WHO SENT IT. `serverBlock` in lib/ingest.ts carries
// no server id and must not grow one; this pins the route side of that.
expectSource('D4  the envelope is never read for a server id', ingestRoute, /env_\.server\.(serverId|id|name|env)\b/, false)

// `\b` after the T is what keeps this off `INGEST_SECRETS`, which the prose in
// both routes is allowed to name and neither is allowed to read one value of.
expectSource('D5  /api/ingest no longer reads the single secret directly', ingestRoute, /\bINGEST_SECRET\b/, false)

expectSource('D6  the applies are told which server they belong to', ingestRoute, /applySnapshot\(\s*serverId/, true)
expectSource('D7  and so are the events', ingestRoute, /applyEvents\(\s*serverId/, true)

/**
 * D8: THE MINT ROUTE SHARES THE CREDENTIAL SET. It presented the same header
 * with the same value and compared it against `env().INGEST_SECRET`, so a
 * console configured through `INGEST_SECRETS` alone would have had a working
 * ingest and a mint that refused every game box.
 */
expectSource('D8  /api/handoff/mint authenticates against the same set', mintRoute, 'resolveServerId(', true)
expectSource('D9  and not against a single secret of its own', mintRoute, /\bINGEST_SECRET\b/, false)

// ===========================================================================

if (failed) {
  console.error(`\ncheck:ingestauth - ${failed} failing case(s) of ${ran}`)
  console.error(
    'A server id is a property of the secret that authenticated the push, never ' +
      'a field in it. See src/lib/ingestAuth.ts.',
  )
  process.exit(1)
}
console.log(`check:ingestauth - ${ran} cases pass: two servers, two secrets, two boards`)
