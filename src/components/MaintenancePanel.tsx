'use client'

import {
  ArrowUpCircle,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  Rocket,
  Undo2,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LocalTime } from '@/components/LocalTime'
import { useFormatInstant } from '@/components/PrefsProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { postJson } from '@/lib/api'
import { AUTO_AFTER_MS, type MaintenanceWindow } from '@/lib/maintenance'
import type { HostBranch } from '@/lib/ssh'
import { cn } from '@/lib/utils'

/**
 * Schedule, watch and call off a maintenance window.
 *
 * THE PAGE IS MOSTLY A STATUS DISPLAY, and that is correct: once a window is
 * scheduled the interesting question stops being "what did I ask for" and
 * becomes "how far along is it and how many people are still on". Scheduling is
 * a form you use once; draining is a thing you watch.
 */

const DRAIN_CHOICES = [
  { value: '0', label: 'Immediately' },
  { value: '15', label: 'In 15 minutes' },
  { value: '30', label: 'In 30 minutes' },
  { value: '60', label: 'In 1 hour' },
] as const

function until(ts: number, now: number): string {
  const ms = ts - now
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `in ${m}m`
  return `in ${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Local datetime string for an <input type="datetime-local"> default.
 *
 * THE OFFSET IS SAMPLED AT `ts`, NOT AT NOW, and that is a bug fix rather than
 * a tidy-up. `new Date().getTimezoneOffset()` asks "what is the offset right
 * now"; across a DST boundary the answer for the moment being rendered is an
 * hour different. Scheduling a deploy for the far side of a clock change put
 * the wrong hour in the field, and the field controls when the production game
 * server restarts.
 *
 * STAYS BROWSER-LOCAL, deliberately, and is the one thing in this console that
 * ignores the timezone preference. `<input type="datetime-local">` is parsed by
 * the browser in the browser's zone (see the `new Date(deployAt)` in
 * `schedule()`), so re-rendering the field in a different zone while the parse
 * stayed browser-local would put the typed value and the resulting instant five
 * hours apart on a form that restarts a live server. The form says which zone
 * it is in instead — see the note beside the input.
 */
function localInput(ts: number): string {
  const offsetAtTs = new Date(ts).getTimezoneOffset()
  return new Date(ts - offsetAtTs * 60_000).toISOString().slice(0, 16)
}

export function MaintenancePanel({
  initial,
  initialPlayers,
  canRun,
  initialDeployedRef,
}: {
  initial: MaintenanceWindow | null
  initialPlayers: number
  canRun: boolean
  /**
   * What the game host is running right now, or null if it has not said.
   *
   * NULL AND 'main' ARE NOT THE SAME THING here, for the same reason they are
   * not the same thing in `lib/ssh`: null is a host that has not answered — an
   * unconfigured channel, or a dispatcher older than this feature — and the
   * page renders exactly as it always did for it. Only a stated ref that is not
   * `main` puts this page into its parked shape.
   */
  initialDeployedRef: string | null
}) {
  const router = useRouter()
  const [w, setW] = useState(initial)
  const [players, setPlayers] = useState(initialPlayers)
  const [now, setNow] = useState(() => Date.now())
  const [deployedRef, setDeployedRef] = useState(initialDeployedRef)

  const [drainIn, setDrainIn] = useState('0')
  const [advanced, setAdvanced] = useState(false)
  const [timed, setTimed] = useState(false)
  const [deployAt, setDeployAt] = useState(() =>
    localInput(Date.now() + 60 * 60_000),
  )
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)

  // ------------------------------------------------------------- branches ---
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [branches, setBranches] = useState<HostBranch[] | null>(null)
  const [branchesStale, setBranchesStale] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [picked, setPicked] = useState<HostBranch | null>(null)
  const [confirmSwitch, setConfirmSwitch] = useState(false)

  /**
   * PARKED IS A STATED FACT, NOT THE ABSENCE OF ONE. See the prop comment: a
   * host that has not answered renders as it always has.
   */
  const parked = typeof deployedRef === 'string' && deployedRef !== 'main'

  /**
   * Every time this panel DISPLAYS is in the reader's stated zone and says so.
   * The one time it READS — the datetime-local field — is in the browser's.
   */
  const { format, timeZone } = useFormatInstant()
  const clock = (ts: number) => format(ts, { withYear: false })

  /**
   * The browser's own zone, read after mount because `Intl` during render is
   * one answer on the server and another here.
   *
   * WHEN THE TWO DISAGREE THE FORM HAS TO SAY SO. This is the highest
   * consequence surface in the console: the field below is parsed browser-local
   * while every label around it is rendered in the preference zone. An admin
   * whose preference is New York, sitting in London, would otherwise type 10:00
   * meaning one and get the other — and the thing that moves is a production
   * game-server restart, five hours early.
   */
  const [browserZone, setBrowserZone] = useState<string | null>(null)
  useEffect(() => {
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])
  const zoneMismatch = browserZone !== null && browserZone !== timeZone

  // Last state we announced. null until the first poll, so opening the page
  // during a live window does not toast about something already underway.
  const seenState = useRef<string | null>(null)

  /**
   * Poll, and announce what changed.
   *
   * EVERY OPEN CONSOLE LEARNS WHAT EVERY OTHER ADMIN DID, which matters because
   * maintenance is the one action here whose effects another admin will notice
   * before they notice the cause: the player count starts falling and joins
   * stop. Deriving the toast from a state CHANGE rather than pushing a message
   * costs nothing — the poll already runs — and works for the admin who opened
   * the page thirty seconds after somebody else clicked.
   *
   * The previous state is held in a ref so a re-render cannot re-fire a toast
   * that has already been shown.
   */
  useEffect(() => {
    const tick = async () => {
      setNow(Date.now())
      try {
        const res = await fetch('/api/maintenance', { cache: 'no-store' })
        if (!res.ok) return
        const d = (await res.json()) as {
          window?: MaintenanceWindow | null
          players?: number
        }
        const next = d.window ?? null
        const prev = seenState.current
        const nextState = next?.state ?? 'none'

        if (prev !== null && prev !== nextState) {
          if (nextState === 'scheduled') {
            toast.info(
              `${next?.createdByName ?? 'Someone'} scheduled a server update.`,
              { description: 'It deploys once the server empties.' },
            )
          } else if (nextState === 'draining') {
            toast.warning('The server has stopped accepting new players.', {
              description: 'The update runs as soon as everyone has left.',
            })
          } else if (nextState === 'deploying') {
            toast.info('The update is being deployed now.')
          } else if (prev === 'deploying' && nextState === 'complete') {
            toast.success('Server update completed. The server is back open.')
          } else if (nextState === 'cancelled') {
            toast.info(
              `${next?.cancelledByName ?? 'Someone'} cancelled the maintenance window.`,
            )
          }
        }

        /**
         * A STATE CHANGE HAS TO RE-RENDER THE SERVER COMPONENTS TOO.
         *
         * The sidebar and header badges are resolved in AppShell, which is a
         * server component — so this poll updated the panel while the
         * "maintenance draining" badge beside the nav item stayed exactly as it
         * was, indefinitely, long after the update had finished. It only
         * cleared on a hard navigation, which is not something anybody does
         * while watching a deploy.
         *
         * router.refresh() re-runs the server render, which re-reads the row
         * and drops the badge. Only on a CHANGE, never per poll: refreshing
         * every five seconds would re-fetch every server component on the page
         * forever.
         */
        if (prev !== null && prev !== nextState) {
          router.refresh()
        }

        seenState.current = nextState
        setW(next)
        setPlayers(d.players ?? 0)
      } catch {
        /* keep the last view; the clock still ticks */
      }

      /**
       * Which ref the box is on, refreshed in the same beat.
       *
       * A SEPARATE, CHEAP READ. /api/host answers from the telemetry poller's
       * in-memory snapshot and makes no SSH call of its own, so this costs a
       * local round trip rather than a trip to the game box — unlike
       * /api/host/branches, which really does fetch and is therefore only
       * loaded on demand.
       *
       * It matters here specifically because a deploy CHANGES this value: an
       * admin who switches to a branch and watches the window through would
       * otherwise be looking at a page still describing the old ref, on the one
       * screen where that fact is the entire subject.
       */
      try {
        const hres = await fetch('/api/host', { cache: 'no-store' })
        if (hres.ok) {
          const hv = (await hres.json()) as {
            status?: { deployedRef?: string } | null
          }
          setDeployedRef(
            typeof hv.status?.deployedRef === 'string'
              ? hv.status.deployedRef
              : null,
          )
        }
      } catch {
        /* leave the last known ref; a dropped poll is not a branch change */
      }
    }
    void tick()
    const t = setInterval(tick, 5_000)
    return () => clearInterval(t)
  }, [])

  const live =
    w && (w.state === 'scheduled' || w.state === 'draining' || w.state === 'deploying')

  /**
   * Read the branch list off the game host.
   *
   * ON DEMAND, NEVER POLLED. Every other host read in this console is on a
   * timer; this one costs a real `git fetch --prune` against GitHub on the game
   * box, and the answer changes when somebody pushes rather than every fifteen
   * seconds. Opening the picker asks once; the refresh button asks again.
   */
  const loadBranches = async () => {
    setLoadingBranches(true)
    setBranchError(null)
    try {
      const res = await fetch('/api/host/branches', { cache: 'no-store' })
      const text = await res.text()
      let d: {
        ok?: boolean
        error?: string
        stale?: boolean
        deployedRef?: string
        branches?: HostBranch[]
      }
      try {
        d = JSON.parse(text) as typeof d
      } catch {
        throw new Error(
          `Server returned ${res.status} ${res.statusText}. ` +
            `Body began: ${text.slice(0, 80).replace(/\s+/g, ' ').trim() || '(empty)'}`,
        )
      }
      if (!res.ok || d.ok === false) {
        throw new Error(d.error ?? `Request failed (${res.status}).`)
      }
      setBranches(d.branches ?? [])
      setBranchesStale(Boolean(d.stale))
      if (typeof d.deployedRef === 'string') setDeployedRef(d.deployedRef)
    } catch (e) {
      setBranches(null)
      setBranchError(e instanceof Error ? e.message : 'Could not read the branches.')
    } finally {
      setLoadingBranches(false)
    }
  }

  /**
   * Schedule a window, optionally putting a different branch on the box.
   *
   * THE SHA TRAVELS WITH THE NAME, ALWAYS. It was resolved on the game host
   * when the list was drawn, and it is what makes the difference between "put
   * feature/x on the box" and "put whatever feature/x happens to be by the time
   * the last match ends". Anyone with push access can move a branch in that
   * gap, and the box refuses rather than deploying a tip nobody looked at.
   */
  const scheduleWith = async (target: HostBranch | null) => {
    setBusy(true)
    try {
      await postJson('/api/maintenance', {
        drainInMinutes: Number(drainIn),
        deployMode: timed ? 'at-time' : 'when-empty',
        deployAt: timed ? new Date(deployAt).getTime() : null,
        ...(target ? { targetRef: target.name, targetSha: target.sha } : {}),
      })
      const what = target
        ? `Switching to ${target.name} (${target.sha.slice(0, 8)}).`
        : 'Maintenance scheduled.'
      toast.success(
        timed
          ? `${what} Deploy at ${clock(new Date(deployAt).getTime())}.`
          : `${what} It deploys once the server empties.`,
      )
      // `picked` is deliberately NOT cleared here. The confirm dialog reads it
      // for its own title, and clearing it inside the awaited handler renders
      // one frame of "Put this branch on the live server?" before the dialog
      // closes. The window is live after this, so the picker is not on screen
      // to be stale.
      setBranchesOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not schedule.')
    } finally {
      setBusy(false)
    }
  }

  const schedule = () => scheduleWith(null)

  /**
   * Back to main, in one click.
   *
   * IT USES THE ORDINARY CHANNEL, and that is safe for one specific reason
   * rather than by luck: `tools/dispatch.sh` refuses to pin any ref whose own
   * copy of `tools/dispatch.sh` differs from main's, and `tools/deploy.sh`
   * refuses to check one out. So the dispatcher answering this revert is
   * byte-identical to the reviewed one no matter what the box is parked on —
   * there is no reachable state in which the thing being recovered from is also
   * the thing performing the recovery.
   *
   * IT STILL RESOLVES main TO A SHA FIRST rather than sending the bare name.
   * Same rule as every other switch, and it costs one round trip that the admin
   * sees as a spinner. Sending a name alone would be the one unpinned deploy in
   * the system, on the path that matters most.
   *
   * NO OPTIONS AND NO CONFIRMATION. Drain immediately, deploy when empty. The
   * whole point of the target-based confirmation rule in the switch dialog is
   * that returning to reviewed code has to be cheaper than the mistake that
   * made it necessary.
   */
  const revert = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/host/branches', { cache: 'no-store' })
      const d = (await res.json()) as {
        ok?: boolean
        error?: string
        branches?: HostBranch[]
      }
      if (!res.ok || d.ok === false) {
        throw new Error(d.error ?? `Could not read the branch list (${res.status}).`)
      }
      const main = d.branches?.find((b) => b.name === 'main')
      if (!main) {
        throw new Error('The game host did not report a main branch.')
      }
      if (!main.eligible) {
        throw new Error(`main cannot be deployed right now: ${main.blockedBy}`)
      }

      await postJson('/api/maintenance', {
        drainInMinutes: 0,
        deployMode: 'when-empty',
        deployAt: null,
        targetRef: 'main',
        targetSha: main.sha,
      })
      toast.success('Reverting to main. It deploys once the server empties.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revert.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    try {
      await postJson('/api/maintenance/cancel', {})
      toast.success('Maintenance cancelled. The server is accepting players again.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel.')
    }
  }

  const force = async () => {
    try {
      const d = await postJson<{ playersAffected?: number }>(
        '/api/maintenance/force',
        {},
      )
      toast.success(
        d.playersAffected
          ? `Deploy started. ${d.playersAffected} player${d.playersAffected === 1 ? ' was' : 's were'} disconnected.`
          : 'Deploy started.',
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not deploy.')
    }
  }

  /**
   * The parked notice, rendered above BOTH shapes of this page.
   *
   * ABOVE THE LIVE VIEW TOO, which is the case it would be easy to skip. The
   * live view replaces the whole page while a window is draining, and an admin
   * arriving then is watching a deploy land on a branch — the single moment
   * where "which code is this" matters most. The revert button is disabled
   * rather than hidden in that state, with the reason, because a button that
   * vanishes teaches nothing about why.
   */
  const parkedCard = parked ? (
    <Card className="gap-0 border-warn/40 bg-warn/5 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-warn" />
            <h2 className="text-sm font-medium text-warn">
              This server is not running main
            </h2>
          </div>
          <p className="mt-1 text-sm">
            It is parked on{' '}
            <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs">
              {deployedRef}
            </code>
            . Every deploy from here refreshes that branch until somebody
            switches back — nothing returns it to main on its own.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Automatic updates are paused while it is parked, so an update
            waiting behind this branch waits indefinitely.
          </p>
        </div>

        {canRun && (
          <Button
            variant="default"
            disabled={busy || Boolean(live)}
            title={
              live
                ? 'Cancel the window that is already scheduled first.'
                : undefined
            }
            onClick={revert}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
            Revert to main
          </Button>
        )}
      </div>
    </Card>
  ) : null

  // ---------------------------------------------------------------- live ----

  if (live && w) {
    const draining = w.state === 'draining' || now >= w.drainStartsAt
    return (
      <>
        {/* The spacing lives here rather than on the card below, which would
            otherwise carry a top margin with nothing above it on a box that is
            on main — the ordinary case. */}
        {parkedCard && <div className="mb-4">{parkedCard}</div>}

        <Card className="surface-edge gap-0 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">
                  {w.state === 'deploying'
                    ? 'Deploying'
                    : draining
                      ? 'Draining'
                      : 'Maintenance scheduled'}
                </h2>
                <Badge
                  className={cn(
                    'gap-1 border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                    w.state === 'deploying'
                      ? 'bg-primary/10 text-primary ring-primary/30'
                      : draining
                        ? 'bg-warn/10 text-warn ring-warn/30'
                        : 'bg-info/10 text-info ring-info/30',
                  )}
                >
                  {w.state === 'deploying' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CalendarClock className="size-3" />
                  )}
                  {w.state}
                </Badge>
              </div>
              {/* The note is gone from here. Every window says the same thing
                  -- "a server update" -- because that is the only kind of
                  window this system schedules, so quoting it back added a line
                  of text that never varied. Who and when do vary, and they are
                  what an admin arriving at this page needs. */}
              <p className="mt-1 text-xs text-muted-foreground/60">
                Scheduled by {w.createdByName} · {clock(w.createdAt)}
              </p>
              {/*
                WHAT THIS WINDOW WILL PUT ON THE BOX, named on the page that
                watches it happen. A window that switches branch looks
                identical to an ordinary update everywhere else — same drain,
                same countdown, same buttons — and the difference is the entire
                consequence. The sha is shown as well as the name because the
                name stops identifying anything the moment somebody pushes.
              */}
              {w.targetRef && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <GitBranch className="size-3 text-warn" />
                  <span className="text-muted-foreground">Will deploy</span>
                  <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-warn">
                    {w.targetRef}
                  </code>
                  {w.targetSha && (
                    <code className="font-mono text-muted-foreground/70">
                      {w.targetSha.slice(0, 8)}
                    </code>
                  )}
                </p>
              )}
            </div>

            {canRun && w.state !== 'deploying' && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                  <X />
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmForce(true)}
                >
                  <Rocket />
                  Deploy now
                </Button>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Players online
              </div>
              <div
                className={cn(
                  'mt-0.5 text-xl tabular-nums',
                  players === 0 ? 'text-live' : 'text-foreground',
                )}
              >
                {players}
              </div>
              <div className="text-xs text-muted-foreground/60">
                {players === 0
                  ? 'server is empty'
                  : draining
                    ? 'waiting for them to finish'
                    : 'still joining'}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Draining
              </div>
              <div className="mt-0.5 text-xl">
                {draining ? 'Now' : until(w.drainStartsAt, now)}
              </div>
              <div className="text-xs text-muted-foreground/60">
                {draining ? 'refusing new players' : clock(w.drainStartsAt)}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Deploy
              </div>
              <div className="mt-0.5 text-xl">
                {w.deployMode === 'when-empty'
                  ? players === 0
                    ? 'Any moment'
                    : 'When empty'
                  : until(w.deployAt ?? 0, now)}
              </div>
              <div className="text-xs text-muted-foreground/60">
                {w.deployMode === 'when-empty'
                  ? 'automatic'
                  : clock(w.deployAt ?? 0)}
              </div>
            </div>
          </div>
        </Card>

        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Cancel this maintenance window?"
          confirmLabel="Confirm cancel"
          busyLabel="Cancelling…"
          onConfirm={cancel}
          body={
            <>
              <p>
                The server will start accepting players again straight away, and
                no deploy will run.
              </p>
              <p className="text-muted-foreground">
                There is no way to resume it — schedule a new window instead.
              </p>
            </>
          }
        />

        <ConfirmDialog
          open={confirmForce}
          onOpenChange={setConfirmForce}
          title="Deploy now?"
          confirmLabel="Confirm deploy"
          busyLabel="Deploying…"
          onConfirm={force}
          body={
            <>
              {players > 0 ? (
                <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
                  <strong>
                    {players} player{players === 1 ? ' is' : 's are'} still on the
                    server
                  </strong>{' '}
                  and will be disconnected mid-match. Their matches end here.
                </p>
              ) : (
                <p>The server is empty — nobody is affected.</p>
              )}
              {/*
                IT NAMES THE TARGET. This said "pull main" unconditionally,
                which was true when main was the only thing this system could
                deploy and is now a straightforward lie in the case that
                matters: an admin forcing a window that switches to a branch
                would read a confirmation describing a deploy of main and press
                it. The dialog that exists to make somebody stop and check has
                to be the one thing on the page that is exactly right.
              */}
              <p className="text-muted-foreground">
                This runs <code className="font-mono">royale-deploy</code>:{' '}
                {w.targetRef ? (
                  <>
                    switch to{' '}
                    <code className="font-mono text-warn">{w.targetRef}</code>
                    {w.targetSha ? ` (${w.targetSha.slice(0, 8)})` : ''}, sync
                    resources, restart FXServer.
                  </>
                ) : (
                  <>
                    refresh{' '}
                    <code className="font-mono">{deployedRef ?? 'main'}</code>,
                    sync resources, restart FXServer.
                  </>
                )}
              </p>
              {w.targetRef && w.targetRef !== 'main' && (
                <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-warn">
                  <code className="font-mono">{w.targetRef}</code> has not been
                  through review. The server stays on it until somebody switches
                  back.
                </p>
              )}
            </>
          }
        />
      </>
    )
  }

  // ------------------------------------------------------------ schedule ----

  const behind = w?.updateAvailable ?? 0
  const deadline = w?.updateFirstSeenAt
    ? w.updateFirstSeenAt + AUTO_AFTER_MS
    : null

  return (
    <div className="space-y-4">
      {parkedCard}

      {/*
        SUPPRESSED WHILE PARKED. `behind` is forced to zero by the driver off
        main (it measures distance from main, which is not what a parked box is
        tracking), so this branch would render "the server is running the latest
        code" underneath a banner saying it is running an unreviewed branch —
        two true-ish sentences that together say something false.
      */}
      {parked ? null : behind > 0 ? (
        <Card className="surface-edge gap-0 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">Update available</h2>
                <Badge className="gap-1 border-0 bg-info/10 text-xs uppercase tracking-wider text-info ring-1 ring-inset ring-info/30">
                  <ArrowUpCircle className="size-3" />
                  {behind} commit{behind === 1 ? '' : 's'} behind
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Schedule it and the server drains, then deploys once everyone
                has left. Nobody loses a match.
              </p>
              {deadline && (
                <p className="mt-1 text-xs text-muted-foreground/70">
                  If nobody schedules it, this runs automatically on{' '}
                  <span className="text-foreground">{clock(deadline)}</span>.
                </p>
              )}
            </div>

            {canRun && (
              <Button disabled={busy} onClick={schedule}>
                {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                Schedule update
              </Button>
            )}
          </div>

          {canRun && (
            <>
              {/*
                The default path is one button. Everything below is folded away
                because choosing a time is the rare case — and a form with four
                controls makes the common action look as considered as the
                uncommon one.
              */}
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="mt-3 flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform',
                    advanced && 'rotate-180',
                  )}
                />
                {advanced ? 'Hide options' : 'Options'}
              </button>

              {advanced && (
                <div className="mt-3 space-y-4 border-t border-border pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="m-drain">Stop accepting players</Label>
                    <Select
                      value={drainIn}
                      onValueChange={(v) => setDrainIn(v ?? '0')}
                    >
                      <SelectTrigger id="m-drain" className="w-full max-w-xs">
                        <SelectValue>
                          {(value) =>
                            DRAIN_CHOICES.find((d) => d.value === value)?.label ??
                            'Choose when'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {DRAIN_CHOICES.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="m-timed"
                      checked={timed}
                      onCheckedChange={(v) => setTimed(v === true)}
                    />
                    <Label htmlFor="m-timed" className="font-normal">
                      Deploy at a specific time instead of waiting for the server
                      to empty
                    </Label>
                  </div>

                  {timed && (
                    <div className="space-y-1.5">
                      <Label htmlFor="m-at">Deploy at</Label>
                      <Input
                        id="m-at"
                        type="datetime-local"
                        value={deployAt}
                        max={deadline ? localInput(deadline) : undefined}
                        onChange={(e) => setDeployAt(e.target.value)}
                        className="max-w-xs"
                      />
                      {/* Only when the two genuinely differ — a permanent
                          "times are in your browser's zone" note beside a field
                          that already is would be noise on every load. */}
                      {zoneMismatch && (
                        <p className="text-xs text-warn">
                          The time you type here is in {browserZone!.replace(/_/g, ' ')},
                          your browser&rsquo;s zone. Everything else on this page
                          is shown in {timeZone.replace(/_/g, ' ')}.
                        </p>
                      )}
                      <p className="text-xs text-warn">
                        Anyone still connected at that moment is disconnected
                        mid-match.
                      </p>
                      {deadline && (
                        <p className="text-xs text-muted-foreground/70">
                          Cannot be later than {clock(deadline)} — the automatic
                          window would already have run by then, so a later time
                          would never happen.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!canRun && (
            <p className="mt-2 text-xs text-muted-foreground">
              Scheduling needs the <code className="font-mono">process</code>{' '}
              scope — it restarts the game server.
            </p>
          )}
        </Card>
      ) : (
        <Card className="surface-edge items-center px-6 py-12 text-center">
          <CircleCheck className="size-6 text-live" />
          <p className="mt-2 text-sm">The server is running the latest code.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Maintenance can only be scheduled when there is an update to deploy.
          </p>
        </Card>
      )}

      {canRun && (
        <BranchPicker
          open={branchesOpen}
          onOpenChange={(v) => {
            setBranchesOpen(v)
            if (v && branches === null && !loadingBranches) void loadBranches()
          }}
          branches={branches}
          stale={branchesStale}
          error={branchError}
          loading={loadingBranches}
          deployedRef={deployedRef}
          picked={picked}
          onPick={setPicked}
          onRefresh={loadBranches}
          busy={busy}
          onSchedule={() => {
            if (!picked) return
            /**
             * CONFIRM ON THE TARGET, NOT ON THE SOURCE.
             *
             * The obvious rule — "confirm when leaving main" — lets
             * feature/a → feature/b through without a word, and that is a
             * switch between two unreviewed trees on a box that is already off
             * reviewed code. It is at least as consequential as the first
             * switch was, and it is the one an admin is most likely to make
             * casually. Gate on where the server ENDS UP.
             *
             * Switching to main never asks, for the same reason: recovery has
             * to be cheaper than the mistake.
             */
            if (picked.name === 'main') void scheduleWith(picked)
            else setConfirmSwitch(true)
          }}
        />
      )}

      <ConfirmDialog
        open={confirmSwitch}
        onOpenChange={setConfirmSwitch}
        title={`Put ${picked?.name ?? 'this branch'} on the live server?`}
        confirmLabel="Confirm switch"
        busyLabel="Scheduling…"
        onConfirm={async () => {
          if (picked) await scheduleWith(picked)
        }}
        body={
          <>
            <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-warn">
              <code className="font-mono">{picked?.name}</code> at{' '}
              <code className="font-mono">{picked?.sha.slice(0, 8)}</code> has
              not been through review. It will run on the live game server until
              somebody switches back.
            </p>
            <p>
              The server drains first — nobody loses a match — and the switch
              lands once it empties. Automatic updates stop while it is parked.
            </p>
            <p className="text-muted-foreground">
              If that commit moves before the deploy runs, the game host refuses
              it rather than deploying something else. You would schedule again.
            </p>
          </>
        }
      />

      <MaintenanceExplainer />
    </div>
  )
}

/**
 * Pick a branch to put on the game host.
 *
 * A LIST, NOT A DROPDOWN, and that is decided by one requirement: branches that
 * cannot be deployed are shown DISABLED WITH THE REASON rather than omitted. A
 * reason is a sentence — "changes tools/dispatch.sh — deploy it through main
 * and PR review" — and a sentence does not fit in a select option. Omitting
 * them instead would be worse than either: the operator knows the branch
 * exists, cannot see it, and has no way to tell a rule from a bug.
 *
 * COLLAPSED BY DEFAULT because it is the rare path. The common action on this
 * page is one button that ships main, and putting a branch picker beside it at
 * equal weight would make the two look equally routine. They are not.
 */
function BranchPicker({
  open,
  onOpenChange,
  branches,
  stale,
  error,
  loading,
  deployedRef,
  picked,
  onPick,
  onRefresh,
  busy,
  onSchedule,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: HostBranch[] | null
  stale: boolean
  error: string | null
  loading: boolean
  deployedRef: string | null
  picked: HostBranch | null
  onPick: (b: HostBranch) => void
  onRefresh: () => void
  busy: boolean
  onSchedule: () => void
}) {
  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Deploy a different branch</span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {!open && (
        <p className="mt-1 text-xs text-muted-foreground">
          Run an unreviewed branch on the live server. It drains first, and the
          server stays on that branch until somebody switches back.
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Read from the game host, newest commit first. Ahead and behind are
              measured against what is running now.
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh
            </Button>
          </div>

          {/*
            SAID OUT LOUD RATHER THAN HIDDEN. The game host answers from the
            refs already on disk when its fetch does not finish inside the
            six-second SSH budget. A list quietly a day old is how somebody
            picks a commit that no longer exists — which the box would refuse,
            correctly and confusingly.
          */}
          {stale && (
            <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              The game host could not reach GitHub in time and answered from
              what it already had. This list may be out of date — press Refresh.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          {loading && branches === null && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Asking the game host…
            </p>
          )}

          {branches?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              The game host reported no branches at all, which should not
              happen. Check that its clone still has a remote.
            </p>
          )}

          {branches && branches.length > 0 && (
            <ul className="space-y-1.5">
              {branches.map((b) => {
                const isCurrent = b.name === deployedRef
                /**
                 * THE BRANCH THAT IS RUNNING IS STILL SELECTABLE ONCE IT MOVES,
                 * and that closes a real gap rather than being a nicety.
                 *
                 * Off main there is no "Schedule update" button — that button
                 * is driven by the distance from main, which is suppressed
                 * while parked — so if the current branch were disabled outright
                 * there would be NO way to pick up new commits pushed to the
                 * branch being tested. The whole point of parking on a branch is
                 * iterating on it.
                 *
                 * Only a branch that is both running and identical to what is
                 * deployed is disabled, because that deploy would restart every
                 * match to change nothing.
                 */
                const noChange = isCurrent && b.ahead === 0 && b.behind === 0
                const isPicked = picked?.name === b.name
                return (
                  <li key={b.name}>
                    <button
                      type="button"
                      disabled={!b.eligible || noChange}
                      aria-pressed={isPicked}
                      onClick={() => onPick(b)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                        isPicked
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border bg-card/40',
                        b.eligible && !noChange
                          ? 'hover:border-primary/40 hover:bg-primary/5'
                          : 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-sm">{b.name}</span>
                        <span className="font-mono text-xs text-muted-foreground/70">
                          {b.sha.slice(0, 8)}
                        </span>
                        {isCurrent && (
                          <Badge className="border-0 bg-live/10 text-xs uppercase tracking-wider text-live ring-1 ring-inset ring-live/30">
                            running now
                          </Badge>
                        )}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          +{b.ahead} / −{b.behind}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {b.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/60">
                        {b.tipAuthor} · {b.tipAt ? <LocalTime ms={b.tipAt} /> : '—'}
                      </p>
                      {/*
                        THE REASON, VERBATIM, ON THE DISABLED ROW. This is the
                        entire difference between a rule and a mystery: "changes
                        tools/dispatch.sh" tells an operator both why this
                        branch is refused and what to do about it, where a
                        greyed-out row with no text reads as a bug.
                      */}
                      {!b.eligible && b.blockedBy && (
                        <p className="mt-1 text-xs text-warn">
                          Cannot be deployed — {b.blockedBy}
                        </p>
                      )}
                      {noChange && b.eligible && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Already running, at this exact commit — there is
                          nothing to deploy.
                        </p>
                      )}
                      {isCurrent && !noChange && b.eligible && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Running, but it has moved since. Pick it to deploy the
                          new tip.
                        </p>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {picked && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                The server drains immediately and switches to{' '}
                <code className="font-mono text-foreground">{picked.name}</code>{' '}
                once the last match finishes.
              </p>
              <Button disabled={busy} onClick={onSchedule}>
                {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                Schedule switch
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * What actually happens, in order.
 *
 * WORTH THE SPACE because this is the one page whose button ends other
 * people's matches, and the sequence is not guessable from the controls. An
 * admin who understands that draining is gradual and the deploy waits for
 * empty will schedule it in the middle of the evening; one who assumes it
 * restarts immediately will put it off until 4am and never do it.
 */
function MaintenanceExplainer() {
  const steps = [
    {
      title: 'An update appears',
      body: 'Ringmaster asks the game host every 15 seconds whether it is behind main, and the host re-checks GitHub at most once a minute — so a new commit shows up here within about a minute of being merged. It then badges it, and tells any admin in game so somebody schedules it.',
    },
    {
      title: 'You schedule it',
      body: 'One button. The window is recorded in the audit log against your name, and everyone in the console and on the server is told what is coming.',
    },
    {
      title: 'The server drains',
      body: 'No new players are let in — they get an explanation at the door — and no new matches start. Everyone already playing carries on and finishes normally.',
    },
    {
      title: 'The update runs',
      body: 'Once the last player leaves, royale-deploy pulls the branch the server is on — normally main — syncs the resources and restarts FXServer.',
    },
    {
      title: 'Back to normal',
      body: 'The server accepts players again and the result — success or failure — lands in the audit log.',
    },
  ]

  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-info" />
        <h2 className="text-sm font-medium">How maintenance works</h2>
      </div>

      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">
            You can cancel any time before the deploy starts.
          </span>{' '}
          The server goes straight back to accepting players. Once the deploy is
          running it cannot be called off — the restart is already happening.
        </p>
        <p>
          <span className="font-medium text-foreground">
            An update left for 72 hours schedules itself.
          </span>{' '}
          It runs the same drain, and the audit log records it as initiated by{' '}
          <code className="font-mono">system</code>.
        </p>
        <p>
          <span className="font-medium text-foreground">Deploy now</span> skips
          the waiting and disconnects whoever is still playing. It asks first,
          and records who chose it and how many people were on.
        </p>
        <p>
          <span className="font-medium text-foreground">
            A branch other than main can be deployed,
          </span>{' '}
          for testing on the real server. The game host refuses any branch that
          changes its own control scripts, so a branch can change the game but
          never the console&rsquo;s channel to the box — which is what makes
          &ldquo;revert to main&rdquo; something you can always rely on.
          Automatic updates pause the whole time the server is off main, and
          nothing brings it back on its own.
        </p>
      </div>
    </Card>
  )
}
