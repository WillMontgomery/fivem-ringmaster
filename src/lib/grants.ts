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

/**
 * What resolving an admin to a license needs, named rather than imported.
 *
 * THE SEAM IS HERE SO THE CHECK CAN DRIVE THE REAL DECISION, the same reason
 * `GateDeps` exists in lib/discordRole.ts. `lib/session.ts` supplies the real
 * `grantsForDiscordId`, the real `players.licensesFor` and the real console.
 * `grants.check.ts` supplies fakes, and both run the code below rather than two
 * copies of the same rules.
 */
export interface LicenseLookup {
  /** The hand-written link row, by Discord id. {@link grantsForDiscordId}. */
  granted(discordId: string): Promise<Grant | null>
  /**
   * Licenses the GAME has seen present a qualified identifier —
   * `players.licensesFor`, over the reverse index `recordConnect` maintains.
   */
  seen(qualifiedId: string): Promise<string[]>
  /** The operator log. Separated so the check can assert loudness. */
  log(level: 'warn' | 'error', message: string): void
}

/**
 * The acting admin's own license: the hand-written row first, what the game
 * actually saw second.
 *
 * ═══ WHY THE SECOND SOURCE HAD TO BE ADDED ═══
 *
 * `grantsForDiscordId` was the ONLY source of `actorLicense`, and until 4078d47
 * that was self-correcting: the same row carried the scopes, `authorize()` ran
 * `requireScope(admin.license, scope)`, and `can()` returns false for a null
 * license — so an admin without a row was refused on every route, reads
 * included. A null `actorLicense` on a human's audit row was UNREACHABLE.
 *
 * 4078d47 removed that gate and made the row optional. It did not make it
 * unnecessary: the row is still the only thing that names the acting admin's
 * license, and it is still written BY HAND (`scripts/grant.mjs`,
 * docs/aws-setup.md). So an admin who was made an admin the new way — given the
 * Discord role and nothing else — acts with full authority and signs every row
 * `actorLicense: null`. That is not cosmetic: `audit.forPlayer` answers "what
 * has this admin done" with `actorLicense === license`, so their own actions are
 * invisible on their own profile, and their name is unlinked wherever a row is
 * rendered.
 *
 * THE GAME ALREADY KNOWS THE ANSWER. `players.recordConnect` writes
 * `discord:<id> -> [license]` into the reverse index on every connect, which is
 * precisely the link src/auth.ts describes as existing "only because a player
 * connected to the game server once with Discord integration enabled". Reading
 * it here costs one GetItem and only for admins who have no row at all.
 *
 * ═══ THE HAND-WRITTEN ROW STILL WINS ═══
 *
 * It is an assertion by a human about which character is theirs; the index is an
 * observation. When they disagree the assertion is the one somebody chose, and
 * it is also the only source that can exist for an admin who has never connected
 * with Discord integration on — the chicken-and-egg `grant.mjs` was written for.
 *
 * ═══ AND AMBIGUITY RESOLVES TO NULL, DELIBERATELY ═══
 *
 * Several licenses behind one Discord account is exactly the state
 * `recordConnect` raises as a mismatch for a human to judge — a reinstall, a
 * shared console, or somebody evading a ban. Guessing which of them acted would
 * stamp a moderation record with a license nobody asserted. A missing
 * attribution is a gap; a wrong one is a false record, and this log is read to
 * decide what happened. Null, and the operator log says why.
 *
 * NEVER THROWS ON THE SECOND SOURCE. `currentAdmin()` runs on every page render,
 * so a reverse-index read that fails must cost attribution rather than the
 * console. The FIRST source is left to throw as it always has — a missing
 * `discordId-index` is a broken deployment and docs/aws-setup.md says so.
 */
export async function licenseForDiscordId(
  discordId: string,
  deps: LicenseLookup,
): Promise<{ license: string | null; grant: Grant | null }> {
  const grant = await deps.granted(discordId)
  if (grant?.license) return { license: grant.license, grant }

  let seen: string[]
  try {
    seen = await deps.seen(`discord:${discordId}`)
  } catch (e) {
    deps.log(
      'error',
      `[session] could not read the identifier index for discord:${discordId}; ` +
        `this admin's actions will be recorded without a license: ${
          e instanceof Error ? e.message : String(e)
        }`,
    )
    return { license: null, grant }
  }

  // De-duplicated because the index appends per license, and one human
  // reconnecting is one license however many times it is listed.
  const distinct = [...new Set(seen.filter((l) => typeof l === 'string' && l))]

  const only = distinct.length === 1 ? distinct[0] : undefined
  if (only) return { license: only, grant }

  if (distinct.length > 1) {
    deps.log(
      'warn',
      `[session] discord:${discordId} has presented ${distinct.length} licenses ` +
        `(${distinct.join(', ')}); refusing to guess which one is acting, so ` +
        `their audit rows carry no license. Settle it with scripts/grant.mjs.`,
    )
  }

  return { license: null, grant }
}
