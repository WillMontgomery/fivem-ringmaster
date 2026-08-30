import { cookies } from 'next/headers'
import { z } from 'zod'

import { signOut } from '@/auth'

import * as audit from './audit'
import {
  checkAdminRole,
  enforceDiscordAdmin,
  RoleRevokedError,
} from './discordRole'
import { isIdle } from './activity'
import { ACTIVITY_COOKIE, IDLE_ERROR_CODE } from './idle'
import { REVOKED_ERROR_CODE, REVOKED_MESSAGE } from './revocation'
import {
  isServiceCall,
  serviceDeps,
  serviceGate,
  serviceRequest,
} from './service'
import { currentAdmin, type CurrentAdmin } from './session'

/**
 * The shared spine of every mutation route.
 *
 * ONE PLACE THAT ORDERS THE STEPS, because the order is the security property
 * and getting it right once beats getting it right in each of eight routes:
 *
 *   authenticate → re-check Discord → validate → record intent → act →
 *   record outcome
 *
 * ═══ THERE IS NO SCOPE STEP ANY MORE, AND DISCORD IS NOW THE WHOLE OF IT ═══
 *
 * `requireScope(admin.license, scope)` used to sit between authentication and
 * the Discord re-check, reading a `scopes` array out of DynamoDB. Scopes are
 * gone (see lib/grants.ts for why), so authorisation is exactly one question,
 * asked live at the moment of action:
 *
 *   DOES THIS ACCOUNT HOLD THE DISCORD ADMIN ROLE, RIGHT NOW?
 *
 * Nothing in DynamoDB takes part in that decision. The session proves who is
 * asking; Discord decides whether they may.
 *
 * AUTHENTICATION STILL COMES BEFORE VALIDATION, for the reason it always did: a
 * stranger should not be able to learn what the endpoint accepts, and a 400
 * saying "reason must be at least 3 characters" is a free schema oracle for
 * someone with no business calling it. It also means a stranger cannot make this
 * console call Discord by POSTing at it.
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
 * Listing and viewing are reads even when they are expensive and even when the
 * thing they list is dangerous; `/api/host/branches` is the case that looks
 * ambiguous and is not, because a `git fetch` on the game box changes nothing a
 * player or a moderator can observe.
 */
export type ActionIntent = 'read' | 'write'

/**
 * What this request is called, for the operator log and the audit row.
 *
 * A PLAIN STRING, AND IT AUTHORISES NOTHING. This argument used to be a
 * `Scope` — one of nine values, checked against a DynamoDB row before the
 * request was allowed to proceed. Scopes are gone (lib/grants.ts), and what is
 * left in its place is a LABEL: `discordGate` puts it in the `discord.revoked`
 * and `discord.unresolved` audit rows and in the operator log, so "which write
 * was refused when that admin's role vanished" stays an answerable question.
 *
 * DELIBERATELY NOT A UNION TYPE, and that is a safeguard rather than laziness.
 * A closed set of strings sitting in front of every mutation route is a
 * permission system with the checking temporarily removed, and it would take
 * one plausible-looking commit to wire it back up. A free string cannot be
 * mistaken for a capability by anybody reading it.
 */
export type ActionLabel = string

/**
 * Authenticate, re-check Discord on writes, and hand back the acting admin.
 *
 * Throws {@link ActionError} with the right status for each failure, so a
 * route handler maps one error type rather than branching.
 */
export async function authorize(
  action: ActionLabel,
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

  /**
   * AND THAT IS THE WHOLE OF AUTHORISATION FOR A READ. A valid, non-idle
   * session belongs to somebody who held the Discord admin role when they
   * signed in; there is no second thing to consult, and no DynamoDB row that
   * could say otherwise. A write goes on to ask Discord again, below.
   */
  const actor: audit.Actor = {
    license: admin.license,
    name: admin.name,
    discordId: admin.discordId,
  }

  if (intent === 'write') {
    await discordGate(action, actor)
  }

  return { admin, actor }
}

/**
 * What a write route gets, whichever door the request came through.
 *
 * NO `admin` FIELD, AND ITS ABSENCE IS THE POINT. `ActionContext.admin` is a
 * `CurrentAdmin` — a live session, an avatar, a grants row — and a machine
 * caller has none of those. A route that genuinely needs the signed-in person
 * rather than the acting one keeps calling {@link authorize} and gets the wider
 * object; a route offered through the service credential cannot accidentally
 * reach for a session that is not there, because `tsc` does not know of one.
 */
export interface WriteContext {
  actor: audit.Actor
}

/**
 * Authorise a write from EITHER door: the signed-in admin, or the named machine
 * caller in lib/service.ts.
 *
 * ONE BRANCH, IN ONE PLACE, for the reason every other choke point in this file
 * exists: three routes each writing their own version of "is this the bot or a
 * person" is three chances to get it wrong, and this repository has shipped the
 * same one-line omission across five routes before now.
 *
 * THE HEADER PICKS THE DOOR AND OPENS NOTHING. Presenting
 * `x-ringmaster-service` only means the request is judged as a service call —
 * where it then needs the secret, an allowlisted path, and a named human who
 * holds the Discord admin role right now. A browser cannot reach that path by
 * adding a header, and adding one does not weaken the session path either: the
 * two are exclusive, and neither is consulted twice.
 *
 * WHAT IT DOES NOT DO IS AS IMPORTANT AS WHAT IT DOES. It authorises the
 * CALLER. Every check the route makes afterwards — `nothingToDeploy`, the
 * already-scheduled guard, "that license is already banned", the closed-case
 * refusals — runs exactly as it did, because none of them is here.
 *
 * ONLY THE THREE ROUTES IN `SERVICE_ROUTES` MAY CALL THIS, and `serviceGate`
 * refuses on the path rather than trusting the import: wiring this into a
 * fourth route gets a 403, not a fourth entrance. `service.check.ts` asserts
 * that the routes calling this and the paths on that list are the same set, in
 * both directions.
 */
export async function authorizeWrite(
  action: ActionLabel,
  req: Request,
): Promise<WriteContext> {
  if (!isServiceCall(req)) return await authorize(action, 'write')

  const verdict = await serviceGate(serviceRequest(action, req), serviceDeps())

  /**
   * A MACHINE CODE RATHER THAN A SENTENCE, and no `code` field. `ActionError`'s
   * message is written for an admin reading a dialog; this one is read by the
   * bot, which turns it into words in Discord. The `code` slot stays empty
   * because it exists for the browser client's own branching (see lib/api.ts),
   * and there is no browser on this path.
   */
  if (!verdict.ok) throw new ActionError(verdict.error, verdict.status)

  return { actor: verdict.actor }
}

/**
 * Ask Discord whether this admin still holds the role, and act on the answer.
 *
 * THIS IS NOW THE ONLY AUTHORISATION IN THE CONSOLE, rather than a second
 * opinion on top of one. It used to run after a DynamoDB grant check had
 * already passed, and lib/discordRole.ts argued its fail-open behaviour from
 * exactly that — so that argument has been rewritten there rather than left
 * standing on a backstop which no longer exists.
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
async function discordGate(
  action: ActionLabel,
  actor: audit.Actor,
): Promise<void> {
  const jar = await cookies()

  try {
    await enforceDiscordAdmin({
      discordId: actor.discordId,
      actor,
      action,
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
