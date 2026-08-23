'use client'

import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'

import { LocalTime } from '@/components/LocalTime'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  Timeline,
  TimelineContent,
  TimelineItem,
  TimelineMarker,
  TimelineMeta,
  TimelineTitle,
} from '@/components/ui/timeline'
import { verdictTone } from '@/lib/incidentChip'
import type { ClosedByBan, IncidentVerdict, VerdictAction } from '@/lib/incidents'
import { labelFor } from '@/lib/labels'
import { profileHref } from '@/lib/profileLink'
import {
  CONSOLE_EVENT_LABEL,
  MATCH_EVENT_LABEL,
  MATCH_PROGRESS_LABEL,
  isBracket,
  isCaseBracket,
  isResolution,
  killDiscrepancy,
  killLine,
  matchOffset,
  matchProgress,
  mergeTimeline,
  weaponTone,
  withClosure,
  type CaseClosure,
  type ConsoleTimelineEvent,
  type MatchFields,
  type MatchTimelineEntry,
  type TimelineParty,
  type WeaponPart,
} from '@/lib/matchTimeline'
import { cn } from '@/lib/utils'

/**
 * ONE TIMELINE, WRITTEN BY TWO PLACES.
 *
 * The console owns `events` — opened, note, resolved — and the gamemode owns
 * `matchTimeline` — the match brackets and every kill inside them. Neither can
 * see the other's list and neither writes into it, so nothing upstream can put
 * them in order. They are merged here, sorted by `at`, and rendered as one
 * thing, because an admin reading a case does not care which process wrote
 * which row; they care what happened and in what order.
 *
 * ═══ AND A CASE FILED IN WARMUP HAS NO START TO BE ANCHORED ON ═══
 *
 * A match is formed into warmup and only stamps a start on entering play, so a
 * case opened on the warmup pad carries a `match_created` entry where every
 * other case carries `match_start`. Its word is a different word on purpose,
 * and `MATCH_EVENT_LABEL` is where the word and the argument for it live —
 * NOT HERE, because a label spelled in markup is a label nothing checks.
 * Nothing else special-cases the kind either: it is a bracket, it goes through
 * the same lookup, and the `weapon_strip` entries that opened the case sit
 * under it like any other row.
 *
 * EVERY DECISION IN HERE THAT COULD BE WRONG LIVES IN `lib/matchTimeline`, and
 * that is deliberate rather than tidy. `npm run verify` runs `check:timeline`
 * against those functions — the sort, the match states, the bracket set, the
 * article, and above all the one comparison that decides whether a weapon turns
 * red. A rule spelled inline in JSX is a rule nothing can test.
 *
 * ═══ THE RED IS A SERIOUS CLAIM AND IT IS MADE ONCE ═══
 *
 * The game's issued-weapon flag is `false` when the gamemode does not recognise
 * the weapon at all, which is close to proof of a cheat. It is ABSENT when no
 * claim was made — every incident filed before 2026-08-20 predates the field,
 * and an environmental death omits it on purpose, because falling off a cliff
 * is not a weapon. Absent must render exactly like `true`, and the comparison
 * that decides it lives in `weaponPart`.
 *
 * NOTHING IN THIS FILE READS THAT FLAG, and nothing in `src/components` may.
 * `check:timeline` walks the source and fails, by path, if a second reader of
 * it appears — because the second reader is where the comparison gets written
 * the obvious wrong way and every legacy row turns red at once.
 *
 * ═══ AND THE VERDICT IS ON THIS LIST NOW, NOT IN A CARD UNDER IT ═══
 *
 * The owner, 2026-08-22: "we still have the 'verdict' section displaying on the
 * incidents page? That's not supposed to have it's own section on a resolved
 * incident as we already agreed to." The card said four things and three of them
 * were already on the closing row of this list — `incidents.resolve` writes one
 * string into both `resolution` and the closing event's `text` in a single
 * update, and `resolvedAt`/`resolvedByName` are the same instant and the same
 * name that row's meta line prints. The two that were NOT duplicated are the
 * verdict chip and the `closedByBan` provenance, and they are the two things
 * that moved.
 *
 * WHICH ROW IS THE CLOSING ONE IS `isResolution`'s DECISION, not a comparison
 * here — the same rule the marker tone already follows one predicate up, and in
 * this case a rule `check:timeline` enforces by refusing the literal outright.
 *
 * AND A RESOLVED CASE WITH NO CLOSING ROW STILL GETS ONE. `withClosure` builds
 * it from the row's own closure attributes when the events list has none, so the
 * fold cannot turn a shape nobody has seen into a page with no verdict on it at
 * all. It says why, at length, and says plainly that it is a guard rather than a
 * response to a shape anything here produces.
 */
