import { ddb, tables } from './dynamo'

/**
 * The Discord → license link. NOT a permission record.
 *
 * ═══ THERE ARE NO PERMISSION LEVELS IN THIS CONSOLE ═══
 *
 * This file used to define nine scopes — view, kick, ban, moderate, spectate,
 * notify, config, grant, process — and the `can()` / `requireScope()` pair that
 * gated every route on them. All of it is gone. ANYONE WHO CAN LOG IN IS A FULL
 * ADMIN, and the login gate is the whole authorisation model:
 *
 *   `auth.ts`         the Discord admin role, checked at sign-in
 *   `discordRole.ts`  the same role, re-checked live before every write
 *
 * WHY IT WENT, stated plainly so nobody rebuilds it by accident: the scopes
 * could not be granted. There was no scopes UI and there never was one — the
 * only way to give somebody `ban` was to hand-edit a DynamoDB item, which the
 * owner does not do. So in practice every account had whatever its row happened
 * to be seeded with, forever, and the granularity bought nothing but greyed
 * buttons and sentences telling admins to acquire something unacquirable. That
 * argument had already retired the `spectate` scope on its own (dba5a6a); this
 * is the same reasoning applied to the remaining eight.
 *
 * A GRANULAR CHECK WITH NO GRANT PATH IS NOT CAUTION, IT IS A BROKEN FEATURE.
 * If levels are ever wanted again, they go back WITH the UI that issues them,
 * not before it.
 *
 * ═══ SO WHY DOES THIS FILE STILL EXIST ═══
 *
 * Because the row was doing a second job all along, and that job is not a
 * permission. Discord tells us WHO logged in; every ban, audit row and
 * game-side record keys on the game LICENSE. This table is the only bridge
 * between the two, and two things still genuinely need it:
 *
 *   audit attribution   `actorLicense` on every row in the audit table
 *   /api/spectate       whose camera to move — the admin needs a body in the
 *                       world, and that body is found by license
 *
 * A SIGNED-IN ADMIN WITH NO ROW IS NORMAL AND FULLY PRIVILEGED. They get a null
 * license, their audit rows say so, and Spectate refuses them for a reason that
 * is about physics rather than permission — there is no character on the server
 * to look through. Nothing else about the console is diminished.
 *
 * The table keeps its name (`grants`, see docs/aws-setup.md) because renaming a
 * live DynamoDB table to improve a noun is not worth an outage.
 */

/**
 * One admin's link row.
 *
 * `scopes` USED TO BE A FIELD HERE. Existing rows in DynamoDB still carry the
 * attribute — nothing reads it, and an unread attribute costs nothing but a few
 * bytes, so there is no migration to run. Should anyone ever want the table
 * tidied, deleting the attribute is safe precisely because no code path looks
 * at it.
 */
export interface Grant {
  license: string
  discordId?: string
  note?: string
  grantedBy?: string
  grantedAt?: number
}

/**
 * Look up an admin's license by Discord id — the login-time direction, and now
 * the only direction.
 *
 * The table is keyed by license because every ban, audit row and game-side
 * record is; Discord id is a plain attribute with a GSI over it
 * (`discordId-index`, provisioned in docs/aws-setup.md). Login only knows the
 * Discord id, so this is the bridge every session crosses exactly once.
 *
 * `grantsFor(license)` — THE OTHER DIRECTION — WAS DELETED WITH THE SCOPES. Its
 * only caller was `can()`, which asked "does this license hold this scope?".
 * Nothing asks that any more, and a lookup with no callers is the exact kind of
 * scaffolding this repository keeps shipping by mistake.
 *
 * Takes the FIRST match if several rows carry the same discordId. That state
 * is a data-entry error — one human, one license, one row — and picking
 * deterministically beats refusing to log the person in over it.
 *
 * Returns null for an unknown Discord id. That is not an error and it is no
 * longer even a restriction: it means we could not resolve this admin to a
 * character in the game, not that they may do less.
 */
export async function grantsForDiscordId(
  discordId: string,
): Promise<Grant | null> {
  const res = await ddb.query({
    TableName: tables.grants,
    IndexName: 'discordId-index',
    KeyConditionExpression: 'discordId = :d',
    ExpressionAttributeValues: { ':d': discordId },
    Limit: 1,
  })

  return (res.Items?.[0] as Grant | undefined) ?? null
}
