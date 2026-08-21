import { randomUUID } from 'node:crypto'

import { ddb, tables } from './dynamo'

/**
 * The audit trail.
 *
 * WRITTEN IN TWO PHASES, and that is the whole design. An action is recorded
 * BEFORE it is attempted and updated after it resolves, rather than written
 * once when it succeeds. Recording only successes produces a log that is
 * useless in exactly the moment it matters: the admin whose kick crashed the
 * resource, the ban that never reached the game host, the command issued
 * thirty seconds before the box went down. Those leave no trace at all in a
 * success-only log, and their absence looks identical to nobody having tried.
 *
 * So every action lands here first as `pending`, and the outcome is stamped on
 * afterwards. A row that stays `pending` forever is itself a finding — it means
 * we asked and never learned what happened, which is a different fact from
 * "it failed" and has to be distinguishable from it.
 *
 * THE GAME BOX NEVER READS THIS TABLE. Its IAM role has no access to it at
 * all, and that is deliberate rather than incidental: the audit log is the
 * record of what admins did, and a compromised game host should not be able to
 * read, still less rewrite, the account of its own compromise.
 */

/** What kind of thing happened. Open-ended by design — new verbs get added. */
export type AuditAction =
  | 'ban.issue'
  | 'ban.lift'
  | 'player.kick'

  /**
   * An admin asked to put their camera on a player (#192).
   *
   * THE ROW IS THE POINT, not a by-product of one. A kick and a ban are visible
   * to the person they happen to; this one is not — the player is not told, and
   * cannot be, or the tool stops being useful. "An admin watching a player who
   * does not know they are being watched is exactly the class of action
   * `ringmaster-audit` exists to record — the same as a kick or a ban. Nothing
   * else in the console acts on a player without leaving a row" (#192). This is
   * the row, and it is written BEFORE the command is sent like every other one.
   *
   * NO REASON, and unlike the kick that is not a judgement call about how much
   * typing is reasonable — the console never asks for one, because the button
   * is a single click by design. Who watched whom, and when, is the record.
   */
  | 'player.spectate'
  | 'maintenance.schedule'
  | 'maintenance.cancel'
  | 'maintenance.drain'
  | 'maintenance.deploy'
  // Closing an incident is a moderation decision and belongs in the same log
  // as every other one. "Who decided nothing was wrong" is exactly the kind of
  // thing that has to be comparable across actions later.
  | 'incident.resolve'

  /**
   * The Discord re-check refused a write and ended the session.
   *
   * AN ADMIN WHOSE ROLE WAS TAKEN AWAY, STILL TRYING TO ACT, is the single
   * clearest thing an audit log can be asked to capture, and it is invisible
   * everywhere else: the write never happened, so no ban or kick row records
   * it, and the session is gone a moment later. `outcome` carries whether the
   * sign-out actually succeeded — a `failed` row here means a revoked admin's
   * session could not be torn down, which is the case worth paging somebody
   * over. See lib/discordRole.ts.
   */
  | 'discord.revoked'

  /**
   * A write that went ahead WITHOUT a Discord answer, because Discord did not
   * give one inside the budget.
   *
   * THIS IS THE RECEIPT FOR THE FAIL-OPEN DECISION. The gate allows a write
   * when Discord times out or errors, on the reasoning that the DynamoDB grant
   * — the primary authorisation — has already been checked live and passed. A
   * fail-open nobody can see afterwards is indistinguishable from a check that
   * was never running, so each one leaves a row and "was the Discord check up
   * when this ban was issued" stays an answerable question.
   *
   * NOT written when the feature is simply unconfigured; that is a state, not
   * an event, and it would be on every row forever. See lib/discordRole.ts.
   */
  | 'discord.unresolved'

export type AuditOutcome = 'pending' | 'ok' | 'failed'

export interface AuditRow {
  /**
   * Partition key. A single literal string, so the whole log is one partition
   * ordered by `ts` and "show me the last 50 actions" is one Query.
   *
   * FINE AT THIS SCALE AND NOT FOREVER: DynamoDB partitions cap at 1000 WCU,
   * and admin actions are measured in tens per day, so the ceiling is roughly
   * four orders of magnitude away. When it stops being fine the key becomes
   * `AUDIT#<yyyy-mm>` and the reader queries the current and previous month —
   * noted here because the migration is cheap now and expensive after somebody
   * writes a report that assumes one partition.
   */
  pk: string
  /** Sort key: milliseconds since epoch. */
  ts: number

  /** Joins the intent row to the outcome that arrives later. */
  commandId: string

  action: AuditAction
  outcome: AuditOutcome

  /** The acting admin. License is the identity every other table keys on. */
  actorLicense: string | null
  actorName: string
  actorDiscordId: string | null

  /** Who it was done to, when the action targets a player. */
  targetLicense?: string | null
  targetName?: string | null

  /** Free text supplied by the admin (a ban reason). Never interpolated. */
  reason?: string | null