export function IncidentTimeline({
  incident,
  now,
  verdictLabel,
}: {
  incident: MatchFields &
    CaseClosure & {
    /**
     * WHERE THE NAMES ON THIS LIST LEAD BACK TO. Every kill links both parties
     * to their profile, and each of those links carries this so the breadcrumb
     * there returns to this case rather than to the live table. See
     * `lib/profileLink`.
     */
    incidentId: string
    /**
     * ZERO ON THE OFFSET AXIS, AND THE WHOLE OF IT. Every `+2:14` and `-1:30` on
     * this list is measured from here and from nothing else — see `matchOffset`,
     * which is also where the limit on how far the ruler reaches is argued. No
     * match attribute takes any part in it.
     */
    openedAt: number
    events: ConsoleTimelineEvent[]
    /**
     * WHAT WAS DECIDED, WHICH IS NOW A ROW ON THIS LIST. Optional because
     * history is: every case closed before the field existed, and every one the
     * system auto-resolved, carries none — and that ABSENCE is its own reading
     * rather than a "no action". See {@link Verdict}.
     */
    verdict?: IncidentVerdict | null
    /**
     * WHY IT CLOSED WHEN NOBODY DECIDED ANYTHING ON IT. The other half of what
     * the deleted card held that this list did not. Carried as a structured
     * field, never found in the resolution text — see the note at its markup.
     */
    closedByBan?: ClosedByBan | null
  }
  /**
   * PASSED IN, NEVER READ FROM THE CLOCK HERE — the same rule `ago()` states in
   * `lib/duration`. It decides one thing: whether a match with no recorded end
   * is still inside its deadline or has blown through it. Reading `Date.now()`
   * during render would answer that differently on the server than in the
   * browser a moment later, which is a hydration mismatch React 19 repairs by
   * throwing the tree away. The incident page already has a `now`; the preview
   * harness has a fixed one, which is what makes both absent-end states
   * reviewable at all.
   */
  now: number
  /**
   * The English for a verdict, handed down from the server like
   * `categoryLabel` and `kindLabel` are on the page above.
   *
   * A PROP RATHER THAN AN IMPORT, and that is the same rule `incidentChip`
   * states: `VERDICT_LABEL` lives in `lib/incidents`, which reaches DynamoDB, so
   * a client component cannot import the value — only the type, which erases.
   * There is still exactly one place the English is written down.
   */
  verdictLabel: Record<VerdictAction, string>
}) {
  /*
    THE CLOSING ROW IS GUARANTEED BEFORE THE MERGE, not conjured during it.
    `withClosure` is a no-op on every shape this repository produces; it exists
    so that a resolved case whose events somehow lack a closing entry does not
    lose its verdict, its resolution text, its closing time and its closing
    admin all at once now that the card those lived in is gone.
  */
  const rows = mergeTimeline(
    withClosure(incident.events, incident),
    incident.matchTimeline,
  )
  const progress = matchProgress(incident, now)
  const progressLabel = MATCH_PROGRESS_LABEL[progress]
  const dropped = killDiscrepancy(incident)

  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 text-sm">
        Timeline
        {progressLabel && (
          <Badge
            className={cn(
              'border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
              progress === 'running'
                ? 'bg-live/10 text-live ring-live/30'
                : 'bg-warn/10 text-warn ring-warn/30',
            )}
          >
            {progressLabel}
          </Badge>
        )}
        {/*
          THE DROPPED KILLS, AS A COUNT. The ring buffer has a cap and a busy
          match overruns it; `matchKillsSeen` is how many the game actually
          counted. Neutral rather than amber on purpose — a full buffer is a
          fact about the buffer, not a fault in the case, and a warning colour
          here would read as though something were wrong with the evidence.
        */}
        {dropped && (
          <Badge className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
            {dropped.shown} of {dropped.seen} kills
          </Badge>
        )}
      </header>

      <div className="p-4">
        <Timeline>
          {rows.map((row) =>
            row.source === 'console' ? (
              <ConsoleRow
                key={`c-${row.index}`}
                event={row.event}
                origin={incident.openedAt}
                /*
                  THE VERDICT RIDES ON THE ROW THAT CLOSED THE CASE AND ON NO
                  OTHER. Null everywhere else, which is what stops the plausible
                  mutation — a chip on every console row, so that the opening
                  and every note claim a decision that had not been taken yet.
                  `check:timeline` pins this expression for that reason.
                */
                closure={isResolution(row.event) ? incident : null}
                verdictLabel={verdictLabel}
              />
            ) : (
              <MatchRow
                key={`m-${row.index}`}
                entry={row.entry}
                origin={incident.openedAt}
                from={incident.incidentId}
              />
            ),
          )}
        </Timeline>
      </div>
    </Card>
  )
}

