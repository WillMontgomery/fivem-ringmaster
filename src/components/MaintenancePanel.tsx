'use client'

import {
  ArrowUpCircle,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  Info,
  Loader2,
  Rocket,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ConfirmDialog'
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

function clock(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function until(ts: number, now: number): string {
  const ms = ts - now
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `in ${m}m`
  return `in ${Math.floor(m / 60)}h ${m % 60}m`
}

/** Local datetime string for an <input type="datetime-local"> default. */
function localInput(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function MaintenancePanel({
  initial,
  initialPlayers,
  canRun,
}: {
  initial: MaintenanceWindow | null
  initialPlayers: number
  canRun: boolean
}) {
  const router = useRouter()
  const [w, setW] = useState(initial)
  const [players, setPlayers] = useState(initialPlayers)
  const [now, setNow] = useState(() => Date.now())

  const [drainIn, setDrainIn] = useState('0')
  const [advanced, setAdvanced] = useState(false)
  const [timed, setTimed] = useState(false)
  const [deployAt, setDeployAt] = useState(() =>
    localInput(Date.now() + 60 * 60_000),
  )
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)

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

        seenState.current = nextState
        setW(next)
        setPlayers(d.players ?? 0)
      } catch {
        /* keep the last view; the clock still ticks */
      }
    }
    void tick()
    const t = setInterval(tick, 5_000)
    return () => clearInterval(t)
  }, [])

  const live =
    w && (w.state === 'scheduled' || w.state === 'draining' || w.state === 'deploying')

  const schedule = async () => {
    setBusy(true)
    try {
      await postJson('/api/maintenance', {
        drainInMinutes: Number(drainIn),
        deployMode: timed ? 'at-time' : 'when-empty',
        deployAt: timed ? new Date(deployAt).getTime() : null,
      })
      toast.success(
        timed
          ? `Maintenance scheduled. Deploy at ${clock(new Date(deployAt).getTime())}.`
          : 'Maintenance scheduled. It will deploy once the server empties.',
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not schedule.')
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

  // ---------------------------------------------------------------- live ----

  if (live && w) {
    const draining = w.state === 'draining' || now >= w.drainStartsAt
    return (
      <>
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
              <p className="mt-1 text-sm text-muted-foreground">“{w.note}”</p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Scheduled by {w.createdByName} · {clock(w.createdAt)}
              </p>
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
              <p className="text-muted-foreground">
                This runs <code className="font-mono">royale-deploy</code>: pull
                main, sync resources, restart FXServer. The machine itself is not
                rebooted.
              </p>
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
      {behind > 0 ? (
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

      <MaintenanceExplainer />
    </div>
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
      body: 'Ringmaster notices the server is behind main, badges it here and in the header, and tells any admin in game so somebody schedules it.',
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
      body: 'Once the last player leaves, royale-deploy pulls main, syncs the resources and restarts FXServer.',
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
      </div>
    </Card>
  )
}
