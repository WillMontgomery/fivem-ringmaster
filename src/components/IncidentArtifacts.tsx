'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useState } from 'react'

import { LocalTime } from '@/components/LocalTime'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { artifactSrc, type Artifact } from '@/lib/artifacts'
import { cn } from '@/lib/utils'

/**
 * The frames captured on one incident, one at a time.
 *
 * ═══ AN EMPTY SET SAYS NOTHING, AND THAT IS THE WHOLE DESIGN ═══
 *
 * "EMPTY IS NORMAL AND IS NOT EVIDENCE OF ANYTHING" was the comment on the
 * `captureKeys` field this replaces, and it survives the field's deletion
 * because it is the reason this component is shaped the way it is. The four
 * unrelated reasons a case can have no frames are listed in `lib/artifacts.ts`
 * and not one of them is a statement about the accused.
 *
 * SO THERE IS NO EMPTY-STATE COPY, NO ICON AND NO DISTINCTION DRAWN IN WORDS.
 * The owner, 2026-08-20: "yeah agreed it never reads as innocent, but we don't
 * need helper text to convey that. it's assumed." An old case whose frames aged
 * out and a case where the capture never ran render IDENTICALLY, deliberately —
 * `/preview/incident?artifacts=aged` exists to make that visible.
 *
 * WHAT IS FORBIDDEN HERE IS ANYTHING THAT READS AS A VERDICT. No tick, no
 * reassuring graphic, no "nothing to see". The section keeps its header and its
 * body holds the console's own em-dash — the same glyph `LocalTime` renders for
 * an instant it does not have. It is plainly empty and makes no claim.
 *
 * THE SECTION STAYS RATHER THAN VANISHING because a missing panel reads as a
 * console that has no artifacts feature, and the next question after "why is
 * there nothing here" should not be "does this even work".
 *
 * THE ONE SENTENCE ON THIS PANEL IS IN THE HEADER AND THE OWNER WROTE IT — see
 * {@link COVERAGE_NOTE}. It says what a frame covers, which is true of the
 * feature and not of this case, so it does not touch the paragraph above: the
 * BODY is still wordless when there is nothing in it.
 *
 * ═══ ONE IMAGE AT A TIME, AND NO THUMBNAIL RAIL ═══
 *
 * A rail is the obvious carousel furniture and it is the wrong thing here:
 * there are no thumbnails in the bucket. Drawing nine of them means fetching
 * nine full-size screenshots to render a strip 48px high, which is the whole
 * cost of the feature spent on navigation.
 *
 * WHAT A MODERATOR ACTUALLY DOES is open a case, look at the first frame, and
 * either see it immediately or step through looking for the moment. So the first
 * frame loads with the page and the rest load when they are asked for — and a
 * frame already looked at STAYS MOUNTED, so stepping back is instant and does
 * not re-fetch. The cost of reviewing a nine-frame case fully is nine images;
 * the cost of opening one and seeing what you needed is one.
 *
 * THE PROBE IS THE CHEAP HALF AND HAPPENS ON THE SERVER. Nine parallel HEADs
 * establish which frames exist and when they were taken, moving headers rather
 * than pictures — see `lib/artifactStore.probe`. This component is handed the
 * answer and never talks to S3.
 *
 * ═══ WHY THIS IS A CLIENT COMPONENT AND NOTHING ABOVE IT MOVED ═══
 *
 * `IncidentDetail` is already `'use client'`, so this sits inside a boundary
 * that already exists rather than opening a new one. It needs state (which frame
 * is showing), and `LocalTime` — which is where every timestamp in this console
 * is formatted — is a client component reading the reader's chosen zone from
 * context. Everything with a credential in it stays on the server: the probe
 * runs in the page, the signing runs in the route, and neither the S3 SDK nor
 * the bucket name is reachable from this file.
 */
