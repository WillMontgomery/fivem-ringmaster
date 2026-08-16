'use client'

import { ArrowLeft, Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { LocalTime } from '@/components/LocalTime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { postJson } from '@/lib/api'
import type { Incident, IncidentCategory, IncidentKind } from '@/lib/incidents'
import { cn } from '@/lib/utils'

/**
 * One incident, and the decision about it.
 *
 * THE TIMELINE IS THE RECORD. State says where it ended up; the timeline says
 * who looked and what they concluded, which is the thing that matters when the
 * same player turns up again.
 *
 * RESOLVING IS ONE-WAY, and the UI says so before you do it rather than after.
 * If the behaviour continues that is a new incident — which is the design, not
 * a limitation, because it keeps the queue strictly shrinking.
 */
export function IncidentDetail({
  incident,
  canResolve,
  categoryLabel,
  kindLabel,
}: {
  incident: Incident
  canResolve: boolean
  categoryLabel: Record<IncidentCategory, string>
  kindLabel: Record<IncidentKind, string>
}) {
  const router = useRouter()
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = incident.state === 'pending_review'

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await postJson('/api/incidents/resolve', {
      incidentId: incident.incidentId,
      resolution: resolution.trim() || 'No action taken.',
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'That could not be resolved.')
      return
    }
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to incidents
      </Link>

      <Card className="surface-edge animate-rise gap-0 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                {kindLabel[incident.kind] ?? incident.kind}
              </h1>
              <Badge
                variant="outline"
                className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
              >
                {categoryLabel[incident.category] ?? incident.category}
              </Badge>
              <Badge
                className={cn(
                  'border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                  pending
                    ? 'bg-warn/10 text-warn ring-warn/30'
                    : 'bg-muted/40 text-muted-foreground ring-border',
                )}
              >
                {pending ? 'pending review' : 'resolved'}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm">{incident.summary}</p>
            {incident.note && (
              <p className="mt-1 text-sm text-muted-foreground">
                &ldquo;{incident.note}&rdquo;
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              About
            </div>
            <Link
              href={`/players/${encodeURIComponent(incident.subjectLicense)}`}
              className="mt-1 block text-sm underline underline-offset-2"
            >
              {incident.subjectName}
            </Link>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Reported by
            </div>
            {incident.reporterLicense ? (
              <Link
                href={`/players/${encodeURIComponent(incident.reporterLicense)}`}
                className="mt-1 block text-sm underline underline-offset-2"
              >
                {incident.reporterName}
              </Link>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">The system</p>
            )}
          </div>
          {incident.linkedLicense && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Also involves
              </div>
              <Link
                href={`/players/${encodeURIComponent(incident.linkedLicense)}`}
                className="mt-1 block text-sm underline underline-offset-2"
              >
                Linked profile
              </Link>
            </div>
          )}
        </div>
      </Card>

      {/* CAPTURES. Absent is normal — the upload comes from the subject's own
          machine and can fail or be blocked, so an incident with no frames must
          never read as one where nothing was happening. */}
      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <header className="border-b border-border bg-card/60 px-4 py-2.5 text-sm">
          Captures
        </header>
        <div className="p-4">
          {incident.captureKeys && incident.captureKeys.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {incident.captureKeys.length} frame
              {incident.captureKeys.length === 1 ? '' : 's'} stored. Viewing is not
              wired up yet.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/70">
              No captures. This does not mean nothing was happening — the upload
              runs on the reported player&apos;s own machine and can fail or be
              blocked.
            </p>
          )}
        </div>
      </Card>

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <header className="border-b border-border bg-card/60 px-4 py-2.5 text-sm">
          Timeline
        </header>
        <div className="p-4">
          <ul>
            {incident.events.map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className="border-t border-border/60 py-2.5 first:border-t-0 first:pt-0"
              >
                <div className="text-sm">
                  <span className="font-medium">
                    {e.kind === 'opened'
                      ? 'Opened'
                      : e.kind === 'resolved'
                        ? 'Resolved'
                        : 'Note'}
                  </span>
                  {e.text ? <span className="text-muted-foreground"> — {e.text}</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <LocalTime ms={e.at} /> · {e.byName}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {pending && canResolve && (
        <Card className="surface-edge gap-0 px-5 py-4">
          <h2 className="text-sm font-medium">Resolve</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            What did you decide? This is permanent — an incident cannot be
            reopened. If the behaviour continues, that is a new incident.
          </p>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={2}
            placeholder="Banned for 7 days / watched a match, looked fine / no action"
            className="mt-3 w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-3">
            <Button onClick={submit} disabled={busy}>
              <Check className="size-4" />
              {busy ? 'Resolving…' : 'Resolve'}
            </Button>
          </div>
        </Card>
      )}

      {!pending && incident.resolution && (
        <Card className="surface-edge gap-0 px-5 py-4">
          <h2 className="text-sm font-medium">Resolution</h2>
          <p className="mt-1 text-sm text-muted-foreground">{incident.resolution}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {incident.resolvedByName}
            {incident.resolvedAt ? ` · $<LocalTime ms={incident.resolvedAt} />` : ''}
          </p>
        </Card>
      )}
    </div>
  )
}