function ConsoleRow({
  event,
  origin,
  closure,
  verdictLabel,
}: {
  event: ConsoleTimelineEvent
  /** The instant every offset on this list counts from. See `matchOffset`. */
  origin: number
  /**
   * The case's outcome, on the ONE row that closed it, and null on every other.
   * The caller decides which row that is, from `isResolution`.
   */
  closure: {
    verdict?: IncidentVerdict | null
    closedByBan?: ClosedByBan | null
  } | null
  verdictLabel: Record<VerdictAction, string>
}) {
  return (
    <TimelineItem>
      {/*
        THE ENDS OF THE CASE ARE DRAWN AS ENDS (owner, playtest: red dots on
        "Incident opened" and "Incident resolved", "not black dots"). Which rows
        those are lives in `isCaseBracket` and the colour argument lives with
        it — a membership test spelled here is one nothing can check, which is
        the same rule the match brackets already follow one component down.
      */}
      <TimelineMarker tone={isCaseBracket(event) ? 'danger' : 'default'} />
      <TimelineContent>
        <TimelineTitle>
          <span className="font-medium">
            {labelFor(CONSOLE_EVENT_LABEL, event.kind)}
          </span>
          {event.text ? (
            <span className="text-muted-foreground"> — {event.text}</span>
          ) : null}
          {closure && (
            <Verdict verdict={closure.verdict} verdictLabel={verdictLabel} />
          )}
        </TimelineTitle>
        {/*
          WHERE THE BAN WAS ACTUALLY DECIDED, when it was not decided here.

          THE LINK IS BUILT FROM A STRUCTURED FIELD, NOT FOUND IN THE TEXT. The
          resolution beside it is free text an admin never typed on this case,
          and an incident id interpolated into a sentence would be an id in a
          value that gets copied around — see the note on AUTO_CLOSE_RESOLUTION
          in `lib/incidents`. The id lives in `closedByBan`, which is what this
          reads.

          AND WHEN THERE IS NO CASE TO POINT AT, IT SAYS SO IN THE OWNER'S OWN
          WORDS — "banned on-demand" — rather than rendering a dead anchor or an
          "n/a". A ban issued from the profile page is not a ban whose incident
          is missing; it is a ban that was never an incident verdict.

          ITS OWN LINE RATHER THAN THE TITLE'S, because it is a sentence and the
          title is a label. It sits above the meta line so the row reads as what
          happened, why it happened, then when and by whom.
        */}
        {closure?.closedByBan && (
          <p className="text-sm text-muted-foreground">
            The ban that closed this was issued{' '}
            {closure.closedByBan.fromIncidentId ? (
              <>
                on another{' '}
                <Link
                  href={`/incidents/${closure.closedByBan.fromIncidentId}`}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  incident
                </Link>
              </>
            ) : (
              'on-demand'
            )}
            .
          </p>
        )}
        <TimelineMeta>
          <LocalTime ms={event.at} /> · {event.byName}
          <Offset at={event.at} origin={origin} />
        </TimelineMeta>
      </TimelineContent>
    </TimelineItem>
  )
}