/**
 * What this frame is, in the owner's words.
 *
 * THE WORDING IS THEIRS AND IS NOT PARAPHRASED: "[offender]'s screen at report
 * time" or "[offender]'s screen at report time +5s". It replaced a bare
 * timestamp, which said when the photograph was taken and never what it was of.
 *
 * THE OFFSET IS DERIVED, NEVER HARDCODED. The three timed frames land at 0, +5s
 * and +10s, but every corroboration adds another whenever it arrives -- the
 * console's own fixtures carry +47s and +214s -- so a switch on the frame index
 * would be right for three frames and wrong for the rest.
 *
 * SECONDS THROUGHOUT, INCLUDING THE LARGE ONES. `+214s` rather than `+3m34s`,
 * because seconds-since-the-report is the number an admin is actually comparing
 * across frames, and because a second unit is a format the owner did not ask
 * for.
 *
 * NO CAPTURE TIME, NO CLAIM ABOUT ONE. A frame whose object carried no
 * `captured-at` gets the subject and nothing else. "At report time" would be a
 * guess, and it would be the one caption a reviewer might rely on.
 */
export function artifactCaption(
  subjectName: string,
  reportedAt: number,
  capturedAt: number | null,
): string {
  const whose = `${subjectName}'s screen`
  if (capturedAt === null || !Number.isFinite(capturedAt)) return whose

  // Rounded, then floored at zero. A frame stamped a hair before the report is
  // clock jitter between two writes, not a photograph from before the incident.
  const seconds = Math.max(0, Math.round((capturedAt - reportedAt) / 1000))
  return seconds === 0
    ? `${whose} at report time`
    : `${whose} at report time +${seconds}s`
}

