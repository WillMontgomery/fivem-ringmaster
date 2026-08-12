import { ddb, tables } from './dynamo'

/**
 * Scheduled maintenance.
 *
 * WHAT "MAINTENANCE" MEANS HERE, precisely, because the word usually implies
 * more: it is running `royale-deploy` — pull main, sync resources, restart
 * FXServer. Nothing reboots, no machine goes down, and the box is up the whole
 * time. The expensive part is not the deploy (seconds) but the restart, which
 * ends every match in progress. So the entire design exists to make sure that
 * restart lands when nobody is mid-drop rather than at a convenient moment for
 * the person clicking.
 *
 * THE SHAPE OF A WINDOW:
 *
 *   scheduled ──(drainStartsAt)──► draining ──(server empties)──► deploying
 *       │                              │                              │
 *       └──────── cancelled ───────────┘                        complete
 *
 * While DRAINING the game refuses new connections and starts no new matches,
 * so the population can only fall. When it reaches zero the deploy fires on its
 * own — that automatic step is the point of scheduling at all, since the whole
 * purpose is not having to sit and watch for the server to empty.
 *
 * A SPECIFIC DEPLOY TIME IS OPTIONAL AND NOT THE DEFAULT. Waiting for empty is
 * kinder and almost always works; a fixed time is for the case where you need
 * the change out by a deadline and are willing to end a match to get it. That
 * mode can still find people online when it fires, which is why forcing is an
 * explicit action with its own confirmation rather than something that quietly
 * happens.
 *
 * ONE WINDOW AT A TIME, stored under a fixed key. Two overlapping windows have
 * no sensible meaning — they would both drain and both deploy — and the history
 * lives in the audit log, which is append-only and already records who did
 * what. There is deliberately no "extend": cancel and schedule again, which is
 * one fewer state transition to get wrong and reads identically in the log.
 */

/** The single active window's partition key. */
const CURRENT = 'current'

export type MaintenanceState =
  | 'scheduled'
  | 'draining'
  | 'deploying'
  | 'complete'
  | 'cancelled'

/** How the deploy is triggered once draining starts. */
export type DeployMode = 'when-empty' | 'at-time'

export interface MaintenanceWindow {
  id: string
  state: MaintenanceState

  /** Who scheduled it, for the log and the UI. */
  createdAt: number
  createdBy: string | null
  createdByName: string

  /**
   * Shown to players refused at the door while draining, so "server won't let
   * me in" has an answer that is not a support ticket.
   */
  note: string

  /** When refusing new connections begins. */
  drainStartsAt: number

  deployMode: DeployMode
  /** Only for `at-time`. Absolute, so nothing has to re-derive it. */
  deployAt: number | null

  drainStartedAt?: number | null
  deployStartedAt?: number | null
  completedAt?: number | null

  cancelledAt?: number | null
  cancelledBy?: string | null
  cancelledByName?: string | null

  /**
   * Set when an admin deployed while players were still connected. Recorded
   * because it is the one path that ends matches on purpose, and "who decided
   * that" is the first question afterwards.
   */
  forcedAt?: number | null
  forcedBy?: string | null
  forcedByName?: string | null
  /** How many were online at the moment it was forced. */
  forcedWithPlayers?: number | null

  /**
   * Commits the running server is behind main, kept fresh by the driver.
   *
   * LIVES ON THIS ROW so the game can read one document and learn everything it
   * needs: whether to drain, and whether to nudge admins that an update is
   * waiting. A second row would mean a second GetItem on every game-side poll
   * for a number that changes on the same cadence.
   */
  updateAvailable?: number | null
  /**
   * When the current update was FIRST seen. The 72-hour clock runs from here,
   * not from the last poll — otherwise the deadline would reset every fifteen
   * seconds and never arrive.
   */
  updateFirstSeenAt?: number | null
}

/**
 * How long an available update may sit before maintenance schedules itself.
 *
 * WHY AUTOMATE THIS AT ALL. An update nobody schedules is the normal outcome of
 * a busy week, and the cost is silent: the server drifts further from main, the
 * eventual deploy carries more change, and the first thing anybody notices is a
 * bigger, riskier restart. Three days is long enough that no reasonable
 * intention gets overridden and short enough that drift stays small.
 */
export const AUTO_AFTER_MS = 72 * 60 * 60 * 1000

/**
 * The moment maintenance will schedule itself, given when the update appeared.
 *
 * Used by the UI to bound the date picker: there is no point letting somebody
 * choose a deploy time after the automation would already have run, because the
 * automation would win and their choice would silently never happen.
 */
