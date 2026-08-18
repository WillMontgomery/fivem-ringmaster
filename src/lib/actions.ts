import { cookies } from 'next/headers'
import { z } from 'zod'

import { signOut } from '@/auth'

import * as audit from './audit'
import {
  checkAdminRole,
  enforceDiscordAdmin,
  RoleRevokedError,
} from './discordRole'
import { ForbiddenError, requireScope, type Scope } from './grants'
import { isIdle } from './activity'
import { ACTIVITY_COOKIE, IDLE_ERROR_CODE } from './idle'
import { REVOKED_ERROR_CODE, REVOKED_MESSAGE } from './revocation'
import { currentAdmin, type CurrentAdmin } from './session'

/**
 * The shared spine of every mutation route.
 *
 * ONE PLACE THAT ORDERS THE STEPS, because the order is the security property
 * and getting it right once beats getting it right in each of eight routes:
 *
 *   authenticate → authorise → re-check Discord → validate → record intent →
 *   act → record outcome
 *
 * Authorisation before validation is deliberate. A caller without the scope
 * should not be able to learn anything about what the endpoint accepts — a
 * 400 that says "reason must be at least 3 characters" is a free schema oracle
 * for someone who has no business calling it at all.
 *
 * THE DISCORD RE-CHECK SITS AFTER THE GRANT CHECK AND NOT BEFORE IT, and that
 * ordering is what the whole fail-open argument in lib/discordRole.ts rests on:
 * by the time Discord is asked, the primary authorisation has already been
 * satisfied against a live database read. It also means a stranger cannot make
 * this console call Discord by POSTing at it.
 */

/** A route handler failed in a way the caller should be told about. */
export class ActionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    /**
     * A machine-readable tag, for the handful of failures the client has to
     * act on rather than merely display. Only `idle` uses it today: a poller
     * seeing a bare 401 cannot tell "your session ended because you walked
     * away" from "your grants were revoked", and those want different words
     * and different destinations.
     */
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ActionError'
  }
}

/**
 * Free text from an admin, bounded and cleaned.
 *
 * CONTROL CHARACTERS ARE STRIPPED HERE, at the boundary, not at the point of
 * use. A ban reason ends up on a console command line on the game host, and a
 * newline in it is a second command to FXServer — the injection this whole
 * channel is designed to prevent. Stripping at the edge means every consumer
 * downstream is safe by default rather than by remembering.
 *
 * Length is capped because the reason is displayed to a player at connect, in a
 * fixed-size dialog, and a thousand-character essay is not read by anybody.
 */
export const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Give a reason of at least 3 characters.')
  .max(300, 'Keep the reason under 300 characters.')
  // Control characters collapse to a space. Written as a code-point test
  // rather than a regex literal so that no escape sequence can be mangled
  // in transit and quietly turn the guard into a no-op -- which is exactly
  // what happened twice while writing it.
  .transform((s) => {
    let out = ''
    for (const ch of s) {
      const c = ch.charCodeAt(0)
      out += c < 32 || c === 127 ? ' ' : ch
    }
    return out.split(' ').filter(Boolean).join(' ').trim()
  })

/** A qualified license, the only identifier this system bans on. */
export const licenseSchema = z
  .string()
  .trim()
  .regex(
    /^license2?:[0-9a-f]{6,64}$/i,
    'That is not a license identifier (expected `license:` followed by hex).',
  )

export interface ActionContext {
  admin: CurrentAdmin
  actor: audit.Actor
}

/**
 * Does this request change anything?
 *
 * A REQUIRED ARGUMENT, NOT AN OPTION WITH A DEFAULT, and that is the entire
 * mechanism keeping the Discord re-check from quietly missing a route. There is
 * no safe default: `read` would let a new write route skip the check by
 * omission — the exact failure this repo has shipped before, where correct code
 * has no callers — and `write` would put a Discord round trip in front of the
 * two-second `/api/state` poll. Making it mandatory means `tsc` refuses to
 * build a route whose author has not said which kind it is, and the answer is
 * greppable afterwards.
 *
 * WHAT COUNTS AS A WRITE: anything that changes state anywhere — a ban, a lift,
 * a kick, an incident verdict, a maintenance window, a branch switch, a deploy.
 * Listing and viewing are reads even when they are expensive and even when they
 * are guarded by a heavy scope; `/api/host/branches` is the case that looks
 * ambiguous and is not, because a `git fetch` on the game box changes nothing a
 * player or a moderator can observe.
 */
export type ActionIntent = 'read' | 'write'

