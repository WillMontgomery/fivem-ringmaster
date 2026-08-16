import { cookies } from 'next/headers'
import { z } from 'zod'

import * as audit from './audit'
import { ForbiddenError, requireScope, type Scope } from './grants'
import { isIdle } from './activity'
import { IDLE_ERROR_CODE } from './idle'
import { currentAdmin, type CurrentAdmin } from './session'

/**
 * The shared spine of every mutation route.
 *
 * ONE PLACE THAT ORDERS THE STEPS, because the order is the security property
 * and getting it right once beats getting it right in each of eight routes:
 *
 *   authenticate → authorise → validate → record intent → act → record outcome
 *
 * Authorisation before validation is deliberate. A caller without the scope
 * should not be able to learn anything about what the endpoint accepts — a
 * 400 that says "reason must be at least 3 characters" is a free schema oracle
 * for someone who has no business calling it at all.
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
 * Authenticate, authorise, and hand back the acting admin.
 *
 * Throws {@link ActionError} with the right status for each failure, so a
 * route handler maps one error type rather than branching.
 */
export async function authorize(scope: Scope): Promise<ActionContext> {
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

  return {
    admin,
    actor: {
      license: admin.license,
      name: admin.name,
      discordId: admin.discordId,
    },
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
