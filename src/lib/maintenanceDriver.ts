import * as audit from './audit'
import * as maint from './maintenance'
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
    let w = await maint.current()
    const now = Date.now()

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
     */
    const behind = isParkedOffMain(status) ? 0 : (status?.behindMain ?? 0)
    await maint.noteUpdateAvailable(behind).catch(() => {})

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
     */
    if (!maint.isLive(w) && onMain && behind > 0) {
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
        w = await maint.current()
      }
    }

    if (!maint.isLive(w)) return

    // scheduled -> draining, once the clock passes.
    if (w.state === 'scheduled' && now >= w.drainStartsAt) {
      await maint.markDraining().catch(() => {})
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

    const players = liveView(now).counts.connected

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

    await maint.markDeploying().catch(() => {})

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
      },
    })

    const res = await runDeploy(w)
    await audit.resolve(ts, res.ok ? 'ok' : 'failed', res.error ?? null)
    await maint.markComplete(res.error ?? null).catch(() => {})
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