/**
 * Authenticate, authorise, re-check Discord on writes, and hand back the acting
 * admin.
 *
 * Throws {@link ActionError} with the right status for each failure, so a
 * route handler maps one error type rather than branching.
 */
export async function authorize(
  scope: Scope,
  intent: ActionIntent,
): Promise<ActionContext> {
  /**
   * IDLE BEFORE ANYTHING ELSE, and read directly rather than inferred from the
   * null `currentAdmin()` already returns for it. Both refuse the request; only
   * this one can say which refusal it was, and "Signed out for inactivity" sent
   * to a poller is what stops the board from silently freezing with no
   * explanation.
   *
   * `authorize()` is the single choke point for every mutation route in the
   * app, which is why the check goes here rather than in each of them.
   */
  if (isIdle(await cookies())) {
    throw new ActionError(
      'Signed out for inactivity.',
      401,
      IDLE_ERROR_CODE,
    )
  }

  const admin = await currentAdmin()
  if (!admin) throw new ActionError('Not signed in.', 401)

  try {
    await requireScope(admin.license, scope)
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new ActionError(
        `You do not hold the \`${scope}\` scope.`,
        403,
      )
    }
    throw e
  }

  const actor: audit.Actor = {
    license: admin.license,
    name: admin.name,
    discordId: admin.discordId,
  }

  if (intent === 'write') {
    await discordGate(scope, actor)
  }

  return { admin, actor }
}

/**
 * Ask Discord whether this admin still holds the role, and act on the answer.
 *
 * ALL OF THE DECIDING HAPPENS IN lib/discordRole.ts — including which verdicts
 * deny, what gets audited and whether the session is torn down — so that the
 * checks in `discordRole.check.ts` exercise the shipped logic rather than a
 * second copy of it. What lives here is only the wiring: the real Discord call,
 * the real Auth.js sign-out, the real audit table.
 *
 * THE WAIT IS DELIBERATE AND IT IS UP TO FIVE SECONDS. Every write in this
 * console is submitted behind a spinner that is already on screen (BanDialog,
 * KickDialog, ConfirmDialog, MaintenancePanel and the moderation board's
 * `toast.promise` all hold one), so a slow Discord costs a longer spinner and
 * then the real outcome — not a frozen page and not a spurious failure.
 */
async function discordGate(scope: Scope, actor: audit.Actor): Promise<void> {
  const jar = await cookies()

  try {
    await enforceDiscordAdmin({
      discordId: actor.discordId,
      actor,
      scope,
      deps: {
        check: checkAdminRole,
        endSession: async () => {
          /**
           * The session RECORD, not just the cookie. Auth.js deletes the
           * DynamoDB row; clearing cookies alone would orphan it until its TTL
           * and leave a session that a captured cookie still opens. Same exit
           * the keepalive route and the sidebar's sign-out button use.
           */
          await signOut({ redirect: false })
          // The activity cookie is bound to the session token it was minted
          // against, so it is dead weight now. Dropped for the same reason the
          // keepalive route drops it on an idle sign-out.
          jar.delete(ACTIVITY_COOKIE)
        },
        audit: audit,
        log: (level, message) => {
          if (level === 'error') console.error(message)
          else console.warn(message)
        },
      },
    })
  } catch (e) {
    if (e instanceof RoleRevokedError) {
      /**
       * 403 RATHER THAN 401, and the difference is the message. A 401 says "log
       * in again", which is precisely the wrong instruction: logging in again
       * will fail, because `auth.ts`'s sign-in gate checks the same role. The
       * code is what the browser acts on — see lib/api.ts — and the message is
       * what it shows if the navigation is blocked.
       */
      throw new ActionError(REVOKED_MESSAGE, 403, REVOKED_ERROR_CODE)
    }
    throw e
  }
}

/**
 * Turn a thrown error into the response body a route should send.
 *
 * UNEXPECTED ERRORS DO NOT REACH THE CLIENT. An ActionError was written to be
 * read by an admin; anything else is a bug, a DynamoDB fault or a schema
 * surprise, and its message can carry table names, key shapes and internal
 * paths. Those get logged and replaced with something honest but empty.
 */
export function errorResponse(e: unknown): Response {
  if (e instanceof ActionError) {
    return Response.json(
      { ok: false, error: e.message, ...(e.code ? { code: e.code } : {}) },
      { status: e.status },
    )
  }
  if (e instanceof z.ZodError) {
    return Response.json(
      { ok: false, error: e.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    )
  }

  console.error('[action] unhandled', e)
  return Response.json(
    { ok: false, error: 'Something went wrong. It has been logged.' },
    { status: 500 },
  )
}