  /** Set when the outcome lands. */
  resolvedAt?: number
  /** Why it failed, for the failed case. Operator-facing, not a stack trace. */
  error?: string | null

  /** Anything action-specific worth keeping. Small, and never secrets. */
  detail?: Record<string, string | number | boolean | null>
}

const PK = 'AUDIT'

/**
 * The last sort key this process handed out.
 *
 * `pk` + `ts` IS THE WHOLE PRIMARY KEY, so two rows written in the same
 * millisecond are not two rows — the second is a PutItem over the first and the
 * first is gone, with nothing logged and nothing to notice. One millisecond
 * used to be comfortably longer than the gap between any two admin actions;
 * closing a player's other cases after a permanent ban writes rows in a LOOP,
 * which is the first thing in this console that can genuinely queue several
 * inside one tick.
 *
 * SO A TIE IS BROKEN FORWARD, never backward: the row lands a millisecond late
 * rather than on top of its predecessor. It stays a real timestamp — the skew
 * is bounded by how many rows one request writes — and the ordering the log is
 * read in is preserved exactly.
 *
 * THIS IS PER PROCESS AND CANNOT BE ANYTHING ELSE. Two consoles writing in the
 * same millisecond still collide; that needs a different key (see the note on
 * `pk`) and is not worth a migration for an event nothing has ever observed.
 * What it does remove is the one case this code can actually cause.
 */
let lastTs = 0

function nextTs(): number {
  const now = Date.now()
  lastTs = now > lastTs ? now : lastTs + 1
  return lastTs
}

export interface Actor {
  license: string | null
  name: string
  discordId: string | null
}

/** The handle to an open intent row: both halves of its primary key. */
export interface AuditHandle {
  /** Minted here, echoed back by the game side so the two halves join. */
  commandId: string
  /** The row's sort key. Returned rather than re-derived — see below. */
  ts: number
}

/**
 * Record the intent to do something. Returns the handle {@link resolve} needs.
 *
 * CALLED BEFORE THE ACTION, always. If this throws, the action must not
 * proceed — an unlogged admin action is precisely what this table exists to
 * make impossible, so a failure to record is a failure to act.
 *
 * IT RETURNS `ts` RATHER THAN LETTING THE CALLER STAMP ITS OWN. The sort key
 * is half the primary key, so a caller that called Date.now() separately would
 * update a row that does not exist — silently, because an UpdateItem against a
 * missing key creates one. That would leave the real intent row stuck at
 * `pending` forever and a second orphan row holding the outcome.
 */
export async function begin(input: {
  action: AuditAction
  actor: Actor
  targetLicense?: string | null
  targetName?: string | null
  reason?: string | null
  detail?: AuditRow['detail']
}): Promise<AuditHandle> {
  const commandId = randomUUID()
  const ts = nextTs()

  const row: AuditRow = {
    pk: PK,
    ts,
    commandId,
    action: input.action,
    outcome: 'pending',
    actorLicense: input.actor.license,
    actorName: input.actor.name,
    actorDiscordId: input.actor.discordId,
    targetLicense: input.targetLicense ?? null,
    targetName: input.targetName ?? null,
    reason: input.reason ?? null,
    detail: input.detail,
  }

  await ddb.put({ TableName: tables.audit, Item: row })
  return { commandId, ts }
}

/**
 * Stamp the outcome onto an intent row.
 *
 * Takes the row's own `ts` because that is half the primary key — the caller
 * holds it from {@link begin}'s return trip. A conditional update would be
 * tidier but needs a GSI on commandId to find the row by id alone, which is
 * not worth a whole index for a value we already have in hand.
 *
 * NEVER THROWS. A failure to record the outcome must not turn a successful
 * ban into an error the admin sees and retries — the ban happened, and a row
 * stuck at `pending` is the honest record of a bookkeeping failure. It is
 * logged for the operator and swallowed for the caller.
 */
