/**
 * Contract checks for the cross-origin refusal — #23.
 *
 *   npx tsx src/lib/origin.check.ts
 *
 * A PLAIN SCRIPT, matching `handoff.check.ts` and `discordRole.check.ts`: this
 * repo has no test framework and adding one to assert three dozen cases would
 * be the larger change. IT IS WIRED INTO `npm run verify` as `check:origin`; a
 * check nothing runs is this repository's signature failure mode and has
 * already happened here once.
 *
 * ============================================================================
 * WHAT IT ACTUALLY EXERCISES, because the distinction decides what a pass is
 * worth:
 *
 *   A. THE RULE — `originAllowed` from `lib/origin.ts`, as shipped.
 *   B. THE WIRING — the DEFAULT EXPORT OF `src/middleware.ts`, called with real
 *      `NextRequest` objects. This is the half that matters: a correct rule
 *      nobody invokes is precisely the failure this repository keeps shipping,
 *      and A alone cannot tell the difference.
 *   C. THE COVERAGE — every `route.ts` on disk that exports a state-changing
 *      method, checked against the shipped `config.matcher`. This is the "a new
 *      route added without the check is caught" case, and it is why the guard
 *      is in middleware rather than in a helper each route remembers to call.
 *   D. THE COOKIE — that `SameSite=None` cannot be produced without `Secure`,
 *      and that the three places issuing session cookies still derive both from
 *      `lib/handoff.ts` rather than spelling them out.
 *   E. THE FRAME HEADER — that `X-Frame-Options` is gone and `frame-ancestors`
 *      names the CEF scheme. Read from `next.config.mjs` as text, which is what
 *      that file supports; it proves the value shipped, not that a browser
 *      honours it.
 * ============================================================================
 *
 * THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL. Deleting the guard call from
 * middleware fails eight cases in B. Inverting the absent-`Origin` rule to
 * "require Origin" fails the two game-box cases and nothing else, which is
 * exactly the regression that would otherwise reach a playtest as "the player
 * list is empty". Narrowing the matcher back to exclude `/api` fails all of C.
 * Hard-coding `sameSite: 'lax'` back into any cookie site fails D.
 */

process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'https://console.example.com'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NextRequest } from 'next/server'

import middleware, { config as middlewareConfig } from '../middleware'
import { secureCookies, sessionSameSite } from './handoff'
import {
  CSRF_REJECT_STATUS,
  UNSAFE_METHODS,
  originAllowed,
  requestOriginAllowed,
} from './origin'

/** `src/`, resolved from this file rather than from the working directory. */
const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_DIR = dirname(SRC_DIR)

/** The origin the console is deployed on, for the whole of this file. */
const HOST = 'console.example.com'
const SELF = `https://${HOST}`
const EVIL = 'https://evil.example'

let failed = 0
function fail(label: string, detail: string): void {
  failed++
  console.error(`  FAIL  ${label} — ${detail}`)
}
function expect(label: string, got: unknown, want: unknown): void {
  if (got !== want) fail(label, `got ${String(got)}, expected ${String(want)}`)
}

// ===========================================================================
// A. THE RULE
// ===========================================================================

