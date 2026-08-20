import * as audit from './audit'
import * as maint from './maintenance'
import { heartbeatIsFresh } from './serverPhase'
import { isOnMain, isParkedOffMain, runVerb, sshConfigured, switchRef } from './ssh'
import { ensurePolling, hostView } from './telemetry'
import { liveView } from './state'

/**
 * The thing that actually makes a maintenance window happen.
 *
 * A WINDOW IS A ROW UNTIL SOMETHING WATCHES IT. This is that something: a
 * server-side timer that compares the stored window against the clock and the
 * live player count, advances the state, and fires the deploy when the
 * conditions are met.
 *
 * IT RUNS ON ONE BOX AND THAT IS LOAD-BEARING. Ringmaster is a single instance
 * (same assumption as lib/state's live snapshot), so exactly one timer is
 * looking at this. If a second instance ever appears, two drivers would race to
 * deploy — which the conditional writes in lib/maintenance survive (one wins,
 * one fails harmlessly) but which should be understood before anyone scales
 * this horizontally.
 *
 * EVERY TRANSITION IS AUDITED, including the automatic ones. "The server
 * restarted at 04:12" is a fact somebody will want attached to a person or to
 * a rule, and an unattributed restart in the middle of the night is exactly the
 * thing an audit log exists to explain.
 */

const TICK_MS = 15_000

const globalForDriver = globalThis as unknown as {
  ringMaintTimer?: ReturnType<typeof setInterval>
  ringMaintBusy?: boolean
  /** The last window this driver read. See {@link maintenanceView}. */
  ringMaintWindow?: maint.MaintenanceWindow | null
  /** When it read it, so a caller can tell a cold cache from an empty row. */
  ringMaintAt?: number
}

/**
 * The window, from memory, for anything that needs it on a fast cadence.
 *
 * THE SAME SHAPE AND THE SAME REASON AS `hostView()`. The header's chips have to
 * know whether a deploy is running, on every page, without each of them opening
 * its own poller against DynamoDB — and this driver is ALREADY reading that row
 * every fifteen seconds to decide whether to advance the state machine. Handing
 * out what it just read costs a property access; a second reader would cost a
 * GetItem per console per tick to learn a value that is already in memory.
 *
 * FIFTEEN SECONDS IS THE RESOLUTION, AND IT IS THE RIGHT ONE FOR WHAT IT
 * ANSWERS. Learning that a deploy has STARTED is minute-scale — the deploy takes
 * tens of seconds and nobody is watching the millisecond it begins. The
 * transition that has to feel immediate is the other one, the server coming back,
 * and that is not decided here: it is `lastPushAt` off the two-second live poll,
 * compared against `completedAt` from this cache. Slow fact, fast fact, and the
 * user-visible flip rides the fast one.
 *
 * NULL FOR A COLD CACHE AND NULL FOR AN EMPTY ROW, deliberately not
 * distinguished by the window itself — `at` is what tells them apart, and every
 * consumer treats both as "no window", which is the safe direction: a chip that
 * has not learned about a deploy shows the ordinary health chips rather than
 * hiding them. See lib/serverPhase.
 */
export function maintenanceView(now = Date.now()): {
  window: maint.MaintenanceWindow | null
  badge: ReturnType<typeof maint.badgeState>
  /** When the driver last read the row. 0 means it never has. */
  at: number
} {
  const w = globalForDriver.ringMaintWindow ?? null
  return { window: w, badge: maint.badgeState(w, now), at: globalForDriver.ringMaintAt ?? 0 }
}

/** Record what the driver just read, so `maintenanceView` can hand it out. */
function remember<T extends maint.MaintenanceWindow | null>(w: T): T {
  globalForDriver.ringMaintWindow = w
  globalForDriver.ringMaintAt = Date.now()
  return w
}

