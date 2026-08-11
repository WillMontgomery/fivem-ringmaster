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
 * Look up grants by Discord id — the login-time direction.
 *
 * The table is keyed by license because every ban, audit row and game-side
 * record is; Discord id is a plain attribute with a GSI over it
 * (`discordId-index`, provisioned in docs/aws-setup.md). Login only knows the
 * Discord id, so this is the bridge every session crosses exactly once.
 *
 * Takes the FIRST match if several rows carry the same discordId. That state
 * is a data-entry error — one human, one license, one row — and picking
 * deterministically beats refusing to log the person in over it.
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
 * Does this admin hold this scope?
 *
 * CALL THIS AT THE POINT OF ACTION, in every route that changes anything —
 * not once at login, and not only where the UI decides whether to draw a
 * button. Hiding a button is a courtesy; this is the boundary. Same principle
 * the whole gamemode runs on: the client asks, the server decides.
 *
 * This is the whole check, and that is a deliberate change from an earlier
 * design. That design had `br_ringmaster` re-check independently on arrival,
 * because RCON carried no notion of *which* admin sent a command. RCON is gone
 * (see the README), and the only writer to its replacement — SSH forced-command
 * → supervisor → FXServer stdin — is the supervisor itself. Anyone able to put
 * bytes on that channel already has console authority on the game box, so a
 * second check there would guard nothing. The acting admin's license still
 * travels with every command, as an audit field, never as an authorisation
 * input.
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
 * Thrown by {@link requireScope}. Distinct from a generic Error so a route
 * handler can map it to a 403 without string-matching a message.
 */
export class ForbiddenError extends Error {
  constructor(public readonly scope: Scope) {
    super(`forbidden: ${scope}`)
    this.name = 'ForbiddenError'
  }
}

/**
 * Throwing form, for route handlers.
 *
 * Named `requireScope` rather than `require`: the latter shadows CommonJS's
 * global in any file that imports it, which is a genuinely confusing thing to
 * do to the next person reading a stack trace.
 *
 * Deliberately does not say whether the license was unknown or merely lacked
 * the scope. That distinction is useful to an attacker enumerating admins and
 * useless to a legitimate one, who already knows which they are.
 */
export async function requireScope(
  license: string | null | undefined,
  scope: Scope,
): Promise<void> {
  if (!(await can(license, scope))) {
    throw new ForbiddenError(scope)
  }
}
