'use client'

import { Ban as BanIcon, Loader2, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Ban } from '@/lib/bans'
import { cn } from '@/lib/utils'

/**
 * Issue and lift bans.
 *
 * WHAT THIS DOES NOT DO, said plainly in the UI as well as here: writing a ban
 * does not remove anybody from the server. It is a record the game host checks
 * when a license next connects. A player who is online right now stays online
 * until they reconnect, and pretending otherwise would be the single most
 * dangerous thing this page could do — an admin who believes a griefer is gone
 * stops watching them.
 */

function isActive(b: Ban, now: number): boolean {
  if (b.liftedAt) return false
  if (b.expiresAt !== null && b.expiresAt <= now) return false
  return true
}

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ModerationBoard({
  initial,
  canBan,
}: {
  initial: Ban[]
  /** Drives whether the form is offered. The API re-checks regardless. */
  canBan: boolean
}) {
  const [rows, setRows] = useState<Ban[]>(initial)
  const [now, setNow] = useState(() => Date.now())
  const [license, setLicense] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const refresh = useCallback(async () => {
    const res = await fetch('/api/bans', { cache: 'no-store' })
    if (res.ok) {
      const d = (await res.json()) as { bans?: Ban[] }
      setRows(d.bans ?? [])
    }
  }, [])

  /**
   * Every mutation goes through toast.promise, so the three states an admin
   * cares about — asked, succeeded, failed — are one visual grammar across the
   * whole console. The failure branch surfaces the API's own message, which is
   * written for an operator; unexpected errors are already generic by the time
   * they reach here (see lib/actions.ts).
   */
  const submit = async () => {
    setBusy(true)
    const body = {
      license: license.trim(),
      reason: reason.trim(),
      days: days.trim() ? Number(days) : null,
    }

    await toast
      .promise(
        (async () => {
          const res = await fetch('/api/bans', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const d = (await res.json()) as { ok?: boolean; error?: string }
          if (!res.ok || !d.ok) throw new Error(d.error ?? 'Ban failed.')
          return d
        })(),
        {
          loading: 'Issuing ban…',
          success: () => {
            setLicense('')
            setReason('')
            setDays('')
            void refresh()
            return 'Ban recorded. It applies the next time they connect.'
          },
          error: (e: Error) => e.message,
        },
      )
      .unwrap()
      .catch(() => {
        /* the toast is the report; nothing else to do */
      })

    setBusy(false)
  }

  const doLift = async (b: Ban) => {
    await toast
      .promise(
        (async () => {
          const res = await fetch('/api/bans/lift', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ license: b.license }),
          })
          const d = (await res.json()) as { ok?: boolean; error?: string }
          if (!res.ok || !d.ok) throw new Error(d.error ?? 'Lift failed.')
          return d
        })(),
        {
          loading: 'Lifting ban…',
          success: () => {
            void refresh()
            return 'Ban lifted. The record is kept.'
          },
          error: (e: Error) => e.message,
        },
      )
      .unwrap()
      .catch(() => {})
  }

  const active = rows.filter((b) => isActive(b, now))
  const past = rows.filter((b) => !isActive(b, now))

  return (
    <div className="space-y-4">
      {canBan && (
        <Card className="surface-edge gap-0 px-5 py-4">
          <h2 className="text-sm font-medium">Issue a ban</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Recorded against the license. It takes effect the next time that
            player connects — it does not remove anyone who is online now.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <label htmlFor="ban-license" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                License
              </label>
              <Input
                id="ban-license"
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder="license:0123abcd…"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ban-days" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Days (blank = permanent)
              </label>
              <Input
                id="ban-days"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                placeholder="7"
              />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <label htmlFor="ban-reason" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason — shown to the player
            </label>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Aimbot, match 3 — clip in #reports"
            />
          </div>

          <div className="mt-3 flex justify-end">
            <Button onClick={submit} disabled={busy || !license.trim() || reason.trim().length < 3}>
              {busy ? <Loader2 className="animate-spin" /> : <BanIcon />}
              Issue ban
            </Button>
          </div>
        </Card>
      )}

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <header className="flex items-baseline gap-2 border-b border-border bg-card/60 px-4 py-3">
          <span className="text-sm">Active bans</span>
          <span className="text-[11px] text-muted-foreground">{active.length}</span>
        </header>

        {active.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nobody is banned.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {active.map((b) => (
              <li key={b.license} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">
                      {b.playerName ?? 'Unknown player'}
                    </span>
                    <Badge className="border-0 bg-danger/10 text-[10px] uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30">
                      {b.expiresAt === null ? 'permanent' : `until ${when(b.expiresAt)}`}
                    </Badge>
                  </div>
                  <code className="block truncate font-mono text-[10px] text-muted-foreground/60">
                    {b.license}
                  </code>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {b.reason}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <div>{when(b.at)}</div>
                  <div className="text-muted-foreground/60">by {b.byName}</div>
                </div>
                {canBan && (
                  <Button variant="ghost" size="sm" onClick={() => doLift(b)}>
                    <ShieldOff />
                    Lift
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card className="surface-edge gap-0 overflow-hidden py-0">
          <header className="flex items-baseline gap-2 border-b border-border bg-card/60 px-4 py-3">
            <span className="text-sm">Lifted and expired</span>
            <span className="text-[11px] text-muted-foreground">{past.length}</span>
          </header>
          <ul className="divide-y divide-border/60">
            {past.map((b) => (
              <li key={b.license} className="flex items-center gap-4 px-4 py-2.5 opacity-70">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">
                    {b.playerName ?? 'Unknown player'}
                  </div>
                  <code className="block truncate font-mono text-[10px] text-muted-foreground/60">
                    {b.license}
                  </code>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-[10px] uppercase tracking-wider',
                    b.liftedAt ? 'text-info' : 'text-muted-foreground',
                  )}
                >
                  {b.liftedAt ? `lifted by ${b.liftedByName ?? 'unknown'}` : 'expired'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