export function autoDeadline(updateFirstSeenAt: number | null | undefined):
  | number
  | null {
  if (!updateFirstSeenAt) return null
  return updateFirstSeenAt + AUTO_AFTER_MS
}

/** States in which the window still governs the server's behaviour. */
export function isLive(w: MaintenanceWindow | null): w is MaintenanceWindow {
  if (!w) return false
  return w.state === 'scheduled' || w.state === 'draining' || w.state === 'deploying'
}

/**
 * Should the game be refusing connections right now?
 *
 * DERIVED FROM THE CLOCK, NOT FROM THE STORED STATE, so a console that was
 * asleep when `drainStartsAt` passed does not leave the server accepting
 * players it should be turning away. The stored state catches up on the next
 * tick; this answer is correct immediately.
 */
export function isDraining(
  w: MaintenanceWindow | null,
  now = Date.now(),
): w is MaintenanceWindow {
  if (!isLive(w)) return false
  if (w.state === 'deploying') return true
  return now >= w.drainStartsAt
}

/**
 * Record how far behind main the server is, and when we first noticed.
 *
 * WRITTEN ON THE SAME ROW THE GAME POLLS, so one GetItem tells the game both
 * whether to drain and whether to nudge admins about a waiting update.
 *
 * `updateFirstSeenAt` is set once and left alone while the update persists. It
 * is the start of the 72-hour clock, and refreshing it on every poll would push
 * the deadline forever into the future — the automation would never fire, which
 * is the exact failure it exists to prevent.
 */
export async function noteUpdateAvailable(behind: number): Promise<void> {
  const existing = await current()

  // Back in sync: clear the flag and the clock together, so the next update
  // starts a fresh three days rather than inheriting an old deadline.
  if (behind <= 0) {
    if (!existing) return
    await ddb
      .update({
        TableName: tables.maintenance,
        Key: { id: CURRENT },
        UpdateExpression: 'SET updateAvailable = :z, updateFirstSeenAt = :n',
        ExpressionAttributeValues: { ':z': 0, ':n': null },
      })
      .catch(() => {})
    return
  }

  const firstSeen = existing?.updateFirstSeenAt || Date.now()

  if (!existing) {
    // No row yet — the game still needs one to read, so create a minimal
    // finished window carrying just the update signal.
    await ddb.put({
      TableName: tables.maintenance,
      Item: {
        id: CURRENT,
        state: 'complete',
        createdAt: Date.now(),
        createdBy: null,
        createdByName: 'system',
        note: '',
        drainStartsAt: 0,
        deployMode: 'when-empty',
        deployAt: null,
        updateAvailable: behind,
        updateFirstSeenAt: firstSeen,
      } satisfies MaintenanceWindow,
    })
    return
  }

  await ddb
    .update({
      TableName: tables.maintenance,
      Key: { id: CURRENT },
      UpdateExpression: 'SET updateAvailable = :b, updateFirstSeenAt = :f',
      ExpressionAttributeValues: { ':b': behind, ':f': firstSeen },
    })
    .catch(() => {})
}

export async function current(): Promise<MaintenanceWindow | null> {
  const res = await ddb.get({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
  })
  return (res.Item as MaintenanceWindow | undefined) ?? null
}

/**
 * Schedule a window, replacing any finished one.
 *
 * REFUSES TO OVERWRITE A LIVE WINDOW. Scheduling on top of one that is already
 * draining would silently move the goalposts on a server that is already
 * turning players away — the caller has to cancel first, which is a decision
 * with a name in the audit log rather than an accident.
 */
export async function schedule(input: {
  createdBy: string | null
  createdByName: string
  note: string
  drainStartsAt: number
  deployMode: DeployMode
  deployAt: number | null
}): Promise<MaintenanceWindow> {
  const existing = await current()

  // Read BEFORE the guard below. `isLive` is a type predicate, so once it has
  // been called TypeScript narrows `existing` to null on the false branch —
  // correct for control flow, useless for reading fields off the row we are
  // about to replace.
  const carriedAvailable = existing?.updateAvailable ?? null
  const carriedFirstSeen = existing?.updateFirstSeenAt ?? null

  if (isLive(existing)) {
    throw new Error('A maintenance window is already scheduled. Cancel it first.')
  }

  const w: MaintenanceWindow = {
    id: CURRENT,
    state: 'scheduled',
    createdAt: Date.now(),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    note: input.note,
    drainStartsAt: input.drainStartsAt,
    deployMode: input.deployMode,
    deployAt: input.deployMode === 'at-time' ? input.deployAt : null,
    drainStartedAt: null,
    deployStartedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelledByName: null,
    forcedAt: null,
    forcedBy: null,
    forcedByName: null,
    forcedWithPlayers: null,

    // CARRIED FORWARD, not reset. This is a full put over the same key, so
    // anything not repeated here is destroyed — and losing `updateFirstSeenAt`
    // would restart the 72-hour clock every time somebody scheduled and
    // cancelled, which is the one sequence that must not defeat the automation.
    updateAvailable: carriedAvailable,
    updateFirstSeenAt: carriedFirstSeen,
  }

  await ddb.put({ TableName: tables.maintenance, Item: w })
  return w
}

