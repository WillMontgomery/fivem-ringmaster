import type { Actor, AuditHandle, AuditOutcome, AuditRow } from './audit'
import { env } from './env'
import type { AdminRole } from './profile'
import { REVOKED_MESSAGE } from './revocation'

/**
 * Discord as a live second opinion on every write.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT. It is not the authorisation check. That is `lib/grants.ts`,
 * keyed on license, read fresh from DynamoDB on every single call — a grant
 * revoked in the table stops working on the next request with no help from this
 * file. That half already worked and was not touched.
 *
 * WHAT IT IS. Ringmaster's grants are independent of Discord, so somebody
 * kicked from the Discord server — or merely stripped of the admin role there —
 * kept a working console until a human remembered to revoke their row by hand.
 * Discord is where admin status is actually decided in this project, and this
 * asks it, at the point of action, before anything changes.
 *
 * ONLY ON WRITES. `authorize()` takes an explicit `read` / `write` intent and
 * only the second reaches this file. Reads are a different risk: the cost of a
 * revoked admin reading the moderation board for another thirty seconds is
 * approximately nothing, and putting a Discord round trip in front of every
 * page render and every two-second poll would be both slow and, at poll rates,
 * a genuine rate-limit problem.
 *
 * NOT CACHED, AT ALL. The owner's requirement is "every time", and writes are
 * measured in tens per day against a global ceiling of fifty requests per
 * second, so there is nothing to save. A cache here would be worse than
 * pointless: the whole value of the check is that it is current, and a TTL is
 * exactly a window in which a removed admin still works.
 */

/**
 * How long a write will wait for Discord before going ahead without it.
 *
 * THE OWNER'S NUMBER AND THE OWNER'S REASONING: "let's defer the action until
 * the Discord API comes back, or proceed after 5 seconds if we still have no
 * response". The write is submitted behind a spinner that is already on screen
 * — every write path in the console has one — so a slow Discord costs the admin
 * a longer spinner and nothing else. It does not race ahead and it does not
 * skip the check because Discord is merely slow.
 *
 * A SEPARATE CONSTANT FROM `DISCORD_TIMEOUT_MS` IN lib/discord.ts THOUGH THEY
 * ARE THE SAME NUMBER TODAY. That one is how long a profile page waits for an
 * avatar; this one is how long a ban waits for permission to exist. They happen
 * to agree, they answer different questions, and either must be free to move
 * without dragging the other with it.
 */
export const ROLE_CHECK_TIMEOUT_MS = 5_000

/**
 * Discord's JSON error codes, which are the whole reason a 404 is not simply
 * read as "not a member".
 *
 * THIS DISTINCTION IS THE MOST DANGEROUS DETAIL IN THE FILE. `GET
 * /guilds/{guild}/members/{user}` answers 404 for BOTH "that user is not in
 * this guild" (10007) and "I cannot see that guild at all" (10004) — which is
 * what a wrong `DISCORD_GUILD_ID`, or a bot that has been removed from the
 * server, looks like. Reading the second as the first would sign out every
 * admin in the console, simultaneously, on their next action, and tell each of
 * them their role had been removed. So only 10007 is a denial; every other 404
 * is our problem and fails open.
 */
const ERR_UNKNOWN_MEMBER = 10007

/**
 * The answer, in the only three shapes that matter.
 *
 * `revoked` IS RESERVED FOR A DEFINITIVE NEGATIVE — Discord answered, and the
 * answer was no. Everything else in the world (no token, a timeout, a 429, a
 * 500, a body that does not parse, a guild we cannot see) is `unresolved`, and
 * `unresolved` never denies anything. See `enforceDiscordAdmin` for why.
 */
export type RoleCheck =
  | { state: 'held' }
  | { state: 'revoked'; why: RevokedWhy }
  | { state: 'unresolved'; why: string }

export type RevokedWhy = 'not-a-member' | 'role-removed'

