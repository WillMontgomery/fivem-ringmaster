import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  licenseSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import { spectatePlayer, sshConfigured } from '@/lib/ssh'

/**
 * Put the requesting admin's camera on a player (#192).
 *
 * ═══ IT IS THE KICK'S ROUTE WITH THE FREE TEXT TAKEN OUT ═══
 *
 * Deliberately so, rather than deliberately different. `/api/kick` already
 * establishes the whole shape — authorise, refuse if the channel is not
 * configured, validate, record the intent, dispatch over the one SSH channel,
 * stamp a failure if the host refuses, and answer `accepted` rather than `ok` —
 * and every one of those steps is right here for the same reason it is right
 * there. A second transport to the same box would be a second thing to secure,
 * a second thing to audit and a second thing to get wrong.
 *
 * ═══ THIS ROUTE IS WHERE THE SCOPES STARTED COMING DOWN ═══
 *
 * It first required a `spectate` scope. The reasoning was sound in the abstract
 * — watching somebody is strictly less destructive than removing them, so it is
 * a thing a trainee moderator could be trusted with far earlier, which was the
 * same argument that kept `kick` and `ban` apart.
 *
 * IT WAS STILL WRONG, FOR A REASON THAT HAD NOTHING TO DO WITH THE ARGUMENT.
 * `spectate` was one of the scopes that had never been checked anywhere, and
 * NOTHING IN THIS CONSOLE COULD GRANT ONE. There was no scopes UI; the only way
 * to add a scope to a grant row was to edit DynamoDB by hand, and the owner said
 * plainly that they do not do that. So requiring it built a wall with no door —
 * the feature shipped unreachable by the only person able to use it.
 *
 * The owner, on hitting it: "in console it says I need a permission that I
 * don't have. That should not even exist."
 *
 * THAT SENTENCE EVENTUALLY TOOK EVERY SCOPE IN THE CONSOLE (lib/grants.ts).
 * Anyone who can sign in is a full admin. What controls spectating is not a
 * permission gate but the audit row this route writes on every press: watching a
 * player who has not been told is the one console action with no other trace,
 * and that row is the reason it does not need to be rationed.
 *
 * IF LEVELS ARE EVER WANTED, THE PREREQUISITE IS A WAY TO GRANT ONE, not this
 * line. Reintroducing the check before that exists reintroduces the wall.
 *
 * ═══ NO PRESENCE CHECK HERE, AND THAT IS A DECISION ═══
 *
 * The button is drawn only when the admin and the target are both in-game, and
 * this route does not re-assert it. Two reasons, in order of weight:
 *
 *   THE GAME IS THE AUTHORITY ON WHO IS CONNECTED and this console is not. Its
 *   answer is a snapshot up to two seconds old; `br_ringmaster` resolves both
 *   licenses against `GetPlayers()` at the instant the command lands. Refusing
 *   here on a stale reading would fail requests the game would have honoured,
 *   and honouring one the game refuses costs nothing — `spectate.lua` reports
 *   "admin not connected" / "target not connected" as an ordinary non-error
 *   outcome, precisely because a board a few seconds behind is not a fault.
 *
 *   `/api/kick` DOES NOT RE-CHECK EITHER. It sends, and `kick.lua` answers "not
 *   connected". One transport, one place that knows who is on the server.
 *
 * What is emphatically NOT skipped is authorisation: Discord is re-checked live
 * at the moment of action, because `authorize(..., 'write')` does that. Hiding a
 * button is a courtesy; that is the boundary.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const spectateSchema = z.object({
  license: licenseSchema,

  /**
   * Who the console believed it was, for the audit row's `targetName`.
   *
   * COSMETIC AND NEVER AUTHORITATIVE, exactly as on `/api/kick`. The license is
   * what the command travels on and what every table keys against; this is so
   * the log reads as a sentence about a person instead of a hex string.
   */
  playerName: z.string().trim().max(120).optional().nullable(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor, admin } = await authorize('view', 'write')

    if (!sshConfigured()) {
      throw new ActionError(
        'The command channel to the game server is not configured.',
        503,
      )
    }

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = spectateSchema.parse(body)

    /**
     * THE ADMIN'S OWN LICENSE IS AN ARGUMENT HERE, WHICH IT IS NOT FOR A KICK.
     *
     * A kick names one person; this names two, because the camera has to be
     * pointed FROM somewhere.
     *
     * THIS GUARD IS REACHABLE NOW AND IT DID NOT USE TO BE. `requireScope`
     * refused a null license before anything got this far, so the narrowing was
     * for `tsc` and the branch was dead. Scopes are gone, and the grants row is
     * a Discord-to-license LINK rather than a permission (lib/grants.ts) — so an
     * admin who has never joined the game server has no row, no license, and
     * every other power in this console. They land here.
     *
     * IT IS NOT A PERMISSION REFUSAL. There is no character on the server to
     * look through, which is the same reason the profile page hides the button
     * for them; this is the boundary saying so rather than sending the string
     * "null" to the game host.
     */
    if (!admin.license) {
      throw new ActionError(
        'This account is not linked to a game license, so there is nobody to put the camera on.',
        403,
      )
    }

    const { commandId, ts } = await audit.begin({
      action: 'player.spectate',
      actor,
      targetLicense: input.license,
      targetName: input.playerName ?? null,
    })

    try {
      const res = await spectatePlayer(admin.license, input.license, commandId)
      if (!res.ok) throw new Error(res.error ?? 'spectate refused')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await audit.resolve(ts, 'failed', message)
      throw new ActionError(
        `The game server refused the spectate request: ${message}`,
        502,
      )
    }

    // DELIBERATELY NOT RESOLVED AS 'ok' HERE, for the reason the kick is not:
    // all we know is that the command reached the console. Whether a session
    // actually opened comes back as an outcome event carrying this commandId.
    // Marking it done now would make the audit log claim knowledge it does not
    // have — and this is the one row that has to be beyond argument later.
    return Response.json({ ok: true, accepted: true, commandId })
  } catch (e) {
    return errorResponse(e)
  }
}