/**
 * What the chip wears. Everything but the colour, which is `verdictTone`'s.
 *
 * `ml-1.5 align-[0.05em]` IS WHAT THE MOVE COST IT AND THE WHOLE OF WHAT IT
 * COST. The chip sat in a `flex … gap-2` row beside a heading and now sits
 * inline after a sentence, so it needs its own gap and its own baseline nudge —
 * the same two the headshot badge on the kill rows already carries, for the same
 * reason. Nothing else about it changed.
 *
 * NO TINT IS SPELLED HERE. The background comes from `verdictTone`, whose two
 * alphas are already in the CEF override block at the end of `globals.css`;
 * `check:cef` is what fails if a fresh one appears.
 */
const VERDICT_CHIP =
  'ml-1.5 border-0 align-[0.05em] text-xs uppercase tracking-wider ring-1 ring-inset'

/**
 * The verdict on a closed case, as a chip on the row that closed it.
 *
 * ═══ IT USED TO BE A CARD OF ITS OWN AND THE OWNER CUT IT ═══
 *
 * 2026-08-22: "we still have the 'verdict' section displaying on the incidents
 * page? That's not supposed to have it's own section on a resolved incident as
 * we already agreed to." Three of the four things that card said were already on
 * this row — the text, the instant and the admin — because `incidents.resolve`
 * writes them into the event and onto the row in a single update. This chip and
 * the provenance sentence above are what was actually only in the card.
 *
 * ABSENT IS ITS OWN CHIP AND NOT "NO ACTION". Every incident resolved before the
 * verdict field existed, and every one the system auto-resolved, carries no
 * verdict — and rendering those as "No action" would be the console inventing a
 * decision nobody made, which is the precise failure the field was added to end.
 * It says what it knows: closed, and no verdict was recorded.
 *
 * ═══ AND IT IS THE ONLY PLACE THAT DISTINCTION IS STATED IN WORDS ═══
 *
 * `incidentChips` deliberately gives a queue row NO second chip when there is no
 * verdict, because a recorded `none` and a never-recorded verdict are different
 * states and a two-chip row cannot carry the difference. Its comment names this
 * chip as where the difference is said instead. That pointer moved here with the
 * chip; if this ever stops rendering, that comment is the one to fix in the same
 * change, because the console would otherwise lose the distinction entirely.
 *
 * ITS OWN WORDING, THE SHARED COLOUR. This is not the row chip: it is the only
 * one that shows a ban's expiry. What it must NOT have its own opinion about is
 * which outcomes are loud — that rule is `verdictTone`, shared with the queue and
 * the profile, because a page where "banned" is red in a list and grey on the
 * case itself is a page that has two views about what a ban is.
 *
 * ONE WORD IS SAID TWICE ON THIS ROW AND IT IS DELIBERATELY LEFT ALONE. The
 * no-verdict chip reads "RESOLVED · NO VERDICT RECORDED" directly after a title
 * that already says the case was resolved — wording chosen for a chip that sat
 * beside a heading. Rewording a verdict label is the owner's call and was not
 * asked for, so it is reported rather than improved.
 */