/**
 * The one `unresolved` reason that is a CONFIGURATION STATE rather than an
 * EVENT, and therefore the one that must not write an audit row.
 *
 * A CONSTANT RATHER THAN A SENTENCE MATCHED WITH `.includes()`, which is what
 * this was first. The gate has to tell "nobody pasted a bot token" apart from
 * "Discord fell over", and doing that by substring means the two ends can drift
 * with nothing failing: reword the message and every ban on an unconfigured
 * console starts writing a `discord.unresolved` row, forever, until somebody
 * notices the audit log is twice as long as it should be. Comparing identity
 * makes that impossible and makes the coupling visible.
 */
export const NO_TOKEN_REASON =
  'DISCORD_BOT_TOKEN is not set, so the Discord role re-check is disabled'

/** The refusal `enforceDiscordAdmin` throws. Mapped to a 403 by lib/actions. */
export class RoleRevokedError extends Error {
  constructor(public readonly why: RevokedWhy) {
    super(REVOKED_MESSAGE)
    this.name = 'RoleRevokedError'
  }
}

/**
 * Turn one HTTP answer into a verdict. Pure, and separated from the fetch so
 * that every branch below can be tested without a network — see
 * `discordRole.check.ts`, which walks all of them.
 */
export function readMemberResponse(
  status: number,
  body: unknown,
  adminRoleId: string,
): RoleCheck {
  if (status === 200) {
    const roles = (body as { roles?: unknown } | null)?.roles
    if (!Array.isArray(roles)) {
      // A 200 whose body we cannot read is not evidence about the person. It is
      // evidence that something changed at Discord or in front of it.
      return { state: 'unresolved', why: 'member payload had no roles array' }
    }
    return roles.includes(adminRoleId)
      ? { state: 'held' }
      : { state: 'revoked', why: 'role-removed' }
  }

  if (status === 404) {
    const code = (body as { code?: unknown } | null)?.code
    if (code === ERR_UNKNOWN_MEMBER) {
      return { state: 'revoked', why: 'not-a-member' }
    }
    // 10004 (unknown guild), a bot removed from the server, a mistyped guild
    // id, or a 404 with no code at all. All of those are about US.
    return {
      state: 'unresolved',
      why: `Discord answered 404 with code ${String(code ?? 'none')} — that is about this bot's access, not about the admin`,
    }
  }

  // 401 (bad token), 403 (missing access), 429 (rate limited), 5xx, and
  // anything else Discord invents later. None of them is a statement about
  // whether this person holds the role.
  return { state: 'unresolved', why: `Discord answered ${status}` }
}

/**
 * Ask Discord whether one account still holds the configured admin role.
 *
 * THE ENDPOINT IS `GET /guilds/{guild.id}/members/{user.id}`, which returns the
 * member object with its `roles` array of role ids, and which — unlike LIST
 * Guild Members — needs no privileged intent. Membership comes free with it:
 * a non-member is a 404, so one call answers both halves of the question. This
 * is the same pair of facts the sign-in gate in `auth.ts` establishes, asked
 * again at the point of action rather than once at the door.
 *
 * IT USES THE BOT TOKEN, NOT THE ADMIN'S OAUTH TOKEN, and that choice matters.
 * `GET /users/@me/guilds/{guild}/member` with the stored `access_token` would
 * work and would need no bot in the guild — but Discord access tokens expire in
 * about a week and nothing here refreshes them, so past that point every check
 * would 401, resolve to `unresolved`, and fail open forever. A check that
 * silently stops checking is worse than no check, because everything downstream
 * is written as though it were running.
 *
 * THIS IS A NEW REQUIREMENT ON THE BOT AND IT IS WRITTEN DOWN IN .env.example:
 * the token was previously used only for `GET /users/{id}`, which works from
 * outside the server. This endpoint needs the bot to be a member of the guild.
 * It still needs no privileged intents and still cannot read messages.
 *
 * RATE LIMITS. Discord publishes no number for this route on purpose — per-route
 * buckets are dynamic and announced in `X-RateLimit-*` headers — and the only
 * documented hard figure is the global fifty requests per second per bot. Write
 * actions in this console are bans, kicks, resolutions and deploys: tens per
 * day. One uncached call per write is four or five orders of magnitude inside
 * the ceiling, so there is no backoff logic here and no bucket accounting. If
 * that ever stops being true, a 429 already lands in `unresolved` and fails
 * open loudly rather than locking anybody out.
 *
 * NEVER THROWS, AND NEVER LOGS THE TOKEN.
 */