/** [label, input, expected allowed?] */
const ruleCases: Array<[string, Parameters<typeof originAllowed>[0], boolean]> =
  [
    // ---- The attack this whole change exists to stop. ----
    [
      'cross-origin POST from another site',
      { method: 'POST', origin: EVIL, host: HOST },
      false,
    ],
    [
      'cross-origin POST, attacker on a lookalike host',
      { method: 'POST', origin: 'https://console.example.com.evil.example', host: HOST },
      false,
    ],
    [
      'cross-origin POST, attacker on a subdomain of ours',
      { method: 'POST', origin: 'https://x.console.example.com', host: HOST },
      false,
    ],
    [
      'cross-origin POST, right host on the wrong port',
      { method: 'POST', origin: 'https://console.example.com:8443', host: HOST },
      false,
    ],
    ['cross-origin PUT', { method: 'PUT', origin: EVIL, host: HOST }, false],
    ['cross-origin PATCH', { method: 'PATCH', origin: EVIL, host: HOST }, false],
    ['cross-origin DELETE', { method: 'DELETE', origin: EVIL, host: HOST }, false],
    [
      'lowercase method is still refused',
      { method: 'post', origin: EVIL, host: HOST },
      false,
    ],

    /**
     * `null` IS PRESENT, NOT ABSENT. A sandboxed iframe and a form post that
     * crossed a redirect both send this literal string. Reading it as "no
     * origin" would let a hostile page opt out of the check by opting into a
     * sandbox — the one case where the absent-Origin allowance would be a hole.
     */
    ['literal null origin', { method: 'POST', origin: 'null', host: HOST }, false],
    ['unparseable origin', { method: 'POST', origin: 'not a url', host: HOST }, false],
    ['empty-host origin', { method: 'POST', origin: 'https://', host: HOST }, false],

    // ---- The console's own writes. ----
    ['same-origin POST', { method: 'POST', origin: SELF, host: HOST }, true],
    [
      'same-origin POST, origin cased differently',
      { method: 'POST', origin: 'https://CONSOLE.EXAMPLE.COM', host: HOST },
      true,
    ],
    [
      'same-origin POST on a dev machine over http',
      {
        method: 'POST',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        configured: 'localhost:3000',
      },
      true,
    ],
    [
      'http origin on our own host — scheme is not compared, and the Secure cookie is why',
      { method: 'POST', origin: `http://${HOST}`, host: HOST },
      true,
    ],

    /**
     * THE CASE THAT BREAKS THE GAME LINK IF IT IS GOT WRONG. `/api/ingest` and
     * `/api/handoff/mint` are called by the game box with `x-ringmaster-secret`
     * and no `Origin` header at all. "Require Origin" 403s both, and the
     * symptom is an empty player list and a dead pause menu with the secret
     * looking fine in every log.
     */
    ['no Origin at all — the game box push', { method: 'POST', origin: null, host: HOST }, true],
    ['no Origin, header absent entirely', { method: 'POST', origin: undefined, host: HOST }, true],
    ['no Origin, empty string', { method: 'POST', origin: '   ', host: HOST }, true],

    // ---- Reads are untouched. ----
    ['cross-origin GET', { method: 'GET', origin: EVIL, host: HOST }, true],
    ['cross-origin HEAD', { method: 'HEAD', origin: EVIL, host: HOST }, true],
    [
      'cross-origin OPTIONS — a preflight this app never answers permissively',
      { method: 'OPTIONS', origin: EVIL, host: HOST },
      true,
    ],
    [
      'the pause-menu redeem: a GET framed by NUI, whose Origin is not ours',
      { method: 'GET', origin: 'https://cfx-nui-br_ringmaster', host: HOST },
      true,
    ],

    // ---- Behind the proxy. ----
    [
      'proxy rewrote Host; X-Forwarded-Host carries the real one',
      { method: 'POST', origin: SELF, host: 'localhost:3000', forwardedHost: HOST, configured: null },
      true,
    ],
    [
      'X-Forwarded-Host is a list; only the first entry counts',
      {
        method: 'POST',
        origin: SELF,
        host: 'localhost:3000',
        forwardedHost: `${HOST}, inner.internal`,
        configured: null,
      },
      true,
    ],
    [
      'a forged X-Forwarded-Host does not admit a foreign Origin',
      { method: 'POST', origin: EVIL, host: HOST, forwardedHost: EVIL.replace('https://', ''), configured: null },
      // It matches, and that is fine to state plainly: setting this header on a
      // credentialed cross-site request is not something a browser permits —
      // it is not CORS-safelisted, so it earns a preflight nothing here
      // answers. Recorded as a case so the reasoning is not re-litigated.
      true,
    ],
    [
      'AUTH_URL alone admits the write when Host is an internal name',
      { method: 'POST', origin: SELF, host: 'localhost:3000', configured: HOST },
      true,
    ],
    [
      'AUTH_URL unset and Host internal — refused, which is the safe direction',
      { method: 'POST', origin: SELF, host: 'localhost:3000', configured: null },
      false,
    ],
  ]

