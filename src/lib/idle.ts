/**
 * The idle timeout's shared vocabulary: the window, the names, the policy.
 *
 * NO NODE IMPORTS IN THIS FILE, deliberately, and it is why the timeout is
 * split across two modules at all. The browser half needs the window length and
 * the endpoint name; the enforcement half needs `node:crypto` and `AUTH_SECRET`.
 * Putting both in one module drags the crypto — and the secret's name — into
 * the client bundle, which `tsc` does not notice and `next build` refuses. The
 * enforcement half lives in `lib/activity.ts` and is imported only by server
 * code.
 *
 * WHAT THE TIMEOUT IS ACTUALLY FOR, because it decides every choice in both
 * files: an authenticated console left unattended. This app has a ban button
 * and a button that restarts the production game server, so a signed-in browser
 * nobody is sitting at is a real hole — a colleague's laptop in an open office,
 * a screen left on in a room, a shared machine. That is the threat.
 *
 * IT IS NOT A CONTROL AGAINST ITS OWN SUBJECT, and pretending otherwise would
 * be the more dangerous mistake. The person holding the session can keep it
 * alive: they can move the mouse, or open devtools and poll the keepalive
 * route, or buy a mouse jiggler. Any idle timeout driven by a client — and it
 * must be client-driven, see below — has this property. The cryptography in
 * `lib/activity.ts` is not trying to stop the session holder; it makes the
 * deadline something the server computes rather than something it is told.
 *
 * REQUESTS ARE NOT ACTIVITY. This is the decision the whole feature lives or
 * dies on. The live board polls `/api/state` every two seconds, the host page
 * polls every five, the update watcher every sixty. If any authenticated
 * request refreshed the deadline — the obvious implementation — a tab left open
 * overnight would refresh it seventeen thousand times and nobody would ever be
 * signed out. The feature would build, deploy and do nothing, which is this
 * codebase's signature failure. Only a pointer or a key in the reader's own
 * browser counts (see hooks/use-idle-timeout.ts), and that reaches the server
 * through exactly one endpoint.
 */

/** Two hours, server-wide. */
export const IDLE_MS = 2 * 60 * 60 * 1000

/**
 * How long before the deadline the warning toast appears.
 *
 * Long enough to notice and click, short enough that it is not background
 * noise. The cost of missing it is concrete: `BanDialog` requires a fifteen
 * character reason and the moderation board holds an inline ban form with no
 * draft persistence, so an unwarned sign-out throws away typing that somebody
 * was in the middle of.
 */
export const WARN_BEFORE_MS = 5 * 60 * 1000

/**
 * NOT A PREFERENCE, and this is a security property rather than a scoping
 * decision. EVERYBODY WHO CAN SIGN IN CAN RESTART THE FXSERVER — there are no
 * permission levels (lib/grants.ts) — so a per-user idle setting would let any
 * of them set their own window to thirty days, and a control its own subject
 * can disable is not a control. It is shown on the settings page and in the
 * first-run dialog because that is where a reader looks for it — stated as
 * policy, not offered as a choice.
 *
 * THIS USED TO SAY "if it ever becomes tunable it belongs behind
 * `requireScope(license, 'grant')`, applied to somebody else". There is no such
 * scope now and no surface that could grant one, so tunability would need a
 * genuine notion of who administers whom — which this console does not have.
 */
export const IDLE_POLICY_LABEL = 'You are signed out after 2 hours of inactivity.'

/**
 * The activity cookie. HttpOnly and MAC-authenticated — the browser asks for a
 * new one and cannot mint one. See `lib/activity.ts`.
 */
export const ACTIVITY_COOKIE = 'rm_act'

export const KEEPALIVE_PATH = '/api/session/keepalive'

/**
 * A header a cross-origin form cannot set.
 *
 * CSRF ON THE KEEPALIVE ROUTE IS LOAD-BEARING, which is easy to miss because
 * logout-CSRF is normally a shrug. The interesting direction is the other one:
 * a page the admin has open in another tab that quietly POSTs there every
 * minute would keep an unattended console alive forever, which is precisely
 * what the timeout exists to prevent. Requiring a non-simple header forces a
 * CORS preflight that a form post or an image tag cannot produce, and the route
 * checks `Origin` as well.
 *
 * Auth.js's own signout endpoint was the alternative and cannot do the job: it
 * needs its CSRF token fetched first, and it cannot re-issue our cookie.
 */
export const KEEPALIVE_HEADER = 'x-rm-keepalive'

/**
 * The discriminator on a 401 body. Pollers already treat any `!res.ok` as
 * "stop"; this is what lets the client tell "your session ended because you
 * walked away" apart from "your grants were revoked" and say so.
 */
export const IDLE_ERROR_CODE = 'idle'

/**
 * Outlives the window by five minutes so the server, not the browser's cookie
 * expiry, is what declares the session idle. If the cookie vanished at exactly
 * the deadline, "expired" and "never seeded" would be the same observation at
 * the one moment they need telling apart.
 */
export const ACTIVITY_MAX_AGE_SECONDS = Math.floor(IDLE_MS / 1000) + 300
