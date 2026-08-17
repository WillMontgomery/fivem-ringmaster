'use client'

import { Clock, ShieldOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Pager } from '@/components/Pager'
import { useFormatInstant } from '@/components/PrefsProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { postJson } from '@/lib/api'
import type { Ban } from '@/lib/bans'
import { cn } from '@/lib/utils'

/**
 * What moderation has actually done: recent kicks, and bans still in force.
 *
 * A LOG, NOT A FORM. Issuing a ban moved to the player profile, where the
 * license is already in hand — pasting an identifier into a form two clicks
 * from the person it describes is how the wrong player gets banned. What is
 * left here is the question this page is actually opened to answer: "what has
 * been happening, and to whom".
 *
 * KICKS FIRST, because they are the volume. A ban is rare and deliberate and
 * you probably remember issuing it; kicks are the ambient noise of moderating a
 * server, and "who has been kicking whom" is the thing you cannot reconstruct
 * from memory.
 *
 * EVERY ADMIN NAME IS A LINK to that admin's own profile. Moderators are
 * players too — the fastest way to answer "who is this Xeon that keeps kicking
 * people" is to click them, and a name that is only text makes you go and
 * search for it.
 */

const PER_PAGE = 10

export interface KickRow {
  ts: number
  actorName: string
  actorLicense: string | null
  targetName: string | null
  targetLicense: string | null
  reason: string | null
  outcome: 'pending' | 'ok' | 'failed'
}