/**
 * Re-read the row into the cache after this driver has just changed it.
 *
 * ONE GetItem PER TRANSITION, WHICH IS A HANDFUL PER WINDOW. The alternative —
 * waiting for the next tick — leaves the cache up to fifteen seconds behind the
 * two transitions that are the entire reason the cache exists, and the deploy
 * step is a long `await` that can push the next tick out well past that. The
 * other alternative, patching the cached object with the state we believe we
 * just wrote, is a second copy of the state machine that would silently diverge
 * the first time a conditional write lost a race. Re-reading is the version that
 * cannot be wrong.
 */
async function refresh(): Promise<void> {
  await maint
    .current()
    .then(remember)
    .catch(() => {})
}

/**
 * Ask the game host to run royale-deploy, switching branch first if the window
 * asked for one.
 *
 * NOT A REBOOT AND NOT A PROCESS KILL. The verb runs the same
 * `systemctl start royale-deploy` an operator would type: sync resources,
 * restart FXServer. The box stays up throughout.
 *
 * THE SWITCH HAPPENS HERE, AT DEPLOY TIME, NOT WHEN THE WINDOW WAS SCHEDULED,
 * and that ordering is the whole safety of it. `switchref` writes a pin file
 * that the NEXT deploy — any deploy, including a human typing
 * `systemctl start royale-deploy` on the box — will act on. Pinning at
 * scheduling time would mean a window somebody scheduled and then cancelled
 * leaves that pin lying there, and the next unrelated deploy silently ships a
 * branch nobody currently intends. Pinning immediately before the deploy that
 * consumes it closes the gap to about a second.
 *
 * A FAILED SWITCH MUST NOT DEPLOY. If the branch moved, or turns out to change
 * `tools/dispatch.sh`, the box refuses the pin — and running the deploy anyway
 * would refresh whatever ref the box was already on while the audit row said a
 * branch switch happened. Returning the refusal leaves the server exactly as it
 * was and puts the reason in the log.
 */
