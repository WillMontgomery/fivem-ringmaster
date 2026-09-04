'use client'

import {
  ArrowRight,
  ArrowUpCircle,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  Rocket,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useFormatInstant } from '@/components/PrefsProvider'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { postJson } from '@/lib/api'
import { ago, humanDuration } from '@/lib/duration'
import { commitUrl, compareUrl, shortSha } from '@/lib/github'
import { useLiveState } from '@/lib/livePoll'
import { deployPhase, RESTART_GRACE_MS } from '@/lib/serverPhase'
import {
  AUTO_AFTER_MS,
  behindMainNow,
  branchRefusal,
  nothingToDeploy,
  refBehindNow,
  refBlockedNow,
  runningShaNow,
  updateTargetNow,
  UPDATE_AVAILABLE,
  type MaintenanceWindow,
} from '@/lib/maintenance'
import type { HostBranch, RefUpdate, UpdateTarget } from '@/lib/ssh'
import { machineInstant } from '@/lib/time'
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

function until(ts: number, now: number): string {
  const ms = ts - now
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `in ${m}m`
  return `in ${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Local datetime string for an <input type="datetime-local"> default.
 *
 * THE OFFSET IS SAMPLED AT `ts`, NOT AT NOW, and that is a bug fix rather than
 * a tidy-up. `new Date().getTimezoneOffset()` asks "what is the offset right
 * now"; across a DST boundary the answer for the moment being rendered is an
 * hour different. Scheduling a deploy for the far side of a clock change put
 * the wrong hour in the field, and the field controls when the production game
 * server restarts.
 *
 * STAYS BROWSER-LOCAL, deliberately, and is the one thing in this console that
 * ignores the timezone preference. `<input type="datetime-local">` is parsed by
 * the browser in the browser's zone (see the `new Date(deployAt)` in
 * `schedule()`), so re-rendering the field in a different zone while the parse
 * stayed browser-local would put the typed value and the resulting instant five
 * hours apart on a form that restarts a live server. The form says which zone
 * it is in instead — see the note beside the input.
 */
function localInput(ts: number): string {
  const offsetAtTs = new Date(ts).getTimezoneOffset()
  return new Date(ts - offsetAtTs * 60_000).toISOString().slice(0, 16)
}

/**
 * One commit, linked to what it actually is.
 *
 * A BARE `<a>` STYLED HERE, NOT `Button render={<Link/>}` AND NOT `Link`. This
 * goes to github.com, so `next/link` has nothing to prefetch and no client
 * navigation to make; and Base UI's own installed docs
 * (node_modules/@base-ui/react/docs/react/components/button.md, "Rendering links
 * as buttons") rule out putting an anchor through `render` — `useButton` merges
 * button semantics onto it and costs the reader the one thing an anchor tells
 * them, which here is "this leaves the console".
 *
 * THE `sr-only` PREFIX IS THE WHOLE REASON THIS IS A COMPONENT. Two eight-hex
 * strings side by side are told apart by POSITION, and position is exactly what
 * a screen reader's link list throws away: "link, 4f2b9c1d — link, 9c1e77a4" is
 * two identical-looking destinations and no way to tell which one is running.
 * The label rides in the markup rather than in an `aria-label`, so it cannot
 * replace the visible sha in the accessible name (WCAG 2.5.3) and so the fact
 * survives being read aloud as well as being looked at.
 */
function CommitLink({ sha, label }: { sha: string; label: string }) {
  return (
    <a
      href={commitUrl(sha)}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm font-mono underline decoration-dotted underline-offset-4 transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="sr-only">{label}, commit </span>
      {shortSha(sha)}
    </a>
  )
}

/**
 * WHAT THE SERVER IS ON, AND WHAT A DEPLOY WOULD PUT ON IT.
 *
 * THIS IS WHAT THE COMMIT COUNT BECAME, and the owner's reason for the trade is
 * the whole design: "3 commits behind" does not tell anybody whether to deploy.
 * It is a number that has to be believed, cannot be checked from the console,
 * and — as #26 and the branch picker both found — is ambiguous about what it was
 * measured from. Two shas are checkable in one click each, and the third link
 * shows the diff between them, which is the actual question ("what am I about to
 * ship") that the count was standing in for.
 *
 * IT NAMES THE REF, because this console has two different distances that both
 * get called "behind" and a pair of commits inherits exactly the same ambiguity
 * if it does not say which branch it is walking along.
 *
 * RENDERS ONLY WHEN BOTH ENDS ARE KNOWN. `updateTargetNow` withholds the pair
 * for an unpaired reading and for `from === to`; there is no half of this worth
 * showing, and an arrow with a guess on one end is worse than no arrow.
 */
function CommitPair({ target }: { target: UpdateTarget }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <CommitLink sha={target.fromSha} label="Running now" />
      <ArrowRight className="size-3.5 shrink-0" aria-hidden />
      {/*
        "NEWEST COMMIT", NOT "DEPLOYING TO", AND THE CORRECTION IS THE BUG.

        The owner: "it's misleading to say we're going from X to Y but we
        actually end up on Z, which is the latest." This label was the promise.
        `tools/deploy.sh` resolves the destination ITSELF — its own `git fetch`
        and `reset --hard origin/$BRANCH` — at the moment the deploy runs, which
        for a `when-empty` window is however long the drain took. So the console
        never had the authority to name the commit a deploy would land on, and
        this said it would.

        THE SAME PAGE ALREADY HAD THE RIGHT WORDS. The live-window card says an
        update goes "to its newest commit when the deploy runs", and its comment
        spells out why it shows no sha there: "An update takes the tip at deploy
        time; only a switch is pinned." Two cards on one page disagreed about
        what an update deploys, and this was the one that was wrong.

        THE SHA STAYS, BECAUSE IT IS STILL THE ANSWER TO THE QUESTION BEING
        ASKED. "What am I about to ship" is read from the diff link beside it,
        and the newest commit the box knows about is the honest left-hand side of
        that diff. What changed is that it no longer claims to be a destination.
      */}
      <CommitLink sha={target.toSha} label="Newest commit" />
      <span>
        on <code className="font-mono text-foreground">{target.ref}</code>
      </span>
      <span aria-hidden>·</span>
      <a
        href={compareUrl(target.fromSha, target.toSha)}
        target="_blank"
        rel="noreferrer"
        className="rounded-sm underline decoration-dotted underline-offset-4 transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        what changed
      </a>
      {/*
        SAID OUT LOUD, LIKE THE BRANCH LIST SAYS IT. A stale reading means the
        game box could not finish its fetch inside the SSH budget and answered
        from the refs it already had, so the right-hand commit is the newest one
        IT KNEW ABOUT and the branch may have moved past it since. That does not
        make the pair useless — it is still two real commits and the diff between
        them is still real — but a reader deciding whether to restart a live
        server is entitled to know the target may be behind the truth.
      */}
      {target.stale && (
        <span className="text-warn">
          — the host answered from refs it already had, so the target may have
          moved on
        </span>
      )}
    </div>
  )
}

export function MaintenancePanel({
  initial,
  initialPlayers,
  initialDeployedRef,
  initialRefUpdate,
  initialBehindMain,
  initialUpdateTarget,
  initialRunningSha,
  initialBootEpoch = null,
  initialLastPushAt = null,
  frozen = false,
}: {
  initial: MaintenanceWindow | null
  initialPlayers: number
  /**
   * What the game host is running right now, or null if it has not said.
   *
   * NULL AND 'main' ARE NOT THE SAME THING here, for the same reason they are
   * not the same thing in `lib/ssh`: null is a host that has not answered — an
   * unconfigured channel, or a dispatcher older than this feature — and the
   * page renders exactly as it always did for it. Only a stated ref that is not
   * `main` puts this page into its parked shape.
   */
  initialDeployedRef: string | null
  /**
   * How far the box is behind the branch it is parked on, or null.
   *
   * NULL IS "NOT KNOWN", AND IS NOT ZERO. On main there is no such number by
   * design (`behindMain` is the one that means anything there); off main the
   * poller may not have read it yet, the branch may be gone from the remote, or
   * the host may be unreachable. Every one of those has to render as silence.
   * Claiming "0 commits behind dev" on a box that simply has not been asked
   * would be the same class of confident wrong answer as the distance-from-main
   * number this exists to replace.
   */
  initialRefUpdate: RefUpdate | null
  /**
   * How far behind main the box is, or null.
   *
   * NULL IS "NOT KNOWN", AND IS NOT ZERO — the same sentence as the prop above,
   * which is the point: the two readings finally answer the same way. This
   * arrived as `updateAvailable ?? 0` off the maintenance row until #26, and the
   * coalesce made "the telemetry poller has not answered yet" indistinguishable
   * from "level with main". Off main it is null as well, for a different reason:
   * distance from main is not the question a parked box is being asked, and
   * every surface that has ever printed it beside a branch name was a bug.
   */
  initialBehindMain: number | null
  /**
   * The two commits an update would move between, or null.
   *
   * THE COMMIT COUNT IS GONE AND THIS IS WHAT REPLACED IT. "3 commits behind"
   * does not tell an operator whether to deploy; `4f2b9c1d → 9c1e77a4`, both
   * linked to GitHub, lets them read what actually changed. Null until the
   * two-minute `branches` reading lands, and null renders no arrow at all —
   * there is no half of this pair worth showing on its own.
   */
  initialUpdateTarget: UpdateTarget | null
  /**
   * The commit the box is running RIGHT NOW, or null if it has not said.
   *
   * THE LIVE READING, NOT THE RECORDED ONE, and the distinction is this prop's
   * entire reason for existing — see `runningShaNow`. The settled card used to
   * print `deployLandedSha` off the window row, which is a note about one past
   * deploy rather than an answer about the running server, and the two had
   * visibly diverged by six commits on the owner's console.
   *
   * NULL RENDERS NOTHING, like every other reading here: a host that has not
   * answered, or one too old to send a full sha, leaves the card saying what it
   * always said and naming no commit.
   */
  initialRunningSha: string | null
  /**
   * The live feed, as the SERVER render saw it, so the completion gate has an
   * answer on first paint instead of two seconds later.
   *
   * WITHOUT THESE THE PAGE FLASHES THE WRONG STATE, and in the worst direction:
   * with no boot epoch to compare against, a window that completed thirty
   * seconds ago and whose server is already back reads as still waiting — so an
   * admin who reloads /maintenance right after a successful deploy watches a
   * spinner appear and then vanish. The polled values take over the moment they
   * land; these only cover the gap.
   */
  initialBootEpoch?: string | null
  initialLastPushAt?: number | null
  /**
   * Hold the props as given and never poll. FOR THE DESIGN HARNESS ONLY.
   *
   * This panel is the one preview target that refuses to sit still: it re-reads
   * `/api/maintenance` and `/api/host` every five seconds and overwrites its
   * own state from them, so /preview/maintenance would render a fixture and
   * then replace it with whatever the developer's real console happens to be
   * doing — which for the states worth reviewing (parked on a branch, a window
   * mid-drain) is reliably "nothing", i.e. the fixture is gone a heartbeat
   * after it appears.
   *
   * Defaults to false, so every production caller is untouched and no route can
   * freeze this by omission. The one caller that passes true is the dev-only
   * harness, which 404s in production.
   */
  frozen?: boolean
}) {
  const router = useRouter()
  const [w, setW] = useState(initial)
  const [players, setPlayers] = useState(initialPlayers)
  const [now, setNow] = useState(() => Date.now())
  const [deployedRef, setDeployedRef] = useState(initialDeployedRef)
  const [refUpdate, setRefUpdate] = useState(initialRefUpdate)
  const [behindMain, setBehindMain] = useState(initialBehindMain)
  const [updateTarget, setUpdateTarget] = useState(initialUpdateTarget)
  const [runningSha, setRunningSha] = useState(initialRunningSha)

  const [drainIn, setDrainIn] = useState('0')
  const [advanced, setAdvanced] = useState(false)
  const [timed, setTimed] = useState(false)
  const [deployAt, setDeployAt] = useState(() =>
    localInput(Date.now() + 60 * 60_000),
  )
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)

  // ------------------------------------------------------------- branches ---
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [branches, setBranches] = useState<HostBranch[] | null>(null)
  /**
   * The commit the list's `ahead`/`behind` were counted from.
   *
   * KEPT RATHER THAN DISCARDED because the picker now states what its numbers
   * are measured against, and "the commit running now" is a claim a reader
   * should be able to check. It comes back in the same `branches` answer as the
   * counts, so it is the sha those counts were actually taken from — not
   * `status.sha`, which is a different round trip and could have moved.
   */
  const [branchesFromSha, setBranchesFromSha] = useState<string | null>(null)
  const [branchesStale, setBranchesStale] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [picked, setPicked] = useState<HostBranch | null>(null)
  const [confirmSwitch, setConfirmSwitch] = useState(false)

  /**
   * PARKED IS A STATED FACT, NOT THE ABSENCE OF ONE. See the prop comment: a
   * host that has not answered renders as it always has.
   */
  const parked = typeof deployedRef === 'string' && deployedRef !== 'main'

  /**
   * How many commits the parked branch has gained since this box deployed, or
   * null for "we do not know".
   *
   * DERIVED IN lib/maintenance, NOT HERE, because the same reading now decides
   * two things: what these sentences say, and whether the button under them can
   * be pressed. The pairing rules it applies — a count is only valid under the
   * ref it was taken for, and a STALE zero is not a zero — are stated there and
   * are the difference between "there is nothing to ship" and "we have not
   * looked". Both readings must come out of one place or the card will
   * eventually describe a state its own button disagrees with.
   */
  const refBehind = refBehindNow(deployedRef, refUpdate)

  /**
   * WHY THE GAME BOX WOULD REFUSE TO DEPLOY THIS BRANCH, or null for "it would
   * not".
   *
   * THE SECOND QUESTION ABOUT THE SAME BRANCH, and the one this page never
   * asked. `refBehind` says there is something to deploy; this says whether the
   * box would take it. They are independent, and the state where they disagree
   * — ahead AND refused — is the one that reached production: the update card
   * rendered, the button was live, the deploy was scheduled, and the refusal
   * turned up afterwards in a systemd log.
   *
   * DERIVED IN lib/maintenance FOR THE SAME REASON `refBehind` IS. The pairing
   * rule and the `=== false` polarity are stated once, beside the reading, and
   * `api/maintenance` runs the same function over the same snapshot before it
   * accepts the request — so a greyed button and a refused POST are one
   * expression evaluated twice rather than two rules that happen to agree.
   *
   * THE SENTENCE IS THE GAME BOX'S, WORD FOR WORD. Nothing here rewrites it,
   * shortens it or explains it; the branch picker has rendered the same string
   * the same way since it was built.
   */
  const refBlocked = refBlockedNow(deployedRef, refUpdate)

  /**
   * Is there a KNOWN update against main? Not "is main's card showing".
   *
   * THE PAIR TO `refBehind`, AND IT IS READ THE SAME WAY: truthy is a positive
   * reading, and both zero and null are falsy — which is safe HERE and nowhere
   * that decides an action, because the only thing this switches is which of two
   * sentences to write. Zero never reaches these sentences at all (the card does
   * not render), so falsy means "not yet known" by the time it is used. Anything
   * gating a control must go through `nothingToDeploy` instead, where null and
   * zero are told apart with `!== 0`.
   */
  const mainBehind = behindMain !== null && behindMain > 0

  /**
   * Every time this panel DISPLAYS is in the reader's stated zone and says so.
   * The one time it READS — the datetime-local field — is in the browser's.
   */
  const { format, timeZone } = useFormatInstant()
  const clock = (ts: number) => format(ts, { withYear: false })

  /**
   * The browser's own zone, read after mount because `Intl` during render is
   * one answer on the server and another here.
   *
   * WHEN THE TWO DISAGREE THE FORM HAS TO SAY SO. This is the highest
   * consequence surface in the console: the field below is parsed browser-local
   * while every label around it is rendered in the preference zone. An admin
   * whose preference is New York, sitting in London, would otherwise type 10:00
   * meaning one and get the other — and the thing that moves is a production
   * game-server restart, five hours early.
   */
  const [browserZone, setBrowserZone] = useState<string | null>(null)
  useEffect(() => {
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])
  const zoneMismatch = browserZone !== null && browserZone !== timeZone

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
   *
   * THE COMPLETION TOAST IS NOT HERE ANY MORE, and its absence is deliberate.
   * It fired on `deploying -> complete`, which is the deploy VERB returning
   * rather than FXServer answering — so it landed while the feed was still dead
   * and the header still said the server was gone. It also only existed on this
   * page, so an admin anywhere else was never told. It now lives in
   * `lib/livePoll`, fires off the same reading that flips the header's Updating
   * chip back to Live, and is module-scoped so a re-mounting header cannot say
   * it twice. See `announceDeployOutcome`, which now also has words for the two
   * ways a deploy ends badly — the completion gate gave it a "did not come
   * back" state to announce, where before there was only silence.
   */
  useEffect(() => {
    // The harness renders a fixed state and nothing else may move it. Note the
    // clock stops too, which is correct here: `until()` and the countdowns are
    // part of what is being reviewed, and they have to hold still to be read.
    if (frozen) return

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
          } else if (nextState === 'cancelled') {
            toast.info(
              `${next?.cancelledByName ?? 'Someone'} cancelled the maintenance window.`,
            )
          }
        }

        /**
         * A STATE CHANGE HAS TO RE-RENDER THE SERVER COMPONENTS TOO.
         *
         * The sidebar and header badges are resolved in AppShell, which is a
         * server component — so this poll updated the panel while the
         * "maintenance draining" badge beside the nav item stayed exactly as it
         * was, indefinitely, long after the update had finished. It only
         * cleared on a hard navigation, which is not something anybody does
         * while watching a deploy.
         *
         * router.refresh() re-runs the server render, which re-reads the row
         * and drops the badge. Only on a CHANGE, never per poll: refreshing
         * every five seconds would re-fetch every server component on the page
         * forever.
         */
        if (prev !== null && prev !== nextState) {
          router.refresh()
        }

        seenState.current = nextState
        setW(next)
        setPlayers(d.players ?? 0)
      } catch {
        /* keep the last view; the clock still ticks */
      }

      /**
       * Which ref the box is on, and how far behind that ref it is, refreshed
       * in the same beat.
       *
       * A SEPARATE, CHEAP READ. /api/host answers from the telemetry poller's
       * in-memory snapshot and makes no SSH call of its own, so this costs a
       * local round trip rather than a trip to the game box — unlike
       * /api/host/branches, which really does fetch and is therefore only
       * loaded on demand. `refUpdate` comes from a `branches` call, but one the
       * SERVER made on its own two-minute timer; reading it here is free, and
       * five browser tabs on this page cost the game box exactly as much as
       * none do.
       *
       * It matters here specifically because a deploy CHANGES both values: an
       * admin who switches to a branch and watches the window through would
       * otherwise be looking at a page still describing the old ref, on the one
       * screen where that fact is the entire subject.
       */
      try {
        const hres = await fetch('/api/host', { cache: 'no-store' })
        if (hres.ok) {
          const hv = (await hres.json()) as {
            status?: {
              deployedRef?: string
              behindMain?: number
              /**
               * The full 40-hex commit. `status.commit` beside it is
               * ABBREVIATED and is not read here: `runningShaNow` refuses
               * anything that is not a whole sha, for the same reason
               * `deployLanded` does.
               */
              sha?: string
            } | null
            refUpdate?: RefUpdate | null
            updateTarget?: UpdateTarget | null
          }
          setDeployedRef(
            typeof hv.status?.deployedRef === 'string'
              ? hv.status.deployedRef
              : null,
          )
          setRefUpdate(hv.refUpdate ?? null)
          /**
           * THROUGH `behindMainNow`, NOT `?? 0`, AND NOT A BARE FIELD READ.
           * This poll is one of the four sites that used the coalesce, and it
           * is the one that decides whether the scheduling card is on the page
           * — so a `/api/host` answer that arrives with no `status` at all (an
           * unconfigured channel, a poller that has not landed) has to leave
           * this null and keep the card, rather than zero it and take the card
           * away. One derivation, shared with the route that would accept the
           * request.
           */
          setBehindMain(behindMainNow(hv.status))
          /**
           * AND WHICH COMMIT IT IS ON, IN THE SAME BEAT AS THE DISTANCE. Both
           * come off the one `status` reading, so the settled card below cannot
           * name a commit from a different moment than the one the card's own
           * "there is nothing to deploy" was decided from.
           *
           * THIS POLL IS THE FIX. `deployLandedSha` — what used to be rendered
           * there — is written once and then never touched again until the next
           * scheduled window, so a box moved by anything else (a manual deploy
           * on the game host, a restart, a switch) left the card asserting a
           * commit that had stopped being true and had nothing to correct it.
           */
          setRunningSha(runningShaNow(hv.status))
          setUpdateTarget(hv.updateTarget ?? null)
        }
      } catch {
        /* leave the last known ref; a dropped poll is not a branch change */
      }
    }
    void tick()
    const t = setInterval(tick, 5_000)
    return () => clearInterval(t)
  }, [])

  const live =
    w && (w.state === 'scheduled' || w.state === 'draining' || w.state === 'deploying')

  /**
   * WHERE THIS DEPLOY HAS ACTUALLY GOT TO — the same reading the header chip
   * and the completion toast use.
   *
   * ONE FUNCTION, NOT TWO NOTIONS. The owner's complaint was that "after the
   * drain it just jumps to 'up to date'": the window goes `complete` the moment
   * the deploy VERB returns, `live` goes false, and this panel fell straight
   * through to the finished state while FXServer was still booting. The fix is
   * not a second "am I still deploying" flag on this page — that is how two
   * surfaces come to disagree — it is that the loading state and the completion
   * gate are the SAME expression, `deployPhase`, evaluated here and in
   * `lib/livePoll` over the same row.
   *
   * THE INPUTS COME FROM WHEREVER THEY ARE FRESHEST, which is not a second
   * source: the window fields are this panel's own five-second poll (it holds
   * the whole row, including the three deploy-verdict fields), and the live
   * feed rides the two-second `/api/state` poll every page already runs. A
   * frozen harness has no poll and falls back to the server-rendered values,
   * which is what lets `/preview/maintenance?state=confirming` exist at all.
   */
  const polled = useLiveState(!frozen)
  const phaseNow = polled?.now ?? now
  const phase = deployPhase({
    state: w?.state,
    deployStartedAt: w?.deployStartedAt,
    completedAt: w?.completedAt,
    deployError: w?.deployError,
    deployBootEpoch: w?.deployBootEpoch,
    deployConfirmedAt: w?.deployConfirmedAt,
    bootEpoch: polled?.view.bootEpoch ?? initialBootEpoch,
    lastPushAt: polled?.view.lastPushAt ?? initialLastPushAt,
    now: phaseNow,
  })

  /**
   * The two commits a deploy would move between, on whichever ref the box is
   * on, or null for "we cannot say".
   *
   * PAIRED IN lib/maintenance, NOT HERE, for exactly the reason `refBehind` is:
   * a reading taken for another branch is not a reading, and an arrow whose two
   * ends are the same commit is not an update. Both rules are stated once, in
   * `updateTargetNow`, so the sentence in this card and the arrow under it
   * cannot come to different conclusions about the same poll.
   *
   * ═══ `phaseNow`, AND IT HAS TO BE THE SERVER'S CLOCK ═══
   *
   * `updateTargetNow` now also refuses a reading it is too late to stand behind,
   * and it measures that against `updateTarget.at` — a timestamp stamped on the
   * SERVER when the `branches` answer arrived. Comparing it to this component's
   * `now`, which is `Date.now()` in a browser, would make the arrow disappear on
   * any machine whose clock runs a few minutes fast: an operator's laptop
   * deciding the console's reading is stale on the strength of its own clock.
   * `phaseNow` is the live poll's `now`, which is the same server that stamped
   * `at`, so the subtraction is between two readings of one clock. It falls back
   * to the local `now` only in the frozen preview harness, where there is no poll
   * and no host either.
   *
   * WHICH IS ALSO WHY THIS MOVED DOWN THE FILE, past `polled`. It reads the live
   * poll now, so it has to come after it.
   */
  const target = updateTargetNow(deployedRef, updateTarget, phaseNow)

  /**
   * The moment the excuse runs out, for the countdown below.
   *
   * SHOWN, NOT HIDDEN, because a loading state whose end an operator cannot see
   * is one they have no way to distinguish from a hang — which is exactly the
   * complaint that the old behaviour (jump to "up to date") was the other half
   * of. Saying "five minutes, then this becomes a failure" makes waiting a
   * decision rather than a guess.
   */
  const restartDeadline =
    typeof w?.completedAt === 'number' ? w.completedAt + RESTART_GRACE_MS : null

  /**
   * Read the branch list off the game host.
   *
   * ON DEMAND, NEVER POLLED. Every other host read in this console is on a
   * timer; this one costs a real `git fetch --prune` against GitHub on the game
   * box, and the answer changes when somebody pushes rather than every fifteen
   * seconds. The refresh button asks; OPENING THE PICKER ASKS TOO, every time
   * and not only the first.
   *
   * WHY THAT SECOND CLAUSE IS THE WHOLE POINT. The open handler used to fire
   * this only while `branches === null`, so the list was read once per page
   * session and the picker showed that one reading for as long as the tab
   * stayed open. `blockedBy` is the reading on this page that is SUPPOSED to
   * stop being true — a merge to main resolves it — and the owner hit exactly
   * that: he landed the PR that unblocked `dev` and the picker went on printing
   * "changes tools/dispatch.sh — deploy it through main and PR review",
   * reopened and reopened, with no way to notice. `do_branches` on the box is
   * also what runs the `fetch --prune`, so a console that never re-asks leaves
   * the box's own `origin/main` unrefreshed and the refusal is stale at both
   * ends.
   *
   * ON OPEN IS NOT A POLL, and that distinction is the budget. The fetch is
   * bounded at both ends — the box gives up and answers `stale`, and this end
   * gives up on the six-second SSH wall — and it is now spent once per
   * deliberate act by a human, which is exactly what Refresh has always cost. A
   * timer would spend it forever on a page left open.
   */
  const loadBranches = async () => {
    setLoadingBranches(true)
    setBranchError(null)
    try {
      const res = await fetch('/api/host/branches', { cache: 'no-store' })
      const text = await res.text()
      let d: {
        ok?: boolean
        error?: string
        stale?: boolean
        deployedRef?: string
        deployedSha?: string
        branches?: HostBranch[]
      }
      try {
        d = JSON.parse(text) as typeof d
      } catch {
        throw new Error(
          `Server returned ${res.status} ${res.statusText}. ` +
            `Body began: ${text.slice(0, 80).replace(/\s+/g, ' ').trim() || '(empty)'}`,
        )
      }
      if (!res.ok || d.ok === false) {
        throw new Error(d.error ?? `Request failed (${res.status}).`)
      }
      const list = d.branches ?? []
      setBranches(list)
      setBranchesStale(Boolean(d.stale))
      setBranchesFromSha(
        typeof d.deployedSha === 'string' && d.deployedSha ? d.deployedSha : null,
      )
      if (typeof d.deployedRef === 'string') setDeployedRef(d.deployedRef)
      /**
       * AND THE PICK FOLLOWS THE LIST IT CAME OUT OF.
       *
       * `picked` outlives the picker being closed, so a reload can land under a
       * selection made against the previous reading — and it is the SAME row
       * only by name. Two ways that goes wrong and both are silent: the sha
       * travels with the pick, so an un-repointed one schedules a commit that
       * has since been superseded, pinned, against a row on screen naming a
       * different one; and `api/maintenance` deliberately does not re-check a
       * switch's eligibility because "the picker has already gated on that
       * branch's own `eligible`" — a promise that only holds while the pick and
       * the list are the same answer.
       *
       * SO IT IS RE-POINTED, OR DROPPED. Re-pointed at the fresh row when that
       * row is still choosable, dropped when it is not there at all or
       * `branchRefusal` now names a reason — which is the same function the row
       * itself is disabled by, so the footer button and the row it refers to
       * cannot come apart. The owner's case is the happy direction of this:
       * `dev` unblocked by a merge comes back choosable and the pick survives.
       */
      const ref = typeof d.deployedRef === 'string' ? d.deployedRef : deployedRef
      setPicked((p) => {
        if (!p) return null
        const fresh = list.find((b) => b.name === p.name)
        return fresh && branchRefusal(fresh, ref) === null ? fresh : null
      })
    } catch (e) {
      /**
       * A FAILED RE-READ DOES NOT TAKE THE LIST AWAY.
       *
       * This used to null `branches` and `branchesFromSha` on any error, which
       * was harmless while the only load was the first one — there was nothing
       * to lose — and is wrong now that opening the picker re-asks. A cold load
       * still ends with nothing, because nothing is what it started with; a
       * RELOAD that cannot reach the host would otherwise delete the rows an
       * operator was reading mid-read, on the strength of a failure that says
       * nothing about whether those rows were right.
       *
       * NOT SILENTLY, AND NOT DRESSED UP AS FRESH EITHER. The error is rendered
       * above the list in the danger register, so what is on screen is a list
       * with a stated failure over it rather than a list presented as current.
       *
       * `branchesStale` IS DELIBERATELY NOT SET HERE. That flag is the game
       * host's own admission that it answered from refs on disk, and the banner
       * it draws says exactly that. A console-side fetch failure is a different
       * fact, and borrowing the host's sentence for it would state a cause
       * nobody established. The two readings keep their own words.
       *
       * `branchesFromSha` STAYS WITH THE LIST because it is part of the same
       * answer: it names the commit those `+`/`−` were counted from. Keeping
       * the rows while dropping what they are measured against would leave
       * every number on screen unlabelled.
       */
      setBranchError(e instanceof Error ? e.message : 'Could not read the branches.')
    } finally {
      setLoadingBranches(false)
    }
  }

  /**
   * Schedule a window, optionally putting a different branch on the box.
   *
   * THE SHA TRAVELS WITH THE NAME, ALWAYS. It was resolved on the game host
   * when the list was drawn, and it is what makes the difference between "put
   * feature/x on the box" and "put whatever feature/x happens to be by the time
   * the last match ends". Anyone with push access can move a branch in that
   * gap, and the box refuses rather than deploying a tip nobody looked at.
   */
  const scheduleWith = async (target: HostBranch | null) => {
    setBusy(true)
    try {
      await postJson('/api/maintenance', {
        drainInMinutes: Number(drainIn),
        deployMode: timed ? 'at-time' : 'when-empty',
        deployAt: timed ? new Date(deployAt).getTime() : null,
        ...(target ? { targetRef: target.name, targetSha: target.sha } : {}),
      })
      /**
       * THE ORDINARY PATH NAMES THE REF TOO WHEN THERE IS ONE TO NAME. On main
       * "Maintenance scheduled." is the whole story; parked on a branch it is
       * the exact ambiguity #146 was about, because the same button means
       * "update dev" there and the operator has no other confirmation of
       * which ref they just aimed a restart at.
       */
      const what = target
        ? `Switching to ${target.name} (${target.sha.slice(0, 8)}).`
        : parked
          ? `Updating ${deployedRef} to its newest commit.`
          : 'Maintenance scheduled.'
      toast.success(
        timed
          ? `${what} Deploy at ${clock(new Date(deployAt).getTime())}.`
          : `${what} It deploys once the server empties.`,
      )
      // `picked` is deliberately NOT cleared here. The confirm dialog reads it
      // for its own title, and clearing it inside the awaited handler renders
      // one frame of "Put this branch on the live server?" before the dialog
      // closes. The window is live after this, so the picker is not on screen
      // to be stale.
      setBranchesOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not schedule.')
    } finally {
      setBusy(false)
    }
  }

  const schedule = () => scheduleWith(null)

  /**
   * Back to main, in one click.
   *
   * IT USES THE ORDINARY CHANNEL, and that is safe for one specific reason
   * rather than by luck: `tools/dispatch.sh` refuses to pin any ref whose own
   * copy of `tools/dispatch.sh` differs from main's, and `tools/deploy.sh`
   * refuses to check one out. So the dispatcher answering this revert is
   * byte-identical to the reviewed one no matter what the box is parked on —
   * there is no reachable state in which the thing being recovered from is also
   * the thing performing the recovery.
   *
   * IT STILL RESOLVES main TO A SHA FIRST rather than sending the bare name.
   * Same rule as every other switch, and it costs one round trip that the admin
   * sees as a spinner. Sending a name alone would be the one unpinned deploy in
   * the system, on the path that matters most.
   *
   * NO OPTIONS AND NO CONFIRMATION. Drain immediately, deploy when empty. The
   * whole point of the target-based confirmation rule in the switch dialog is
   * that returning to reviewed code has to be cheaper than the mistake that
   * made it necessary.
   */
  const revert = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/host/branches', { cache: 'no-store' })
      const d = (await res.json()) as {
        ok?: boolean
        error?: string
        branches?: HostBranch[]
      }
      if (!res.ok || d.ok === false) {
        throw new Error(d.error ?? `Could not read the branch list (${res.status}).`)
      }
      const main = d.branches?.find((b) => b.name === 'main')
      if (!main) {
        throw new Error('The game host did not report a main branch.')
      }
      if (!main.eligible) {
        throw new Error(`main cannot be deployed right now: ${main.blockedBy}`)
      }

      await postJson('/api/maintenance', {
        drainInMinutes: 0,
        deployMode: 'when-empty',
        deployAt: null,
        targetRef: 'main',
        targetSha: main.sha,
      })
      toast.success('Reverting to main. It deploys once the server empties.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revert.')
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

  /**
   * The parked notice, rendered above BOTH shapes of this page.
   *
   * ABOVE THE LIVE VIEW TOO, which is the case it would be easy to skip. The
   * live view replaces the whole page while a window is draining, and an admin
   * arriving then is watching a deploy land on a branch — the single moment
   * where "which code is this" matters most. The revert button is disabled
   * rather than hidden in that state, with the reason, because a button that
   * vanishes teaches nothing about why.
   */
  const parkedCard = parked ? (
    <Card className="gap-0 border-warn/40 bg-warn/5 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-warn" />
            <h2 className="text-sm font-medium text-warn">
              This server is not running main
            </h2>
          </div>
          <p className="mt-1 text-sm">
            It is parked on{' '}
            <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs">
              {deployedRef}
            </code>
            . Every deploy from here ships the newest commit on that branch
            until somebody switches back — nothing returns it to main on its
            own.
          </p>
          {/*
            THE RULE, IN THE OWNER'S OWN TERMS: still discovered, not installed.

            This used to read "automatic updates are paused while it is parked",
            which was true of installing and quietly wrong about finding —
            nothing was looking at the parked branch at all, so a commit pushed
            to the branch the live server was running was invisible here until
            somebody opened the branch picker and went looking for it. The
            console now watches the branch the box is on and says so; what stays
            switched off is the part that deploys without being asked.
          */}
          <p className="mt-1 text-xs text-muted-foreground">
            New commits on{' '}
            <code className="font-mono">{deployedRef}</code> are still found
            automatically. Installing them is not — while the box is parked
            nothing deploys unless somebody asks, and a main-branch update
            waiting behind this one waits indefinitely.
          </p>
        </div>

        {/*
          THE REASON IS WRITTEN DOWN, NOT HOVERED, AND THAT IS FORCED.
          A native `title` fires on a `disabled` button; a `TooltipTrigger`
          does not, because a disabled control swallows the pointer events the
          trigger listens for. So a like-for-like conversion here deletes the
          explanation outright, in the one state where the button explains
          nothing on its own -- which the comment above calls the single moment
          where "which code is this" matters most.

          The in-repo workaround is to wrap the disabled button in a bare
          `<span>` (`PlayerActions.tsx:87`), but that only restores the mouse
          case: the span has no `tabIndex` and no role, so the keyboard and the
          screen reader still get nothing. There are two copies of that shape
          already; a third is not the fix.

          NOT `aria-describedby` EITHER: a `disabled` button is not focusable,
          so nothing ever reaches the description. The visible sentence is what
          does the work, and it is rendered only while `live`, so the panel
          gains no permanent noise.
        */}
        <div className="flex flex-col items-end gap-1">
          {/*
            WIREFRAME, NOT PURPLE, AND IT MATCHES THE BANNER'S COPY OF ITSELF
            (owner: "change the remaining 'Revert to main' button from purple
            to wireframe to match the one in the banner").

            THE BANNER'S BUTTON WAS CHANGED FIRST AND THIS ONE WAS MISSED, so
            the console had two controls, one page apart, that do the same
            thing and looked like different kinds of thing. `OffMainBanner`
            carries the full reasoning; the short version is that `default` is
            `--primary`, which means "the main action on this page", and this
            is not that — it sits inside a warning card about an unusual state,
            where a saturated brand fill competes with the warning for
            attention.

            THE `warn` EDGE IS COPIED WITH IT, AND IT IS LOAD-BEARING. This
            card is a `warn/5` wash, the same family as the banner's `warn/10`,
            and `outline`'s own `--border` measures around 1.3:1 against it —
            under the 3:1 WCAG 1.4.11 asks of the boundary that identifies a
            control. `--warn` takes it to 3.7:1 light and 10:1 dark.
            `dark:border-warn` is not redundant: `outline` ships
            `dark:border-input`, and twMerge treats a `dark:`-prefixed utility
            as a different key, so a bare `border-warn` would silently lose in
            dark mode.

            A REAL `Button` HERE, unlike the banner's `buttonVariants` on a
            `<Link>`: this one runs `revert` and has a disabled state, so it is
            a button in the markup as well as in the paint.
          */}
          <Button
            variant="outline"
            className="border-warn dark:border-warn"
            disabled={busy || Boolean(live)}
            onClick={revert}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
            Revert to main
          </Button>
          {live && (
            <p className="text-xs text-muted-foreground">
              Cancel the window that is already scheduled first.
            </p>
          )}
        </div>
      </div>
    </Card>
  ) : null

  // ---------------------------------------------------- waiting for life ----

  /**
   * THE DEPLOY RAN AND THE SERVER HAS NOT SPOKEN YET.
   *
   * THIS IS THE GAP THE OWNER SAW: "currently after the drain it just jumps to
   * 'up to date'". The window is `complete` — so `live` above is false and the
   * whole live-window card is gone — but `complete` means the deploy VERB
   * returned, which happens the moment `royale-deploy` has kicked the restart
   * off. FXServer is still coming up. The page used to render the finished
   * state over that, tick and all.
   *
   * IT REPLACES THE PAGE RATHER THAN SITTING ABOVE IT, unlike the failure card
   * below, and the difference is whether there is anything useful to do. There
   * is not: the deploy has been fired, `updateAvailable` has been cleared, and
   * scheduling a second window at a server that is mid-restart is the one
   * action that could make this worse. The failure states DO leave the controls
   * up, because by then acting is the point.
   */
  if (phase === 'confirming' && w) {
    return (
      <>
        {parkedCard && <div className="mb-4">{parkedCard}</div>}

        <Card className="surface-edge items-center px-6 py-12 text-center">
          <Loader2 className="size-6 animate-spin text-info" />
          <p className="mt-3 text-sm font-medium">Waiting for the server</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The update has been deployed and the game server is restarting. This
            is not finished until{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              br_ringmaster
            </code>{' '}
            reports in from the restarted server — that is the only thing that
            proves the new code is actually running.
          </p>
          {/*
            THE BOUND, STATED. A wait with a visible end is a wait; one without
            is indistinguishable from a hang, and this page has exactly one
            reader — somebody standing over a production restart deciding
            whether to go and look at the box.
          */}
          {restartDeadline !== null && (
            <p className="mt-3 text-xs text-muted-foreground/70">
              {phaseNow >= restartDeadline
                ? 'Any moment now.'
                : `Giving it ${humanDuration(restartDeadline - phaseNow)} more, then this is reported as a failure.`}
            </p>
          )}
        </Card>
      </>
    )
  }

  // ---------------------------------------------------------------- live ----

  if (live && w) {
    const draining = w.state === 'draining' || now >= w.drainStartsAt
    return (
      <>
        {/* The spacing lives here rather than on the card below, which would
            otherwise carry a top margin with nothing above it on a box that is
            on main — the ordinary case. */}
        {parkedCard && <div className="mb-4">{parkedCard}</div>}

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
              {/* The note is gone from here. Every window says the same thing
                  -- "a server update" -- because that is the only kind of
                  window this system schedules, so quoting it back added a line
                  of text that never varied. Who and when do vary, and they are
                  what an admin arriving at this page needs. */}
              <p className="mt-1 text-xs text-muted-foreground/60">
                Scheduled by {w.createdByName} · {clock(w.createdAt)}
              </p>
              {/*
                WHAT THIS WINDOW WILL PUT ON THE BOX, named on the page that
                watches it happen. A window that switches branch looks
                identical to an ordinary update everywhere else — same drain,
                same countdown, same buttons — and the difference is the entire
                consequence. The sha is shown as well as the name because the
                name stops identifying anything the moment somebody pushes.
              */}
              {w.targetRef && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <GitBranch className="size-3 text-warn" />
                  <span className="text-muted-foreground">Will deploy</span>
                  <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-warn">
                    {w.targetRef}
                  </code>
                  {w.targetSha && (
                    <code className="font-mono text-muted-foreground/70">
                      {w.targetSha.slice(0, 8)}
                    </code>
                  )}
                </p>
              )}
              {/*
                AND THE SAME LINE FOR A PLAIN UPDATE OF A PARKED BRANCH, which
                is the window with no `targetRef` at all. The banner above says
                which branch the box is parked on; this says what this window is
                going to do about it, and the two together are the whole answer
                to "what am I watching". It deliberately does NOT show a sha —
                there is none, and inventing one would misdescribe the action.
                An update takes the tip at deploy time; only a switch is pinned,
                which is why this line says WHEN the commit is chosen.
              */}
              {!w.targetRef && parked && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <GitBranch className="size-3 text-warn" />
                  <span className="text-muted-foreground">Will update</span>
                  <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-warn">
                    {deployedRef}
                  </code>
                  <span className="text-muted-foreground">
                    to its newest commit when the deploy runs
                  </span>
                </p>
              )}
            </div>

            {w.state !== 'deploying' && (
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
              {/*
                IT NAMES THE TARGET. This said "pull main" unconditionally,
                which was true when main was the only thing this system could
                deploy and is now a straightforward lie in the case that
                matters: an admin forcing a window that switches to a branch
                would read a confirmation describing a deploy of main and press
                it. The dialog that exists to make somebody stop and check has
                to be the one thing on the page that is exactly right.
              */}
              <p className="text-muted-foreground">
                This runs <code className="font-mono">royale-deploy</code>:{' '}
                {w.targetRef ? (
                  <>
                    switch to{' '}
                    <code className="font-mono text-warn">{w.targetRef}</code>
                    {w.targetSha ? ` (${w.targetSha.slice(0, 8)})` : ''}, sync
                    resources, restart FXServer.
                  </>
                ) : (
                  <>
                    update{' '}
                    <code className="font-mono">{deployedRef ?? 'main'}</code> to
                    its newest commit, sync resources, restart FXServer.
                  </>
                )}
              </p>
              {w.targetRef && w.targetRef !== 'main' && (
                <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-warn">
                  <code className="font-mono">{w.targetRef}</code> has not been
                  through review. The server stays on it until somebody switches
                  back.
                </p>
              )}
            </>
          }
        />
      </>
    )
  }

  // ------------------------------------------------------------ schedule ----

  /**
   * The automatic deadline, and null whenever the automation cannot fire.
   *
   * `behindMain` is null while the box is parked and the driver's own gate is
   * `onMain && behind !== null && behind > 0` — so off main there is no
   * automatic window coming, whatever timestamp happens to be left on the row.
   * Deriving the deadline from `updateFirstSeenAt` alone would put "this runs
   * automatically on Tuesday" and a hard cap on the deploy-time picker in front
   * of an operator on a parked box, for a window that will never run.
   *
   * AND NULL WHEN THE DISTANCE IS UNKNOWN, which the `> 0` gets for free and is
   * worth stating anyway: a console that has not heard from the host must not
   * promise an automatic deploy on Tuesday either. It says nothing until it
   * knows, which is the whole rule this card was rewritten around.
   */
  const deadline =
    behindMain !== null && behindMain > 0 && w?.updateFirstSeenAt
      ? w.updateFirstSeenAt + AUTO_AFTER_MS
      : null

  /**
   * WHY THERE IS NO BOX, OR NULL WHEN THERE IS ONE.
   *
   * THE OWNER'S RULE, IN HIS WORDS: "the schedule an update box shouldn't even
   * exist when there is no update found." Not a disabled button with a sentence
   * under it — the card itself. Known zero, on either ref, is a restart that
   * ends every match in progress to deliver the code that is already running,
   * and the branch picker below has always refused exactly that on its own rows
   * ("Already running, at this exact commit"). The two now agree.
   *
   * IT IS THE SERVER'S RULE, LITERALLY THE SAME FUNCTION. `api/maintenance`
   * calls `nothingToDeploy` before it schedules and throws its `reason` as a
   * 409; this calls it to decide whether the card renders. There is no second
   * copy to fall out of step, and the inputs are the same telemetry snapshot —
   * the route reads `hostView()`, this reads that same object over `/api/host`
   * every five seconds. Card absent, request refused; card present, request
   * accepted. Not two rules that happen to agree: one expression, twice.
   *
   * UNKNOWN STILL GETS THE BOX, and it is now the ONLY thing standing between
   * this change and #146. `refBehindNow` answers null for a host that has not
   * spoken, a branch gone from the remote, a console that booted a minute ago
   * and a reading the box itself admits is stale — and every one of those has to
   * leave the operator able to ship the commit in their hand. It matters more
   * than it did when the button merely greyed out: there is no disabled control
   * left behind to say the action exists. `/preview/maintenance?state=parked`
   * and `?state=parked-stale` are those cases; the card and its button are live
   * in both, and `nothingToDeploy` compares `!== 0` rather than testing falsy
   * precisely so `null` cannot fall into the `0` branch.
   *
   * AND THE MAIN SIDE IS NOW IN THAT SENTENCE TOO, which it was not when this
   * card first learned to disappear. `behindMain` was `updateAvailable ?? 0`,
   * so a console whose telemetry poller had not yet answered — every console,
   * for the first seconds after a restart — computed a KNOWN zero and took its
   * own scheduling box off the page. That is #146 with the control removed
   * rather than greyed, arrived at from the other ref. `behindMainNow` returns
   * null there and `!== 0` lets it through: `/preview/maintenance?state=unpolled`
   * is that case, and the card and its button are live in it.
   *
   * NOTHING HERE TOUCHES THE REF-CHANGE PATH, and that is what stops a level box
   * stranding anybody. Switching branch is a different action against a
   * different control: `BranchPicker` is its own Card below, rendered outside
   * this decision, and "Revert to main" is a third control on the parked card
   * above. An operator on a `dev` that has not moved keeps both. The rule is
   * passed `changingRef: false` here because this button never sends a
   * `targetRef` — the picker's "Schedule switch" does, and the same function
   * exempts it.
   */
  const noDeploy = nothingToDeploy({
    behindMain,
    deployedRef,
    refUpdate,
    changingRef: false,
  })

  /**
   * A DEPLOY THAT ENDED BADLY AND HAS NOT BEEN RESOLVED.
   *
   * IT SUPPRESSES THE GREEN TICK, and only that. The empty state below says
   * "the server is running the latest code" over a `CircleCheck`, which is a
   * statement about commits and is still literally true after a deploy that
   * shipped and then never came back — and printing it under a red card saying
   * the server never came back is the console arguing with itself in the space
   * of two cards. The failure card answers the same question ("what is the
   * state of this server") with the more important half of the answer, so it
   * takes the slot.
   *
   * NOTHING ELSE YIELDS. The scheduling card, the branch picker and "revert to
   * main" all stay exactly where they are — a failure that removes the way out
   * is worse than the failure.
   */
  const deployTrouble = phase === 'failed' || phase === 'unconfirmed'

  /**
   * WHICH CARD THIS PAGE IS: the one that schedules, or the one that says there
   * is nothing to schedule. `noDeploy` decides, and nothing else does.
   *
   * WHAT #146 WAS, BECAUSE THIS IS THE LINE THAT CAUSED IT. This used to read
   * `parked ? null : behind > 0` — two gates, both measured against MAIN, and
   * either one alone removed the only ordinary schedule button in the console
   * from a parked box. `behind` is distance from main and the driver holds it at
   * zero the whole time the server runs a branch, so an operator who had just
   * pushed to `dev` was told there was nothing to do. The number was not zero
   * because there was nothing; it was zero because nobody was measuring the
   * right thing.
   *
   * WHAT MAKES HIDING SAFE NOW IS THAT THERE IS A RIGHT THING TO MEASURE.
   * `refUpdateFrom` (lib/ssh) measures the box against the tip of the branch it
   * is actually on and returns null — never zero — when it cannot. So an absent
   * card means "we asked, and there is nothing", which is a fact worth acting
   * on, where before it meant "we asked the wrong question". Null still renders
   * the card. That distinction is the entire safety of this change and it is
   * enforced in one place, `nothingToDeploy`, with `!== 0`.
   *
   * THE SUPPRESSION THAT WAS DROPPED, AND WHY IT IS BACK. The pre-#146 comment
   * argued that "the server is running the latest code" under a banner saying
   * the server is on an unreviewed branch says something false. It was right,
   * and the answer is not to suppress the sentence but to qualify it: the empty
   * state below names the ref — "running the latest code on dev" — which is true
   * of exactly the branch it names and says nothing about main. `nothingToDeploy`
   * writes that sentence, beside the 409 it would refuse with.
   *
   * THE RULE IS STILL NOT SYMMETRIC. Automatic updates require main; a
   * human-initiated deploy does not. The 72-hour automation must never fire at a
   * box somebody is testing on — that gate is `onMain && behind > 0` in the
   * driver and none of this goes near it.
   *
   * NOTHING HERE PINS A SHA. An update is `scheduleWith(null)` — no
   * `targetRef`, no `targetSha` — which leaves `tools/deploy.sh` to resolve the
   * ref itself (pin file, then `symbolic-ref HEAD`) and take that branch's
   * current tip. That is the deliberate box-side behaviour a bare `deploy` has
   * always had, and it is the same code path on main. Attaching the sha the
   * branch had when it was switched to would quietly turn "ship what I just
   * pushed" into "redeploy the commit from Tuesday", which is the opposite of
   * the request, and the box would refuse it the moment the branch moved.
   * Pinning belongs to the branch picker, where a human has read the commit
   * they are choosing.
   */
  return (
    <div className="space-y-4">
      {parkedCard}

      {/*
        THE TWO WAYS A DEPLOY ENDS BADLY, AND THEY ARE NOT THE SAME PROBLEM.

        ABOVE THE CONTROLS, NOT INSTEAD OF THEM. The waiting state replaces the
        page because there is nothing to do while a server boots; these do not,
        because acting is the entire point of reading them — redeploy, revert to
        main, or switch branch, all of which are below and all of which stay
        live. A failure card that took the schedule button away would leave an
        operator with a red box and no exit.

        `failed` IS THE HOST REFUSING. The deploy verb came back with an error,
        so nothing was restarted and the server is still running exactly what it
        was running before. That is the safer failure and the message says so —
        it is the difference between "go and fix the deploy" and "go and look at
        whether the game server is alive".

        `unconfirmed` IS THE DANGEROUS ONE. The deploy reported success, the
        restart was fired, and five minutes later nothing has been heard from
        br_ringmaster. Nobody can tell from here whether FXServer failed to
        start, crashed on the new code, or came up with its outbox broken — only
        that the console has no evidence of life, and that is precisely the
        state the old "up to date" tick used to paint green.

        IT CLEARS ITSELF ON EVIDENCE. The moment a heartbeat arrives from a
        process that is not the one this window restarted, the phase returns to
        `idle` and this card goes; the driver writes that verdict to the row so
        it survives a console restart. Nothing here is dismissed by hand,
        because a failure an operator can wave away is one they will.
      */}
      {deployTrouble && (
        <Card className="surface-edge gap-0 border-danger/30 px-5 py-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-danger">
                {phase === 'failed'
                  ? 'The update failed'
                  : 'The server did not come back'}
              </h2>
              {phase === 'failed' ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The game host refused the deploy, so nothing was restarted —
                    the server is still running the code it was running before.
                  </p>
                  {w?.deployError && (
                    <p className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-xs text-danger">
                      {w.deployError}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The deploy ran and the restart was fired, but{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                      br_ringmaster
                    </code>{' '}
                    has not reported in since — so there is no evidence the game
                    server came back up on the new code.
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground/70">
                    {typeof w?.completedAt === 'number'
                      ? `The deploy finished ${ago(w.completedAt, phaseNow)}. `
                      : ''}
                    Check FXServer on the game box. This clears itself the
                    moment the server reports in, however late that is.
                  </p>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {noDeploy === null ? (
        <Card className="surface-edge gap-0 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {parked ? (
                <>
                  {/*
                    IT NAMES THE REF IN THE HEADING, not just in the banner
                    above. This is the control that restarts a live game server,
                    and the entire content of #146 is an operator not being able
                    to tell what an unlabelled "schedule an update" would do to a
                    box that is not on main. There is no reading of this card
                    that leaves which branch in doubt.

                    AND THE BADGE NAMES THE REF, WHICH IS ALL IT EVER HAD TO DO.
                    It used to read "3 commits behind dev", and the count was
                    there to disambiguate a distance that appears on this page in
                    two completely different meanings — from main, and from the
                    branch the box is parked on. The owner's answer to that is
                    better than the count was: drop the number and show the two
                    commits (below), which say which branch they walk along and
                    can be opened and read. What is left in the badge is the ref,
                    which is the half that was doing the disambiguating.
                  */}
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">
                      {refBehind ? UPDATE_AVAILABLE : 'Update this branch'}
                    </h2>
                    <Badge className="gap-1 border-0 bg-warn/10 text-xs uppercase tracking-wider text-warn ring-1 ring-inset ring-warn/30">
                      <GitBranch className="size-3" />
                      {deployedRef}
                    </Badge>
                  </div>
                  {/*
                    TWO SENTENCES FOR THE TWO STATES THAT REACH THIS CARD, and
                    the third is deliberately not here. A parked box has three
                    readings — behind, level, and not known — but "level" no
                    longer renders a card at all, so this ternary must not grow a
                    branch for it: dead copy for an unreachable state is how a
                    page ends up describing something it cannot show. The
                    remaining two are "there is an update" and "we have not been
                    told", and the second says what the button DOES rather than
                    what the branch has done, because nothing is known about the
                    branch.
                  */}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {refBehind ? (
                      <>
                        There is code on{' '}
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {deployedRef}
                        </code>{' '}
                        that this server is not running. Deploying takes it and
                        restarts — the same drain as any other window, so the
                        server empties first and nobody loses a match.
                      </>
                    ) : (
                      <>
                        Deploys the newest commit on{' '}
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {deployedRef}
                        </code>{' '}
                        and restarts. The same drain as any other window — the
                        server empties first and nobody loses a match.
                      </>
                    )}
                  </p>
                  {/*
                    THE DISTINCTION FROM THE PICKER, SAID PLAINLY, because the
                    two controls sit on the same page and do different things
                    with the same word. Both are called "update"/"deploy" in
                    ordinary speech; what separates them is WHICH COMMIT gets
                    chosen and WHEN. This one follows the branch and resolves at
                    deploy time; that one freezes a commit the operator has
                    read. Naming them differently ("refresh" here, "deploy"
                    there) implied two mechanisms where there is one action
                    against two refs — so the difference is written out instead.
                  */}
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    It stays on{' '}
                    <code className="font-mono">{deployedRef}</code> — this does
                    not put main back, and it takes whatever the branch points
                    at when the deploy runs rather than a fixed commit. To
                    choose an exact commit, use{' '}
                    <span className="text-foreground">
                      Deploy a different branch
                    </span>{' '}
                    below.
                  </p>
                </>
              ) : (
                <>
                  {/*
                    "UPDATE AVAILABLE", AND NOT HOW MANY. The owner: "we don't
                    need it to show how many commits anything is behind — just
                    'update available'". The badge carries `main` for the same
                    reason the parked one carries the branch name: the ref is the
                    fact a reader needs, and it is the half the count was
                    smuggling in. What replaced the number is the pair of commits
                    below, which is checkable where a number never was.

                    AND IT ONLY SAYS "AVAILABLE" WHEN IT HAS BEEN TOLD SO. The
                    owner's other sentence in #26 is "stop assuming an update is
                    available before it's polled the first time", and this
                    heading was the assumption: hard-coded, on a card that must
                    still RENDER when the distance is unknown, so a console that
                    had never heard from the game host announced an update it had
                    no reading of. Those two requirements are not in conflict —
                    offer the action, do not assert the state — and the parked
                    side of this ternary has answered them that way since #146.
                    This is the same pair of sentences: the second says what the
                    BUTTON DOES rather than what main has done, because nothing
                    is known about main.

                    THE THIRD READING IS DELIBERATELY NOT HERE, exactly as it is
                    not on the parked side. Known-level does not render this card
                    at all, so a branch for it would be copy describing a state
                    the component cannot reach.
                  */}
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">
                      {mainBehind ? UPDATE_AVAILABLE : 'Update this server'}
                    </h2>
                    <Badge className="gap-1 border-0 bg-info/10 text-xs uppercase tracking-wider text-info ring-1 ring-inset ring-info/30">
                      <ArrowUpCircle className="size-3" />
                      main
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mainBehind ? (
                      <>
                        Schedule it and the server drains, then deploys once
                        everyone has left. Nobody loses a match.
                      </>
                    ) : (
                      <>
                        Deploys the newest commit on{' '}
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                          main
                        </code>{' '}
                        and restarts. The same drain as any other window — the
                        server empties first and nobody loses a match.
                      </>
                    )}
                  </p>
                  {deadline && (
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      If nobody schedules it, this runs automatically on{' '}
                      <span className="text-foreground">{clock(deadline)}</span>.
                    </p>
                  )}
                </>
              )}

              {/*
                ONE COPY, OUTSIDE THE TERNARY, FOR BOTH REFS. The pair is the
                same fact on main and on a branch — what is running, and what a
                deploy would put there — and `updateTargetNow` has already
                decided which ref it belongs to and whether it is safe to pair
                with the name above it. Writing it into both arms would be two
                copies of one sentence that must never disagree.

                AND IT IS ALLOWED TO BE ABSENT. It rides the two-minute
                `branches` cadence while the card itself is gated on the
                fifteen-second `status` one, so for the first couple of minutes
                after a console boots there is an update and no arrow yet. That
                is the honest rendering: the card knows there is something to
                deploy, and does not yet know which commit. It must not guess an
                end of the arrow to fill the space.
              */}
              {target && <CommitPair target={target} />}
            </div>

            {/*
              ONE LABEL FOR BOTH REFS. This read "Schedule refresh" off main and
              "Schedule update" on it, which taught the page that two different
              things happen. They are the same thing: `royale-deploy` resolves
              the ref the box is on — pin file, then `symbolic-ref HEAD` — and
              deploys its tip, and it does that identically whether that ref is
              main or `dev`. What varies is WHICH ref, and every surface around
              this button already names it: the banner, the heading, the badge,
              the sentence above, and the confirmation on the live window.
              Varying the verb as well made the ref look like a consequence of
              the verb rather than the only thing that differs.
            */}
            {/*
              THIS SAID "NEVER DISABLED, BECAUSE IT IS NEVER HERE WHEN IT WOULD
              BE" — the card does not render unless there is something to
              deploy, so the only state left for the control was "in flight".
              THE HOLE IN THAT IS THAT "THERE IS SOMETHING TO DEPLOY" IS NOT
              "IT CAN BE DEPLOYED". A branch can be ahead and refused at the
              same time, and that combination is what actually happened: the
              game box declined the deploy because the branch changes
              `tools/dispatch.sh`, from a systemd unit, discovered in a log —
              while this console held the refusal, in a sentence, the whole
              time. `noDeploy` answers whether anything is waiting; it was never
              asked whether the box would take it.

              SO THERE ARE TWO GATES NOW AND THEY ARE NOT INTERCHANGEABLE.
              `noDeploy` removes the CARD, because there is nothing to say; this
              greys the BUTTON and leaves the card, because there is — the box's
              own sentence, below.

              THE REASON GOES BESIDE THE CONTROL, NOT ON IT. A disabled button
              eats pointer events, so a tooltip here would delete the
              explanation in exactly the state that needs one; `docs/hover-text.md`
              records that trap and the branch picker already answers it by
              rendering the sentence next to the disabled row.
            */}
            {/*
              THE COLUMN IS THE REVERT BUTTON'S SHAPE, ONE CARD UP — a button
              with its reason under it — and `items-start` rather than that
              one's `items-end` for one measured reason. This card's left half
              is three paragraphs wide, so the row ALWAYS wraps and the button
              sits on a line of its own; the column's width is then whatever
              its widest child is, and a right-aligned column that grows to
              `max-w-xs` when the sentence appears would slide the button 186px
              sideways between two states a reviewer is asked to flip between
              (`/preview/maintenance?state=parked-behind` and `parked-blocked`).
              Starting both children at the same edge holds the button exactly
              where it renders today and runs the sentence under it from that
              edge — which is also how the branch picker aligns the same
              string on a refused row.
            */}
            <div className="flex flex-col items-start gap-1.5">
              <Button
                disabled={busy || refBlocked !== null}
                onClick={schedule}
              >
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CalendarClock />
                )}
                Schedule update
              </Button>
              {/*
                VERBATIM, AND IN THE PICKER'S OWN WORDS. `Cannot be deployed —`
                is the existing lead-in on a refused branch row; the rest is
                the game box's sentence, unedited. Rendered on the sentence
                being present rather than on the refusal, exactly as the
                picker does it — the button is greyed by the verdict, the line
                appears when there is something to read.
              */}
              {refBlocked && (
                <p className="max-w-xs text-xs text-warn">
                  Cannot be deployed — {refBlocked}
                </p>
              )}
            </div>
          </div>

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
                    {/* Only when the two genuinely differ — a permanent
                        "times are in your browser's zone" note beside a field
                        that already is would be noise on every load. */}
                    {zoneMismatch && (
                      <p className="text-xs text-warn">
                        The time you type here is in {browserZone!.replace(/_/g, ' ')},
                        your browser&rsquo;s zone. Everything else on this page
                        is shown in {timeZone.replace(/_/g, ' ')}.
                      </p>
                    )}
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

        </Card>
      ) : (
        /*
          WHERE THE BOX WAS, RATHER THAN A HOLE WHERE THE BOX WAS.
          The scheduling card is gone on the owner's instruction, and a panel
          that renders nothing reads as a page that failed to load — especially
          here, where an admin arrived intending to do something. So the space
          answers the question the missing card would have: there is no update,
          on this ref, and here is what would change that.

          BOTH SENTENCES COME FROM THE RULE THAT REMOVED THE CARD. `state` and
          `fix` are written beside the `reason` the server would refuse the same
          request with, so what the page says and what the API would say cannot
          drift into disagreeing about the same fact. Off main both name the
          branch, which is what makes "running the latest code" true here at all:
          it is a statement about `dev`, under a banner that has just said the
          server is not on main, and the two do not contradict each other.

          THE GREEN TICK IS STILL RIGHT OFF MAIN. This card answers one question
          — is there an update to schedule — and the answer is genuinely "no, you
          are current". Whether being on `dev` at all is fine is the banner's
          question, and the banner is still saying no.

          IT YIELDS TO A FAILED DEPLOY, THOUGH, and that is the one case where
          the sentence is true and unwelcome: a deploy that shipped and never
          came back leaves the box level with main, so this card would print a
          green tick directly under a red one saying the server is gone. See
          `deployTrouble`.
        */
        deployTrouble ? null : (
        <Card className="surface-edge items-center px-6 py-12 text-center">
          <CircleCheck className="size-6 text-live" />
          <p className="mt-2 text-sm">{noDeploy.state}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {noDeploy.fix}
          </p>
          {/*
            WHICH COMMIT THE SERVER IS ON, AS OF THE LAST POLL.

            WHY THIS COMMIT IS HERE AT ALL, and that half has not changed. This
            card made a claim — "the server is running the latest code" — and
            showed nothing to check it against, which is the owner's report read
            from the other end: the page said "going from X to Y", the box went
            to Z, and the screen it landed on named no commit. Yes and no are
            both unfalsifiable there. The card owes the reader a commit.

            IT IS THE LIVE READING NOW, AND IT USED TO BE THE RECORDED ONE. This
            rendered `deployLanded(...).sha` — `deployLandedSha` off the window
            row — which is a note about ONE PAST DEPLOY and not an answer about
            the running server. The owner's console showed the difference: the
            tick here named a commit six behind the one the branch picker and the
            Host page were both naming on the same screen. Two mechanisms
            produced that and either alone is enough — the field is written once
            and never refreshed, so anything that moves the box outside a
            scheduled window leaves it stale; and it could be written wrong to
            begin with, off a `status` poll up to fifteen seconds behind the
            confirmation. `runningShaNow` reads the same `status.sha` the Host
            page renders, arriving on the same /api/host poll as the sentence
            above it, so the two pages cannot name different commits and neither
            can go stale in place.

            THE RECORD IS NOT DELETED, IT IS JUST NOT A CURRENT FACT.
            `deployLandedSha` and `deployLanded` still exist and still answer
            "where did that deploy go" for the audit trail, which is the question
            they were built for. What was wrong was rendering that answer where a
            reader was asking a different one.

            STILL NO NEW SENTENCE. One `CommitLink`, the same component the arrow
            above uses; the sr-only label is what the anchor needs to be readable
            at all (WCAG 2.5.3, same reason as the pair) and it matches the words
            already on the pair's left-hand side, which is the same fact.

            ABSENT UNTIL THERE IS ONE. A console whose poller has not answered,
            or a dispatcher too old to send a full sha, renders nothing — what
            every other reading on this page does when it has not been told.
          */}
          {runningSha && (
            <p className="mt-3 text-xs text-muted-foreground">
              <CommitLink sha={runningSha} label="Running now" />
            </p>
          )}
        </Card>
        )
      )}

      <BranchPicker
        open={branchesOpen}
        onOpenChange={(v) => {
          setBranchesOpen(v)
          /**
           * EVERY OPEN, NOT ONLY THE FIRST. The `branches === null` that used
           * to stand here made the list a once-per-page-session reading; see
           * `loadBranches` for what that did to a refusal the operator had
           * just resolved. The only guard left is against asking twice at
           * once.
           */
          if (v && !loadingBranches) void loadBranches()
        }}
        branches={branches}
        stale={branchesStale}
        error={branchError}
        loading={loadingBranches}
        deployedRef={deployedRef}
        deployedSha={branchesFromSha}
        now={now}
        picked={picked}
        onPick={setPicked}
        onRefresh={loadBranches}
        busy={busy}
        onSchedule={() => {
          if (!picked) return
          /**
           * CONFIRM ON THE TARGET, NOT ON THE SOURCE.
           *
           * The obvious rule — "confirm when leaving main" — lets
           * feature/a → feature/b through without a word, and that is a
           * switch between two unreviewed trees on a box that is already off
           * reviewed code. It is at least as consequential as the first
           * switch was, and it is the one an admin is most likely to make
           * casually. Gate on where the server ENDS UP.
           *
           * Switching to main never asks, for the same reason: recovery has
           * to be cheaper than the mistake.
           */
          if (picked.name === 'main') void scheduleWith(picked)
          else setConfirmSwitch(true)
        }}
      />

      <ConfirmDialog
        open={confirmSwitch}
        onOpenChange={setConfirmSwitch}
        title={`Put ${picked?.name ?? 'this branch'} on the live server?`}
        confirmLabel="Confirm switch"
        busyLabel="Scheduling…"
        onConfirm={async () => {
          if (picked) await scheduleWith(picked)
        }}
        body={
          <>
            <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-warn">
              <code className="font-mono">{picked?.name}</code> at{' '}
              <code className="font-mono">{picked?.sha.slice(0, 8)}</code> has
              not been through review. It will run on the live game server until
              somebody switches back.
            </p>
            <p>
              The server drains first — nobody loses a match — and the switch
              lands once it empties. Automatic updates stop while it is parked.
            </p>
            <p className="text-muted-foreground">
              If that commit moves before the deploy runs, the game host refuses
              it rather than deploying something else. You would schedule again.
            </p>
          </>
        }
      />

      <MaintenanceExplainer />
    </div>
  )
}

/**
 * When a branch tip was committed: "3h 12m ago", with the instant still there.
 *
 * RELATIVE ON THE FACE OF IT, ON THE OWNER'S INSTRUCTION — "the commit time
 * should say how long ago, not the timestamp". Scanning ten branches, the
 * question is which of them moved this afternoon, and an absolute datetime makes
 * every reader do the subtraction themselves. `humanDuration` is the console's
 * existing answer to that and is reused rather than reinvented, so these rows
 * age in the same words as every other duration in the app.
 *
 * AND THE INSTANT IS NOT LOST, WHICH IS THE HALF THAT NEEDED CARE. Three copies,
 * for three readers, per `docs/hover-text.md`:
 *
 *   - `<time dateTime>` for machines. That is what the attribute is for, and it
 *     is where a machine value belongs instead of a tooltip (rule 6).
 *   - `sr-only` text for a screen reader, IN THE MARKUP, because Base UI's
 *     tooltip popup carries no `role="tooltip"` and no `aria-describedby` and is
 *     therefore never announced. The DOM floor (rule 1) is not satisfied by the
 *     popup existing.
 *   - the `Tooltip` for a sighted mouse user, which is the only reader the popup
 *     actually serves.
 *
 * NOT A NATIVE `title`. Banned outright on DOM elements — it cannot be selected,
 * focused or announced, never fires on touch, and four were shipped past that
 * rule recently.
 *
 * `render={<time … />}` AND NOT THE DEFAULT TRIGGER. `TooltipTrigger` renders a
 * `<button>` unless told otherwise, and this sits inside the row's own
 * `<button>` — a nested button, the exact defect `docs/hover-text.md` records
 * from the last time somebody put a trigger inside a row. `<time>` is inline,
 * carries the machine-readable attribute, and nests legally.
 */
function BranchTipTime({ at, now }: { at: number; now: number }) {
  const { format } = useFormatInstant()
  if (!at) return <span>—</span>

  const instant = format(at)
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<time dateTime={machineInstant(at)} />}>
          {ago(at, now)}
        </TooltipTrigger>
        <TooltipContent side="bottom">{instant}</TooltipContent>
      </Tooltip>
      <span className="sr-only"> — committed {instant}</span>
    </>
  )
}

/**
 * Pick a branch to put on the game host.
 *
 * A LIST, NOT A DROPDOWN, and that is decided by one requirement: branches that
 * cannot be deployed are shown DISABLED WITH THE REASON rather than omitted. A
 * reason is a sentence — "changes tools/dispatch.sh — deploy it through main
 * and PR review" — and a sentence does not fit in a select option. Omitting
 * them instead would be worse than either: the operator knows the branch
 * exists, cannot see it, and has no way to tell a rule from a bug.
 *
 * COLLAPSED BY DEFAULT because it is the rare path. The common action on this
 * page is one button that ships main, and putting a branch picker beside it at
 * equal weight would make the two look equally routine. They are not.
 */
function BranchPicker({
  open,
  onOpenChange,
  branches,
  stale,
  error,
  loading,
  deployedRef,
  deployedSha,
  now,
  picked,
  onPick,
  onRefresh,
  busy,
  onSchedule,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: HostBranch[] | null
  stale: boolean
  error: string | null
  loading: boolean
  deployedRef: string | null
  /**
   * The commit every row's `+`/`−` is counted from, as the host reported it
   * alongside the list. Null on an older answer; the sentence degrades to naming
   * the fact without linking it rather than dropping the fact.
   */
  deployedSha: string | null
  /** The panel's ticking clock, so the rows age without their own timer. */
  now: number
  picked: HostBranch | null
  onPick: (b: HostBranch) => void
  onRefresh: () => void
  busy: boolean
  onSchedule: () => void
}) {
  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Deploy a different branch</span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {!open && (
        <p className="mt-1 text-xs text-muted-foreground">
          Run an unreviewed branch on the live server. It drains first, and the
          server stays on that branch until somebody switches back.
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            {/*
              THE ANSWER TO "MEASURED AGAINST WHAT", IN FULL, ONCE. Every row
              also says `vs. running` on its own numbers — a number whose meaning
              lives only in a sentence elsewhere on the page is the ambiguity #26
              removed from the update banner — but the row has no space for the
              whole answer, so it lives here and the row points at it.

              IT IS THE DEPLOYED COMMIT, NOT MAIN, and the distinction is not
              academic: on a box parked on `dev`, "67 behind" against main and
              "67 behind" against the running commit are wildly different numbers
              and only one of them describes what this list is offering. The game
              host computes both against its deployed sha (`do_branches`), so the
              sentence names that commit and links it — which makes the claim
              checkable rather than merely stated.
            */}
            <p className="text-xs text-muted-foreground">
              Read from the game host, newest commit first. The{' '}
              <span className="text-live">+</span> and{' '}
              <span className="text-danger">−</span> on each row are counted
              against the commit running now
              {deployedSha ? (
                <>
                  ,{' '}
                  <a
                    href={commitUrl(deployedSha)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm font-mono underline decoration-dotted underline-offset-4 transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {shortSha(deployedSha)}
                  </a>
                </>
              ) : null}
              , not against main.
            </p>
            {/*
              THIS ONE IS STILL CALLED REFRESH, AND IT IS THE ONLY ONE.
              Everywhere else on this page the word used to mean "deploy the tip
              of the branch the box is on", which is an update and is now called
              that. This button re-reads the LIST — it asks the game host to
              `git fetch --prune` and redraws the rows above. It touches nothing
              on the server, restarts nothing, and ends no matches. That is what
              refresh means everywhere else in software, and renaming it to
              match the deploy controls would put the console's most harmless
              button and its most consequential one under the same verb.
            */}
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh
            </Button>
          </div>

          {/*
            SAID OUT LOUD RATHER THAN HIDDEN. The game host answers from the
            refs already on disk when its fetch does not finish inside the
            six-second SSH budget. A list quietly a day old is how somebody
            picks a commit that no longer exists — which the box would refuse,
            correctly and confusingly.
          */}
          {stale && (
            <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              The game host could not reach GitHub in time and answered from
              what it already had. This list may be out of date — press Refresh.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          {loading && branches === null && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Asking the game host…
            </p>
          )}

          {branches?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              The game host reported no branches at all, which should not
              happen. Check that its clone still has a remote.
            </p>
          )}

          {branches && branches.length > 0 && (
            <ul className="space-y-1.5">
              {branches.map((b) => {
                const isCurrent = b.name === deployedRef
                /**
                 * THE BRANCH THAT IS RUNNING IS STILL SELECTABLE ONCE IT MOVES,
                 * and it is now a genuine choice rather than the only way out.
                 *
                 * This used to be the sole route to new commits on the branch
                 * being tested, because off main the ordinary schedule button
                 * did not render at all — the bug in
                 * WillMontgomery/fivem-br-gamemode#146. That button is back, so
                 * picking the running branch here is no longer a workaround. It
                 * remains offered because the two paths differ in the one way
                 * that matters: THIS ONE PINS THE SHA ON THE ROW YOU JUST READ,
                 * and the box refuses if the branch has moved by deploy time.
                 * "Schedule update" follows the branch and takes whatever its
                 * tip is when the deploy fires. Pin when it matters which
                 * commit; update when it matters that it is the newest.
                 *
                 * Only a branch that is both running and identical to what is
                 * deployed is disabled, because that deploy would restart every
                 * match to change nothing.
                 *
                 * THE RULE MOVED TO lib/maintenance AND DID NOT CHANGE. It is
                 * read three times now — here, by the sentence under the row,
                 * and by the reconciliation that drops a pick this list has
                 * invalidated — and a pick surviving a refusal the row is
                 * showing is precisely the disagreement that would put a live
                 * button over a refused deploy.
                 */
                const refusal = branchRefusal(b, deployedRef)
                const isPicked = picked?.name === b.name
                return (
                  /*
                    THE SHA LINK IS A SIBLING OF THE ROW BUTTON, NOT A CHILD, AND
                    THE DOM WILL NOT ALLOW ANYTHING ELSE. The owner asked for the
                    commits to be hyperlinks and the row has always been one big
                    `<button>`; an `<a>` inside a `<button>` is interactive
                    content nested in interactive content, which the HTML parser
                    reorders and which leaves the anchor unreachable by keyboard
                    in some engines. `docs/hover-text.md` records the same trap in
                    the opposite direction — a default `TooltipTrigger` renders a
                    `<button>`, which nested one inside a row `<Link>`.

                    SO THE BUTTON KEEPS THE ROW AND GIVES UP ITS TOP-RIGHT
                    CORNER: `pr-24` reserves the space, and the anchor is
                    positioned into it from the `<li>`. No `pointer-events-none`
                    overlay — the alternative "stretched button" pattern would
                    have to disable pointer events on all the row's content to
                    let clicks through, and that also disables SELECTING it,
                    which on a row whose whole purpose is a commit subject and a
                    sha is a real loss.

                    THE LINK STAYS LIVE ON A DISABLED ROW. A branch that cannot
                    be deployed — `blockedBy`, or already running at this exact
                    commit — is still one whose commit somebody wants to read;
                    the button is what is refused, not the information.
                  */
                  <li key={b.name} className="relative">
                    <button
                      type="button"
                      disabled={refusal !== null}
                      aria-pressed={isPicked}
                      onClick={() => onPick(b)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 pr-24 text-left transition-colors',
                        isPicked
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border bg-card/40',
                        refusal === null
                          ? 'hover:border-primary/40 hover:bg-primary/5'
                          : 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-sm">{b.name}</span>
                        {isCurrent && (
                          <Badge className="border-0 bg-live/10 text-xs uppercase tracking-wider text-live ring-1 ring-inset ring-live/30">
                            running now
                          </Badge>
                        )}
                        {/*
                          GREEN AND RED FROM THE TOKENS, NEVER FROM A LITERAL.
                          `text-live` and `text-danger` are the console's own
                          operational colours — defined once in globals.css and
                          redefined once for the dark theme — so these two
                          numbers follow every future adjustment to what "good"
                          and "bad" look like here, in both themes, without this
                          file being touched. A hard-coded `text-green-500` would
                          be the one pair of numbers in the console that did not.

                          AND THE COLOUR IS NEVER THE ONLY CHANNEL. `+` and `−`
                          carry the same distinction in glyphs, which is what
                          makes this readable to a reader who cannot separate the
                          two hues at all — colour is the fast path here, not the
                          information.

                          WHAT THEY ARE MEASURED AGAINST, ON THE ROW. The game
                          host computes both against the DEPLOYED SHA, not
                          against main (`do_branches` in the game repo, and see
                          `HostBranch.ahead` in lib/ssh) — so `+4` is "four
                          commits this branch has that the running server does
                          not". That was stated once, above the list, and a
                          number whose meaning lives in a sentence somewhere else
                          on the page is exactly the ambiguity #26 just deleted
                          from the update banner. It says it here too.
                        */}
                        <span className="text-xs tabular-nums text-muted-foreground/70">
                          <span className="text-live">+{b.ahead}</span>{' '}
                          <span className="text-danger">−{b.behind}</span>{' '}
                          vs. running
                        </span>
                      </div>
                      {/*
                        THE SUBJECT IN BOLD, because it is the thing being read.
                        The owner: "the commit name should be in bold". Everything
                        else on this row — the branch, the counts, the age — is
                        context for deciding whether THIS is the commit you meant.
                        It was `text-muted-foreground`, one weight below the
                        branch name, which put the only human-written string on
                        the row at the bottom of its visual hierarchy.

                        THE AUTHOR IS GONE, on the same instruction ("the author
                        doesn't matter — we can remove that"). In a two-person
                        project it is noise, and it was sharing a line with the
                        timestamp, which is not.
                      */}
                      <p className="mt-1 truncate text-xs font-semibold text-foreground">
                        {b.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/60">
                        <BranchTipTime at={b.tipAt} now={now} />
                      </p>
                      {/*
                        THE REASON, VERBATIM, ON THE DISABLED ROW. This is the
                        entire difference between a rule and a mystery: "changes
                        tools/dispatch.sh" tells an operator both why this
                        branch is refused and what to do about it, where a
                        greyed-out row with no text reads as a bug.
                      */}
                      {refusal === 'blocked' && b.blockedBy && (
                        <p className="mt-1 text-xs text-warn">
                          Cannot be deployed — {b.blockedBy}
                        </p>
                      )}
                      {refusal === 'no-change' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Already running, at this exact commit — there is
                          nothing to deploy.
                        </p>
                      )}
                      {/*
                        "RUNNING, BUT IT HAS MOVED SINCE" IS GONE, and the owner
                        is right that it was useless: the row already carries
                        both halves of it. The `running now` badge says it is
                        running; `+4 −67 vs. running` says it has moved, and says
                        by how much, which the sentence did not. A line of prose
                        restating two facts sitting an inch above it is the kind
                        of copy that trains a reader to skip the row.
                      */}
                    </button>
                    {/*
                      Positioned into the `pr-24` the button reserved. `top-2.5`
                      lines its baseline up with the branch name on the first
                      line; it is the last child so it stacks above the button
                      without a z-index, and clicks on it open the commit rather
                      than picking the row.
                    */}
                    <a
                      href={commitUrl(b.sha)}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute top-2.5 right-3 rounded-sm font-mono text-xs text-muted-foreground/70 underline decoration-dotted underline-offset-4 transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="sr-only">
                        Tip of {b.name}, commit{' '}
                      </span>
                      {shortSha(b.sha)}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}

          {picked && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                The server drains immediately and switches to{' '}
                <code className="font-mono text-foreground">{picked.name}</code>{' '}
                once the last match finishes.
              </p>
              <Button disabled={busy} onClick={onSchedule}>
                {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                Schedule switch
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
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
      body: 'Ringmaster asks the game host every 15 seconds whether it is behind main, and the host re-checks GitHub at most once a minute — so a new commit shows up here within about a minute of being merged. It then badges it, and tells any admin in game so somebody schedules it. On a server parked on a branch the same question is asked about that branch instead, on a two-minute cadence, because the update anybody is waiting for there is the one on the branch they are pushing to.',
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
      body: 'Once the last player leaves, royale-deploy pulls the branch the server is on — normally main — syncs the resources and restarts FXServer.',
    },
    {
      title: 'The server reports back',
      /*
        THE STEP THAT USED TO BE MISSING FROM THE STORY AS WELL AS FROM THE
        PAGE. "Back to normal" described the deploy command returning, which is
        not the same event as the game server running the new code — and this
        list is where an operator learns what they are waiting for.
      */
      body: 'The update is not finished until br_ringmaster reports in from the restarted server — that is the proof FXServer actually came back on the new code. If it has not within five minutes, the console says the server did not come back rather than claiming success. Either way the result lands in the audit log.',
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
        <p>
          <span className="font-medium text-foreground">
            A branch other than main can be deployed,
          </span>{' '}
          for testing on the real server. The game host refuses any branch that
          changes its own control scripts, so a branch can change the game but
          never the console&rsquo;s channel to the box — which is what makes
          &ldquo;revert to main&rdquo; something you can always rely on. Nothing
          brings the server back to main on its own.
        </p>
        <p>
          <span className="font-medium text-foreground">
            While the server is on a branch, only the AUTOMATIC install pauses.
          </span>{' '}
          New commits on that branch are still found on their own and shown
          here. You schedule the deploy yourself, and it takes the newest commit
          on the branch the server is on rather than putting main back — the
          same drain, the same waiting for the server to empty. The 72-hour
          automation is what stays off, because nothing should deploy over a
          branch somebody is testing on while they are not looking.
        </p>
      </div>
    </Card>
  )
}
