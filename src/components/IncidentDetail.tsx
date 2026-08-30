'use client'

import { ArrowLeft, Ban as BanIcon, CircleSlash, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { BanDialog, MIN_REASON } from '@/components/BanDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IncidentArtifacts } from '@/components/IncidentArtifacts'
import { IncidentMatchRecord } from '@/components/IncidentMatchRecord'
import { IncidentTimeline } from '@/components/IncidentTimeline'
import { KickDialog } from '@/components/KickDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api'
import type { Artifact } from '@/lib/artifacts'
import { incidentHeadline } from '@/lib/incidentChip'
import { labelFor } from '@/lib/labels'
import type {
  Incident,
  IncidentCategory,
  IncidentKind,
  VerdictAction,
} from '@/lib/incidents'
import type { ProfileMatch } from '@/lib/profile'
import { profileHref } from '@/lib/profileLink'
import { cn } from '@/lib/utils'

/**
 * One incident, and the decision about it.
 *
 * ═══ THE ORDER OF THIS PAGE IS THE OWNER'S, FROM A PLAYTEST ═══
 *
 *   report bar   what this is, who it is against, who filed it — and the three
 *                resolve buttons, right-aligned in the same row
 *   match record what the subject did in that match — only when there was one.
 *                "Can you move the 'Match record' box to be displayed above the
 *                timeline please?" (2026-08-22). It was below it.
 *   timeline     "Directly under the 'player report' section should be the
 *                timeline section" — which it was, until the line above moved
 *                one short panel in between. THE VERDICT IS PART OF IT NOW.
 *   artifacts    last. It was second.
 *
 * ═══ THE VERDICT HAS NO SECTION OF ITS OWN ANY MORE (owner, 2026-08-22) ═══
 *
 * "are you aware we still have the 'verdict' section displaying on the incidents
 * page? That's not supposed to have it's own section on a resolved incident as
 * we already agreed to." There was a card between the timeline and the artifacts
 * holding a heading, a chip, the resolution text, the ban provenance and a line
 * naming who closed the case and when.
 *
 * THREE OF THOSE FIVE WERE ALREADY ON THE TIMELINE'S CLOSING ROW, which is why
 * the owner was reading the same words twice: `incidents.resolve` writes one
 * string into both `resolution` and the closing event's `text` in a single
 * update, and `resolvedAt`/`resolvedByName` are the same instant and the same
 * name that row's meta line prints. The card was the duplicate, not the row.
 *
 * SO THE OTHER TWO FOLDED ONTO THAT ROW RATHER THAN BEING DELETED WITH IT. The
 * verdict chip and the `closedByBan` sentence are the only things the card held
 * that the row did not, and both live in `IncidentTimeline` now — which is also
 * where the argument for each of them moved. NOTHING IS LOST, and that is the
 * test this had to pass: `lib/incidentChip` names that chip as the only place
 * the console states the difference between a recorded verdict of `none` and no
 * verdict at all, and its comment now points at the row.
 *
 * THE TIMELINE IS THE RECORD. State says where it ended up; the timeline says
 * who looked and what they concluded, which is the thing that matters when the
 * same player turns up again.
 *
 * RESOLVING IS ONE-WAY. It is not said on the page any more — the owner asked
 * for no helper text in the resolve bar and for the sentence about it to come
 * out of the confirm dialog as well — but it is still the rule, enforced by a
 * conditional update in `lib/incidents` that refuses to run twice, and it is
 * still why the queue can only shrink.
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
 *   Kick       KickDialog — its own reason and confirm. NOT DRAWN AT ALL unless
 *              they are on the server, because there is nobody to kick otherwise
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
 * same size, no warning colour. A verdict UI that makes dismissal feel like
 * losing produces admins who ban to feel finished.
 *
 * ═══ WHAT IS UNAVAILABLE NO LONGER SAYS SO, AND THAT WAS ASKED FOR ═══
 *
 * This bar used to carry a visible sentence under it for each button that was
 * off — the arrangement `docs/hover-text.md` prescribes, because a disabled
 * button eats pointer events and a tooltip on one deletes the explanation in
 * exactly the state that needed explaining. The owner asked for the bar to carry
 * no helper text at all, so those sentences are gone rather than moved onto
 * hover, which would have been the same words in the one place that cannot show
 * them.
 *
 * WHICH LEAVES EXACTLY ONE GREYED CONTROL WITH NOTHING SAYING WHY: Ban, on a
 * player already under a ban. Kick does not need one, because it is not drawn
 * at all when there is nobody to kick — an absent control raises no question
 * about why it is dead. Recorded here rather than worked around.
 */
export function IncidentDetail({
  incident,
  artifacts,
  artifactSrcOverride,
  matchRecord,
  subjectOnline,
  subjectBanned,
  now,
  categoryLabel,
  kindLabel,
  verdictLabel,
}: {
  incident: Incident
  /**
   * The frames this case has in the bucket, as the server found them.
   *
   * PASSED IN RATHER THAN FETCHED HERE, and not optional. Finding them means
   * nine authenticated HEADs against S3, which belongs on the server — and a
   * defaulted `?? []` would make "nobody looked" and "there are none" the same
   * value, which is the exact confusion that got `captureKeys` deleted.
   */
  artifacts: Artifact[]
  /**
   * Forwarded straight to `IncidentArtifacts`, which explains why it exists.
   * `/preview/incident` is its only caller; nothing real passes it.
   */
  artifactSrcOverride?: Record<number, string>
  /**
   * What the subject did in the match this was filed during, or null.
   *
   * JOINED ON THE SERVER, like everything else on this page that needs a second
   * table. The page reads the subject's match history and `matchRecordFor`
   * picks the row — which is not `find(r => r.matchId === …)`, because the
   * game's match number restarts with the server. See `lib/matchTimeline`.
   *
   * NULL IS ORDINARY AND IS NOT "THEY DID NOTHING". The row is written when the
   * match ends, the read behind it is bounded, and it can simply fail. All
   * three render as an em dash; see `IncidentMatchRecord`.
   */
  matchRecord: ProfileMatch | null
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
  /**
   * The server's clock, read once on the page above and handed down.
   *
   * ONE FACT DEPENDS ON IT: whether a match with no recorded end is still
   * inside its deadline or has blown past it. Reading `Date.now()` inside a
   * client component that also renders on the server answers that differently
   * in the two places, which React 19 repairs by discarding the tree — the same
   * hydration trap `LocalTime` was rebuilt to escape.
   */
  now: number
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
                {labelFor(kindLabel, incident.kind)}
              </h1>
              {/*
                THE CATEGORY CHIP IS GONE HERE TOO (owner, playtest): "we don't
                need a chip telling us what the incident was for if the
                description already tells us". The description is the line
                directly below this row, and for a player report it now reads
                "Reported for Abusive chat" — the same words the chip carried,
                one line apart. On a system-filed case the chip read "SYSTEM",
                which the owner cut by name.

                THE FACT ITSELF IS NOT LOST, and that is the test this had to
                pass: the category is what the description IS for a report, and
                for an escalation the summary and the "Reported by / System"
                field below say what it was. Nothing is only in the chip.
              */}
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
            {/*
              COMPOSED FOR A PLAYER REPORT, VERBATIM OTHERWISE. The stored
              summary interpolates the raw category id on the game side —
              "Reported for abusive_chat by Xeon" — and the owner's instruction
              is that it "should display as 'Abusive chat'". `incidentHeadline`
              is the same reading the queue row and the profile row take, so the
              three surfaces cannot describe one incident three ways.
            */}
            <p className="mt-1.5 text-sm">
              {incidentHeadline(incident, categoryLabel)}
            </p>
            {incident.note && (
              <p className="mt-1 text-sm text-muted-foreground">
                &ldquo;{incident.note}&rdquo;
              </p>
            )}
          </div>

          {/*
            ═══ THE RESOLVE BUTTONS LIVE IN THIS BAR NOW (owner, playtest) ═══

            "The resolve buttons should be at the top of the page like in the
            'player report' bar, akin to our profile page. No helper text is
            needed there either."

            They were a card of their own at the BOTTOM of the page, under the
            heading "Resolve", with a paragraph of explanation above them and two
            more underneath. The profile page settled this shape first (#22 item
            1): the moderation buttons are part of the identity bar, right-
            aligned, and the row reads left to right as "who is this, and what do
            you want to do about it". This is the same row on the same argument.

            NO PROSE CAME WITH THEM, WHICH IS THE OTHER HALF OF THE INSTRUCTION.
            The intro paragraph is gone, and so are the two sentences that
            explained a disabled button — see the note on the Ban button for what
            that costs and what it replaced.

            `justify-between` WAS ALREADY HERE with one child in it. This is the
            thing it was left waiting for.
          */}
          {pending && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/*
                BAN IS DISABLED RATHER THAN HIDDEN while one is already in force,
                and it now carries no sentence saying so. That is the owner's
                instruction above rather than an oversight: the paragraph that
                explained it was helper text in the place they asked for none.
                The fact itself is not only here — a player under a ban wears the
                chip for it on their profile, which the name in this bar links
                to.
              */}
              <Button
                variant="destructive"
                size="sm"
                disabled={subjectBanned}
                onClick={() => setBanOpen(true)}
              >
                <BanIcon />
                Ban
              </Button>
              {/*
                KICK IS ABSENT WHEN THERE IS NOBODY TO KICK, not greyed out.

                "the 'kick' button should not be displayed if the offender is not
                actively on the server" — the owner, playtest. It is the same
                rule `PlayerActions` already follows on the profile page, off the
                same fact: presence comes from the live snapshot, decided on the
                server, and arrives here as `subjectOnline`.

                HIDDEN RATHER THAN DISABLED IS THE POINT, and PlayerActions'
                `kick` comment is where the reasoning is written out in full. In
                short: a greyed control says "this action exists and is being
                withheld from you", which is a claim about the admin. An absent
                player is not that — there is simply nothing for the action to
                act on. Nothing marks the gap.
              */}
              {subjectOnline && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setKickOpen(true)}
                >
                  <LogOut />
                  Kick
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNoneOpen(true)}
              >
                <CircleSlash />
                No action
              </Button>
            </div>
          )}
        </div>

        {/*
          EVERY PROFILE LINK ON THIS PAGE CARRIES THE INCIDENT WITH IT — these
          three, and both parties of every kill in the timeline below.

          "Clicking on the player's profile in the incident page takes me to the
          player's profile page - great! But the breadcrumbs there say 'back to
          live players' and it should instead take me back to the incident" —
          the owner, playtest. `profileHref` puts the case id in the URL and the
          profile page decides what to do with it; see `lib/profileLink` for why
          the parameter is checked rather than believed.
        */}
        <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
          <div>
            {/*
              "AGAINST", NOT "ABOUT" (owner, playtest: "Where the incident says
              'about' it should really say 'against'"). It is the word they
              already use for this relation everywhere else they have written
              it down — "all other incidents against the freshly banned player"
              — and it is the more honest one: a case names somebody as its
              subject, which "about" softens into a topic.
            */}
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Against
            </div>
            <Link
              href={profileHref(incident.subjectLicense, incident.incidentId)}
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
                href={profileHref(incident.reporterLicense, incident.incidentId)}
                className="mt-1 block text-sm underline underline-offset-2"
              >
                {incident.reporterName}
              </Link>
            ) : (
              /*
                "System", NOT "The system" (owner, playtest: "'filed by the
                system' sounds cheesy. How about filed by `System`"). It is the
                name the timeline beneath this already uses — every event
                `lib/incidents` writes without a human carries `byName:
                'System'` — so the page now names one actor one way.
              */
              <p className="mt-1 text-sm text-muted-foreground">System</p>
            )}
          </div>
          {incident.linkedLicense && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Also involves
              </div>
              <Link
                href={profileHref(incident.linkedLicense, incident.incidentId)}
                className="mt-1 block text-sm underline underline-offset-2"
              >
                Linked profile
              </Link>
            </div>
          )}
        </div>
      </Card>

      {/*
        WHAT THE SUBJECT DID IN THAT MATCH (owner, playtest: "In the incident
        there should also be a section about what they did that match - like how
        many kills they got, what position they got, how much loot they got,
        etc."). See `IncidentMatchRecord`.

        ═══ AND IT SITS ABOVE THE TIMELINE NOW (owner, playtest 2026-08-22) ═══

        "Can you move the 'Match record' box to be displayed above the timeline
        please?" It was directly under it, on the argument that the two are the
        same match seen two ways round — the timeline is what happened, this is
        how it came out — so the account should precede the result.

        THE OWNER'S ORDER IS THE BETTER ONE AND IT IS WORTH SAYING WHY, so that
        nobody reverses it back on the old reasoning. This panel is six numbers
        and one screen-line tall; the timeline is unbounded and on a busy match
        runs to dozens of rows. Putting the short, fixed-height summary first
        means an admin opening a case reads placement and kills before deciding
        whether to scroll at all — and the thing they were going to scroll past
        to reach it is no longer in the way.

        LOOT IS NOT IN IT AND CANNOT BE — nothing on either row records it. See
        `IncidentMatchRecord`, which says what a game-side change would have to
        write.

        `matchId` DECIDES WHETHER THE PANEL EXISTS AT ALL, and that is the one
        distinction this line is carrying. No matchId means there was no match —
        a report filed in the lobby, or any case filed before the game recorded
        this — and a panel about a match that did not happen is furniture. A
        matchId with no history row is a DIFFERENT state, it is ordinary, and it
        renders inside the panel as an em dash rather than by deleting it.

        NOTHING ABOUT THE MOVE IS RESPONSIVE-SENSITIVE. Both are Cards in the
        page's single `space-y-4` column and neither is in a grid with the
        other, so the order is the DOM order at every width; the panel's own
        `sm:` columns are internal to it and unaffected.
      */}
      {incident.matchId != null && <IncidentMatchRecord record={matchRecord} />}

      {/*
        THE TIMELINE MOVED OUT OF THIS FILE (#30) and grew a second writer. It
        was the console's own `events` in a bare `<ul>`; it is now those merged
        with the match the game recorded around this incident — the brackets,
        every kill inside them, and whether the match ever reported an end. Two
        attributes, two writers, one list, sorted here because DynamoDB's
        `list_append` does not order. See `IncidentTimeline`.

        IT USED TO SIT DIRECTLY UNDER THE REPORT BAR (owner, playtest: "Directly
        under the 'player report' section should be the timeline section"), and
        the match record has since been moved above it at the owner's request —
        see the note on that panel. What that instruction was against is still
        intact: the timeline is above the artifacts, which were second and are
        now last. The reading order is what happened, then what was decided,
        then the pictures — rather than the pictures before the account of what
        they are pictures of.
      */}
      <IncidentTimeline
        incident={incident}
        now={now}
        verdictLabel={verdictLabel}
      />

      {/*
        ARTIFACTS, AND THEY ARE LAST NOW (owner, playtest). This was a
        placeholder card reading "N frames stored. Viewing is not wired up yet",
        counting a field that could never be non-empty. Both are gone: the field
        (see `lib/incidents`) and the placeholder.

        IT WAS THE SECOND THING ON THE PAGE and is the last. A carousel is the
        heaviest thing here and the slowest to read; the account of what
        happened belongs above the pictures of it, not below them.

        THE FRAMES ARE FOUND ON THE SERVER, not here — `probe()` in
        `lib/artifactStore` runs in the page above this component and hands down
        what it found. This card is handed data and nothing else, which is what
        keeps the S3 SDK and the bucket name out of the client bundle.

        ITS EMPTY STATE HAS NO WORDS, on purpose, and `IncidentArtifacts`
        explains why at length. The one-line version: an empty set has four
        unrelated causes and none of them is a statement about the accused, so
        the console says nothing rather than picking one.
      */}
      <IncidentArtifacts
        incidentId={incident.incidentId}
        subjectName={incident.subjectName}
        reportedAt={incident.openedAt}
        frames={artifacts}
        srcOverride={artifactSrcOverride}
      />

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
            {/*
              THE VERDICT SENTENCE IS GONE FROM ALL THREE BOXES (owner, playtest
              2026-08-21). It read "The incident is closed with a verdict of X.
              Verdicts are final -- this cannot be edited, re-resolved or reopened."

              It was consolidated onto one wording across the three boxes earlier the
              same evening and then removed outright. That is not a reversal: the
              consolidation was about the three agreeing, and they still do -- at
              nothing.

              WHAT IS LOST, SO NOBODY RE-ADDS IT BY ACCIDENT. Finality is real and
              still enforced -- lib/incidents.ts allows only pending_review and
              resolved, a resolved case cannot be reopened, and a verdict cannot be
              rewritten. The confirm step no longer SAYS so. Ban and kick each keep
              their own consequence line and their reason field, which is what the
              owner kept when the rest went.
            */}

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
              {/*
                THE SATISFIED HALF OF THIS LINE IS GONE (owner, playtest): it
                read "This is what the next person reading their history finds."
                Only the shortfall is left, which is a count rather than a
                sentence — the thing standing between the admin and a disabled
                confirm button.

                THE ROW KEEPS ITS HEIGHT, which is why this is an empty element
                rather than no element. `min-h-4` is one `text-xs` line, so the
                dialog does not jump by a line the moment the fifteenth
                character is typed and move the confirm button out from under
                the pointer.
              */}
              <p className={cn('min-h-4 text-xs', !reasonOk && 'text-warn')}>
                {reasonOk
                  ? null
                  : `At least ${MIN_REASON} characters (${resolution.trim().length} so far).`}
              </p>
            </div>
          </>
        }
      />
    </div>
  )
}