async function runDeploy(
  w: maint.MaintenanceWindow,
): Promise<{ ok: boolean; error?: string }> {
  if (!sshConfigured()) {
    return { ok: false, error: 'the command channel is not configured' }
  }
  try {
    if (w.targetRef && w.targetSha) {
      const pin = await switchRef(
        w.targetRef,
        w.targetSha,
        w.createdByName || 'an admin',
      )
      if (!pin.ok) {
        return {
          ok: false,
          error: pin.error ?? `the game host refused to switch to ${w.targetRef}`,
        }
      }
    }
    const res = await runVerb<{ ok: boolean; error?: string }>('deploy')
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'deploy refused' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * One pass of the state machine.
 *
 * Exported so a route can force an immediate evaluation after a change rather
 * than leaving the operator watching a badge that updates in fifteen seconds.
 */
export async function tick(): Promise<void> {
  // Overlapping ticks would double-fire the deploy on a slow SSH round trip.
  // A plain boolean is enough for a single instance and is honest about being
  // exactly that.
  if (globalForDriver.ringMaintBusy) return
  globalForDriver.ringMaintBusy = true

  try {
    let w = remember(await maint.current())
    const now = Date.now()

    /**
     * DID THE SERVER COME BACK FROM THE LAST DEPLOY? Recorded once, durably.
     *
     * THE VERDICT IS DERIVED EVERYWHERE AND WRITTEN DOWN HERE. Every surface
     * computes `deployPhase` from the same inputs on its own two-second poll,
     * which is what makes the header chip, the Maintenance page and the toast
     * flip together; but all of those read the live feed, which is in-memory
     * and dies with this process. This is the one place that turns the
     * observation into a fact on the row, so the answer survives a restart and
     * a console booting a week later cannot mistake an unrelated outage for a
     * deploy that never landed.
     *
     * IT RUNS BEFORE THE `isLive` GATE BELOW because a `complete` window is not
     * live — this is precisely the state the rest of the state machine has
     * finished with and the only one where this question exists.
     *
     * NOT OVER AN ERROR. A deploy the host refused never restarted anything, so
     * the game pushing happily is the expected state rather than evidence of
     * anything; recording a confirmation there would turn a stated failure into
     * a success. See `deployPhase`, which tests `deployError` first for the
     * same reason.
     */
    if (
      w &&
      w.state === 'complete' &&
      typeof w.completedAt === 'number' &&
      typeof w.deployConfirmedAt !== 'number' &&
      !w.deployError
    ) {
      const feed = liveView(now)
      const back = heartbeatIsFresh({
        completedAt: w.completedAt,
        deployBootEpoch: w.deployBootEpoch,
        deployConfirmedAt: w.deployConfirmedAt,
        bootEpoch: feed.bootEpoch,
        lastPushAt: feed.lastPushAt,
      })
      if (back) {
        try {
          await maint.markDeployConfirmed(feed.lastPushAt ?? now)
          w = remember(await maint.current())
        } catch (e) {
          // Loud rather than swallowed: a confirmation that silently fails to
          // write leaves the console re-deciding this from volatile state
          // forever, and the symptom (a deploy that reads as unconfirmed after
          // a restart) is a long way from the cause.
          console.error('[maintenance] could not record deploy confirmation', e)
        }
      }
    }

    /**
     * IS THE BOX ON MAIN? DERIVED FROM THE HOST, EVERY TICK, NEVER STORED.
     *
     * This gates the automation below, and where it lives is the entire
     * decision. The obvious home is a flag on the maintenance `current` row —
     * and `maint.schedule()` is a full `ddb.put` over that key, so any
     * schedule/cancel cycle would wipe it. The failure that produces is
     * specific and bad: the flag comes back as absent, absent reads as "on
     * main", and fifteen seconds later the driver schedules and deploys `main`
     * over a branch somebody is actively testing, attributed to `system`, with
     * nothing anywhere saying why the code changed under them.
     *
     * Derived state cannot be wiped by a write to something else. `isOnMain`
     * is written in the positive so a host that does not answer the question —
     * an older dispatcher, a detached HEAD — reads as off main and turns the
     * automation OFF rather than on.
     */
    const status = hostView().status
    const onMain = isOnMain(status)

    /**
     * Keep the update signal fresh on the row the game polls.
     *
     * READ FROM THE TELEMETRY POLLER rather than making an SSH call of our own:
     * it already asks the host for `status` every fifteen seconds, and a second
     * caller would double the traffic to learn a number that is already in
     * memory.
     *
     * ZERO WHILE PARKED, DELIBERATELY. `behindMain` is the distance from main,
     * which is a number the box is not tracking while it runs a branch: it will
     * be large, permanently, and it is not describing an update anybody is
     * waiting for. Reporting it would badge "3 commits behind" in the console
     * chrome and nudge admins in game to schedule a deploy that would refresh
     * the parked branch rather than ship main — an offer whose description and
     * behaviour disagree. The off-main banner is what should be visible
     * instead, and it is.
     *
     * GATED ON `isParkedOffMain`, NOT ON `!onMain`, AND THAT AVOIDS A DEADLOCK.
     * `onMain` is false for a host that has not answered the question — which
     * is every game box until it has deployed the dispatcher that reports the
     * field. Suppressing the update signal on that basis would zero
     * `updateAvailable`, which blanks the maintenance page ("running the latest
     * code") and makes `POST /api/maintenance` refuse ("nothing to deploy") —
     * so the console would refuse to deploy the very commit that teaches the
     * box to answer, and the only way out would be an SSH session and a
     * hand-typed `systemctl start royale-deploy`. Suppress on a stated fact;
     * leave an unanswering host behaving exactly as it did before.
     *
     * NULL IS "THE HOST HAS NOT ANSWERED", AND IT WRITES NOTHING AT ALL. This
     * was `status?.behindMain ?? 0`, and the coalesce was a real bug rather than
     * a tidiness complaint. `ensureDriver` starts this tick and the telemetry
     * poller in the same breath, and the poller's first answer is an SSH round
     * trip away — so the first tick after EVERY console restart ran with a null
     * status, called `noteUpdateAvailable(0)`, and that call clears BOTH
     * `updateAvailable` and `updateFirstSeenAt`. The second is the start of the
     * 72-hour clock, so a console restarted daily reset the deadline daily and
     * the automatic window could never arrive. `behindMainNow` returns null
     * instead, and null means we skip the write and leave the row exactly as the
     * last tick that actually knew something left it.
     *
     * THE ZERO WHILE PARKED IS STILL WRITTEN, and has to be. `behindMainNow`
     * answers null off main as well — for a different reason, "that question
     * does not apply" rather than "we have not asked" — so the deliberate pin
     * cannot come from it. The ternary supplies it, which keeps the two rules
     * visible as two rules.
     */
    const behind = isParkedOffMain(status) ? 0 : maint.behindMainNow(status)
    if (behind !== null) {
      await maint.noteUpdateAvailable(behind).catch(() => {})
    }

    /**
     * The automation. An update nobody schedules is the normal outcome of a
     * busy week, and the cost is silent drift — so after three days the console
     * schedules the window itself, attributed to `system` so the audit log
     * never implies a person chose this moment.
     *
     * `onMain` IS THE GATE, AND IT IS STRICTER THAN THE LINE ABOVE. A host that
     * does not answer "which ref" still reports its distance from main, so
     * `behind` above can be positive while `onMain` is false. That combination
     * is exactly the one where the console must not schedule anything by
     * itself: it would be firing a deploy at a box whose state it cannot read.
     * A human can still schedule it from the page, with their name on it.
     *
     * Re-read after noteUpdateAvailable so `updateFirstSeenAt` is the value
     * just written rather than the one from before this tick.
     *
     * `behind !== null` IS THE SAME FAIL-QUIET DIRECTION EVERY OTHER GATE HERE
     * TAKES. A tick that does not know how far behind main the box is does not
     * schedule a deploy on the strength of not knowing; it waits for the poller,
     * which is fifteen seconds away.
     */
    if (!maint.isLive(w) && onMain && behind !== null && behind > 0) {
      const fresh = await maint.current()
      const deadline = maint.autoDeadline(fresh?.updateFirstSeenAt)
      if (deadline !== null && now >= deadline) {
        await maint
          .schedule({
            createdBy: null,
            createdByName: 'system',
            note: `Automatic update — ${behind} commit${behind === 1 ? '' : 's'} behind for over 72 hours`,
            drainStartsAt: now,
            deployMode: 'when-empty',
            deployAt: null,
          })
          .then(async () => {
            await audit.begin({
              action: 'maintenance.schedule',
              actor: { license: null, name: 'system', discordId: null },
              reason: 'Update available for more than 72 hours',
              detail: { behind, automatic: true },
            })
          })
          .catch(() => {})
        w = remember(await maint.current())
      }
    }

    if (!maint.isLive(w)) return

    // scheduled -> draining, once the clock passes.
    if (w.state === 'scheduled' && now >= w.drainStartsAt) {
      await maint.markDraining().catch(() => {})
      await refresh()
      await audit.begin({
        action: 'maintenance.drain',
        actor: {
          license: w.createdBy,
          name: w.createdByName,
          discordId: null,
        },
        reason: w.note,
        detail: { deployMode: w.deployMode },
      })
      return
    }

    if (w.state !== 'draining') return

    /**
     * The live view is read ONCE here and used twice: the player count that
     * decides whether to fire, and the boot epoch of the process the deploy is
     * about to restart. Two reads could straddle a push and pair a count with
     * an epoch from a different snapshot, which is the one pairing the
     * completion gate must not get wrong.
     */
    const feed = liveView(now)
    const players = feed.counts.connected

    /**
     * WHY EMPTY IS THE TRIGGER RATHER THAN A TIMER. The whole point of draining
     * is that nobody loses a match to the restart, and the only fact that
     * guarantees it is nobody being on the server. A "probably done by now"
     * timeout would end somebody's game to save a few minutes of waiting.
     */
    const emptied = w.deployMode === 'when-empty' && players === 0

    /**
     * The timed mode fires on the clock whether or not anybody is left — that
     * is what asking for a specific time means. It is not the default for
     * exactly this reason.
     */
    const timeUp =
      w.deployMode === 'at-time' && w.deployAt !== null && now >= w.deployAt

    if (!emptied && !timeUp) return

    /**
     * THE BOOT EPOCH GOES ON THE ROW IN THE SAME WRITE THAT STARTS THE DEPLOY,
     * and this is the last instant it is worth recording: from here on the
     * process it names is being killed, and anything the console hears
     * afterwards is what we will be comparing against it. Null when the console
     * has never had a push — `heartbeatIsFresh` falls back to the timestamp
     * comparison there rather than refusing to ever confirm.
     */
    await maint.markDeploying({ bootEpoch: feed.bootEpoch }).catch(() => {})
    /**
     * BEFORE THE DEPLOY, NOT AFTER IT, AND THAT ORDERING IS THE POINT. The
     * `runDeploy` below is the long await — an SSH round trip that restarts the
     * game server — and it is exactly the window in which the feed goes quiet.
     * Publishing `deploying` first is what lets the header say "Updating"
     * DURING the outage rather than explaining it once it is over.
     */
    await refresh()

    const actor = {
      license: w.createdBy,
      name: w.createdByName,
      discordId: null,
    }
    const { ts } = await audit.begin({
      action: 'maintenance.deploy',
      actor,
      reason: w.note,
      detail: {
        trigger: emptied ? 'server empty' : 'scheduled time',
        playersOnline: players,
        // Both, or the row cannot answer "what actually got deployed" later.
        // The name alone is ambiguous once a branch has moved on.
        targetRef: w.targetRef ?? null,
        targetSha: w.targetSha ?? null,
        /**
         * AND FOR A WINDOW THAT SWITCHES NOTHING, the ref the box is actually
         * on at the moment the deploy fires — which is precisely what
         * `deploy.sh` is about to refresh, since it resolves the branch from
         * the pin file and `symbolic-ref HEAD` rather than assuming main.
         *
         * Without this, a scheduled refresh of a parked branch audits as a
         * deploy with no target at all, and the log cannot answer which branch
         * restarted. Null when the window carries a `targetRef`, because the
         * two lines above already say it, and null on main because there it
         * would only repeat the default.
         */
        refreshingRef: w.targetRef
          ? null
          : isParkedOffMain(status)
            ? (status?.deployedRef ?? null)
            : null,
      },
    })

    const res = await runDeploy(w)
    await audit.resolve(ts, res.ok ? 'ok' : 'failed', res.error ?? null)
    await maint.markComplete(res.error ?? null).catch(() => {})
    /**
     * `completedAt` IS THE CLOCK THE "IS IT BACK YET" TEST RUNS AGAINST, so it
     * has to reach the cache immediately rather than on the next tick. Until it
     * does, `updateInProgress` sees a window still marked `deploying` and keeps
     * saying Updating — which is the safe direction, but it would also delay the
     * completion toast by up to a tick for no reason.
     */
    await refresh()
  } catch (e) {
    console.error('[maintenance] tick failed', e)
  } finally {
    globalForDriver.ringMaintBusy = false
  }
}

/**
 * Start the driver once.
 *
 * Called from the pages and routes that touch maintenance, the same lazy
 * pattern the telemetry poller uses: no timer exists until somebody has looked
 * at the console at least once since it booted.
 *
 * THE LAZINESS HAS A REAL EDGE. A window scheduled before a console restart
 * does not advance until the first request afterwards. That is acceptable
 * because the state is derived from the clock rather than from having been
 * watched — nothing is missed, it is only noticed late — and because a console
 * nobody has opened in hours is one where a fifteen-second delay changes
 * nothing.
 */
export function ensureDriver(): void {
  if (globalForDriver.ringMaintTimer) return
  // The driver reads behindMain out of the telemetry window, so that poller
  // has to be running for the update signal to mean anything.
  ensurePolling()
  globalForDriver.ringMaintTimer = setInterval(() => void tick(), TICK_MS)
  void tick()
}
