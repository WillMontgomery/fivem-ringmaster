'use client'

import {
  CalendarClock,
  Loader2,
  Rocket,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api'
import type { MaintenanceWindow } from '@/lib/maintenance'
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

  const [note, setNote] = useState('')
  const [drainIn, setDrainIn] = useState('30')
  const [timed, setTimed] = useState(false)
  const [deployAt, setDeployAt] = useState(() =>
    localInput(Date.now() + 60 * 60_000),
  )
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)

  // Poll rather than rely on the page render: a window that starts draining, or
  // a server that empties, changes this display without anybody navigating.
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
        setW(d.window ?? null)
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
        note: note.trim(),
        drainInMinutes: Number(drainIn),
        deployMode: timed ? 'at-time' : 'when-empty',
        deployAt: timed ? new Date(deployAt).getTime() : null,
      })
      toast.success(
        timed
          ? `Maintenance scheduled. Deploy at ${clock(new Date(deployAt).getTime())}.`
          : 'Maintenance scheduled. It will deploy once the server empties.',
      )
      setNote('')
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
                    'gap-1 border-0 text-[10px] uppercase tracking-wider ring-1 ring-inset',
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
              <p className="mt-1 text-[13px] text-muted-foreground">“{w.note}”</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
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
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
              <div className="text-[11px] text-muted-foreground/60">
                {players === 0
                  ? 'server is empty'
                  : draining
                    ? 'waiting for them to finish'
                    : 'still joining'}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Draining
              </div>
              <div className="mt-0.5 text-xl">
                {draining ? 'Now' : until(w.drainStartsAt, now)}
              </div>
              <div className="text-[11px] text-muted-foreground/60">
                {draining ? 'refusing new players' : clock(w.drainStartsAt)}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Deploy
              </div>
              <div className="mt-0.5 text-xl">
                {w.deployMode === 'when-empty'
                  ? players === 0
                    ? 'Any moment'
                    : 'When empty'
                  : until(w.deployAt ?? 0, now)}
              </div>
              <div className="text-[11px] text-muted-foreground/60">
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

  if (!canRun) {
    return (
      <Card className="surface-edge gap-0 px-5 py-4">
        <h2 className="text-sm font-medium">No maintenance scheduled</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Scheduling maintenance needs the{' '}
          <code className="font-mono">process</code> scope — it restarts the game
          server.
        </p>
      </Card>
    )
  }

  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <h2 className="text-sm font-medium">Schedule maintenance</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        The server stops accepting players, finishes the matches already running,
        then deploys the latest main and restarts. Nothing reboots.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="m-note">What is it for — players see this</Label>
          <Textarea
            id="m-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Deploying the storm-damage fix"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="m-drain">Stop accepting players</Label>
          <Select value={drainIn} onValueChange={(v) => setDrainIn(v ?? '30')}>
            <SelectTrigger id="m-drain" className="w-full">
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

        {/*
          Waiting for empty is the default because it is the kind option and
          almost always works. A fixed time is for a deadline you are willing to
          end a match for — which is why it is a checkbox you have to reach for
          rather than the thing already selected.
        */}
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="m-timed"
            checked={timed}
            onCheckedChange={(v) => setTimed(v === true)}
          />
          <Label htmlFor="m-timed" className="font-normal">
            Deploy at a specific time instead of waiting for the server to empty
          </Label>
        </div>

        {timed && (
          <div className="space-y-1.5">
            <Label htmlFor="m-at">Deploy at</Label>
            <Input
              id="m-at"
              type="datetime-local"
              value={deployAt}
              onChange={(e) => setDeployAt(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-[11px] text-warn">
              Anyone still connected at that moment is disconnected mid-match.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button disabled={busy || note.trim().length < 5} onClick={schedule}>
            {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />}
            Schedule
          </Button>
        </div>
      </div>
    </Card>
  )
}
