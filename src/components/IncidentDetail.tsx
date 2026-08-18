'use client'

import { ArrowLeft, Ban as BanIcon, CircleSlash, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { BanDialog, MIN_REASON } from '@/components/BanDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KickDialog } from '@/components/KickDialog'
import { LocalTime } from '@/components/LocalTime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api'
import { verdictTone } from '@/lib/incidentChip'
import type {
  Incident,
  IncidentCategory,
  IncidentKind,
  VerdictAction,
} from '@/lib/incidents'
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
 *
 * ═══ RESOLVING IS NOW A CHOICE OF THREE, NOT A SENTENCE (#28) ═══
 *
 * This card used to be one textarea whose placeholder read "Banned for 7 days /
 * watched a match, looked fine / no action" — three completely different
 * outcomes offered as three ways of phrasing one. Nothing downstream could tell
 * them apart, which is why the profile page discards every closure and why
 * fivem-br-gamemode#168 has nothing to pay a reporter against.
 *
 * SO THE CHOICE IS THE UI AND THE TEXT IS THE FOOTNOTE. Three buttons, each
 * opening the dialog that already exists for that action:
 *
 *   Ban        BanDialog — its own reason, its 15-character floor, the existing
 *              duration presets, the permanent checkbox, its own confirm step
 *   Kick       KickDialog — its own reason and confirm. Offered only while they
 *              are on the server, because there is nobody to kick otherwise
 *   No action  ConfirmDialog — the one "are you sure" the rest of the console
 *              uses, with the reason inside it
 *
 * NOTHING HERE ISSUES A BAN OR A KICK ITSELF. Both dialogs post to the same
 * endpoints the profile page posts to and produce the same `ban.issue` and
 * `player.kick` audit rows; all they carry extra is the incident id, which the
 * server uses to write the verdict after the action succeeded. There is no
 * second spelling of "banned" anywhere in the log.
 *
 * NO ACTION IS NOT STYLED AS A FAILURE, on purpose. It sits with the other two,
 * same size, no warning colour, and its own confirm says plainly that deciding
 * nothing happened is a decision. A verdict UI that makes dismissal feel like
 * losing produces admins who ban to feel finished.
 *
 * WHAT IS UNAVAILABLE SAYS SO IN THE MARKUP, NOT ON HOVER. `docs/hover-text.md`
 * is explicit: a disabled button eats pointer events, so a tooltip on one
 * deletes the explanation in exactly the state that needed explaining. The
 * reason a button is off is a visible sentence under the row.
 */
export function IncidentDetail({
  incident,
  canResolve,
  subjectOnline,
  subjectBanned,
  categoryLabel,
  kindLabel,
  verdictLabel,
}: {
  incident: Incident
  canResolve: boolean
  /**
   * On the server right now. Decides whether Kick is even offered — the console
   * already knows this from the live roster, so the admin should not have to
   * find out by trying.
   */
  subjectOnline: boolean
  /**
   * Already under a ban that is in force, decided by `bans.isActive` on the
   * server — the one place that decides what banned means.
   */
  subjectBanned: boolean
  categoryLabel: Record<IncidentCategory, string>
  kindLabel: Record<IncidentKind, string>
  verdictLabel: Record<VerdictAction, string>
}) {
  const router = useRouter()
  const [resolution, setResolution] = useState('')
  const [banOpen, setBanOpen] = useState(false)
  const [kickOpen, setKickOpen] = useState(false)
  const [noneOpen, setNoneOpen] = useState(false)

  const pending = incident.state === 'pending_review'
  const reasonOk = resolution.trim().length >= MIN_REASON

  const resolveNoAction = async () => {
    try {
      await postJson('/api/incidents/resolve', {
        incidentId: incident.incidentId,
        resolution: resolution.trim(),
      })
      toast.success(`Closed with no action against ${incident.subjectName}.`)
      setResolution('')
      router.refresh()
    } catch (e) {
      /**
       * CAUGHT, NOT RETHROWN, and the typed reason is kept.
       *
       * ConfirmDialog closes itself once `onConfirm` settles either way, so a
       * rethrow here would only produce an unhandled rejection on top of the
       * toast. What the admin must not lose is what they wrote — `resolution`
       * is cleared on success only, so reopening the dialog finds it intact.
       *
       * This also replaces a check that could never fire: the old handler read
       * `postJson(...)` and then tested `res.ok`, but postJson THROWS on a
       * failed request, so the inline error line under the button was
       * unreachable and every failed resolve looked like nothing happening.
       */
      toast.error(e instanceof Error ? e.message : 'That could not be resolved.')
    }
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
            Choose what happens to {incident.subjectName}. This is permanent —
            the verdict cannot be edited or re-resolved and the incident cannot
            be reopened. If the behaviour continues, that is a new incident.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={subjectBanned}
              onClick={() => setBanOpen(true)}
            >
              <BanIcon />
              Ban
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!subjectOnline}
              onClick={() => setKickOpen(true)}
            >
              <LogOut />
              Kick
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNoneOpen(true)}
            >
              <CircleSlash />
              No action
            </Button>
          </div>

          {/*
            EVERY DISABLED BUTTON HAS ITS SENTENCE HERE, visible, in the markup.
            Not a tooltip — a disabled button does not fire pointer events, so a
            tooltip on one explains nothing in the only state that needed
            explaining (docs/hover-text.md, and PlayerActions is listed there as
            a site that worked around it badly).
          */}
          <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
            {!subjectOnline && (
              <p>
                {incident.subjectName} has left the server, so there is nobody to
                kick. A ban still applies the next time they try to join.
              </p>
            )}
            {subjectBanned && (
              <p>
                {incident.subjectName} is already banned, so this cannot issue a
                second one. Closing with{' '}
                <span className="font-medium text-foreground">no action</span>{' '}
                records that nothing further was done about this report — it does
                not lift the existing ban, and it is the honest answer when the
                ban came from somewhere else.
              </p>
            )}
          </div>

        </Card>
      )}

      {!pending && (
        <Card className="surface-edge gap-0 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Verdict</h2>
            <Verdict incident={incident} verdictLabel={verdictLabel} />
          </div>
          {incident.resolution && (
            <p className="mt-2 text-sm text-muted-foreground">
              {incident.resolution}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground/70">
            {incident.resolvedByName}
            {incident.resolvedAt ? (
              <>
                {' · '}
                <LocalTime ms={incident.resolvedAt} />
              </>
            ) : null}
          </p>
        </Card>
      )}

      <BanDialog
        license={incident.subjectLicense}
        name={incident.subjectName}
        online={subjectOnline}
        incidentId={incident.incidentId}
        open={banOpen}
        onOpenChange={setBanOpen}
      />

      <KickDialog
        license={incident.subjectLicense}
        name={incident.subjectName}
        incidentId={incident.incidentId}
        open={kickOpen}
        onOpenChange={setKickOpen}
      />

      <ConfirmDialog
        open={noneOpen}
        onOpenChange={setNoneOpen}
        title="Close with no action?"
        confirmLabel="Confirm — no action"
        busyLabel="Closing…"
        confirmDisabled={!reasonOk}
        onConfirm={resolveNoAction}
        body={
          <>
            <p>
              <span className="font-medium text-foreground">
                {incident.subjectName}
              </span>{' '}
              will not be kicked or banned, and nothing is shown to them.
            </p>
            {/*
              THE LAST CHANCE, SAYING WHAT BECOMES PERMANENT. Unlike a ban, which
              can at least be lifted, nothing about this outcome can be revisited
              — there is no edit screen and no re-resolve, by design.
            */}
            <p>
              The incident is closed with a verdict of{' '}
              <span className="font-medium text-foreground">no action</span>.
              Verdicts are final — this cannot be edited, re-resolved or
              reopened. If the behaviour continues, that is a new incident.
            </p>

            {/*
              THE REASON IS ASKED FOR IN HERE, not on the card behind it.
              It was on the card, and that was wrong for a reason worth keeping
              written down: with the reason outside and the confirm inside, the
              confirm button sat disabled with its own character counter hidden
              behind the dialog — a dead control with the explanation on the
              other side of an overlay, which is the exact defect
              docs/hover-text.md spends a section on. Ban and kick each collect
              their reason inside their own dialog; so does this.
            */}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="incident-resolution">
                Why? Only admins ever see this.
              </Label>
              <Textarea
                id="incident-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                placeholder="Watched two matches from spectate — nothing unusual"
              />
              <p className={reasonOk ? 'text-xs' : 'text-xs text-warn'}>
                {reasonOk
                  ? 'This is what the next person reading their history finds.'
                  : `At least ${MIN_REASON} characters (${resolution.trim().length} so far).`}
              </p>
            </div>
          </>
        }
      />
    </div>
  )
}