export async function resolve(
  ts: number,
  outcome: Exclude<AuditOutcome, 'pending'>,
  error?: string | null,
): Promise<void> {
  try {
    await ddb.update({
      TableName: tables.audit,
      Key: { pk: PK, ts },
      UpdateExpression:
        'SET outcome = :o, resolvedAt = :r, #e = :e',
      ExpressionAttributeNames: { '#e': 'error' },
      ExpressionAttributeValues: {
        ':o': outcome,
        ':r': Date.now(),
        ':e': error ?? null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to record outcome', { ts, outcome, e })
  }
}

/**
 * A convenience wrapper: record the intent, run the action, stamp the result.
 *
 * Returns whatever the action returned. Rethrows what the action threw, after
 * recording the failure — the caller still gets to decide what the admin sees.
 */
export async function audited<T>(
  input: Parameters<typeof begin>[0],
  run: (commandId: string) => Promise<T>,
): Promise<T> {
  const { commandId, ts } = await begin(input)

  try {
    const out = await run(commandId)
    await resolve(ts, 'ok')
    return out
  } catch (e) {
    await resolve(ts, 'failed', e instanceof Error ? e.message : String(e))
    throw e
  }
}

/**
 * The most recent actions, newest first.
 *
 * `ScanIndexForward: false` walks the sort key backwards, which is how you get
 * "latest" out of DynamoDB without sorting client-side.
 */
/**
 * How far back one profile's moderation history reaches.
 *
 * A CEILING ON THE READ, NOT ON THE TRUTH. Anything older than this many rows is
 * still in the table and still in `/audit`; it simply is not on the profile. The
 * number is named rather than inlined because both halves of `forPlayer` are
 * bounded by it and a reader deserves to know which one they are looking at.
 */
const PROFILE_WINDOW = 400

/**
 * Both directions of one player's audit history, from ONE read of the log.
 *
 * TWO QUESTIONS, ONE QUERY, AND THAT IS WHY THIS REPLACED `forTarget`. The
 * profile page now asks what was done TO this person AND — because they may be an
 * admin — what they DID. Those are two filters over the same recent slice, and a
 * second exported reader would have meant a second `recent(400)` on every profile
 * view for rows we already had in hand.
 *
 * THE BANS TABLE CANNOT ANSWER THE FIRST OF THEM. It is keyed on license alone —
 * one row per player — so issuing a second ban overwrites the first and the
 * history is gone. The audit log is append-only and is the only place a player's
 * moderation past actually survives, which is exactly what an audit log is for.
 *
 * READS THE WHOLE RECENT LOG AND FILTERS, rather than querying an index. Admin
 * actions are measured in tens per day, so scanning the last few hundred is
 * cheaper than the GSI it would take to avoid it — and the whole log lives in
 * one partition anyway (see the note on `pk`). When either of those stops being
 * true this needs `targetLicense` and `actorLicense` indexes, and the same
 * comment on `pk` marks the moment.
 *
 * INTENT ROWS WITHOUT AN OUTCOME ARE INCLUDED, deliberately. A kick that was
 * dispatched and never confirmed is a thing a moderator needs to see — dropping
 * it would present a cleaner history than actually happened.
 *
 * `taken` IS NOT SLICED HERE AND THAT IS NOT AN OVERSIGHT. Those rows still have
 * to be COLLAPSED — a ban issued as an incident verdict is two rows of one act,
 * see lib/actionsTaken.ts — and slicing before collapsing could cut a pair in
 * half at the boundary and leave the second row of it standing alone. The caller
 * groups first and bounds the result afterwards; `PROFILE_WINDOW` is the real
 * ceiling either way.
 *
 * `against` IS SLICED, AND THAT IS WHY {@link closedByABan} EXISTS. A permanent
 * ban closes every other open case about the same player, and each closure is an
 * `incident.resolve` row TARGETING that player, written a moment AFTER the
 * `ban.issue` row. Fifty of them are fifty rows newer than the ban — so a plain
 * `filter(target).slice(0, 50)` would hand the profile fifty closures and drop
 * the ban itself, and the panel that exists to say "this person is banned" would
 * be empty on the one profile where that mattered most. The rows are dropped
 * BEFORE the slice rather than after, because after is too late: the ban is
 * already outside the window by then.
 */
export async function forPlayer(
  license: string,
  limit = 50,
): Promise<{ against: AuditRow[]; taken: AuditRow[] }> {
  const rows = await recent(PROFILE_WINDOW)
  return {
    against: rows
      .filter((r) => r.targetLicense === license && !closedByABan(r))
      .slice(0, limit),
    taken: rows.filter((r) => r.actorLicense === license),
  }
}

/**
 * A case closed BY a ban, rather than a decision anybody took about this player.
 *
 * NOTHING IS HIDDEN THAT WAS EVER SHOWN. The profile's "Kicks and bans" panel
 * already discards every `incident.resolve` row unconditionally — closing a
 * report is not something done to the player (see `NOT_AN_ACTION` in
 * components/ProfileView) — so these rows have no reader on this side of the
 * log. They are still in `/audit` and still in the table, which is where the
 * append-only record lives.
 *
 * NARROWER THAN THAT FILTER ON PURPOSE. This does not drop the enforcement
 * `player.kick` that also carries `becauseOf: 'ban.issue'`: being removed from a
 * match IS something that happened to the player, it is one row rather than
 * fifty, and it has been on that panel since bans started kicking.
 */
function closedByABan(row: AuditRow): boolean {
  return (
    row.action === 'incident.resolve' && row.detail?.becauseOf === 'ban.issue'
  )
}

export async function recent(limit = 100): Promise<AuditRow[]> {
  const res = await ddb.query({
    TableName: tables.audit,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': PK },
    ScanIndexForward: false,
    Limit: limit,
  })

  return (res.Items ?? []) as AuditRow[]
}