for (const [label, input, want] of ruleCases) {
  expect(`rule: ${label}`, originAllowed(input), want)
}

/**
 * The rule restated as a property rather than a table, so a future edit to the
 * cases cannot quietly drop the invariant: for EVERY state-changing method, a
 * present-and-foreign origin is refused and an absent one is not.
 */
for (const method of UNSAFE_METHODS) {
  if (originAllowed({ method, origin: EVIL, host: HOST, configured: HOST })) {
    fail(`property: ${method} with a foreign origin`, 'was allowed')
  }
  if (!originAllowed({ method, origin: null, host: HOST, configured: HOST })) {
    fail(`property: ${method} with no origin`, 'was refused')
  }
}

// `requestOriginAllowed` reads the three headers off a request and defers.
expect(
  'adapter: reads Origin off a request',
  requestOriginAllowed({
    method: 'POST',
    headers: { get: (n) => (n === 'origin' ? EVIL : n === 'host' ? HOST : null) },
  }),
  false,
)

// ===========================================================================
// B. THE WIRING — the shipped middleware, driven for real
// ===========================================================================

function through(
  path: string,
  init: { method?: string; origin?: string | null; host?: string },
): number {
  const host = init.host ?? HOST
  const headers = new Headers({ host })
  if (init.origin) headers.set('origin', init.origin)
  const req = new NextRequest(`https://${host}${path}`, {
    method: init.method ?? 'GET',
    headers,
  })
  return middleware(req).status
}

const PASS = 200

/** [label, path, init, expected status] */
const wiringCases: Array<
  [string, string, { method?: string; origin?: string | null; host?: string }, number]
