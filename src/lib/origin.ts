/**
 * The cross-origin refusal that stands where `SameSite=Lax` used to — #23.
 *
 * ============================================================================
 * WHAT WAS ACTUALLY WRONG. Nothing in this console carried a CSRF token and no
 * write route looked at `Origin`. `/api/bans`, `/api/bans/lift`, `/api/kick`,
 * `/api/incidents/resolve`, `/api/maintenance`, `/api/maintenance/cancel` and
 * `/api/maintenance/force` all authenticated from the session cookie alone, and
 * the ONLY thing stopping another site POSTing at them was that the cookie was
 * `SameSite=Lax` and so was not attached to a cross-site POST.
 *
 * #23 spends that. A console framed in the pause menu is a third-party context,
 * which needs `SameSite=None; Secure`, which hands every page on the internet a
 * credentialed POST into a console that bans players and restarts game servers.
 * So this lands FIRST and the cookie moves second. The order is the mitigation.
 * ============================================================================
 *
 * THE RULE IS "REJECT WHEN `Origin` IS PRESENT AND WRONG", NOT "REQUIRE
 * `Origin`", and getting that backwards breaks the game link in a way that
 * looks like the console is down. Server-to-server callers send no `Origin`
 * header at all: `/api/ingest` (the game box's push) and `/api/handoff/mint`
 * (the game box asking for a pause-menu token) both authenticate with
 * `x-ringmaster-secret` over the peering link and neither is a browser. A rule
 * that demanded `Origin` would 403 the player feed and the whole of #23 while
 * every log line said the secret was fine.
 *
 * That is not a hole. `Origin` is set by the BROWSER and cannot be removed by
 * the page making the request — it is a forbidden header name, so no `fetch`,
 * no form, no `<img>` and no `<script>` can suppress it. An absent `Origin` on
 * a request carrying a session cookie is therefore not something a hostile page
 * can arrange. What can omit it is a non-browser client, and a non-browser
 * client does not have the admin's cookie jar.
 *
 * WHAT THIS IS NOT. It is not clickjacking protection. A page framed by an
 * attacker is still the console, and every request it makes is genuinely
 * same-origin — this check passes them, correctly, and would pass them for a
 * stolen click too. Framing is governed by `frame-ancestors` in
 * `next.config.mjs`, and what stands behind a stolen click is that the
 * destructive actions demand typed text and a confirm. Two different attacks,
 * two different controls; neither substitutes for the other.
 *
 * NO DEPENDENCIES ON PURPOSE. This module imports nothing. `src/middleware.ts`
 * runs on the edge runtime where the AWS SDK does not load and where `lib/env`'s
 * zod schema would be dead weight, and `origin.check.ts` loads the functions
 * below directly so the shipped decision is the one under test rather than a
 * second copy of it.
 */

/**
 * The methods a browser can be made to send cross-site with credentials and
 * which change something when it does.
 *
 * `GET` and `HEAD` are absent because they must be: the pause-menu handoff
 * lands as a top-level `GET` on `/api/handoff/redeem` from a frame whose
 * `Origin` is the NUI page, and every RSC navigation, poller and page load in
 * the console is a `GET`. Guarding them would break the console and buy
 * nothing — a `GET` that changes state is a bug in that route, not something
 * this file can paper over. `/api/handoff/redeem` is the one `GET` here that
 * does change state, and its defence is a single-use 90-second token bound to
 * one Discord id (`lib/handoff.ts`), not the shape of the request.
 *
 * `OPTIONS` is absent so that a preflight is answered by the framework rather
 * than by a bare 403; nothing here answers preflights with permissive CORS
 * headers, so the actual request never follows.
 */
export const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * The status a refusal carries, and the whole of what it says.
 *
 * NO BODY AND NO SENTENCE. There is no admin on the other end of this — the
 * only thing that trips it is a page that is not ours — and an explanation
 * would be a free description of the control to whoever is probing it.
 */
export const CSRF_REJECT_STATUS = 403

export function isUnsafeMethod(method: string): boolean {
  return (UNSAFE_METHODS as readonly string[]).includes(method.toUpperCase())
}

