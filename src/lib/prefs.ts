import { browserCookieAttributes } from './cookieFlags'
import { DISPLAY_LOCALE, FALLBACK_TIME_ZONE } from './time'

/**
 * Display preferences, read from cookies, validated once.
 *
 * WHY COOKIES AND NOT THE DATABASE. These are properties of where you are
 * reading, not of who you are: the same admin wants dark at 2am on a laptop and
 * light on a phone in daylight, and the timezone that matters is the one on the
 * wall in front of them. A per-account setting would follow them onto the wrong
 * machine.
 *
 * WHY NOT localStorage, which is where the theme used to live. The server has
 * to know the answer. A theme in localStorage means the first paint is wrong
 * until JavaScript fixes it, and a timezone in localStorage means a server
 * component — the audit log — cannot use it at all, which is the bug that
 * started this. A cookie is the only client-side store the server can read.
 *
 * ONE READ BOUNDARY. Everything hostile about these values is handled here and
 * nowhere else. Call sites receive a `Prefs` and are entitled to assume it is
 * safe; if validation starts appearing next to a `formatInstant` call, this
 * file has failed.
 *
 * NO `__Host-` / `__Secure-` PREFIXES, unlike Auth.js's own cookies and
 * deliberately so — the prefix forces `Secure`, which no dev machine serves, so
 * the names would differ between environments and every reader would have to
 * handle both spellings (as `middleware.ts` already does for the session
 * cookie, and would rather not do again). The prefixes buy origin-pinning
 * against a hostile sibling subdomain; nothing here is a credential, and the
 * one cookie where it would have mattered — the activity cookie in lib/idle.ts
 * — is authenticated with a MAC instead, which a subdomain cannot forge.
 */

export const THEME_COOKIE = 'rm_theme'
export const TZ_COOKIE = 'rm_tz'

/*
 * THERE IS NO `rm_prefs_nag` ANY MORE, and its absence is deliberate rather
 * than an oversight. The prompt used to be dismissable four ways, only one of
 * which ("More settings") wrote nothing at all — see PrefsDialog for how that
 * made the dialog reappear on the page it had just navigated to. The prompt now
 * has exactly one exit, so "have they answered" is `rm_tz` and nothing else.
 *
 * Anyone still holding the old cookie is prompted once more. That is correct:
 * they dismissed a question they were never given a working way to answer, and
 * until they answer it their timestamps read UTC.
 */

/** The localStorage key the theme lived in before this. Migrated, then dead. */
export const LEGACY_THEME_KEY = 'ringmaster.theme'

export const PREF_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * THREE VALUES, NOT TWO.
 *
 * `system` is not padding. The console has always followed the OS when nobody
 * had chosen, so a two-value preference would convert every current
 * OS-following reader into a pinned choice the moment this shipped — and pin
 * roughly half of them to the wrong one. It is also the only value the server
 * cannot resolve on its own, since `prefers-color-scheme` is not in the
 * request, which is why one small inline script survives in the layout.
 */
export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export interface Prefs {
  theme: Theme
  /** Always a valid IANA zone. `UTC` when nothing usable was stored. */
  timeZone: string
  /** False when `timeZone` is the fallback rather than a stated choice. */
  timeZoneIsSet: boolean
  /** False when the theme is the default rather than a stated choice. */
  themeIsSet: boolean
  locale: string
  /** Nobody has stated a zone. The prompt cannot be closed any other way. */
  shouldPrompt: boolean
}

/**
 * The shape both `await cookies()` and `NextRequest.cookies` present.
 *
 * Taking the jar as an argument rather than calling `cookies()` in here keeps
 * this module free of `next/headers`, which matters: the prompt dialog and the
 * settings form are client components and need the cookie names and the zone
 * normaliser. A `next/headers` import would make the whole module server-only
 * and force a second copy of the validation on the client — which is the exact
 * "validate at call sites" failure this file exists to prevent.
 */
export interface CookieJar {
  get(name: string): { value: string } | undefined
}

/**
 * The longest string allowed anywhere near `Intl`.
 *
 * The real IANA names top out around 32 characters. This is a cheap gate in
 * front of a cookie a reader can edit by hand — not because a long string is
 * dangerous to `Intl` (it throws a plain `RangeError` and is not an eval
 * surface) but because there is no reason to hand a five-kilobyte string to
 * ICU's parser to find that out.
 */
const MAX_TZ_LENGTH = 64

/**
 * The only shape a canonical zone name can take.
 *
 * THIS IS A COOKIE-INJECTION GATE, not a second validity check. Anything that
 * reaches a `Set-Cookie` header or a `document.cookie` assignment gets checked
 * against this first, because `;` in a cookie value starts a new attribute and
 * CR/LF in a response header starts a new header. In practice a value that
 * survived `resolvedOptions().timeZone` came out of ICU's own table and cannot
 * contain either — this asserts that rather than assuming it, since the cost of
 * being wrong is an attacker-chosen cookie attribute.
 */