> = [
  // ---- Cross-origin writes, refused at the door. ----
  ['ban issue', '/api/bans', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['ban lift', '/api/bans/lift', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['kick', '/api/kick', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['incident resolve', '/api/incidents/resolve', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['maintenance schedule', '/api/maintenance', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['maintenance cancel', '/api/maintenance/cancel', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['maintenance force deploy', '/api/maintenance/force', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  ['keepalive', '/api/session/keepalive', { method: 'POST', origin: EVIL }, CSRF_REJECT_STATUS],
  [
    'a SERVER ACTION, which posts to a page path and not to /api',
    '/login',
    { method: 'POST', origin: EVIL },
    CSRF_REJECT_STATUS,
  ],

  // ---- The console's own writes, unaffected. ----
  ['ban issue, same-origin', '/api/bans', { method: 'POST', origin: SELF }, PASS],
  ['kick, same-origin', '/api/kick', { method: 'POST', origin: SELF }, PASS],
  ['maintenance force, same-origin', '/api/maintenance/force', { method: 'POST', origin: SELF }, PASS],

  // ---- The game box: shared secret, no Origin header. ----
  ['ingest push, no Origin', '/api/ingest', { method: 'POST', origin: null }, PASS],
  ['handoff mint, no Origin', '/api/handoff/mint', { method: 'POST', origin: null }, PASS],

  // ---- Reads. ----
  ['state poll, same-origin GET', '/api/state', { origin: SELF }, PASS],
  ['audit GET with a foreign Origin is still a read', '/api/audit', { origin: EVIL }, PASS],
  ['handoff redeem, framed GET from NUI', '/api/handoff/redeem', { origin: 'https://cfx-nui-br_ringmaster' }, PASS],
  ['a page load', '/players', { origin: SELF }, PASS],
]

for (const [label, path, init, want] of wiringCases) {
  expect(`middleware: ${label}`, through(path, init), want)
}

/**
 * THE REFUSAL SAYS NOTHING. Asserted rather than assumed: a body here would be
 * a description of the control handed to whoever tripped it, and there is no
 * admin on the other end to read one.
 */
{
  const req = new NextRequest(`https://${HOST}/api/bans`, {
    method: 'POST',
    headers: new Headers({ host: HOST, origin: EVIL }),
  })
  const res = middleware(req)
  expect('middleware: refusal status', res.status, CSRF_REJECT_STATUS)
  if (res.body !== null) fail('middleware: refusal body', 'a refusal carries a body')
}

// ===========================================================================
// C. THE COVERAGE — no route can be added outside the guard
// ===========================================================================

/**
 * Every `route.ts` under `src/app`, with the HTTP methods it exports.
 *
 * THE DESTRUCTURED FORM IS DETECTED TOO. `api/auth/[...nextauth]/route.ts` is
 * `export const { GET, POST } = handlers`, and a detector that only understood
 * `export async function POST` would report that route as read-only and pass it
 * without ever checking it.
 */
function routeFiles(): Array<{ file: string; path: string; methods: string[] }> {
  const out: Array<{ file: string; path: string; methods: string[] }> = []
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

      // src/app/api/bans/lift/route.ts -> /api/bans/lift. Dynamic segments
      // become an ordinary segment; the matcher cannot distinguish them and
      // neither should this.
      const rel = relative(appDir, dirname(full)).split(sep).filter(Boolean)
      const path =
        '/' + rel.map((s) => s.replace(/^\[\.{0,3}(.+)\]$/, 'x')).join('/')

      out.push({ file: relative(REPO_DIR, full), path, methods: [...methods] })
    }
  }

  walk(appDir)
  return out
}

/**
 * The shipped matcher, as a regex.
 *
 * IT REFUSES TO GUESS. Next.js runs these through path-to-regexp, and this
 * understands only the negative-lookahead form the middleware actually uses. A
 * matcher rewritten into any other shape fails this check loudly rather than
 * being silently approximated — an approximation that quietly matched
 * everything would turn C into a check that cannot fail.
 */
function matcherRegexes(): RegExp[] {
  const raw = middlewareConfig.matcher
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((m) => {
    if (typeof m !== 'string' || !m.startsWith('/')) {
      throw new Error(`matcher is not a path string: ${String(m)}`)
    }
    if (/[:{}]/.test(m)) {
      throw new Error(
        `matcher uses path-to-regexp syntax this check cannot evaluate: ${m}. ` +
          `Teach it the new shape rather than deleting the case.`,
      )
    }
    return new RegExp(`^${m}$`)
  })
}

{
  const regexes = matcherRegexes()
  const covered = (path: string): boolean => regexes.some((r) => r.test(path))
  const routes = routeFiles()

  if (routes.length === 0) {
    fail('coverage', 'found no route files at all — the walk is broken')
  }

  let writeRoutes = 0
  for (const route of routes) {
    const unsafe = route.methods.filter((m) =>
      (UNSAFE_METHODS as readonly string[]).includes(m),
    )
    if (unsafe.length === 0) continue
    writeRoutes++
    if (!covered(route.path)) {
      fail(
        'coverage',
        `${route.file} exports ${unsafe.join('/')} at ${route.path}, which the ` +
          `middleware matcher does not cover — that route has no CSRF check`,
      )
    }
  }

  /**
   * A FLOOR ON WHAT WAS FOUND. Without it, a detector that silently stopped
   * matching anything would report full coverage of nothing — which is the
   * shape of every check in this repo that has ever failed to check.
   */
  if (writeRoutes < 8) {
    fail(
      'coverage',
      `only ${writeRoutes} state-changing route(s) detected; there were 9 when ` +
        `this was written, so the detector has probably stopped detecting`,
    )
  }

  /** And the exclusions still exclude, or the matcher has stopped meaning anything. */
  for (const excluded of ['/_next/static/chunk.js', '/_next/image', '/favicon.ico']) {
    if (covered(excluded)) {
      fail('coverage', `${excluded} is matched by middleware; the exclusions are gone`)
    }
  }

  /** The specific regression: `/api` back outside the matcher. */
  for (const p of ['/api/bans', '/api/kick', '/api/maintenance/force', '/api/ingest']) {
    if (!covered(p)) fail('coverage', `${p} is outside the matcher`)
  }
}

// ===========================================================================
// D. THE COOKIE — `None` cannot exist without `Secure`
// ===========================================================================

expect('cookie: https deployment gets SameSite=None', sessionSameSite(true), 'none')
expect('cookie: http/dev stays SameSite=Lax', sessionSameSite(false), 'lax')

/**
 * THE INVARIANT, over the only two inputs there are. `SameSite=None` on a
 * cookie that is not `Secure` is DROPPED by every current browser without a
 * warning anybody operating this console would see — a sign-in that silently
 * does not stick. Deriving both from one boolean is what makes that
 * unreachable, and this is the assertion that keeps it derived.
 */
for (const secure of [true, false]) {
  if (sessionSameSite(secure) === 'none' && !secure) {
    fail('cookie invariant', 'SameSite=None was produced without Secure')
  }
}

expect('cookie: https AUTH_URL is secure', secureCookies('https://console.example.com'), true)
expect('cookie: http AUTH_URL is not', secureCookies('http://localhost:3000'), false)
expect('cookie: an unparseable AUTH_URL fails towards Secure', secureCookies('nonsense'), true)

/**
 * The three places a session-bearing cookie is issued must still DERIVE the
 * flags. A hard-coded `sameSite` in any of them is how the framed console
 * regresses to signed-out with nothing reporting it.
 */
for (const [file, needle] of [
  ['src/auth.ts', 'sessionSameSite'],
  ['src/app/api/handoff/redeem/route.ts', 'sessionSameSite'],
  ['src/app/api/session/keepalive/route.ts', 'sessionSameSite'],
] as const) {
  const src = readFileSync(join(REPO_DIR, file), 'utf8')
  if (!src.includes(needle)) {
    fail('cookie', `${file} no longer derives SameSite from ${needle}()`)
  }
  if (/sameSite:\s*'(lax|none|strict)'/i.test(src) || /SameSite=(Lax|None|Strict)\b/.test(src.replace(/^\s*\*.*$/gm, ''))) {
    fail('cookie', `${file} hard-codes a SameSite value`)
  }
}

// ===========================================================================
// E. THE FRAME HEADER
// ===========================================================================

{
  const cfg = readFileSync(join(REPO_DIR, 'next.config.mjs'), 'utf8')
  // Comments in that file discuss the old header by name, so look only at the
  // header list rather than the prose around it.
  const code = cfg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  if (/X-Frame-Options/.test(code)) {
    fail('frame', 'X-Frame-Options is still being sent; it overrides nothing and confuses everything')
  }
  // To end of line, not to the next quote: the value itself contains `'self'`,
  // so a quote-terminated capture reads as empty and every assertion below it
  // becomes vacuous — which is how this check first passed while asserting
  // nothing at all.
  const csp = /frame-ancestors([^\n]*)/.exec(code)
  if (!csp) {
    fail('frame', 'no frame-ancestors directive is sent, so the console cannot be framed at all')
  } else {
    const value = csp[1] ?? ''
    // CEF's own root document is an ancestor of the NUI page, and
    // frame-ancestors checks EVERY ancestor. Without this the grandparent
    // refuses and the pause menu shows a blank frame.
    if (!/\bnui:/.test(value)) {
      fail('frame', `frame-ancestors does not permit the nui: scheme — CEF's root.html is an ancestor: "${value.trim()}"`)
    }
    if (!/\bhttps:/.test(value) && !/cfx-nui/.test(value)) {
      fail('frame', `frame-ancestors permits no https origin, so the NUI resource page cannot frame us: "${value.trim()}"`)
    }
  }
}

// ===========================================================================

if (failed) {
  console.error(`\ncheck:origin — ${failed} failing case(s)`)
  console.error(
    'The cross-origin refusal is what replaced SameSite=Lax when #23 framed ' +
      'this console. See src/lib/origin.ts.',
  )
  process.exit(1)
}
console.log(
  `check:origin — ${ruleCases.length} rule cases, ${wiringCases.length} middleware cases, ` +
    `coverage, cookie and frame assertions all pass`,
)