/**
 * The verdict on a closed incident, as a chip.
 *
 * ABSENT IS ITS OWN CHIP AND NOT "NO ACTION". Every incident resolved before
 * this field existed, and every one the system auto-resolved, carries no verdict
 * — and rendering those as "No action" would be the console inventing a decision
 * nobody made, which is the precise failure the field was added to end. It says
 * what it knows: closed, and no verdict was recorded.
 *
 * ITS OWN WORDING, THE SHARED COLOUR. This chip is not the row chip: it is
 * title case because it sits beside the heading "Verdict" rather than after the
 * word "resolved", and it is the only one that shows a ban's expiry. What it
 * must NOT have its own opinion about is which outcomes are loud — that rule is
 * `verdictTone`, shared with the queue and the profile, because a page where
 * "banned" is red in a list and grey on the case itself is a page that has two
 * views about what a ban is.
 */
function Verdict({
  incident,
  verdictLabel,
}: {
  incident: Incident
  verdictLabel: Record<VerdictAction, string>
}) {
  const v = incident.verdict

  if (!v) {
    return (
      <Badge
        className={cn(
          'border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
          verdictTone(null),
        )}
      >
        resolved · no verdict recorded
      </Badge>
    )
  }

  return (
    <Badge
      className={cn(
        'border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
        verdictTone(v.action),
      )}
    >
      {verdictLabel[v.action] ?? v.action}
      {v.action === 'ban' ? (
        v.expiresAt === null ? (
          <span className="ml-1 normal-case">— permanent</span>
        ) : (
          <span className="ml-1 normal-case">
            — until <LocalTime ms={v.expiresAt} />
          </span>
        )
      ) : null}
    </Badge>
  )
}
