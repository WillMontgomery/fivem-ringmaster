import { authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as maint from '@/lib/maintenance'
import { runVerb, sshConfigured } from '@/lib/ssh'
import { liveView } from '@/lib/state'

/**
 * Deploy now, whoever is still online.
 *
 * THIS IS THE ONE PATH THAT ENDS MATCHES ON PURPOSE. Everything else about
 * maintenance is built to avoid exactly that: draining refuses new players so
 * the population can only fall, and the automatic deploy waits for zero. This
 * skips the waiting because sometimes a fix has to be out now and a match is
 * the cheaper thing to lose.
 *
 * BECAUSE IT IS DELIBERATE, IT IS RECORDED AS DELIBERATE. The audit row carries
 * who forced it and how many people were on the server when they did — the two
 * facts anybody asks about afterwards, and the ones nobody can reconstruct from
 * a restart timestamp alone.
 *
 * The UI asks "are you sure" and names the count. This route does not re-ask:
 * confirmation is a property of the interface, and an API that demanded a
 * magic `confirm: true` field would be theatre — anyone calling it directly has
 * already decided.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  try {
    const { actor } = await authorize('process')

    if (!sshConfigured()) {
      return Response.json(
        { ok: false, error: 'The command channel to the game server is not configured.' },
        { status: 503 },
      )
    }

    const w = await maint.current()
    if (!maint.isLive(w)) {
      return Response.json(
        { ok: false, error: 'There is no maintenance window to run.' },
        { status: 404 },
      )
    }
    if (w.state === 'deploying') {
      return Response.json(
        { ok: false, error: 'The deploy is already running.' },
        { status: 409 },
      )
    }

    const players = liveView(Date.now()).counts.connected

    await maint.markDeploying({
      forcedBy: actor.license,
      forcedByName: actor.name,
      withPlayers: players,
    })

    const { ts } = await audit.begin({
      action: 'maintenance.deploy',
      actor,
      reason: w.note,
      detail: { trigger: 'forced', playersOnline: players },
    })

    try {
      const res = await runVerb<{ ok: boolean; error?: string }>('deploy')
      if (!res.ok) throw new Error(res.error ?? 'deploy refused')
      await audit.resolve(ts, 'ok')
      await maint.markComplete(null)
      return Response.json({ ok: true, playersAffected: players })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await audit.resolve(ts, 'failed', message)
      await maint.markComplete(message)
      return Response.json(
        { ok: false, error: `The deploy failed: ${message}` },
        { status: 502 },
      )
    }
  } catch (e) {
    return errorResponse(e)
  }
}