/**
 * Cancel the live window.
 *
 * The row is kept in the cancelled state rather than deleted, for the same
 * reason a lifted ban keeps its row: "was there a window and who called it off"
 * is a real question, and a table that deletes cannot answer it.
 */
export async function cancel(input: {
  by: string | null
  byName: string
}): Promise<void> {
  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression:
      'attribute_exists(id) AND (#s = :scheduled OR #s = :draining)',
    UpdateExpression:
      'SET #s = :cancelled, cancelledAt = :t, cancelledBy = :b, cancelledByName = :n',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: {
      ':cancelled': 'cancelled',
      ':scheduled': 'scheduled',
      ':draining': 'draining',
      ':t': Date.now(),
      ':b': input.by,
      ':n': input.byName,
    },
  })
}

/** Move a scheduled window into draining. Idempotent by condition. */
export async function markDraining(): Promise<void> {
  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression: '#s = :scheduled',
    UpdateExpression: 'SET #s = :draining, drainStartedAt = :t',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: {
      ':scheduled': 'scheduled',
      ':draining': 'draining',
      ':t': Date.now(),
    },
  })
}

/**
 * Move into deploying. The condition is what makes this safe to call from a
 * timer: two ticks racing produce one winner and one harmless failure, so the
 * deploy cannot fire twice.
 */
export async function markDeploying(input?: {
  forcedBy?: string | null
  forcedByName?: string | null
  withPlayers?: number
}): Promise<void> {
  const forced = Boolean(input?.forcedBy || input?.forcedByName)

  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression: '#s = :scheduled OR #s = :draining',
    UpdateExpression: forced
      ? 'SET #s = :deploying, deployStartedAt = :t, forcedAt = :t, forcedBy = :fb, forcedByName = :fn, forcedWithPlayers = :fp'
      : 'SET #s = :deploying, deployStartedAt = :t',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: forced
      ? {
          ':deploying': 'deploying',
          ':scheduled': 'scheduled',
          ':draining': 'draining',
          ':t': Date.now(),
          ':fb': input?.forcedBy ?? null,
          ':fn': input?.forcedByName ?? null,
          ':fp': input?.withPlayers ?? 0,
        }
      : {
          ':deploying': 'deploying',
          ':scheduled': 'scheduled',
          ':draining': 'draining',
          ':t': Date.now(),
        },
  })
}

export async function markComplete(error?: string | null): Promise<void> {
  /**
   * CLEARS THE UPDATE SIGNAL ON SUCCESS, and that is a bug fix rather than
   * tidying.
   *
   * `updateAvailable` is refreshed from the host's `status`, which only
   * re-checks the remote on a throttle — so for a minute or so after a
   * successful deploy the row still said an update was waiting. The console
   * duly offered to schedule maintenance for an update that had just been
   * applied: a restart that would end every match in progress and change
   * nothing.
   *
   * Clearing it here makes the console correct immediately and the next poll
   * simply re-confirms zero. A FAILED deploy deliberately leaves the signal
   * alone — the update genuinely is still waiting, and hiding it would be the
   * opposite mistake.
   */
  const clearSignal = !error

  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    UpdateExpression: clearSignal
      ? 'SET #s = :complete, completedAt = :t, deployError = :e, updateAvailable = :z, updateFirstSeenAt = :null'
      : 'SET #s = :complete, completedAt = :t, deployError = :e',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: clearSignal
      ? {
          ':complete': 'complete',
          ':t': Date.now(),
          ':e': null,
          ':z': 0,
          ':null': null,
        }
      : {
          ':complete': 'complete',
          ':t': Date.now(),
          ':e': error,
        },
  })
}

/**
 * The badge state the console chrome shows, or null when nothing is planned.
 *
 * Collapses the five states into the two an operator reads at a glance from
 * across the room: something is coming, or something is happening now.
 */
export function badgeState(
  w: MaintenanceWindow | null,
  now = Date.now(),
): 'scheduled' | 'draining' | null {
  if (!isLive(w)) return null
  return isDraining(w, now) ? 'draining' : 'scheduled'
}
