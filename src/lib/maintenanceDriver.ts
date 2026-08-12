import * as audit from './audit'
import * as maint from './maintenance'
import { runVerb, sshConfigured } from './ssh'
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
 * Ask the game host to run royale-deploy.
 *
 * NOT A REBOOT AND NOT A PROCESS KILL. The verb runs the same
 * `systemctl start royale-deploy` an operator would type: pull main, sync
 * resources, restart FXServer. The box stays up throughout.
 */
async function runDeploy(): Promise<{ ok: boolean; error?: string }> {
  if (!sshConfigured()) {
    return { ok: false, error: 'the command channel is not configured' }
  }
  try {
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
     * Keep the update signal fresh on the row the game polls.
     *
     * READ FROM THE TELEMETRY POLLER rather than making an SSH call of our own:
     * it already asks the host for `status` every fifteen seconds, and a second
     * caller would double the traffic to learn a number that is already in
     * memory.
     */
    const behind = hostView().status?.behindMain ?? 0
    await maint.noteUpdateAvailable(behind).catch(() => {})

    /**
     * The automation. An update nobody schedules is the normal outcome of a
     * busy week, and the cost is silent drift — so after three days the console
     * schedules the window itself, attributed to `system` so the audit log
     * never implies a person chose this moment.
     *
     * Re-read after noteUpdateAvailable so `updateFirstSeenAt` is the value
     * just written rather than the one from before this tick.
     */
    if (!maint.isLive(w) && behind > 0) {
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
      },
    })

    const res = await runDeploy()
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
