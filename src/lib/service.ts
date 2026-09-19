import { createHash, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import * as audit from './audit'
import type { Actor } from './audit'
import { consistentBanFor, isActive, type Ban } from './bans'
import { fetchDiscordUser } from './discord'
import {
  checkAdminRole,
  enforceDiscordAdmin,
  RoleRevokedError,
  type RoleCheck,
} from './discordRole'
import { env } from './env'
import { grantsForDiscordId } from './grants'

/**
 * The second door: a named machine caller, holding a shared secret.
 *
 * ═══ WHY THERE IS A SECOND DOOR AT ALL ═══
 *
 * `authorize()` in lib/actions.ts is session-bound end to end — an Auth.js
 * cookie, the idle cookie, and a live Discord role check on the account that
 * cookie belongs to. There is no machine caller anywhere in the console, and
 * `blitz-bot` now has three commands that need one: `/brkick` and `/brban` need
 * the live kick, which is tmux over SSH and only this box can do it, and
 * `/drain` needs `POST /api/maintenance` — and, since it is one command that
 * both starts a window and calls one off, `POST /api/maintenance/cancel` too.
 *
 * `/drain` HAS TO GO THROUGH THE ROUTE, and that is the whole reason this file
 * exists rather than a DynamoDB grant for the bot. `nothingToDeploy` and the
 * already-scheduled guard live in the route and nowhere else, and the
 * maintenance driver advances any `scheduled` row it finds and then really
 * deploys — so a bot writing that row directly would start an unreviewed deploy
 * that no gate had ever looked at.
 *
 * ═══ IT AUTHORISES THE CALLER, NOT THE ACTION ═══
 *
 * This is a second door into the same room. Everything the route checks, the
 * route still checks: `nothingToDeploy`, the already-scheduled guard, the
 * refusal to ban a license that is already banned, the closed-case refusal on
 * both the kick and the ban. Nothing here can wave any of them through, because
 * nothing here runs after them — a gate hands back an {@link Actor} and stops.
 *
 * ═══ ATTRIBUTION IS THE ACTING HUMAN ═══
 *
 * The bot presents the Discord id of the admin who typed the command, and the
 * audit row names THEM: their license, their name, their Discord id. A row
 * saying `blitz-bot` would answer the wrong question — "which process wrote
 * this" is never what anybody asks the audit log, and "who banned them" is.
 * There is no marker on the row saying the request was relayed; the operator
 * log carries that, and the audit table keeps the answer it is asked for.
 *
 * ═══ AND THE NAMED HUMAN GOES THROUGH THE SAME ROLE GATE AS ANY OTHER WRITER ═══
 *
 * Without that, the actor header would be an unverified claim: whoever holds
 * this secret could pin a ban on any Discord id they liked. So the id is put to
 * `enforceDiscordAdmin` — LITERALLY THE SAME FUNCTION the session path runs, not
 * a second reading of the same question. The only thing that differs is what it
 * is asked ABOUT: a session gate asks about the account the cookie belongs to,
 * and this asks about the id in the request, because the caller is a bot
 * relaying for a human and there is no session to read one off. Which is also
 * why the request MUST carry that id — see the `actor` refusal below.
 *
 * ═══ THE POLARITY, WHICH IS THE OWNER'S AND IS NOT THE OBVIOUS ONE ═══
 *
 * The owner's words on #42: "endpoint should refuse if no role is present, but
 * fail open as the bot should have already validated this." Those are not two
 * rules in tension; they are the two halves of the one `RoleCheck` already
 * models, and lib/discordRole.ts already implements this exact polarity:
 *
 *   Discord answered, and the answer is no  -> REFUSE. (`revoked`)
 *   Discord did not answer at all           -> ALLOW.  (`unresolved`)
 *
 * `revoked` is a DEFINITIVE negative and nothing else in the world is one. No
 * bot token, a timeout, a 429, a 500, a body that does not parse, a guild this
 * bot cannot see — every one of those is `unresolved`, and `unresolved` never
 * refuses anything, here or on the session path.
 *
 * THIS FILE USED TO FAIL CLOSED ON `unresolved`, and the argument for it read
 * well: nobody has vouched for the named human except the caller, so an
 * unresolved check is not "we lost a second opinion" but "we have no first one".
 * The owner overruled it, and the reason is the half that argument left out —
 * THE BOT HAS ALREADY CHECKED. `blitz-bot` will not relay a command from
 * somebody it does not believe is an admin, so the console's check is the second
 * opinion after all. Set against that, failing closed means every `/brkick` and
 * `/brban` in the guild stops working for the duration of a Discord blip, on a
 * console whose entire job is moderating a live game server — the same trade
 * `enforceDiscordAdmin` weighs at length, coming out the same way.
 *
 * SO THERE IS ONE ANSWER TO "MAY THIS PERSON WRITE", IN ONE FILE, AND BOTH DOORS
 * ASK IT. That is worth more than either polarity on its own: two gates that
 * agree today and are maintained separately are two gates that disagree later,
 * and the direction that drift runs in is nobody's choice.
 *
 * IT IS AS LOUD AS A DENIAL EITHER WAY. `enforceDiscordAdmin` writes a
 * `discord.unresolved` audit row naming the human for every write it lets past
 * an unanswered check, and that now covers bot-relayed writes too — so "was the
 * Discord check actually up when this ban was issued" stays answerable for the
 * `/brban` route exactly as it is for the dialog.
 *
 * ═══ THE ONE THING FAILING OPEN COSTS HERE THAT IT DOES NOT COST THERE ═══
 *
 * Written down because it is the difference the two paths do NOT share, and
 * anybody reasoning from the session path's fail-open will otherwise assume it
 * carries over intact. On that path a fail-open still sits behind a LOGIN:
 * `auth.ts` refuses to sign anybody in while Discord is unreachable, so an
 * unresolved check can only ever let through somebody Discord vouched for
 * recently. There is no login in front of this one. So with `DISCORD_BOT_TOKEN`
 * unset — which is `unresolved` on every call, permanently, rather than for the
 * length of an outage — whoever holds COMMAND_SECRET can name any Discord id
 * they like and have it written onto the row.
 *
 * THAT IS THE STATE THE OWNER RULED FOR AND IT IS SURVIVABLE, because the token
 * is set on this box and because an unset one already disables the role re-check
 * for every admin in the console (lib/discordRole.ts says so, and warns on every
 * write). It is recorded here so that "the bot could ban as anybody" is a
 * consequence somebody CHOSE, findable in the file that chose it, rather than
 * something discovered later and mistaken for an oversight.
 *
 * ═══ AND ONE CALLER THAT IS NOBODY: THE SYSTEM ACTOR ═══
 *
 * Everything above assumes a human pressed something, and since blitz-bot#23
 * one thing is pressed by nobody. A member who offends again during their
 * rapid-offense probation is banned by the bot itself: it bans them in Discord,
 * its own audit mirror writes the permanent game ban straight to DynamoDB, and
 * then it asks this door for the live kick. There is no admin to name. The bot
 * used to name ITSELF, so its own Discord id went through the role gate above,
 * the bot does not hold the admin role, and the kick came back `role-revoked`
 * (owner, 2026-09-19). The ban stood and the player stayed in the match.
 *
 * SO {@link SYSTEM_ACTOR} IS A SECOND KIND OF ACTOR, AND IT IS GIVEN EXACTLY ONE
 * THING. The rule that justifies it, and that every line of `systemGate` is:
 *
 *   A SYSTEM ACTOR MAY ENFORCE A BAN THAT ALREADY EXISTS. IT MAY NEVER CREATE
 *   A PUNISHMENT, AND IT MAY NEVER ACT ON ANYBODY WHO IS NOT ALREADY BANNED.
 *
 * Which comes out as three refusals, in this order:
 *
 *   ONLY {@link SYSTEM_ROUTE}. Not a ban, not a drain, not a cancel. Every other
 *   path this credential opens refuses the marker BY NAME (`system-scope`),
 *   before anything is read, rather than leaving it to fail the snowflake test
 *   by accident.
 *
 *   ONLY A PLAIN KICK OF ONE LICENSE, WITH A REASON (`system-body`). No
 *   `incidentId`, because closing a case is a decision. No missing reason,
 *   because the kick route's default for one says an admin did it.
 *
 *   ONLY SOMEBODY WHOSE BAN IS IN FORCE AT THE MOMENT OF THE CALL
 *   (`not-banned`), read strongly consistent from `ringmaster-bans` so the row
 *   the bot wrote a moment ago is certain to be seen (lib/bans.ts,
 *   `consistentBanFor`). A read that fails is a refusal (`store`), never an
 *   allowance. No row, a served row and a lifted row are all the same answer.
 *
 * NOTHING ABOUT A HUMAN CALL CHANGES. The marker is matched exactly and before
 * the snowflake test, a Discord id can never equal it because ids are digits,
 * and a human is still put to `enforceDiscordAdmin` on every path, a banned
 * target or not. The system branch never reaches the role gate, and the human
 * branch never reads the ban table.
 *
 * THE ROW SAYS `System`, the name this console already writes for work nobody
 * did by hand: lib/incidents.ts writes it on every event without a human, and
 * IncidentDetail carries the owner's ruling on the spelling. Null license, null
 * Discord id. The kick's `reason` is the bot's own rapid-offense reason, so an
 * admin reading `/audit` sees why, in the reason column where every kick keeps
 * its why.
 *
 * ═══ SCOPED, SO WIDENING IT IS A DECISION ═══
 *
 * {@link SERVICE_ROUTES} is a closed list of four exact paths and the gate
 * refuses anything else, whatever the secret says. Wiring `authorizeWrite` into
 * a fifth route does not open it; adding the path here does, in a diff with the
 * word `SERVICE_ROUTES` in it. `service.check.ts` asserts the two halves agree
 * in both directions, by walking the routes on disk rather than by holding a
 * list somebody has to remember to update.
 *
 * THE SYSTEM ACTOR'S SCOPE IS ONE PATH INSIDE THAT ONE, {@link SYSTEM_ROUTE}, and
 * it is a single constant rather than a list on purpose: giving the system a
 * second capability should read as a change to the rule above, not as one more
 * entry in an array.
 *
 * THE LIST GREW ONCE AND THAT IS WHAT IT LOOKS LIKE WHEN IT DOES. `/drain
 * cancel` was refused for as long as this list said three, because #42 wired the
 * routes that were known to need the credential and cancel was not one of them.
 * The fix was this list and one route's `authorize`, which is the whole cost of
 * a deliberate scope — and the reason it is worth the friction.
 */

/**
 * The credential header.
 *
 * NAMED AFTER `COMMAND_SECRET`, WHOSE VALUE IT CARRIES — but the wire name stays
 * `x-ringmaster-service`, and the mismatch is deliberate rather than an
 * oversight. That string is a deployed contract: it is what the bot sends and
 * what docs/deploy.md tells an operator to curl. Renaming a constant costs a
 * diff; renaming a header costs a coordinated release of two services, to make
 * a byte on the wire agree with a variable name nobody reading the wire can see.
 *
 * DELIBERATELY NOT `x-ringmaster-secret`, which is the game box's. Two
 * credentials, two headers, two environment variables: the game host holds a
 * secret that pushes state and mints handoff tokens, and if that secret also
 * opened this door then compromising the game box would mean being able to ban
 * players from it. They are separate so that one leak is one blast radius.
 */
export const COMMAND_SECRET_HEADER = 'x-ringmaster-service'

/**
 * Who the call is made for: the Discord id of the human on whose behalf it is
 * made, or {@link SYSTEM_ACTOR} when nobody pressed anything.
 */
export const SERVICE_ACTOR_HEADER = 'x-ringmaster-actor'

/**
 * The actor a call names when there is no human behind it. See the header.
 *
 * A WORD, SO IT CAN NEVER BE A DISCORD ID. Snowflakes are digits and
 * {@link SNOWFLAKE} accepts nothing else, so no admin's id can collide with
 * this and no value of this can reach the role gate as though it were an admin.
 * Matched EXACTLY: `System`, ` system` and `SYSTEM` are not the marker, and are
 * refused as any other actor that is not a Discord id.
 *
 * A DEPLOYED CONTRACT, LIKE THE HEADER IT TRAVELS IN. blitz-bot sends this
 * string (its src/ringmaster.ts, `SYSTEM_ACTOR`), and changing it on one side
 * turns every automated kick back into a refusal.
 */
export const SYSTEM_ACTOR = 'system'

/** The one path a {@link SYSTEM_ACTOR} call may take. See the header. */
export const SYSTEM_ROUTE = '/api/kick'

/**
 * Who the audit row names for a {@link SYSTEM_ACTOR} call.
 *
 * `System`, WITH THE CAPITAL, because that is how this console already names
 * work nobody did by hand (`byName: 'System'` in lib/incidents.ts). No license
 * and no Discord id, because there is nobody to link to, and a profile link on
 * this row would point at a person who did not do it.
 */
export const SYSTEM_ATTRIBUTION: Readonly<Actor> = {
  license: null,
  name: 'System',
  discordId: null,
}

/**
 * Who holds the credential. One secret, one caller.
 *
 * A CONSTANT RATHER THAN A HEADER THE CALLER SENDS, because with a single
 * secret a name on the wire would be a claim and not proof — decoration that
 * reads like identity. A second machine caller needs a second variable in
 * lib/env.ts, which is a change somebody makes on purpose.
 */
export const SERVICE_CALLER = 'blitz-bot'

/**
 * The only paths this credential opens. Exact matches, never prefixes.
 *
 * `/api/maintenance/cancel` IS HERE AND `/api/maintenance/force` IS NOT, which
 * is precisely why the match is exact rather than a prefix: the two sit under
 * one path and are not one kind of thing. Cancel STOPS a restart; force is the
 * button that skips the drain and restarts the box NOW, and a prefix test would
 * hand the bot the second on the strength of a string it shares with the first.
 *
 * CANCEL IS HERE BECAUSE `/drain` IS ONE COMMAND WITH TWO HALVES. It schedules
 * through `/api/maintenance` and calls off through `/api/maintenance/cancel`,
 * and #42 wired only the first — so the bot could start a window and then had
 * no way to stop one, which is what the console was saying when it answered
 * `Not signed in` to `/drain cancel`. Opening it is exactly as narrow as opening
 * the schedule was: the route's own refusals — no live window, and a deploy
 * already under way — are untouched, because none of them is authorisation.
 *
 * READS ARE NOT ON THIS LIST EITHER, and they are excluded structurally rather
 * than by policy: only the POST handlers of these four routes go through
 * `authorizeWrite`, so `GET /api/bans` and `GET /api/maintenance` stay exactly
 * as session-bound as they were.
 */
export const SERVICE_ROUTES = [
  '/api/bans',
  '/api/kick',
  '/api/maintenance',
  '/api/maintenance/cancel',
] as const

/**
 * A Discord snowflake, in the same shape `/api/handoff/mint` accepts one.
 *
 * COPIED RATHER THAN TIGHTENED. Ids are 17-19 digits today and the format is
 * documented to grow; the mint route has been taking `[0-9]{1,32}` from the
 * game box since #23, and a second, stricter opinion about the same value in
 * the same codebase is a bug waiting for the year the digit count changes.
 */
const SNOWFLAKE = /^[0-9]{1,32}$/

/**
 * What a {@link SYSTEM_ACTOR} kick may carry, and nothing more.
 *
 * STRICT, SO AN UNKNOWN FIELD IS A REFUSAL AND NOT A FIELD THAT IS IGNORED. The
 * one that matters is `incidentId`: the kick route closes the case it names
 * with a `kick` verdict, and a verdict is a decision the system actor may not
 * take. Anything else the route learns to accept later is refused here until
 * somebody decides the system may send it too.
 *
 * `reason` IS REQUIRED, where the route makes it optional. A reasonless kick
 * falls back to the route's own wording, which says an admin did it, and that
 * sentence on a `System` row would be false.
 *
 * THE LICENSE IS TAKEN EXACTLY AS SENT, NOT TRIMMED, and that is what makes the
 * ban this gate reads the same row as the player the route kicks. The route
 * trims before it acts; a value that trimming would change never gets that
 * far, so the two can never be two different strings. The pattern is
 * `licenseSchema`'s in lib/actions.ts, copied because that file imports
 * `@/auth` and cannot be loaded from here, and `service.check.ts` fails if the
 * two stop matching.
 */
const systemKickSchema = z
  .object({
    license: z.string().regex(/^license2?:[0-9a-f]{6,64}$/i),
    reason: z.string().trim().min(1),
    playerName: z.string().nullable().optional(),
  })
  .strict()

export type ServiceLogLevel = 'info' | 'warn' | 'error'

/**
 * What the gate needs from the rest of the system, named rather than imported.
 *
 * THE SEAM IS HERE FOR THE REASON `GateDeps` IN lib/discordRole.ts EXISTS: so
 * `service.check.ts` drives the shipped decision — which refusal, in which
 * order, logged how loudly — with fakes, rather than re-encoding the same
 * assumptions in a second copy that can quietly stop agreeing with this one.
 * Nothing below this interface touches a network or DynamoDB.
 */
export interface ServiceDeps {
  /** The configured credential, or undefined when this door is not wired up. */
  secret(): string | undefined
  /** Their game license, for `actorLicense`. Null is normal — see lib/grants.ts. */
  license(discordId: string): Promise<string | null>
  /** Their name, as Discord spells it today. Null when Discord did not answer. */
  name(discordId: string): Promise<string | null>
  /**
   * THE SESSION PATH'S OWN ROLE GATE, injected rather than reimplemented.
   *
   * Resolves when the write may proceed — `held`, and also `unresolved`, which
   * FAILS OPEN — and throws {@link RoleRevokedError} on a definitive no. That
   * contract is `enforceDiscordAdmin`'s, unchanged, which is the point of
   * naming it here instead of asking Discord again in our own words.
   */
  enforceRole(input: {
    discordId: string
    actor: Actor
    action: string
  }): Promise<RoleCheck>
  /**
   * The ban row on one license, lifted and served ones included, or null when
   * there is none. Asked for a {@link SYSTEM_ACTOR} call and never for a human
   * one. Strongly consistent, see `consistentBanFor`. Throws when the read
   * fails, and the gate refuses on a throw.
   */
  ban(license: string): Promise<Ban | null>
  /** The operator log. Separated so a check can assert loudness. */
  log(level: ServiceLogLevel, message: string): void
}

/** The real ones. */
export function serviceDeps(): ServiceDeps {
  return {
    secret: () => env().COMMAND_SECRET,
    license: async (discordId) =>
      (await grantsForDiscordId(discordId))?.license ?? null,
    name: async (discordId) => {
      /**
       * THE SAME NAME THE SESSION PATH WOULD HAVE PUT ON THE ROW, asked of the
       * same source. `currentAdmin()` reads it off the Auth.js user record,
       * which is the Discord profile as it was at that person's last sign-in;
       * this asks Discord now. Both are "what Discord calls them", and a fresh
       * answer is the better one to write into a permanent record.
       *
       * NOT TAKEN FROM A HEADER. A display name supplied by the caller is text
       * this console cannot check, written into the audit log next to a real
       * license — the one field in an audit row that must never be somebody
       * else's assertion.
       */
      const user = await fetchDiscordUser(discordId)
      const name = user?.global_name?.trim() || user?.username?.trim() || null
      return name && name.length > 0 ? name : null
    },
    enforceRole: ({ discordId, actor, action }) =>
      enforceDiscordAdmin({
        discordId,
        actor,
        action,
        deps: {
          check: checkAdminRole,
          /**
           * NOTHING TO END, AND THAT IS NOT A GAP. `endSession` deletes the
           * Auth.js session record behind the CURRENT request, and a bot-relayed
           * call carries no session cookie — there is no record to delete and no
           * way to reach one from here. If the named human also has a browser
           * open, the next write they attempt in it runs the same gate against
           * the same revoked role and ends that session then, which is the
           * moment the console can actually do it.
           */
          endSession: async () => {},
          audit,
          log: (level, message) => {
            if (level === 'error') console.error(message)
            else console.warn(message)
          },
        },
      }),
    ban: consistentBanFor,
    log: (level, message) => {
      if (level === 'error') console.error(message)
      else if (level === 'warn') console.warn(message)
      else console.info(message)
    },
  }
}

/** One call at the door, reduced to the things that decide it. */
export interface ServiceRequest {
  /** What the caller presented in {@link COMMAND_SECRET_HEADER}. */
  secret: string | null
  /** What it presented in {@link SERVICE_ACTOR_HEADER}. */
  actor: string | null
  /** The path being called. Checked against {@link SERVICE_ROUTES}, never trusted. */
  path: string
  /** The route's own label, for the log. Decides nothing — see `ActionLabel`. */
  action: string
  /**
   * The request's JSON body, READ ONLY FOR A {@link SYSTEM_ACTOR} CALL, and only
   * once the gate has got as far as needing it.
   *
   * A FUNCTION RATHER THAN A VALUE so that nothing is read for a caller who
   * failed the secret, the path or the system scope, which is the same "a
   * stranger costs nothing" property every earlier refusal has. It rejects, or
   * answers something that is not a kick, and the gate refuses either way.
   */
  body(): Promise<unknown>
}

/**
 * Allowed, with the actor to attribute it to (the named human, or
 * {@link SYSTEM_ATTRIBUTION}), or refused, with the status and the machine
 * code the caller is told.
 */
export type ServiceVerdict =
  | { ok: true; actor: Actor }
  | { ok: false; status: number; error: string }

/**
 * Constant-time comparison of the shared secret.
 *
 * Lifted deliberately unchanged from `/api/ingest`: hashed first so both sides
 * are always 32 bytes, because `timingSafeEqual` throws on a length mismatch
 * and catching that throw would itself leak the length of the real secret
 * through timing.
 */
function secretMatches(presented: string | null, configured: string): boolean {
  if (!presented) return false

  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(configured).digest()

  return timingSafeEqual(a, b)
}

/**
 * A path with any trailing slash removed, so `/api/kick/` cannot be a way past
 * an exact-match allowlist.
 */
export function normalisePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1)
  return trimmed
}