function Verdict({
  verdict,
  verdictLabel,
}: {
  verdict?: IncidentVerdict | null
  verdictLabel: Record<VerdictAction, string>
}) {
  if (!verdict) {
    return (
      <Badge className={cn(VERDICT_CHIP, verdictTone(null))}>
        resolved · no verdict recorded
      </Badge>
    )
  }

  return (
    <Badge className={cn(VERDICT_CHIP, verdictTone(verdict.action))}>
      {labelFor(verdictLabel, verdict.action)}
      {verdict.action === 'ban' ? (
        verdict.expiresAt === null ? (
          <span className="ml-1 normal-case">— permanent</span>
        ) : (
          <span className="ml-1 normal-case">
            — until <LocalTime ms={verdict.expiresAt} />
          </span>
        )
      ) : null}
    </Badge>
  )
}

function MatchRow({
  entry,
  origin,
  from,
}: {
  entry: MatchTimelineEntry
  /** The instant every offset on this list counts from. See `matchOffset`. */
  origin: number
  /** The incident these names should lead back to. See `lib/profileLink`. */
  from: string
}) {
  /*
    THE SET OF BRACKETS LIVES IN `lib/matchTimeline`, not here. It gained a
    third member — `match_created`, the anchor a warmup case has instead of a
    start — and a membership test spelled in JSX is one nothing can check.
  */
  const bracket = isBracket(entry)

  return (
    <TimelineItem>
      <TimelineMarker tone={bracket ? 'accent' : 'muted'} />
      <TimelineContent>
        <TimelineTitle>
          {entry.kind === 'kill' ? (
            <Kill entry={entry} from={from} />
          ) : (
            <span className="font-medium">
              {labelFor(MATCH_EVENT_LABEL, entry.kind)}
            </span>
          )}
        </TimelineTitle>
        <TimelineMeta>
          <LocalTime ms={entry.at} />
          <Offset at={entry.at} origin={origin} />
        </TimelineMeta>
      </TimelineContent>
    </TimelineItem>
  )
}

/**
 * How far from the moment the incident was opened, positive or negative.
 *
 * WHICH ROWS GET ONE IS `matchOffset`'s DECISION AND NOT THIS COMPONENT'S. It
 * returns null for a row too far from the opening to be read as a duration, and
 * that limit is the only thing suppressing a number anywhere on this list — the
 * match is no longer consulted, so a case filed on the warmup pad and a case
 * with no match at all are both placed like everything else.
 */
function Offset({ at, origin }: { at: number; origin: number }) {
  const offset = matchOffset(at, origin)
  if (offset === null) return null
  return <span className="text-muted-foreground/70"> · {offset}</span>
}

/**
 * `Rebel killed Haley with a Marksman Rifle` — the owner's sentence, in the
 * owner's shape.
 *
 * BOTH NAMES ARE LINKS AND BOTH ARE KEYED ON LICENSE. A display name is chosen
 * by the player and is not unique; two accounts called `Rebel` are two people,
 * and a link built from a name sends an admin to whichever profile a search
 * happened to return first. Where the game recorded no license the name is
 * still shown and simply does not link, which is the honest degradation.
 *
 * WITH NO SECOND PARTY THE VERB GOES TOO. An environmental death — fall,
 * drowning, storm — has no killer, or has the victim as their own killer, and
 * "Haley killed Haley with a Fall" is not a sentence anybody wants on a
 * moderation record. Those rows are the victim and the cause: a name, an em
 * dash and a one-word label, which is the shape the console's own note rows
 * already use one row above.
 */