/** How much of a ban is left, in words. */
function remaining(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return 'Permanent'
  const ms = expiresAt - now
  if (ms <= 0) return 'Expired'
  const days = Math.floor(ms / 86_400_000)
  if (days > 0) return `${days}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h left`
  const hours = Math.floor(ms / 3_600_000)
  if (hours > 0) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`
}

/** A player name that links to their profile, when we have a license. */
function PersonLink({
  name,
  license,
  className,
}: {
  name: string | null
  license: string | null
  className?: string
}) {
  const label = name ?? 'Unknown'
  if (!license) {
    return <span className={cn('text-muted-foreground', className)}>{label}</span>
  }
  return (
    <Link
      href={`/players/${encodeURIComponent(license)}`}
      className={cn(
        'underline-offset-4 transition-colors hover:text-primary hover:underline',
        className,
      )}
    >
      {label}
    </Link>
  )
}

export function ModerationLog({
  kicks,
  bans,
  canBan,
}: {
  kicks: KickRow[]
  bans: Ban[]
  canBan: boolean
}) {
  const router = useRouter()
  const now = Date.now()

  // The reader's stated zone. Year dropped — these are narrow table cells.
  const { format } = useFormatInstant()
  const when = (ts: number) => format(ts, { withYear: false })

  const [kickPage, setKickPage] = useState(0)
  const [banPage, setBanPage] = useState(0)
  const [lifting, setLifting] = useState<Ban | null>(null)

  /*
   * THE CLAMP THE OTHER TWO LISTS ALWAYS HAD.
   *
   * Lifting a ban calls router.refresh(), which re-renders this with a shorter
   * `bans` array. On page 2 of an eleven-row list that leaves ten rows and a
   * page that no longer exists, so the slice came back empty and the panel
   * rendered "Nobody is currently banned." — a false statement about ten people
   * who are — under a pager reading "page 2 of 1". Both lists now pin the page
   * to one that exists, the way `Paged` and the incident queue always did.
   */
  const kickPages = Math.ceil(kicks.length / PER_PAGE)
  const banPages = Math.ceil(bans.length / PER_PAGE)
  const kickCurrent = Math.min(kickPage, Math.max(0, kickPages - 1))
  const banCurrent = Math.min(banPage, Math.max(0, banPages - 1))
  const kickSlice = kicks.slice(
    kickCurrent * PER_PAGE,
    kickCurrent * PER_PAGE + PER_PAGE,
  )
  const banSlice = bans.slice(banCurrent * PER_PAGE, banCurrent * PER_PAGE + PER_PAGE)

  const lift = async (b: Ban) => {
    try {
      await postJson('/api/bans/lift', { license: b.license })
      toast.success(`Ban lifted for ${b.playerName ?? b.license}. The record is kept.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lift failed.')
    }
  }

  return (
    <>
      <Tabs defaultValue="kicks">
        <TabsList>
          <TabsTrigger value="kicks">Kicks</TabsTrigger>
          <TabsTrigger value="bans">Active bans</TabsTrigger>
        </TabsList>

        <TabsContent value="kicks">
          <Card className="surface-edge gap-0 overflow-hidden py-0">
            {kickSlice.length === 0 ? (
              <p className="px-4 py-14 text-center text-sm text-muted-foreground">
                Nobody has been kicked yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {kickSlice.map((k) => (
                  <li
                    key={`${k.ts}-${k.targetLicense ?? ''}`}
                    className="flex items-start gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <PersonLink
                          name={k.actorName}
                          license={k.actorLicense}
                          className="font-medium"
                        />
                        <span className="text-muted-foreground"> kicked </span>
                        <PersonLink
                          name={k.targetName}
                          license={k.targetLicense}
                          className="font-medium"
                        />
                      </div>
                      {k.reason && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          “{k.reason}”
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {when(k.ts)}
                      </div>
                      {/*
                        FAILED, OR NOTHING (#19).

                        The record still has three states and they still mean
                        different things — `pending` is a kick we dispatched and
                        never heard back about, which is genuinely not the same
                        as one that failed. But "unacknowledged" made every
                        reader stop and work out what it meant, and the answer
                        was almost always "it worked, the outcome event has not
                        landed yet". Three labels for a question with two useful
                        answers is noise on the one row that has to be read
                        quickly.

                        So the DISPLAY collapses and the DATA does not: the
                        distinction is still in DynamoDB for anybody
                        reconstructing an incident, and the audit page and the
                        API still carry it. Only failure gets a word here,
                        because only failure changes what you do next.
                      */}
                      {k.outcome === 'failed' && (
                        <div className="text-xs uppercase tracking-wider text-danger">
                          failed
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Pager
              page={kickCurrent}
              perPage={PER_PAGE}
              total={kicks.length}
              onPage={setKickPage}
              className="border-t border-border px-4 py-3"
            />
          </Card>
        </TabsContent>

        <TabsContent value="bans">
          <Card className="surface-edge gap-0 overflow-hidden py-0">
            {banSlice.length === 0 ? (
              <p className="px-4 py-14 text-center text-sm text-muted-foreground">
                Nobody is currently banned.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {banSlice.map((b) => (
                  <li key={b.license} className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <PersonLink
                          name={b.playerName ?? null}
                          license={b.license}
                          className="font-medium"
                        />
                        <span className="text-muted-foreground"> banned by </span>
                        <PersonLink
                          name={b.byName}
                          license={b.by}
                          className="font-medium"
                        />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        “{b.reason}”
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <Badge
                        className={cn(
                          'gap-1 border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                          b.expiresAt === null
                            ? 'bg-danger/10 text-danger ring-danger/30'
                            : 'bg-warn/10 text-warn ring-warn/30',
                        )}
                      >
                        <Clock className="size-3" />
                        {remaining(b.expiresAt, now)}
                      </Badge>
                      <div className="mt-0.5 text-xs tabular-nums text-muted-foreground/60">
                        {when(b.at)}
                      </div>
                    </div>

                    {canBan && (
                      <Button variant="ghost" size="sm" onClick={() => setLifting(b)}>
                        <ShieldOff />
                        Lift
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Pager
              page={banCurrent}
              perPage={PER_PAGE}
              total={bans.length}
              onPage={setBanPage}
              className="border-t border-border px-4 py-3"
            />
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={lifting !== null}
        onOpenChange={(v) => !v && setLifting(null)}
        title="Lift this ban?"
        confirmLabel="Confirm lift"
        busyLabel="Lifting…"
        onConfirm={async () => {
          if (lifting) await lift(lifting)
          setLifting(null)
        }}
        body={
          <>
            <p>
              <span className="font-medium text-foreground">
                {lifting?.playerName ?? lifting?.license}
              </span>{' '}
              will be able to join again immediately.
            </p>
            <p className="text-muted-foreground">
              The ban record is kept, with your name against the lift — nothing
              is deleted.
            </p>
          </>
        }
      />
    </>
  )
}
