'use client'

import { Ban as BanIcon, Loader2, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Ban } from '@/lib/bans'

/**
 * Ban and lift, for one specific player.
 *
 * THE POINT IS THAT THE LICENSE IS ALREADY IN HAND. The Moderation page's form
 * makes you paste a license, which is fine when you are working from a Discord
 * report and awful when you are looking straight at the person — copying an
 * identifier from one panel into a box two clicks away is how the wrong player
 * gets banned. Here the license comes from the row you are already reading.
 *
 * IT DOES NOT HIDE ITSELF WHEN YOU LACK THE SCOPE. It says so instead: an admin
 * who cannot ban should learn that from the console rather than from a button
 * that mysteriously is not there. The API re-checks regardless — this is a
 * courtesy, never the boundary.
 */
export function PlayerActions({
  license,
  name,
  ban,
  canBan,
}: {
  license: string
  name: string
  /** The player's current ban row, if any. */
  ban: Ban | null
  canBan: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)

  const active =
    ban && !ban.liftedAt && (ban.expiresAt === null || ban.expiresAt > Date.now())

  const run = async (
    label: string,
    url: string,
    body: unknown,
    success: string,
  ) => {
    setBusy(true)
    await toast
      .promise(
        (async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const d = (await res.json()) as { ok?: boolean; error?: string }
          if (!res.ok || !d.ok) throw new Error(d.error ?? `${label} failed.`)
          return d
        })(),
        {
          loading: `${label}…`,
          success: () => {
            setReason('')
            setDays('')
            // Re-fetch the server component so the ban state on this page
            // reflects what just happened, without a full reload.
            router.refresh()
            return success
          },
          error: (e: Error) => e.message,
        },
      )
      .unwrap()
      .catch(() => {})
    setBusy(false)
  }

  if (!canBan) {
    return (
      <Card className="surface-edge gap-0 px-5 py-4">
        <h2 className="text-sm font-medium">Moderation</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          You can see this player&rsquo;s record but not act on it — issuing and
          lifting bans needs the <code className="font-mono">ban</code> scope.
        </p>
      </Card>
    )
  }

  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Moderation</h2>
        {active && (
          <Badge className="border-0 bg-danger/10 text-[10px] uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30">
            currently banned
          </Badge>
        )}
      </div>

      {active && ban ? (
        <>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Banned by {ban.byName} — “{ban.reason}”
            {ban.expiresAt === null
              ? '. Permanent.'
              : `. Expires ${new Date(ban.expiresAt).toLocaleString()}.`}
          </p>
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run('Lifting ban', '/api/bans/lift', { license }, 'Ban lifted. The record is kept.')
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <ShieldOff />}
              Lift ban
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Recorded against this license. It takes effect the next time they
            connect — it does not remove them if they are online now.
          </p>

          <div className="mt-3 space-y-3">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Reason — shown to the player"
              aria-label="Ban reason"
            />
            <div className="flex items-center gap-3">
              <Input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                placeholder="Days (blank = permanent)"
                className="max-w-56"
                aria-label="Ban length in days"
              />
              <Button
                variant="destructive"
                className="ml-auto"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  run(
                    'Issuing ban',
                    '/api/bans',
                    {
                      license,
                      reason: reason.trim(),
                      playerName: name,
                      days: days.trim() ? Number(days) : null,
                    },
                    'Ban recorded. It applies the next time they connect.',
                  )
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <BanIcon />}
                Ban {name}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