export function IncidentArtifacts({
  incidentId,
  subjectName,
  reportedAt,
  frames,
  srcOverride,
}: {
  incidentId: string
  /** The player the case is about. The caption is about THEIR screen. */
  subjectName: string
  /**
   * When the report was filed -- `incident.openedAt`. The zero point every
   * caption counts from, and the reason the offsets are not stored: the game
   * writes absolute times so a corrected clock re-renders the whole set rather
   * than leaving baked-in offsets behind.
   */
  reportedAt: number
  /**
   * The frames that exist, in capture order, as `lib/artifactStore.probe` found
   * them. SPARSE BY DESIGN — 01 and 04 present while 02 and 03 are not is the
   * ordinary shape of photographing somebody else's machine.
   */
  frames: Artifact[]
  /**
   * Frame index -> where to fetch its bytes. THE ONLY CALLER THAT PASSES THIS
   * IS `/preview/incident`, and it exists because of a gap the harness cannot
   * otherwise cross.
   *
   * The real source is an authenticated route on this console that signs a URL
   * into a bucket which, as of this commit, has never held a single object —
   * there is no FiveM, no CEF and no S3 in this repo's harness, so no real
   * artifact exists anywhere to render. Left alone, every preview frame would
   * fail to load and the carousel's actual layout — the aspect box, the
   * contain-fit, where the timestamp sits beside the controls — would be
   * unreviewable, which is the one thing the preview directory exists for.
   *
   * A MAP RATHER THAN THE OBVIOUS `(id, index) => string`, and the reason is
   * not style: the preview page is a server component, and React refuses to
   * serialise a function across that boundary ("Functions cannot be passed
   * directly to Client Components"). Data crosses; behaviour does not.
   *
   * UNSET FALLS THROUGH TO THE REAL ROUTE, so the production path cannot be
   * affected by forgetting it.
   */
  srcOverride?: Record<number, string>
}) {
  const total = frames.length
  const [at, setAt] = useState(0)

  /**
   * Which positions have been asked for. The current one is always in it, and
   * nothing ever leaves — see the note above about stepping back.
   */
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]))
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set())

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= total) return
      setAt(next)
      setSeen((s) => (s.has(next) ? s : new Set(s).add(next)))
    },
    [total],
  )

  /**
   * DESTRUCTURED RATHER THAN LENGTH-CHECKED, so the compiler carries the empty
   * case for us. `noUncheckedIndexedAccess` types `frames[at]` as possibly
   * undefined and no length test narrows it; `first` does, and it doubles as the
   * fallback below.
   */
  const [first] = frames

  if (!first) {
    return (
      <Panel>
        {/*
          THE HOUSE GLYPH FOR A VALUE WE DO NOT HAVE, and not a word beside it.
          `LocalTime` renders exactly this for an instant it cannot show. Any
          sentence written here would be helper text (docs/hover-text.md rule 8)
          AND would be the console volunteering an interpretation of an absence
          that has four unrelated causes.
        */}
        <p className="py-6 text-center text-sm text-muted-foreground/70">—</p>
      </Panel>
    )
  }

  /**
   * CLAMPED ONCE, HERE, AND EVERYTHING BELOW READS `pos` RATHER THAN `at`.
   *
   * Not decoration: `at` is state and `frames` is a prop. A `router.refresh()`
   * after a resolve re-probes the bucket, and a set that came back shorter —
   * the lifecycle swept a frame between the two loads — would leave position 6
   * selected in a five-frame set. Clamping the render rather than the state
   * means the page recovers without an effect that fights the user's clicks.
   */
  const pos = at < total ? at : 0
  const current = frames[pos] ?? first

  return (
    <Panel
      /* A count is data, not helper text. `2 / 7`, in the header, like a pager. */
      trailing={
        total > 1 ? (
          <span className="tabular-nums text-xs text-muted-foreground">
            {pos + 1} / {total}
          </span>
        ) : null
      }
    >
      {/*
        THE ARROW KEYS WORK, AND THIS IS WHERE THEY ARE CAUGHT. A carousel a
        keyboard cannot step through is a carousel that only serves a mouse —
        the same complaint docs/hover-text.md makes about every native `title`
        this repo deleted. `tabIndex={-1}` makes the region focusable by click
        without inserting a stop in the tab order ahead of the real buttons.
      */}
      <div
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            go(pos - 1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            go(pos + 1)
          }
        }}
        className="outline-none"
      >
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-muted/30">
          {frames.map((frame, i) =>
            /*
              MOUNTED ONLY ONCE ASKED FOR. React keeps the previous ones in the
              DOM, so the browser has already decoded them and stepping back
              costs nothing. `hidden` rather than unmounting is the entire
              mechanism.
            */
            seen.has(i) ? (
              failed.has(i) ? (
                /*
                  A frame that existed at probe time and would not load now —
                  the lifecycle swept it between the HEAD and the GET, or the
                  signature was refused. NO WORDS: it is the same absence as an
                  empty set and gets the same treatment.
                */
                <p
                  key={frame.index}
                  hidden={i !== pos}
                  className="text-sm text-muted-foreground/70"
                >
                  —
                </p>
              ) : (
                /*
                  A PLAIN `<img>`, NOT `next/image`. The source is a redirect
                  this console issues to a signed URL on a host that changes with
                  the signature, so there is nothing stable to put in
                  `images.remotePatterns` — and the optimiser would fetch and
                  re-encode a picture of a player's screen through a cache on
                  this box, which is the one thing the 180-day bucket expiry
                  exists to avoid.

                  NO `eslint-disable` LINE ABOVE IT, though this is the shape
                  that usually carries one: `npm run lint` in this repo is a name
                  rather than a gate — no ESLint config and no `eslint`
                  dependency anywhere (docs/hover-text.md, "Known gaps") — so a
                  disable comment would point at a rule that never runs.
                */
                <img
                  key={frame.index}
                  hidden={i !== pos}
                  src={
                    srcOverride?.[frame.index] ??
                    artifactSrc(incidentId, frame.index)
                  }
                  alt=""
                  decoding="async"
                  onError={() => setFailed((f) => new Set(f).add(i))}
                  className="max-h-full max-w-full object-contain"
                />
              )
            ) : null,
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          {/*
            THE CAPTURE TIME, THROUGH THE ONE COMPONENT THAT FORMATS TIMES HERE.
            `LocalTime` renders the reader's chosen zone and names it, and it
            renders an em-dash for a frame whose object carried no `captured-at`.
            A second formatting path for this one surface is exactly what the
            issue said not to build.

            IT IS THE SERVER'S CLOCK, sampled when the game decided to ask for
            the frame — not the subject's, whose machine is the thing under
            suspicion, and not the upload's. That distinction belongs in this
            comment and not on the page.
          */}
          <p className="text-sm">
            {artifactCaption(subjectName, reportedAt, current.capturedAt)}
          </p>

          {total > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={pos === 0}
                aria-label="Previous frame"
                onClick={() => go(pos - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              {/*
                THE DOT IS 8px AND THE TARGET IS 24px. A bare `size-2` button is
                a hit area a third the size of the WCAG 2.5.8 minimum, which on
                a laptop trackpad means missing it. The dot is a `<span>` inside
                a button that is big enough to hit.
              */}
              {frames.map((frame, i) => (
                <button
                  key={frame.index}
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === pos ? 'true' : undefined}
                  aria-label={`Frame ${i + 1}`}
                  className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'size-2 rounded-full transition-colors',
                      i === pos
                        ? 'bg-foreground'
                        : 'bg-muted-foreground/50 hover:bg-muted-foreground',
                    )}
                  />
                </button>
              ))}
              <Button
                variant="ghost"
                size="icon"
                disabled={pos === total - 1}
                aria-label="Next frame"
                onClick={() => go(pos + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

/**
 * WHAT A FRAME COVERS, IN THE OWNER'S OWN WORDS, ASKED FOR BY THEM.
 *
 * "Only shows game engine. Inventory, etc. will not be shown." — verbatim, and
 * the only sentence on this page that was written by anybody other than the
 * owner's own hand. `docs/hover-text.md` rule 8 forbids volunteering copy; it
 * does not forbid copy that was requested, and where wording is given it is
 * used exactly as given rather than smoothed.
 *
 * WHY IT IS TRUE, for whoever wonders and must not put this on the page:
 * `screenshot-basic` grabs the game's 3D render through the same calls the
 * `x-cfx-game-view` plugin uses. The NUI layer — HUD, inventory, chat, the
 * pause menu — is composited by CEF afterwards and is not in the framebuffer
 * that gets captured. There is no setting that changes it.
 *
 * IT APPLIES TO THE EMPTY STATE TOO, which is why it sits in the panel header
 * rather than beside the picture. It is a fact about what this feature captures,
 * true whether or not this case has any frames — and the empty body stays
 * wordless, which is a separate instruction from a separate day.
 */
const COVERAGE_NOTE = 'Only shows game engine. Inventory, etc. will not be shown.'

/**
 * The card around it, matching the other panels on this page exactly.
 *
 * LOCAL RATHER THAN SHARED because `IncidentDetail` spells this shape inline
 * four times and extracting all of them is a different change to this one.
 */
function Panel({
  trailing,
  children,
}: {
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      {/*
        `flex-wrap` AND `ml-auto` REPLACED `justify-between`, because the row has
        three things in it now rather than two and the middle one is a sentence.
        Left to `justify-between` the note would have been pushed into the
        counter; this keeps it against the heading it belongs to and lets it drop
        to its own line in a narrow window instead of squeezing the count.
      */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-card/60 px-4 py-2.5 text-sm">
        {/*
          "Artifacts", NOT "Captures" (owner, 2026-08-20). The rename was always
          primarily about this word: it is the only place the feature names
          itself to a reader.
        */}
        <span>Artifacts</span>
        <span className="text-xs text-muted-foreground">{COVERAGE_NOTE}</span>
        {trailing && <span className="ml-auto">{trailing}</span>}
      </header>
      <div className="p-4">{children}</div>
    </Card>
  )
}