/** Is this request presenting the command credential at all? */
export function isServiceCall(req: Request): boolean {
  return req.headers.get(COMMAND_SECRET_HEADER) !== null
}

/** Read the two headers and the path off a real request, and the body on demand. */
export function serviceRequest(action: string, req: Request): ServiceRequest {
  let path = ''
  try {
    path = new URL(req.url).pathname
  } catch {
    // An unparseable request URL is not a path we can match, and the gate
    // refuses an empty one. Better than guessing at a substring.
    path = ''
  }

  return {
    secret: req.headers.get(COMMAND_SECRET_HEADER),
    actor: req.headers.get(SERVICE_ACTOR_HEADER),
    path,
    action,
    /**
     * READ OFF A CLONE, so the route still reads the original afterwards. The
     * gate runs before the route touches the body, so the clone is taken while
     * the stream is whole, and both copies are the same bytes: the license the
     * gate found banned is the license the route kicks.
     */
    body: () => req.clone().json(),
  }
}

/**
 * The gate. Answers with the acting human, or with `System`, or refuses.
 *
 * THE ORDER IS THE SECURITY PROPERTY, the same way it is in `authorize()`:
 *
 *   configured? → secret → scope → actor shape → identity → Discord role
 *
 * AND ONE BRANCH OFF IT, TAKEN ONLY BY THE EXACT {@link SYSTEM_ACTOR} MARKER,
 * after the scope check and before the actor shape:
 *
 *   system? → the kick route only → a plain kick body → a ban in force
 *
 * The branch returns on every path through it, so a system call can never
 * fall through into the human half below, and a human call can never reach
 * the branch. See the header for the rule it enforces.
 *
 * AND IT IS `authorize()`'s ORDER, DELIBERATELY. There, `currentAdmin()` builds
 * the `Actor` and only then does `discordGate` run over it; here the two
 * identity lookups build the same `Actor` and only then does the same gate run
 * over it. The gate needs the actor — it logs and audits under that name — so
 * putting the role check first would mean either passing it a half-built row or
 * keeping a second, quieter copy of the check. This costs one DynamoDB read for
 * a caller whose role turns out to be revoked, which is a caller that has
 * already presented the right secret on an allowlisted path: not a stranger.
 *
 * THE SECRET COMES BEFORE THE SCOPE CHECK ON PURPOSE. Refusing an unknown path
 * first would answer "that route is not on the list" to anybody who asked,
 * which is the allowlist read back to a stranger. Whoever does not hold the
 * secret learns one thing and it is `auth`.
 *
 * REFUSALS ARE MACHINE CODES, NOT SENTENCES, unlike every `ActionError` on the
 * session path. The reader is our own bot, which has to tell an admin in
 * Discord why `/brban` did nothing — the same argument `/api/handoff/mint`
 * makes for putting reasons in its body. What the admin is shown is the bot's
 * to word.
 *
 * EVERY REFUSAL IS LOGGED AT `error`. This credential can ban a player and
 * restart the game server, so a rejected attempt is not noise: it is either the
 * bot misconfigured and about to look broken to every admin who types a
 * command, or somebody who is not the bot. Both are worth a page of journal.
 *
 * NEVER THROWS, and never logs the secret — nothing here echoes what was
 * presented, only whether it matched.
 */