export async function checkAdminRole(
  discordId: string,
  timeoutMs: number = ROLE_CHECK_TIMEOUT_MS,
): Promise<RoleCheck> {
  const cfg = env()

  const token = cfg.DISCORD_BOT_TOKEN
  if (!token) {
    return { state: 'unresolved', why: NO_TOKEN_REASON }
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(cfg.DISCORD_GUILD_ID)}/members/${encodeURIComponent(discordId)}`,
      {
        headers: { Authorization: `Bot ${token}` },
        // Next's data cache has rules about freshness that have nothing to do
        // with when somebody's role was taken away, and a cached "yes" is the
        // one answer this whole file exists to avoid.
        cache: 'no-store',
        // `AbortSignal.timeout` rather than a race against a sleeping promise:
        // it actually cancels the request, so a Discord outage does not leave a
        // hanging socket per write behind a request that has already answered.
        signal: AbortSignal.timeout(timeoutMs),
      },
    )

    // Read as text first. A proxy or an error page in front of Discord answers
    // with HTML, and `res.json()` on that throws a parse error that says
    // nothing about what happened.
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }

    return readMemberResponse(res.status, body, cfg.DISCORD_ADMIN_ROLE_ID)
  } catch (e) {
    // Includes the TimeoutError the abort raises, DNS failures and connection
    // resets. The message is safe to keep — it is about the transport — but the
    // token must never appear in it, which is why nothing here echoes headers.
    const why =
      e instanceof Error && e.name === 'TimeoutError'
        ? `Discord did not answer within ${timeoutMs}ms`
        : `could not reach Discord: ${e instanceof Error ? e.message : String(e)}`
    return { state: 'unresolved', why }
  }
}

/**
 * The same verdict, as the thing a PAGE can draw. See {@link AdminRole}.
 *
 * ═══ WHY THE READ PATH GOES THROUGH THIS FILE AND NOT A SECOND CHECK ═══
 *
 * The owner: "if the person is an admin (meaning they have the discord role)".
 * That is this file's question, already asked once before every write, and there
 * must not be a second notion of "is an admin" living on a profile page — a
 * console where the chip and the gate can disagree about the same person is
 * worse than one with no chip. So the profile page calls `checkAdminRole` and
 * maps its answer here.
 *
 * THE MAPPING IS NOT AN IDENTITY, AND THE INTERESTING LINE IS THE LAST ONE.
 * `unresolved` is a single state to the GATE, which fails open on all of it and
 * says so in the log. To a READER it is two different things:
 *
 *   no bot token   this console cannot answer the question about anybody, ever,
 *                  until somebody pastes a token. A state, not an event — the
 *                  same distinction that keeps this case out of the audit log
 *                  (see `unresolved` below). Rendering "we could not check" on
 *                  every profile forever would be furniture.
 *   anything else  a timeout, a 429, a 5xx, a guild we cannot see. An EVENT, and
 *                  one that must not be shown as a negative: silently dropping
 *                  the chip would tell a moderator this person is not an admin
 *                  on evidence that says nothing about them.
 *
 * PURE, AND DELIBERATELY SEPARATE FROM THE FETCH, so the whole table of answers
 * is reachable without a network — the same arrangement `readMemberResponse`
 * has.
 */
export function adminRoleFrom(check: RoleCheck): AdminRole {
  if (check.state === 'held') return 'yes'
  if (check.state === 'revoked') return 'no'
  return check.why === NO_TOKEN_REASON ? 'unchecked' : 'unknown'
}

/**
 * What the gate needs from the rest of the system, named rather than imported.
 *
 * THE SEAM IS HERE SO THE TESTS CAN DRIVE THE REAL DECISION CODE. Everything
 * below this interface — which verdict denies, what gets recorded, whether the
 * session is torn down, what the caller sees — is the actual shipped logic, and
 * `discordRole.check.ts` exercises it with fakes rather than re-encoding the
 * same assumptions in a second copy. `lib/actions.ts` supplies the real
 * `signOut`, the real `lib/audit`, and the real `checkAdminRole`.
 */
export interface GateDeps {
  /** Ask Discord. */
  check(discordId: string): Promise<RoleCheck>
  /**
   * End the session for real: delete the DynamoDB session RECORD, not merely
   * the cookie. Clearing cookies orphans the row until its TTL, and a session
   * record that still resolves is a session a captured cookie still opens —
   * the same reason the sidebar's sign-out button goes through Auth.js.
   */
  endSession(): Promise<void>
  /** `lib/audit`'s two-phase writer, structurally. */
  audit: {
    begin(input: {
      action: 'discord.revoked' | 'discord.unresolved'
      actor: Actor
      reason?: string | null
      detail?: AuditRow['detail']
    }): Promise<AuditHandle>
    resolve(
      ts: number,
      outcome: Exclude<AuditOutcome, 'pending'>,
      error?: string | null,
    ): Promise<void>
  }
  /** The operator log. Separated so a test can assert loudness. */
  log(level: 'warn' | 'error', message: string): void
}

/**
 * The gate. Runs after the grant check has already passed, before anything is
 * written.
 *
 * ---------------------------------------------------------------------------
 * THE AVAILABILITY DECISION, STATED PLAINLY BECAUSE IT IS A REAL TRADE AND
 * SOMEBODY WILL WANT TO ARGUE WITH IT LATER.
 *
 *   Discord answers "no"           -> DENY. Session ends. Audited.
 *   Discord does not answer at all -> ALLOW. Logged as loudly as a denial.
 *
 * That is fail-OPEN on unreachability and fail-CLOSED only on a definitive
 * negative, and the reasoning is this: the PRIMARY authorisation is the
 * DynamoDB grant, it has already been checked live against the database on this
 * very request, and it passed. This check is defence in depth on top of an
 * authorisation that is already satisfied. Failing closed on a Discord outage
 * would take every moderation tool in the console offline — bans, kicks,
 * incident closure, the maintenance deploy — during exactly the kind of
 * incident where moderation is most needed, and it would do so for a reason
 * unrelated to anybody's actual permissions.
 *
 * The residual risk is stated honestly: an admin removed from Discord during a
 * Discord outage keeps writing until either the outage ends or a human revokes
 * their grant. That is a narrow window, it requires the two events to coincide,
 * and the grant revoke — which is immediate and does not depend on Discord at
 * all — remains available throughout it.
 *
 * WHICH IS WHY THE UNRESOLVED CASE IS AS LOUD AS THE DENIAL. A fail-open that
 * nobody can see afterwards is indistinguishable from a check that was never
 * running, and this repository has shipped that exact thing before. So an
 * outage leaves an audit row per write saying the check did not resolve, and
 * "was the Discord check actually up when this ban was issued" is a question
 * the log can answer.
 * ---------------------------------------------------------------------------
 *
 * @throws {RoleRevokedError} on a definitive negative, after ending the session.
 */
export async function enforceDiscordAdmin(input: {
  /** Null when the session never resolved to a Discord account. */
  discordId: string | null
  actor: Actor
  /** The scope the write asked for. Recorded, never used to decide. */
  scope: string
  deps: GateDeps
}): Promise<RoleCheck> {
  const { discordId, actor, scope, deps } = input

  /**
   * NO DISCORD ID IS NOT A DENIAL, and it is not silence either.
   *
   * `currentAdmin()` returns a null `discordId` only when the Auth.js account
   * record cannot be read — a session that authenticated through Discord always
   * has one. There is nobody to ask about, so there is no answer, so this is
   * `unresolved` by the same rule as a timeout: we did not learn that they lack
   * the role, we failed to find out.
   */
  if (!discordId) {
    return await unresolved(
      { state: 'unresolved', why: 'the session carries no Discord account id' },
      actor,
      scope,
      deps,
    )
  }

  const verdict = await deps.check(discordId)

  if (verdict.state === 'held') return verdict
  if (verdict.state === 'unresolved') {
    return await unresolved(verdict, actor, scope, deps)
  }

  /**
   * A definitive no. Three things happen, in this order, and the order is the
   * point: record the intent, end the session, stamp the outcome. A row that
   * stays `pending` or lands on `failed` means we detected a revoked admin and
   * could NOT sign them out, which is the alarming case and has to be
   * distinguishable from the ordinary one.
   */
  deps.log(
    'error',
    `[discord-role] REFUSED a \`${scope}\` write: ${actor.name} (${actor.license ?? 'no license'}) ` +
      `${verdict.why === 'not-a-member' ? 'is no longer in the Discord server' : 'no longer holds the Discord admin role'}. Session ended.`,
  )

  try {
    const { ts } = await deps.audit.begin({
      action: 'discord.revoked',
      actor,
      reason:
        verdict.why === 'not-a-member'
          ? 'No longer a member of the Discord server'
          : 'Discord admin role removed',
      detail: { scope, why: verdict.why },
    })

    try {
      await deps.endSession()
      await deps.audit.resolve(ts, 'ok')
    } catch (e) {
      await deps.audit.resolve(
        ts,
        'failed',
        e instanceof Error ? e.message : String(e),
      )
      deps.log(
        'error',
        `[discord-role] could not end the session of a revoked admin: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  } catch (e) {
    /**
     * The audit write itself failed. THE REFUSAL STILL STANDS — this is the one
     * direction where losing the record must not lose the control. `lib/audit`
     * says an action must not proceed if its intent row cannot be written, and
     * that rule is about actions; refusing is not an action, and a DynamoDB
     * fault is not a reason to let a revoked admin ban somebody.
     */
    deps.log(
      'error',
      `[discord-role] could not record a revocation: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  throw new RoleRevokedError(verdict.why)
}

/**
 * Discord did not answer. Allow, and make sure somebody can find out later.
 *
 * TWO DIFFERENT SITUATIONS, DELIBERATELY LOGGED DIFFERENTLY. A missing bot
 * token is a CONFIGURATION state, not an event: it is true of every write
 * forever until somebody pastes a token, and one audit row per ban for the rest
 * of time would bury the log it is supposed to protect. It gets a warning on
 * every write and nothing in the table. Anything else — a timeout, a 429, a
 * 500, a guild we cannot see — is an EVENT, and gets a row.
 */
async function unresolved(
  verdict: RoleCheck & { state: 'unresolved' },
  actor: Actor,
  scope: string,
  deps: GateDeps,
): Promise<RoleCheck> {
  const unconfigured = verdict.why === NO_TOKEN_REASON

  deps.log(
    unconfigured ? 'warn' : 'error',
    `[discord-role] a \`${scope}\` write by ${actor.name} (${actor.license ?? 'no license'}) ` +
      `proceeded WITHOUT a Discord role re-check: ${verdict.why}`,
  )

  if (unconfigured) return verdict

  try {
    const { ts } = await deps.audit.begin({
      action: 'discord.unresolved',
      actor,
      reason: verdict.why,
      detail: { scope, allowed: true },
    })
    await deps.audit.resolve(ts, 'ok')
  } catch (e) {
    /**
     * SWALLOWED, AND THIS IS THE ONE PLACE THAT IS RIGHT. The write is being
     * allowed; turning a bookkeeping failure into a refusal here would be
     * fail-closed by accident, arrived at through an error path nobody chose.
     */
    deps.log(
      'error',
      `[discord-role] could not record an unresolved check: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  return verdict
}
