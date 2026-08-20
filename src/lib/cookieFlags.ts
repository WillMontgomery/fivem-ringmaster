/**
 * `Secure` and `SameSite`, decided once, for every cookie this console writes.
 *
 * ═══ WHY THIS IS ITS OWN MODULE AND NOT A CORNER OF `lib/handoff.ts` ═══
 *
 * Both functions below lived in `lib/handoff.ts` until the display-preference
 * cookies needed them too. That file imports `node:crypto` and the DynamoDB
 * client, so it can never be reached from a client component — and `lib/prefs.ts`
 * writes `rm_theme` and `rm_tz` from the BROWSER, with `document.cookie`, from
 * inside a `'use client'` boundary.
 *
 * The alternative was a second copy of the rule next to `document.cookie`, and
 * that is not hypothetical: it is what was there, spelled `samesite=lax`, and it
 * is what made the framed console re-offer first-run setup on every navigation.
 * A `Lax` cookie is not SENT in a third-party context, so the server saw no
 * saved zone on any request from the pause menu and prompted again, forever.
 *
 * THIS FILE IMPORTS NOTHING, and must not start. Its only job is to be reachable
 * from both halves of the app; a single server-only import here would push
 * `lib/prefs.ts` back to hand-writing the attribute it gets wrong.
 *
 * `lib/handoff.ts` re-exports both names so the three session-cookie sites keep
 * the import they already have.
 */

/**
 * Whether cookies are issued `Secure`, from the configured origin's protocol.
 *
 * `config.useSecureCookies ?? url.protocol === 'https:'` is what `@auth/core`'s
 * init does, and this reproduces it so that the redeem route, `src/auth.ts` and
 * the keepalive route cannot each decide it differently. It lived privately in
 * the redeem route until the cookie below started depending on it.
 *
 * UNPARSEABLE FALLS BACK TO `true`, which fails towards a cookie the browser
 * refuses rather than one it accepts over plain HTTP.
 */
export function secureCookies(authUrl: string): boolean {
  try {
    return new URL(authUrl).protocol === 'https:'
  } catch {
    return true
  }
}

/**
 * `SameSite` for every cookie this console writes — #23.
 *
 * ============================================================================
 * `None` IS WHAT MAKES THE PAUSE-MENU CONSOLE WORK AND IT IS A REAL WIDENING.
 * A console framed by NUI is a third-party context, and a `Lax` cookie is not
 * sent on cross-site subresource requests — so the framed console arrives
 * signed out no matter how many times it redeems a token. `None` fixes that and
 * simultaneously hands every page on the internet a credentialed POST into a
 * console that bans players and restarts game servers.
 *
 * THAT IS ONLY ACCEPTABLE BECAUSE `src/middleware.ts` REFUSES CROSS-ORIGIN
 * WRITES. `SameSite=Lax` was the entire CSRF defence in this application before
 * #23; the `Origin` check is what replaced it, it shipped first, and it is not
 * optional. If that check is ever removed, this must go back to `Lax` in the
 * same commit.
 * ============================================================================
 *
 * IT IS DERIVED FROM `secure`, NOT CHOSEN BESIDE IT, and that is the whole
 * point of it being one function. `SameSite=None` without `Secure` is a cookie
 * every modern browser DROPS SILENTLY — no console warning the operator will
 * see, no error, just a console that cannot stay signed in. Making the two
 * impossible to set independently means that state cannot be reached by
 * editing one line and forgetting the other.
 *
 * SO A DEV MACHINE STAYS `Lax`. `http://localhost:3000` gets `secure: false`
 * and therefore `Lax`, which is both the only thing that works there and the
 * posture the console has always had locally. The framed flow is an HTTPS
 * deployment's feature; it was never going to work over plain HTTP anyway.
 *
 * THE NAME STILL SAYS `session` because the session cookie is what forced the
 * decision and where the reasoning above is anchored. Every other cookie this
 * console writes takes the same answer for the same reason: framed is framed.
 */
export function sessionSameSite(secure: boolean): 'none' | 'lax' {
  return secure ? 'none' : 'lax'
}

/**
 * The attribute tail for a cookie written with `document.cookie`, from
 * `<name>=<value>` onward.
 *
 * THE WHOLE TAIL RATHER THAN JUST THE FLAG, so that a caller cannot assemble
 * `SameSite=None` without `Secure` by concatenating two correct pieces in the
 * wrong order. `path=/` is in here for the same reason it is in the three
 * server-side writers: a cookie scoped to whichever page happened to set it is
 * read back on some navigations and not others, which is indistinguishable from
 * it not having been written.
 *
 * `secure` IS A PARAMETER, NOT A READ OF `location`, because one caller has no
 * `location` to read: the theme script in `app/layout.tsx` is a string built on
 * the server and run before any bundle exists. See `browserCookieAttributes`
 * for the ordinary case.
 */
export function cookieAttributes(maxAgeSeconds: number, secure: boolean): string {
  return (
    `; path=/; max-age=${maxAgeSeconds}` +
    `; samesite=${sessionSameSite(secure)}` +
    (secure ? '; secure' : '')
  )
}

/**
 * The same tail, for code already running in a browser.
 *
 * THE PROTOCOL IS READ AT WRITE TIME rather than baked in at build time, so one
 * bundle is correct on a dev box over http and in production over https. A
 * `Secure` cookie on http is dropped in silence, which looks exactly like "the
 * setting does not save".
 */
export function browserCookieAttributes(maxAgeSeconds: number): string {
  return cookieAttributes(maxAgeSeconds, location.protocol === 'https:')
}