function Kill({ entry, from }: { entry: MatchTimelineEntry; from: string }) {
  const line = killLine(entry)
  const weapon = line.weapon ? <Weapon weapon={line.weapon} /> : null

  return (
    <>
      {line.killer ? (
        <>
          <Party party={line.killer} from={from} /> killed{' '}
          <Party party={line.victim} from={from} />
          {line.weapon && (
            <>
              {' '}
              with{line.weapon.article ? ` ${line.weapon.article}` : ''} {weapon}
            </>
          )}
        </>
      ) : (
        <>
          <Party party={line.victim} from={from} />
          {/*
            THE WEAPON WINS OVER THE CAUSE WHEN IT IS AN UNAUTHORIZED ONE, so a
            claim the game made explicitly cannot be hidden behind a cause
            label. Everywhere else the cause is the better word: it is what
            actually happened, and the weapon behind a fall is an engine
            constant nobody needs to read.
          */}
          {line.weapon?.unauthorized ? (
            <> — {weapon}</>
          ) : line.cause ? (
            <span className="text-muted-foreground"> — {line.cause}</span>
          ) : line.weapon ? (
            <> — {weapon}</>
          ) : null}
        </>
      )}
      {line.headshot && (
        <Badge
          variant="outline"
          className="ml-1.5 align-[0.05em] text-[0.625rem] uppercase tracking-wider"
        >
          headshot
        </Badge>
      )}
    </>
  )
}

function Party({ party, from }: { party: TimelineParty; from: string }) {
  if (party.license === null) {
    return <span className="font-medium">{party.name}</span>
  }
  return (
    <Link
      href={profileHref(party.license, from)}
      className="font-medium underline underline-offset-2"
    >
      {party.name}
    </Link>
  )
}

/**
 * The two sentences the hover card carries. Constants because they are rendered
 * TWICE — into the popup, and into an `sr-only` span inside the trigger.
 *
 * BOTH COPIES, ALWAYS. `docs/hover-text.md` rule 1: in Base UI 1.7.0 the popup
 * carries no `role="tooltip"` and no `aria-describedby`, and the hover
 * interaction is `mouseOnly`, so a screen reader is told nothing by it and a
 * phone never opens it. `ProfileView`'s `Face` and `Provenance` are the worked
 * examples — one string, built once, rendered into both places.
 */
const UNAUTHORIZED_TITLE = 'Unauthorized weapon'
const UNAUTHORIZED_DETAIL =
  'The gamemode does not issue this weapon. Damage from one is high-confidence evidence of cheating.'

/**
 * The weapon, and the only red on this page.
 *
 * THE CARD EARNS ITS SHAPE. `docs/hover-text.md` rule 5 — a card is a layout,
 * not an emphasis level — so this one has a header row naming what was found
 * and a body saying what it means, rather than a lone important sentence
 * promoted to a 256px popup.
 *
 * AND IT ADVERTISES ITSELF. The dotted underline comes with the red from
 * `weaponTone`; `cursor-help` alone only pays out once the pointer is already
 * on the word, which is the complaint that got `IdLabel` written in the first
 * place.
 *
 * `render={<span … />}` IS NOT OPTIONAL. `HoverCardTrigger` renders an `<a>` by
 * default and this sits inside a line that already contains two real links —
 * an anchor with no href between them is both wrong markup and a styling
 * surprise. Base UI, not Radix: there is no `asChild` here.
 */
function Weapon({ weapon }: { weapon: WeaponPart }) {
  const tone = weaponTone(weapon)
  if (tone === '') return <>{weapon.raw}</>

  return (
    <HoverCard>
      <HoverCardTrigger render={<span className={cn('cursor-help', tone)} />}>
        {weapon.raw}
        <span className="sr-only">. {UNAUTHORIZED_TITLE}. {UNAUTHORIZED_DETAIL}</span>
      </HoverCardTrigger>
      <HoverCardContent side="top">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-danger/10 text-danger ring-1 ring-inset ring-danger/25">
            <ShieldAlert className="size-3" />
          </span>
          <span className="text-sm font-medium">{UNAUTHORIZED_TITLE}</span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {UNAUTHORIZED_DETAIL}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
