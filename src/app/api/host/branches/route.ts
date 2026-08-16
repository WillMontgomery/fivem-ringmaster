import { ActionError, authorize, errorResponse } from '@/lib/actions'
import { listBranches, sshConfigured } from '@/lib/ssh'

/**
 * The branches the game host can be switched to.
 *
 * GUARDED BY `process`, NOT `view`, even though it only reads. Two reasons, and
 * the second is the real one. It makes a live SSH round trip that includes a
 * `git fetch` on the game box, so anybody with a session could make the console
 * hammer the host by holding the maintenance page open. And it is the shopping
 * list for an action that restarts the server — a moderator who cannot schedule
 * maintenance has no use for it, and showing them a picker they cannot act on
 * only teaches them the console is broken.
 *
 * NOT POLLED, AND THAT IS DELIBERATE. Every other host read in this console is
 * on a timer; this one is fetched when the picker is opened and on an explicit
 * refresh. The list changes when somebody pushes, not on a fifteen-second
 * cadence, and each call costs a `fetch --prune` against GitHub from the game
 * box.
 *
 * IT DOES NOT FILTER. Branches that cannot be deployed arrive with
 * `eligible: false` and a `blockedBy` sentence and are passed through
 * untouched, because the UI shows them disabled with the reason. Dropping them
 * here would produce a list that silently omits the branch the operator is
 * looking for, which reads as a bug rather than as a rule.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    await authorize('process')

    if (!sshConfigured()) {
      return Response.json(
        {
          ok: false,
          error: 'The command channel to the game server is not configured.',
        },
        { status: 503 },
      )
    }

    const res = await listBranches()
    return Response.json(res)
  } catch (e) {
    /**
     * An SSH failure here is ordinary — a cold link, a box mid-reboot — and
     * says nothing an admin can act on beyond "ask again". It is reported as a
     * 502 with the message rather than swallowed into the generic 500
     * `errorResponse` produces for unknown errors, because "could not reach the
     * game server" and "something went wrong, it has been logged" call for
     * completely different next actions.
     */
    if (e instanceof ActionError) return errorResponse(e)
    if (e instanceof Error) {
      return Response.json(
        { ok: false, error: `Could not read the branch list: ${e.message}` },
        { status: 502 },
      )
    }
    return errorResponse(e)
  }
}