export async function serviceGate(
  input: ServiceRequest,
  deps: ServiceDeps,
): Promise<ServiceVerdict> {
  const { secret, actor, path, action } = input
  const where = `${normalisePath(path) || '(no path)'}`

  const configured = deps.secret()

  /**
   * THE DOOR IS NOT WIRED UP.
   *
   * Distinguished from a wrong secret in the RESPONSE as well as the log, and
   * that is a deliberate departure from `/api/ingest`'s "no detail". The
   * information an attacker gains is that a credential they cannot use is also
   * not configured; the information an operator gains is the difference between
   * "the bot's secret is stale" and "nobody ever set `COMMAND_SECRET` on this
   * box", which is otherwise a long evening. 503 rather than 401 because it is
   * this console that is not ready, not the caller that is wrong.
   */
  if (!configured) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call to ${where}: COMMAND_SECRET is not set ` +
        `on this console, so the ${SERVICE_CALLER} path is closed. See docs/deploy.md.`,
    )
    return { ok: false, status: 503, error: 'not-configured' }
  }

  if (!secretMatches(secret, configured)) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call to ${where}: the presented ` +
        `credential is not ${SERVICE_CALLER}'s.`,
    )
    return { ok: false, status: 401, error: 'auth' }
  }

  /**
   * IN SCOPE? Asked of the path the request actually arrived on, not of
   * anything the caller said about itself.
   */
  if (!(SERVICE_ROUTES as readonly string[]).includes(normalisePath(path))) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `that route is not one of ${SERVICE_ROUTES.join(', ')}.`,
    )
    return { ok: false, status: 403, error: 'scope' }
  }

  /**
   * NOBODY, BY NAME. Asked before the snowflake test rather than left to fail
   * it, so that the one actor that is not a human is refused or allowed by a
   * rule written for it, never by the accident of not being digits.
   */
  if (actor === SYSTEM_ACTOR) return await systemGate(input, deps, where)

  /**
   * THE REQUEST MUST CARRY THE HUMAN. There is no session here to read an
   * identity off, so a call with no `x-ringmaster-actor` is not a call this
   * console can attribute — and an unattributable ban is the one thing the
   * audit table exists to prevent. This is the "refuse if no role is present"
   * half of the owner's rule at its earliest and cheapest point: no id, no
   * question to ask Discord, no write.
   */
  if (!actor || !SNOWFLAKE.test(actor)) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `${SERVICE_ACTOR_HEADER} did not carry a Discord id, so there is no ` +
        `human to attribute it to.`,
    )
    return { ok: false, status: 400, error: 'actor' }
  }

  /**
   * WHO THEY ARE, BEFORE WHETHER THEY MAY — `authorize()`'s order, and the role
   * gate below needs this row to log and audit under.
   *
   * A NULL LICENSE IS NORMAL AND NOT A REDUCED CALLER — lib/grants.ts says so at
   * length. It stamps `actorLicense: null` on the row, exactly as it would for
   * the same person signed in with no grants row.
   */
  let license: string | null = null
  try {
    license = await deps.license(actor)
  } catch (e) {
    /**
     * A LOOKUP FAILURE IS A REFUSAL, and this is the one place it is worth
     * being strict about. The whole justification for a machine door is that
     * the row names the human; a ban recorded against a license we failed to
     * read is a ban attributed to nobody, and the caller can simply try again
     * in a moment.
     */
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `could not read the grants row for Discord ${actor} — ` +
        `${e instanceof Error ? e.message : String(e)}`,
    )
    return { ok: false, status: 503, error: 'store' }
  }

  /**
   * THE NAME IS THE ONE THING HERE THAT MAY BE MISSING WITHOUT REFUSING. It is
   * a label on a row whose license and Discord id are both already correct, and
   * losing a ban over a slow avatar API would be the tail wagging the dog. The
   * fallback is the Discord id itself: ugly in a table, and unambiguous, which
   * is the property a fallback in an audit log needs.
   */
  let name: string | null = null
  try {
    name = await deps.name(actor)
  } catch {
    name = null
  }

  const acting: Actor = { license, name: name ?? actor, discordId: actor }

  /**
   * AND NOW THE SAME QUESTION THE SESSION PATH ASKS, THROUGH THE SAME FUNCTION.
   *
   * `revoked` throws and is refused here. `unresolved` returns and is ALLOWED,
   * because the bot has already checked and a Discord outage must not take every
   * moderation command in the guild down with it — the header explains the trade
   * and lib/discordRole.ts weighs it. Both cases are already as loud as each
   * other inside that function; what is added here is a `[service]`-prefixed
   * line for the refusal, because docs/deploy.md tells an operator to grep for
   * exactly that when the bot looks broken.
   */
  try {
    await deps.enforceRole({ discordId: actor, actor: acting, action })
  } catch (e) {
    if (e instanceof RoleRevokedError) {
      deps.log(
        'error',
        `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
          `Discord ${actor} ${e.why === 'not-a-member' ? 'is not in the Discord server' : 'does not hold the admin role'}.`,
      )
      return { ok: false, status: 403, error: 'role-revoked' }
    }

    /**
     * ANYTHING ELSE OUT OF THE GATE IS A BUG, NOT AN OUTAGE, and it is refused.
     *
     * That is not a second polarity sneaking back in. `unresolved` means we
     * ASKED Discord and got nothing usable, and it is handled inside
     * `enforceDiscordAdmin` by returning — it never reaches here. A throw that
     * is not `RoleRevokedError` means the gate itself came apart, so we do not
     * know that it ran at all, and "the authorisation check crashed" is not a
     * state in which to ban a player on a header's say-so.
     */
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `the role gate threw — ${e instanceof Error ? e.message : String(e)}`,
    )
    return { ok: false, status: 503, error: 'role-error' }
  }

  deps.log(
    'info',
    `[service] ${SERVICE_CALLER} relayed a \`${action}\` call to ${where} for ` +
      `${acting.name} (${license ?? 'no license'}).`,
  )

  return { ok: true, actor: acting }
}

/**
 * The system actor's half of the gate: the kick route, a plain kick, a ban in
 * force. The header carries the rule; this is the rule, in its order.
 *
 * IT READS NOTHING ABOUT A PERSON. No grants row, no Discord name, no role
 * check, because there is no person. What it reads is the one fact that makes
 * the kick legitimate, and it reads that from the ban table rather than taking
 * the caller's word for it.
 *
 * EVERY REFUSAL IS AN `error`, like every other refusal in this file. The bot
 * sends this marker for exactly one thing, so a refusal here is either that
 * thing failing (the ban was lifted between the write and the kick, or the
 * table did not answer) or a caller that is not the bot.
 */
async function systemGate(
  input: ServiceRequest,
  deps: ServiceDeps,
  where: string,
): Promise<ServiceVerdict> {
  const { path, action } = input

  if (normalisePath(path) !== SYSTEM_ROUTE) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `${SERVICE_ACTOR_HEADER} named the system, and the system may only kick ` +
        `somebody already banned, at ${SYSTEM_ROUTE}.`,
    )
    return { ok: false, status: 403, error: 'system-scope' }
  }

  /**
   * AN UNREADABLE BODY IS AN EMPTY ONE, and the schema refuses it. The route
   * would refuse the same body a line later; refusing it here means a system
   * call never gets as far as reading the ban table about nothing.
   */
  let raw: unknown
  try {
    raw = await input.body()
  } catch {
    raw = undefined
  }

  const parsed = systemKickSchema.safeParse(raw)
  if (!parsed.success) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `a system kick carries one license and a reason and nothing else, and ` +
        `this one did not (${parsed.error.issues[0]?.message ?? 'no body'}).`,
    )
    return { ok: false, status: 400, error: 'system-body' }
  }

  const { license } = parsed.data

  /**
   * A FAILED READ IS A REFUSAL, NEVER AN ALLOWANCE. Allowing on a failure would
   * make "the table did not answer" the one state in which the system may kick
   * anybody at all, which is the opposite of the rule. `store` is the code the
   * human path already answers a failed grants read with, and the bot retries
   * it, which is right: the ban is still there to be read in a minute.
   */
  let ban: Ban | null
  try {
    ban = await deps.ban(license)
  } catch (e) {
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `could not read the ban on ${license}, so nothing shows this kick enforces ` +
        `one: ${e instanceof Error ? e.message : String(e)}`,
    )
    return { ok: false, status: 503, error: 'store' }
  }

  /**
   * `isActive` DECIDES, the same function the console's pages and the ban route
   * ask, so this gate cannot disagree with the rest of the console about what
   * "banned" means. No row, a lifted row and a served row are one answer.
   */
  if (!ban || !isActive(ban)) {
    const state = !ban
      ? 'no ban'
      : ban.liftedAt
        ? 'a ban that was lifted'
        : 'a ban that has run out'
    deps.log(
      'error',
      `[service] REFUSED a \`${action}\` call by ${SERVICE_CALLER} to ${where}: ` +
        `${license} has ${state}, and the system may only kick somebody whose ` +
        `ban is in force.`,
    )
    return { ok: false, status: 403, error: 'not-banned' }
  }

  deps.log(
    'info',
    `[service] ${SERVICE_CALLER} relayed a system \`${action}\` call to ${where} ` +
      `for ${license}, enforcing the ban in force there.`,
  )

  // A copy, so no route can edit the constant by editing its actor.
  return { ok: true, actor: { ...SYSTEM_ATTRIBUTION } }
}