/**
 * The host of the origin this console is served on, from `AUTH_URL`.
 *
 * WHY THAT VARIABLE AND NOT A NEW ONE. `AUTH_URL` is already required
 * (`lib/env.ts`), already validated as a URL, and already the string Auth.js
 * builds the Discord redirect URI from — so a wrong value does not fail here
 * first, it fails at login, loudly, before anyone can be locked out by this
 * check. A second variable naming the same origin would be a second thing to
 * get wrong and the one nobody would think to look at.
 *
 * READ FROM `process.env` DIRECTLY rather than through `env()`. This is
 * imported by middleware, which runs on the edge, and `env()` parses the whole
 * schema — a console missing an unrelated variable would fail every request at
 * the door instead of at the route that needed it. A missing or unparseable
 * `AUTH_URL` here returns null and the `Host` comparison below carries the
 * check on its own, which is the safe direction: it narrows nothing and it
 * cannot lock anybody out.
 */
export function configuredHost(): string | null {
  const raw = process.env.AUTH_URL
  if (!raw) return null
  try {
    return new URL(raw).host.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * A `Host`-style header value reduced to one host.
 *
 * `X-Forwarded-Host` is a comma-separated list when more than one proxy has
 * touched it, and only the first entry is the host the browser asked for.
 */
function firstHost(value: string | null | undefined): string | null {
  if (!value) return null
  const first = value.split(',')[0]?.trim().toLowerCase()
  return first ? first : null
}

/**
 * The decision, as a pure function of the four things it depends on.
 *
 * SEPARATED FROM THE REQUEST so `origin.check.ts` can state a case as data.
 * Building a `Request` to assert "no Origin header" is awkward and, for `Host`,
 * a forbidden header name the fetch layer may drop — which would have made the
 * most important case in the whole file untestable.
 *
 * HOSTS ARE COMPARED, NOT FULL ORIGINS, because the `Host` header carries no
 * scheme to compare against. That costs nothing real: the session cookie is
 * `Secure`, so a request bearing it reached us over HTTPS, and an `http://`
 * origin on the same host cannot hold the credential this check exists to
 * protect. `AUTH_URL` is likewise reduced to its host so the two comparisons
 * cannot disagree about what counts as a match.
 *
 * `X-Forwarded-Host` IS TRUSTED, and it has to be: the console sits behind
 * Caddy behind Cloudflare (docs/deploy.md), and a proxy that rewrites `Host`
 * would otherwise make every write from the real console look cross-origin.
 * It is not a way in — it is not a CORS-safelisted header, so a cross-site
 * `fetch` that sets it earns a preflight this app never answers, and a form
 * post cannot set headers at all. This is the same pair Next.js's own Server
 * Action CSRF check compares.
 */
export function originAllowed(input: {
  method: string
  origin: string | null | undefined
  host: string | null | undefined
  forwardedHost?: string | null | undefined
  /** Defaults to {@link configuredHost}. Passed explicitly by the checks. */
  configured?: string | null
}): boolean {
  if (!isUnsafeMethod(input.method)) return true

  // Absent: a server-to-server caller. See the header — this is the case that
  // keeps /api/ingest and /api/handoff/mint working.
  const raw = input.origin?.trim()
  if (!raw) return true

  /**
   * `null` IS A PRESENT ORIGIN AND IT IS REFUSED. A sandboxed iframe, a
   * `<form>` that crossed a redirect, and some privacy modes all send the
   * literal string `null`. It parses as no host at all, so it can never match,
   * and treating it as "absent" would hand a hostile page a way to opt out of
   * this check by opting into a sandbox.
   */
  let originHost: string
  try {
    originHost = new URL(raw).host.toLowerCase()
  } catch {
    return false
  }
  if (!originHost) return false

  const configured =
    input.configured === undefined ? configuredHost() : input.configured

  const allowed = [
    firstHost(input.host),
    firstHost(input.forwardedHost),
    configured ? configured.toLowerCase() : null,
  ]

  return allowed.some((h) => h !== null && h === originHost)
}

/** The shape this needs from a request. `NextRequest` and `Request` both fit. */
export interface OriginCheckable {
  method: string
  headers: { get(name: string): string | null }
}

/**
 * The form middleware calls: read the three headers, apply {@link originAllowed}.
 */
export function requestOriginAllowed(req: OriginCheckable): boolean {
  return originAllowed({
    method: req.method,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    forwardedHost: req.headers.get('x-forwarded-host'),
  })
}
