import { ddb, tables } from './dynamo'

/**
 * Permission scopes.
 *
 * Scoped, not a single admin bit: a moderator who can kick must not be able to
 * grant themselves the ability to ban. `process` is separate from `config`
 * because it is strictly more dangerous — a bad config edit degrades a match,
 * a bad process action ends one for everyone on the box.
 */
export const SCOPES = [
  'view',      // read player data, history, incidents
  'kick',      // remove a player from the server
  'ban',       // issue and lift bans
  'moderate',  // trigger loot drops and game events
  'spectate',  // watch a live player, across matches
  'notify',    // send server-wide notifications
  'config',    // edit hot-reloadable config values
  'grant',     // grant and revoke scopes — the one that makes admins
  'process',   // terminate and restart the FXServer process
] as const

export type Scope = (typeof SCOPES)[number]

export interface Grant {
  license: string
  scopes: Scope[]
  discordId?: string
  note?: string
  grantedBy?: string
  grantedAt?: number
}

/**
 * Look up one admin's grants.
 *
 * DynamoDB is the sole authority on permissions. FXServer's own ACE system is
 * never consulted for anything Ringmaster does — the two are separate systems
 * that happen to both mean "admin", and conflating them is how a moderator
 * ends up with console access nobody meant to give them.
 *
 * Returns null for an unknown license. That is not an error: it is the normal
 * answer for every player who is not an admin.
 */
export async function grantsFor(license: string): Promise<Grant | null> {
  const res = await ddb.get({
    TableName: tables.grants,
    Key: { license },
  })

  return (res.Item as Grant | undefined) ?? null
}

/**
 * Does this admin hold this scope?
 *
 * CALL THIS AT THE POINT OF ACTION, in every route that changes anything —
 * not once at login, and not only where the UI decides whether to draw a
 * button. Hiding a button is a courtesy; this is the boundary. Same principle
 * the whole gamemode runs on: the client asks, the server decides.
 *
 * Note this is only Ringmaster's half. `br_ringmaster` re-checks independently
 * when a command arrives, because RCON carries no notion of *which* admin sent
 * it — whoever holds the RCON password can issue anything.
 */
export async function can(
  license: string | null | undefined,
  scope: Scope,
): Promise<boolean> {
  if (!license) return false

  const grant = await grantsFor(license)
  if (!grant) return false

  return Array.isArray(grant.scopes) && grant.scopes.includes(scope)
}

/**
 * Throwing form, for route handlers.
 *
 * Deliberately does not say whether the license was unknown or merely lacked
 * the scope. That distinction is useful to an attacker enumerating admins and
 * useless to a legitimate one, who already knows which they are.
 */
export async function require(
  license: string | null | undefined,
  scope: Scope,
): Promise<void> {
  if (!(await can(license, scope))) {
    throw new Error(`forbidden: ${scope}`)
  }
}
