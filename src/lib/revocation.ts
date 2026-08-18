/**
 * The vocabulary of a forced sign-out, shared by the server that decides it and
 * the browser that has to explain it.
 *
 * NO IMPORTS IN THIS FILE, deliberately, and it is the same split `lib/idle.ts`
 * documents for the idle timeout. The enforcement half (`lib/discordRole.ts`)
 * reads `AUTH_SECRET`-adjacent configuration and talks to Discord; the browser
 * half is `lib/api.ts`, `components/LoginToast.tsx` and the login page, all of
 * which need nothing but these three strings. Putting them in the enforcement
 * module would drag `env()` — and the name of a bot token — into the client
 * bundle, which `tsc` does not notice and `next build` refuses.
 *
 * WHY A THIRD REASON EXISTS AT ALL, next to `idle` and a plain sign-out. An
 * admin whose Discord role was taken away mid-session and who is then shown
 * "your session expired" will try again, and again, and eventually ask why the
 * console is broken. It is not broken. Somebody removed their role, which is a
 * decision a person made about them, and the console's job is to say so in one
 * sentence rather than let them debug it.
 */

/**
 * The discriminator on the 403 body, so a client can tell this refusal apart
 * from every other one and act rather than merely display.
 *
 * Same mechanism as `IDLE_ERROR_CODE`: pollers and form handlers already treat
 * `!res.ok` as failure, and this is what turns one particular failure into a
 * navigation.
 */
export const REVOKED_ERROR_CODE = 'discord-role-revoked'

/** The `?reason=` value the login page reads. */
export const REVOKED_REASON = 'discord-role'

/**
 * What the admin is told, in one sentence, at the moment the write is refused.
 *
 * IT NAMES THE CAUSE AND NOT THE MECHANISM. "Your Discord admin role was
 * removed" is a fact the reader can act on — go ask whoever runs the Discord
 * server. "Authorization failed" is not. It is deliberately the same claim in
 * both places it appears (the refused request and the login page afterwards),
 * because a person who reads two different explanations of one event assumes
 * they hit two different bugs.
 */
export const REVOKED_MESSAGE =
  'Your Discord admin role was removed, so you have been signed out.'

/** The longer form, for the login page the browser lands on afterwards. */
export const REVOKED_DESCRIPTION =
  'Ringmaster re-checks your Discord admin role before every action that ' +
  'changes something. Yours is no longer on your account in this server, so ' +
  'the action was refused and your session was ended. Ask whoever manages ' +
  'the Discord server if you think this is wrong.'