const CANONICAL_TZ = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/

/**
 * A stored or user-supplied zone, resolved to its canonical spelling — or null
 * if `Intl` will not accept it.
 *
 * CANONICALISE, DO NOT MERELY VALIDATE. `Intl` accepts aliases and is
 * case-insensitive, but reports one spelling back: `Europe/Kyiv` resolves to
 * `Europe/Kiev`, `America/Nuuk` to `America/Godthab`, `US/Eastern` and
 * `EST5EDT` both to `America/New_York`, and `america/new_york` to
 * `America/New_York`. Storing what the user typed and comparing it against a
 * picker list built from `Intl`'s own spellings means the lookup misses and the
 * control renders its placeholder while a zone is genuinely set — the failure
 * already found and fixed in `BanDialog`'s duration select.
 *
 * DO NOT SWAP THIS FOR `Intl.supportedValuesOf('timeZone').includes(z)`, which
 * is the obvious-looking guard and is wrong. That list holds 418 entries and
 * contains neither `UTC` — the fallback this whole module defaults to — nor
 * `Etc/UTC`, `US/Eastern`, `EST5EDT` or `Etc/GMT+5`, all of which `Intl`
 * accepts and real people use. Verified against the Node version this runs on.
 */
export function normalizeTimeZone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const candidate = raw.trim()
  if (candidate.length === 0 || candidate.length > MAX_TZ_LENGTH) return null

  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: candidate,
    }).resolvedOptions().timeZone
  } catch {
    // `RangeError: Invalid time zone specified`. The only thing a bad zone can
    // do — but an uncaught one inside the audit page's render is a 500 that any
    // reader can trigger on themselves by editing one cookie.
    return null
  }

  // ICU answered, so this should hold by construction. See CANONICAL_TZ.
  if (!CANONICAL_TZ.test(canonical) || canonical.length > MAX_TZ_LENGTH) return null

  return canonical
}

/** Anything not one of the three known values is the default. */
export function normalizeTheme(raw: string | null | undefined): Theme | null {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : null
}

/**
 * Read and validate every display preference in one pass.
 *
 * Never throws. A reader who sets `rm_tz=$(rm -rf)` by hand gets UTC and a
 * working page, which is the only acceptable outcome for a value the reader
 * controls and a server component formats with.
 */
export function readPrefs(jar: CookieJar): Prefs {
  const theme = normalizeTheme(jar.get(THEME_COOKIE)?.value)
  const timeZone = normalizeTimeZone(jar.get(TZ_COOKIE)?.value)

  return {
    theme: theme ?? 'system',
    themeIsSet: theme !== null,
    timeZone: timeZone ?? FALLBACK_TIME_ZONE,
    timeZoneIsSet: timeZone !== null,
    locale: DISPLAY_LOCALE,
    shouldPrompt: timeZone === null,
  }
}

/**
 * The prefs a page renders with when there is no request to read — the design
 * harness under `/preview`, which has no session and no cookies.
 */
export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  themeIsSet: false,
  timeZone: FALLBACK_TIME_ZONE,
  timeZoneIsSet: false,
  locale: DISPLAY_LOCALE,
  shouldPrompt: false,
}

/**
 * Write a preference from the browser.
 *
 * The client writes these, not the server: a theme click that took a round trip
 * would be visibly slow, and the prompt dialog needs the zone stored before it
 * closes. Both values are constrained to a known set before they get here — see
 * CANONICAL_TZ for why that matters at a `document.cookie` assignment.
 *
 * ═══ THE ATTRIBUTES ARE NOT SPELLED OUT HERE, AND THAT IS THE FIX ═══
 *
 * This line used to end `; samesite=lax`, and `Lax` IS NOT SENT IN A FRAMED
 * CONSOLE. In the pause menu the top-level document is `nui://game/ui/root.html`
 * and this console is a third-party context, so the browser withheld `rm_tz` on
 * every request — the server read no stated zone, `shouldPrompt` came back true,
 * and the first-run dialog opened again on every single navigation. The owner
 * reported it as "changing between pages in-game results in the 'setup your
 * console' popup coming up every time".
 *
 * SO IT TAKES THE SAME ANSWER AS THE SESSION COOKIE, from the same function —
 * `lib/cookieFlags.ts`, where the reasoning for `None` and the reason `Secure`
 * cannot be separated from it are both written. That module is imported rather
 * than copied precisely because the copy is what was wrong: the rule was already
 * correct in three places and this was the fourth, which was on nobody's list.
 * `origin.check.ts` now walks for cookie writes instead of listing them.
 *
 * A DEV BOX OVER http IS UNAFFECTED. `browserCookieAttributes` reads
 * `location.protocol` at write time, so `http://localhost:3000` still gets
 * `samesite=lax` and no `Secure` — the only combination that works there.
 */
export function writePrefCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return
  if (!CANONICAL_TZ.test(value)) return

  document.cookie = `${name}=${value}${browserCookieAttributes(maxAgeSeconds)}`
}
