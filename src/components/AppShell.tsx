import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import {
  LogOut,
  CalendarClock,
  CircleDot,
  FileSearch,
  Gauge,
  ScrollText,
  Settings,
  Settings2,
  ShieldAlert,
  Users,
} from 'lucide-react'

import {
  DdbHealthBanner,
  DdbHealthChip,
  DispatchHealthBanner,
  DispatchHealthChip,
  type DdbSeed,
  type DispatchSeed,
} from '@/components/DdbHealth'
import { IdleGuard } from '@/components/IdleGuard'
import { IncidentBadge, MaintenanceBadge } from '@/components/NavBadges'
import { OffMainBanner } from '@/components/OffMainBanner'
import { PlayerSearchTrigger } from '@/components/PlayerSearch'
import { PrefsDialog } from '@/components/PrefsDialog'
import { ServerChips } from '@/components/ServerChips'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UpdateWatcher } from '@/components/UpdateWatcher'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { activityDeadline, hasSessionCookie } from '@/lib/activity'
import * as incidents from '@/lib/incidents'
import { ensureDriver, maintenanceView } from '@/lib/maintenanceDriver'
import { FrameEscape } from '@/components/FrameEscape'
import { isFramedClient } from '@/lib/framed'
import { readPrefs } from '@/lib/prefs'
import { deployPhase } from '@/lib/serverPhase'
import { currentAdmin } from '@/lib/session'
import { isParkedOffMain } from '@/lib/ssh'
import { liveView } from '@/lib/state'
import { ensurePolling, hostView } from '@/lib/telemetry'
import { cn } from '@/lib/utils'

/**
 * The console chrome.
 *
 * BUILT ON shadcn's Sidebar rather than the hand-rolled rail this replaced.
 * The hand-rolled one looked the part but had none of the behaviour: no
 * collapse, no persistence, no mobile sheet, no keyboard affordance. Those are
 * exactly the things you do not notice missing until you are working in the
 * tool at 2am on a laptop. The real component brings icon-mode collapse
 * (cookie-persisted, so it survives a reload), a rail you can drag, ⌘B, and a
 * proper off-canvas sheet on mobile.
 *
 * THE "COOKIE-PERSISTED" CLAIM ABOVE WAS FALSE UNTIL NOW, which is worth
 * recording because it is the shape of bug this codebase keeps producing.
 * `ui/sidebar.tsx` has always WRITTEN `sidebar_state` on every toggle, and
 * nothing has ever read it: `SidebarProvider` was rendered with no
 * `defaultOpen`, so it started open every time and the cookie was a
 * write-only file. Since this component now reads cookies for the theme
 * anyway, `defaultOpen` is wired below and the sentence is true.
 *
 * NAVIGATION MIRRORS THE MILESTONES, and the not-yet-built entries are
 * deliberate rather than lazy. An admin panel that hides everything it cannot
 * do gives no sense of what it is becoming, so the shape of the finished tool
 * cannot be argued with until it is expensive to change. They link to
 * wireframes rather than being dead: a page that says what it will be and what
 * it is blocked on is more useful than a greyed-out word.
 */

/** Where this console's own source lives. */
const REPO_URL = 'https://github.com/WillMontgomery/fivem-ringmaster'

/**
 * The GitHub mark, INLINE, because it has to be.
 *
 * NOT FROM LUCIDE. `lucide-react` dropped every brand glyph — there is no
 * `Github` export in the version this repo pins, and reaching for one is the
 * first thing somebody will try when editing this file.
 *
 * NOT FETCHED EITHER, and that is a hard constraint rather than a preference. A
 * strict CSP fronts this console; an `<img src="https://…">` or a stylesheet
 * pulling from a CDN is blocked at the browser, so the sidebar would ship a
 * broken image on the deployed box and a perfect one on localhost. `npm run
 * verify` also scans every file for credential shapes, which is one more reason
 * assets belong in the tree rather than behind a URL somebody has to trust.
 *
 * IT IS THE REAL MARK — GitHub's own Octicon path, the one their brand
 * guidelines publish for exactly this use. `currentColor` and no hard-coded
 * size, so it inherits the link's colour in both themes and the `size-*` class
 * that wraps it.
 *
 * `aria-hidden` BECAUSE THE LINK IS ALREADY NAMED. Its `aria-label` says
 * "Ringmaster on GitHub"; a second accessible name on the glyph inside it would
 * be announced twice.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/**
 * What the sidebar badges START from.
 *
 * SEEDS, NOT THE LAST WORD, and that changed when the badges stopped being
 * awaited. Whatever is here is what the SERVER render draws; from there the
 * badges follow the two-second poll like the header chips do, unless polling is
 * off (the design harness), in which case these values stand for good. See
 * `NavBadges` in `components/NavBadges.tsx`.
 */
export interface NavBadges {
  /**
   * Incidents nobody has looked at. The number that should make you click.
   *
   * `undefined` means "we have not managed to count", NOT zero — the badge
   * draws nothing for it, which is a different silence from the one a genuinely
   * empty queue produces. See `lib/incidents`.
   */
  incidents?: number
  /** A maintenance window scheduled, draining, or deploying right now. */
  maintenance?: 'scheduled' | 'draining' | 'updating' | null
}

/** What the nav is allowed to know about the world when deciding what to show. */
interface NavContext {
  /**
   * The game host has said, in so many words, that it is running something
   * other than `main`.
   *
   * DERIVED, NEVER STORED. This is `isParkedOffMain(hostView().status)` — the
   * same reading the off-main banner below is drawn from, recomputed from the
   * host on every render off the poller that is already running. The branch
   * switch work deliberately never persists a flag for this, because any
   * schedule or cancel cycle wipes it; see `docs/branch-switch.md` in the game
   * repo. There must not be a second source of truth for it here.
   */
  offMain: boolean
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Absent when the page is real. Present = what it is waiting on. */
  soon?: string
  /**
   * `b` is the SEED — what this server render knew. `live` says whether the
   * badge may then follow the poll. Both are needed because the badges are
   * client components now; see `NavBadges`.
   */
  badge?: (b: NavBadges, live: boolean) => React.ReactNode
  /** Absent = always shown. Present and false = not in the nav at all. */
  when?: (ctx: NavContext) => boolean
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Observe',
    items: [
      { href: '/', label: 'Live players', icon: Users },
      { href: '/host', label: 'Host', icon: Gauge },
      { href: '/anticheat', label: 'Anticheat', icon: ShieldAlert },
    ],
  },
  {
    group: 'Act',
    items: [
      { href: '/moderation', label: 'Kick & ban', icon: CircleDot },
      {
        href: '/incidents',
        label: 'Incidents',
        icon: FileSearch,
        badge: (b, live) => (
          <IncidentBadge seed={b.incidents ?? null} live={live} />
        ),
      },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
  {
    group: 'Operate',
    items: [
      {
        href: '/maintenance',
        label: 'Maintenance',
        icon: CalendarClock,
        badge: (b, live) => (
          <MaintenanceBadge seed={b.maintenance ?? null} live={live} />
        ),
      },
      /**
       * LIVE CONFIG APPEARS ONLY ON A BOX PARKED OFF MAIN (#20).
       *
       * It is a development surface: changing tuning values under a live match
       * is a thing to do while testing a branch, not on the server everyone is
       * playing on. Hiding it on main means the dangerous button is not sitting
       * in the nav on the ordinary day.
       *
       * `isParkedOffMain`, NOT `!isOnMain`, and the difference matters. A host
       * whose dispatcher is too old to report its ref answers neither, and
       * `isOnMain` folds that silence in with "off main" — correct for turning
       * the AUTOMATION off, wrong here, where it would show a dev-only page on
       * every box we simply have not reached. See the note on both functions in
       * `lib/ssh.ts`: gate the automation pessimistically, gate what a human
       * sees on a fact.
       *
       * `/process` USED TO SIT BELOW THIS AND IS GONE (#20). Superseded — the
       * maintenance page already does the deploy-and-restart it was drawn for,
       * gently, with a drain and an audit trail.
       */
      /**
       * NO LONGER `soon: 'M6'` (#21). The badge means "this page is a drawing
       * of something not built yet", and this one now reads the game host and
       * reports what it is actually configured with. EDITING config is still
       * M6 and this page still does not offer it — but a badge saying the page
       * is unbuilt, over a page full of real values read off a live box, would
       * teach whoever sees it to distrust the values.
       */
      {
        href: '/config',
        label: 'Live config',
        icon: Settings2,
        when: (c) => c.offMain,
      },
    ],
  },
  {
    group: 'You',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

export async function AppShell({
  children,
  active = '/',
  user,
  badges,
  feed,
  hostRef,
  ddb,
  dispatch,
}: {
  children: React.ReactNode
  active?: string
  /**
   * The signed-in user for the sidebar. Omit it and the shell resolves the
   * real admin itself — so every page shows the actual person, avatar and all,
   * without each one threading `currentAdmin()` through. Pass it explicitly
   * (the live board and host page do) to avoid a second lookup, or pass `null`
   * to force the signed-out state (the preview harness).
   */
  user?: { name: string; avatarUrl?: string | null } | null
  /**
   * Badge OVERRIDES, per key, and only for callers that have a reason.
   *
   * NOT THE SOURCE OF THEM, WHICH IT USED TO BE IN PRACTICE. The shell resolves
   * both badges itself now; a key given here replaces that key and leaves the
   * other alone. Passing `{ incidents: 3 }` no longer blanks the maintenance
   * badge, which is the bug the owner reported twice — see the resolution
   * below.
   *
   * The design harness is the caller this exists for: it renders fixtures and
   * must not reach DynamoDB. Real pages may pass a count they already have in
   * hand (both incident routes do) to save the shell a second read.
   */
  badges?: NavBadges
  /**
   * The live feed, for the header cluster.
   *
   * IT DRAWS A FEED CHIP AGAIN — Live, Falling behind and Feed lost were hidden
   * on the owner's instruction and are back on it ("yes please put the live
   * chip back"). Through both changes these readings never stopped mattering:
   * they are what tell a restarted game server from the one that was just
   * killed, so they always had to reach the shell whether or not anything drew
   * them. `live` is the other half: it turns polling on, and the design harness
   * sets it false so a fixture page does not fetch real state over the top of
   * itself.
   */
  feed?: {
    lastPushAt: number | null
    bootEpoch: string | null
    now: number
    /** Poll for fresh state. The real app sets it; the harness does not. */
    live?: boolean
  }
  /**
   * FOR THE DESIGN HARNESS ONLY: pretend the host reported this ref.
   *
   * NOT A SECOND SOURCE OF TRUTH. Nothing in the app passes it — every real
   * page leaves it undefined and the shell reads the telemetry poller, which
   * stays the only place this is derived. It exists because the two states it
   * decides (the off-main banner, and whether Live config is in the nav at all)
   * otherwise require a game box physically parked on a branch to look at, and
   * `/preview/maintenance` was built for exactly that reason after a shape with
   * no schedule button shipped green.
   *
   * `undefined` means "ask the host"; `null` means "the host has not said",
   * which is a third state and behaves like main.
   */
  hostRef?: string | null
  /**
   * FOR THE DESIGN HARNESS ONLY: pretend `/api/host` answered with these two
   * br_ddb readings.
   *
   * SAME CONTRACT AS `hostRef` AND FOR THE SAME REASON. Nothing in the app
   * passes it; every real page leaves it undefined and the chip and banner poll
   * `/api/host` themselves. It exists because the alarm states are otherwise
   * unreviewable — reaching them means a game box whose IAM role is genuinely
   * broken — and this console has already shipped two card defects that were
   * invisible for exactly that reason (see HOST_STATUS).
   *
   * IT IS A SEED, NOT AN OVERRIDE. The moment a real poll answers, the poll
   * wins; on the harness no poll ever succeeds, so the fixture stands.
   */
  ddb?: DdbSeed
  /**
   * FOR THE DESIGN HARNESS ONLY: pretend `/api/host` reported this SSH channel
   * state and this error text.
   *
   * SAME CONTRACT AS `ddb`, AND THE ARGUMENT FOR IT IS STRONGER RATHER THAN
   * WEAKER. Reaching these states for real means a console whose private key is
   * genuinely unreadable or a game box that is genuinely unreachable — and the
   * console has already spent an hour of an outage rendering a page nobody
   * could review, because the only way to see the failing shape was to have the
   * failure.
   */
  dispatch?: DispatchSeed
}) {
  const resolvedUser =
    user === undefined
      ? await currentAdmin().then((a) =>
          a ? { name: a.name, avatarUrl: a.avatarUrl } : null,
        )
      : user

  /**
   * THE FEED READING FOR THE HEADER CHIP, RESOLVED HERE RATHER THAN PASSED IN.
   *
   * Exactly the argument the badges below were moved for, and it had produced
   * exactly the same three wrongs. `feed` was a per-page prop, seven of the
   * eleven real pages passed it, and on the other four — Audit log, Live config,
   * Kick & ban, Settings — the Live chip was simply absent. Not stale, not
   * greyed: gone, on a quarter of the console, for no reason a reader could
   * infer. "Is the data arriving" is a fact about the server and is true of
   * every page drawn from it.
   *
   * `liveView` IS AN IN-MEMORY READ, so resolving it here costs nothing and the
   * pages that already pass `feed` are not doing a second lookup worth saving —
   * they keep the prop only because the preview harness needs it to hand over a
   * fixture and, crucially, to turn POLLING OFF. That is why `live` defaults to
   * true here and is only false when a caller says so: a harness must not fetch
   * real state over the top of its own fixture.
   *
   * IT COMES FIRST NOW because everything below is dated from `chipFeed.now` —
   * the badge, the deploy phase and the chips all describe the same instant.
   */
  const chipFeed = feed
    ? {
        lastPushAt: feed.lastPushAt,
        bootEpoch: feed.bootEpoch,
        now: feed.now,
        live: feed.live ?? false,
      }
    : { ...liveView(Date.now()), now: Date.now(), live: true }

  /**
   * THE MAINTENANCE ROW, READ ONCE, FOR EVERY SURFACE THAT DRAWS FROM IT.
   *
   * IN-MEMORY AND FREE — this is the driver's own cache, not a GetItem. It is
   * the read `/api/state` answers the poll from, which is precisely why the
   * sidebar badge and the header chip are seeded from it too: three surfaces,
   * one row, one reading, no way for them to contradict each other.
   *
   * NULL FOR A COLD CACHE, WHICH SHOWS NO BADGE RATHER THAN A WRONG ONE. A
   * console that has just restarted has not ticked the driver yet, so the badge
   * is absent for the first render and the browser's first poll (two seconds)
   * supplies it. `initialPhase` has always behaved exactly this way; the badge
   * used to be the odd one out, reading the row afresh and therefore able to
   * disagree with the very chip beside it.
   */
  const mv = maintenanceView(chipFeed.now)

  /**
   * BOTH BADGES, SEEDED HERE, ON EVERY PAGE, AND NEITHER OF THEM AWAITED.
   *
   * ═══ THE BUG THAT WAS CLOSED HERE, WHICH WAS REPORTED TWICE ═══
   *
   * The owner: "The incidents # chip in the side bar doesn't appear unless I'm
   * on the Incidents page. The same is true for the chip on the maintenance
   * tab." Both symptoms, one cause, and it is the `??` that used to be on this
   * expression rather than anything in the sidebar.
   *
   * `badges` is a per-page prop and this read `badges ?? <maintenance only>`,
   * so the two badges were never both resolved on the same render:
   *
   *   /incidents          passes `{ incidents: n }`  -> the whole fallback is
   *                       skipped, so the MAINTENANCE badge is missing
   *   /maintenance        passes `{ maintenance: … }` -> same, in reverse: the
   *                       INCIDENTS count is missing
   *   every other page    passes nothing -> the fallback runs, and it only ever
   *                       resolved maintenance, so the incident count was
   *                       missing on eleven routes out of thirteen
   *
   * Which is exactly what a nav badge must not do. Its entire value is that an
   * unread incident is visible from wherever you happen to be standing; one
   * that only appears on the page it counts is telling you a thing you are
   * already looking at.
   *
   * IT IS THE SAME ARGUMENT THE `feed` PROP LOST BELOW, and the previous fix
   * for that one only moved half of it: the fallback was written when
   * maintenance was the only badge, and `incidents` was added later as
   * something the two incident routes passed in by hand. Nothing was wrong with
   * the sidebar. A page-supplied badge was simply the only way an incident
   * count ever reached it.
   *
   * SO BOTH ARE RESOLVED HERE, INDEPENDENTLY, AND `badges` OVERRIDES PER KEY
   * rather than replacing the object. The preview harness still passes
   * DEMO_BADGES and still gets exactly what it asked for; a real page that
   * passes one badge no longer silently blanks the other.
   *
   * ═══ AND THE FIX USED TO BE PAID FOR ON THE CRITICAL PATH ═══
   *
   * THE REQUIREMENT ABOVE IS NOT IN QUESTION. How it was funded is. Resolving
   * both badges here meant `await Promise.all([incidents.openCount(),
   * maint.current()])` — a DynamoDB scan and a GetItem — BEFORE the shell could
   * render, on all eleven routes, on every navigation. The owner felt it:
   * "switching between pages taking longer".
   *
   * MEASURED BEFORE IT WAS CHANGED, because the obvious culprit was not the
   * whole story. The shell's blocking DynamoDB work per navigation was FIVE
   * strictly sequential round trips. FOUR are the session lookup every page
   * awaits before this component is even entered — `auth()` is a Query then a
   * GetItem, then `discordIdFor`, then `grantsForDiscordId` — and ONE was this
   * badge pair, whose two reads at least ran concurrently with each other.
   *
   * SO THE BADGES WERE ONE ROUND TRIP IN FIVE, AND WHAT THAT COST DEPENDED
   * ENTIRELY ON THE INCIDENT CACHE. Warm, it was a single GetItem — about a
   * fifth of the blocking time. Cold, once every fifteen seconds, it was a
   * TABLE SCAN, the most expensive read in this application, and it became the
   * largest single item on the path: roughly 45ms against the session's 32ms at
   * same-region latency, and the gap widens as the incidents table grows.
   *
   * WHICH MEANS THE HONEST ANSWER IS "BOTH". The badges dominated by TIME
   * whenever the cache had lapsed, which is exactly the navigation a human
   * notices; the session lookup dominates by COUNT on every navigation without
   * exception and is the deeper problem. This change removes the badge round
   * trip entirely. IT DOES NOT TOUCH THE SESSION LOOKUP, which is still four
   * sequential reads on every page load and is where the next real win is.
   *
   * NEITHER BADGE IS AWAITED ANY MORE. Both seeds are synchronous in-memory
   * reads of what this process already learned, and the browser takes them from
   * there on the two-second poll that every page was already running for the
   * header chips. See `NavBadges`.
   *
   * ═══ AND THE MAINTENANCE BADGE NOW HAS ONE SOURCE INSTEAD OF TWO ═══
   *
   * It had two readings of one row with nothing asserting they agreed: this
   * component's own `maint.current()` GetItem, and `/api/state`'s
   * `maintenanceView()`. They could genuinely disagree — a console whose driver
   * had not ticked yet served a null badge on the poll while a fresh GetItem
   * here said "draining", so the sidebar and the header contradicted each other
   * about the same window. Both now read the driver's cache, which is also what
   * `initialPhase` below has always read. One row, one reader, three surfaces.
   *
   * A FAILED READ SHOWS NO BADGE, NEVER A ZERO. `openCountView` returns null
   * when it has never managed a count, and a failed recount leaves the previous
   * value alone rather than substituting a zero — see `lib/incidents`. Null and
   * zero both draw nothing, but they arrive here as different values and the
   * badge is written knowing the difference. "We could not look" and "there is
   * nothing waiting" must not become the same fact on the way.
   *
   * ONLY WHAT THE CALLER DID NOT SUPPLY IS READ. The design harness passes both
   * and must not reach DynamoDB to render a fixture; a real page that has
   * already counted the queue for its own body (both incident routes do) seeds
   * first paint with the fresher number it already holds.
   */
  const b: NavBadges = {
    incidents: badges?.incidents ?? incidents.openCountView() ?? undefined,
    maintenance:
      badges?.maintenance !== undefined ? badges.maintenance : mv.badge,
  }

  /**
   * AND THE RECOUNT IS KICKED OFF WITHOUT BEING WAITED FOR.
   *
   * NOT `await`. This returns immediately when the cached count is inside its
   * TTL and otherwise starts one shared scan that some later render or poll
   * will benefit from — so a navigation warms the number for the next one
   * instead of paying for it itself. `/api/state` is what actually keeps it
   * fresh while the console is open; this exists so the first navigation after
   * a console restart leaves a value behind for the second, rather than every
   * page waiting on the browser to come back and ask.
   *
   * The same lazy, idempotent, fire-and-forget shape as `ensurePolling` and
   * `ensureDriver` below, and for the same reason: the work belongs to the
   * process, not to whoever happened to click.
   */
  void incidents.refreshOpenCount()

  /**
   * WHERE THE LAST DEPLOY HAS GOT TO, resolved on the server so the header is
   * right on first paint rather than two seconds later.
   *
   * BOTH HALVES ARE FREE READS. `mv` above is the row the driver last read on
   * its own fifteen-second tick, and `liveView` is in-memory state — neither is
   * a database round trip, which is what makes doing this on every page render
   * reasonable. A console whose driver has never ticked gets a null window and
   * therefore `idle`, which asserts nothing: the same "not knowing shows less"
   * direction the phase is built on.
   *
   * THE SAME FUNCTION THE BROWSER CALLS TWO SECONDS LATER, so the seed and the
   * first poll cannot disagree about the same row.
   *
   * `mv.window` RATHER THAN A SECOND `maintenanceView()` CALL. It used to open
   * with one of its own, which meant this render could sample the row at one
   * instant for the phase and at another for the badge. One read, one instant,
   * every surface below drawn from it.
   */
  const initialPhase = deployPhase({
    state: mv.window?.state,
    deployStartedAt: mv.window?.deployStartedAt,
    completedAt: mv.window?.completedAt,
    deployError: mv.window?.deployError,
    deployBootEpoch: mv.window?.deployBootEpoch,
    deployConfirmedAt: mv.window?.deployConfirmedAt,
    bootEpoch: chipFeed.bootEpoch,
    lastPushAt: chipFeed.lastPushAt,
    now: chipFeed.now,
  })

  const jar = await cookies()
  const prefs = readPrefs(jar)
  // Whether this render is the pause-menu console. Used for exactly one
  // decision, below -- see lib/framed.ts, which is emphatic that a self-
  // reported header may never gate a permission, a session or a write.
  const inGame = isFramedClient(await headers())

  /**
   * The off-main banner has to be true on every page, which means the SSH poll
   * has to be running on every page.
   *
   * IT WAS ONLY EVER STARTED BY THE HOST AND MAINTENANCE ROUTES, so on a
   * freshly restarted console an admin who opened Live players first would see
   * no banner at all — the box could be parked on a branch and nothing would
   * say so until somebody happened to visit Host. A warning that appears only
   * where you already knew to look is not a warning.
   *
   * The cost is one SSH round trip every fifteen seconds while somebody has the
   * console open, which is what the Host page already costs; `ensurePolling` is
   * idempotent and no-ops when the channel is unconfigured, so this is one
   * poller for the process rather than one per page.
   */
  ensurePolling()
  /**
   * AND THE MAINTENANCE DRIVER, FOR THE SAME REASON THE POLLER IS HERE.
   *
   * The header's chips have to know whether a deploy is running on every page,
   * and they learn it from `maintenanceView()` — which is the driver's own cache
   * and is empty until the driver has ticked. Started only by /maintenance and
   * its routes, that cache stayed cold for anybody who never opened that page,
   * so the "Updating" chip would not have appeared where it matters most: on the
   * Live players board, which is exactly where somebody is sitting when the
   * server goes quiet. `ensureDriver` is idempotent and already calls
   * `ensurePolling` itself; the pairing is left explicit because the two answer
   * different questions.
   */
  ensureDriver()
  const host = hostView().status

  /**
   * The one derivation, read once and used twice: it decides both the banner
   * below and whether Live config is in the nav at all. Recomputed from the
   * host every render rather than stored anywhere — see `NavContext.offMain`.
   */
  const deployedRef = hostRef !== undefined ? hostRef : (host?.deployedRef ?? null)
  const navContext: NavContext = {
    offMain: isParkedOffMain({ deployedRef: deployedRef ?? undefined }),
  }

  /**
   * THE IDLE GUARD AND THE FIRST-RUN PROMPT ONLY MOUNT FOR A REAL SESSION, and
   * "real" has to mean the session cookie rather than the `user` prop.
   *
   * The obvious gate — `resolvedUser !== null` — is wrong, and wrong in a way
   * that only shows up when the app is actually run. The design harness under
   * `/preview` passes `user={DEMO_USER}`: a populated fixture for somebody who
   * is not signed in to anything. Gating on the prop therefore mounts the idle
   * guard on the harness, its first keepalive 401s, and the wireframes redirect
   * themselves to the login page — plus the first-run dialog opens over the top
   * of them on every load.
   *
   * `hasSessionCookie` is the same unvalidated sniff the middleware uses and is
   * not a boundary; nothing here is guarding data. It is answering "is there a
   * session for this machinery to be about".
   */
  const signedIn = hasSessionCookie(jar)

  /**
   * Read here rather than in the layout because the layout has no session to
   * bind against; `activityDeadline` returns null when nothing valid is on
   * record, which the client reads as "seed me" and turns into one keepalive on
   * mount. Passed down as a server value so the countdown never has to call
   * `Date.now()` during render.
   */
  const deadline = signedIn ? activityDeadline(jar) : null

  /**
   * The sidebar's own cookie, finally read. Written by `ui/sidebar.tsx` on
   * every toggle since it was installed; anything other than the literal
   * `false` it writes means open, including the cookie being absent.
   */
  const sidebarOpen = jar.get('sidebar_state')?.value !== 'false'

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <Sidebar collapsible="icon" className="sidebar-surface">
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/25">
              {/* The storm circle, which is where the name comes from. */}
              <div className="size-3.5 rounded-full border-2 border-primary" />
            </div>
            <div className="leading-tight group-data-[collapsible=icon]:hidden">
              <div className="text-sm font-semibold">Ringmaster</div>
              <div className="text-xs text-muted-foreground">
                Blitz Royale
              </div>
            </div>
            {/*
              THE REPOSITORY, WHERE THE OWNER ASKED FOR IT: "the top right of
              the sidebar next to the server name and 'Ringmaster' text, but
              right-aligned."

              `ml-auto` DOES THE RIGHT-ALIGNING, not a justify-between on the
              parent — the block to its left is two lines of text that must stay
              beside the mark, and `justify-between` would push them apart from
              it as the sidebar widens.

              IT DISAPPEARS IN ICON MODE with the rest of the wordmark. A
              collapsed rail is 3rem of nav icons; a GitHub mark in it would
              read as a fourteenth destination inside the console rather than as
              a way out of it.

              `target="_blank"` WITH `rel="noreferrer"`. It leaves the console,
              and an admin mid-incident should not lose the page they were on.
              `noreferrer` implies `noopener`, and the referrer is worth
              suppressing on its own: this console's hostname is not something
              to hand to a third party on every click.

              PLAIN `<a>`, NOT `next/link`. Link exists to prefetch and to route
              client-side, and neither means anything for an external origin.
            */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Ringmaster on GitHub"
                    className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground group-data-[collapsible=icon]:hidden"
                  />
                }
              >
                <GithubMark className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="right">Source on GitHub</TooltipContent>
            </Tooltip>
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {NAV.map((section) => {
            const items = section.items.filter(
              (item) => item.when?.(navContext) ?? true,
            )
            // A group whose every item is conditional would otherwise render as
            // a heading over nothing.
            if (items.length === 0) return null

            return (
            <SidebarGroup key={section.group}>
              <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = item.icon
                    const badge = item.badge?.(b, chipFeed.live)
                    return (
                      <SidebarMenuItem key={item.href}>
                        {/* Base UI takes `render`, not Radix's `asChild` — the
                            same difference that bites every shadcn snippet
                            copied from the docs into this app. */}
                        <SidebarMenuButton
                          render={<Link href={item.href} />}
                          isActive={item.href === active}
                          tooltip={item.label}
                          className={cn(item.soon && 'text-muted-foreground/60')}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {badge ? (
                          <SidebarMenuBadge>{badge}</SidebarMenuBadge>
                        ) : item.soon ? (
                          <SidebarMenuBadge className="text-xs uppercase tracking-wider text-muted-foreground/40">
                            {item.soon}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            )
          })}
        </SidebarContent>

        <SidebarFooter>
          {resolvedUser ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="group/user flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:px-0">
                  {/* Discord avatar when we have one, initials as the fallback
                      — a broken image on an admin's own name reads as
                      "something is wrong with my account", so the fallback is a
                      real design state, not an afterthought. */}
                  {resolvedUser.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolvedUser.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      className="size-7 shrink-0 rounded-full object-cover ring-1 ring-inset ring-primary/25"
                    />
                  ) : (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary ring-1 ring-inset ring-primary/25">
                      {resolvedUser.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                    <div className="truncate text-sm">{resolvedUser.name}</div>
                  </div>
                  {/*
                    Sign out, revealed on hover. This deletes the session RECORD
                    in DynamoDB via Auth.js -- which clearing cookies does not:
                    that merely orphans the row until TTL. With server-side
                    sessions, the button is the revocation-correct exit, not a
                    nicety. focus-visible keeps it reachable by keyboard, where
                    "revealed on hover" would otherwise mean "does not exist".
                  */}
                  <form
                    className="group-data-[collapsible=icon]:hidden"
                    action={async () => {
                      'use server'
                      const { signOut } = await import('@/auth')
                      await signOut({ redirectTo: '/login' })
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="submit"
                            aria-label="Sign out"
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/user:opacity-100"
                          />
                        }
                      >
                        <LogOut className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="top">Sign out</TooltipContent>
                    </Tooltip>
                  </form>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              Not signed in
            </div>
          )}
        </SidebarFooter>

        {/* The drag rail — the affordance that makes collapse discoverable. */}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        {/*
          A THREE-TRACK GRID, NOT A FLEX ROW WITH AN ABSOLUTE CHILD.

          The search used to be `absolute inset-x-0 justify-center px-28` -- out of
          flow, centred on the header, reserving a hard-coded 112px on each side.
          That reserve was the bug. The right-hand cluster is in normal flow and
          ran to ~340px when the feed chip, an update badge and a maintenance
          window were all present (the feed chip left and has since come back, so
          that worst case is live again -- the layout below is what makes it
          irrelevant rather than lucky), so `ml-auto` (which only measures in-flow
          siblings) grew it leftward UNDERNEATH the search, and the positioned
          element painted on top: "Ctrl K" and the LIVE chip rendered over each
          other. No amount of min-w-0 or shrink fixes that, because the two boxes
          were not in the same layout -- and Badge is `shrink-0 whitespace-nowrap`
          anyway.

          It was reachable on every route, not just the ones that pass `badges`:
          the maintenance chip falls back to a live read below, and on a
          feed-bearing page "Falling behind" plus "Update available" plus the theme
          toggle already crossed the reserve on their own.

          One layout means they cannot overlap. The side tracks are `1fr` with
          their natural min-content floor, so the middle track is centred on the
          header at ordinary widths -- which is what the absolute positioning was
          for -- and when the chips genuinely need more room the search shifts
          instead of being painted over. Degrading the centring is the right thing
          to lose; the previous `mx-auto` attempt lost it constantly, this loses it
          only in the crowded case.
        */}
        <header className="sticky top-0 z-20 grid h-14 grid-cols-[1fr_minmax(2.5rem,28rem)_1fr] items-center gap-3 border-b border-border bg-background/70 px-5 backdrop-blur-xl">
          <SidebarTrigger className="-ml-1.5" />

          {/*
            ONE INSTANCE. This was rendered twice — a centred desktop copy and a
            separate mobile copy — and `hidden` only removes an element visually:
            both stayed mounted, both registered the ⌘K listener, and both held
            their own dialog. So the shortcut opened two stacked palettes and the
            invisible one intercepted what you typed.

            Centred and given real width because the palette is the primary way
            to reach a player; a small button beside the sidebar toggle read as a
            minor control.
          */}
          {/*
            The middle track. Centred on the header by the grid rather than by
            being taken out of the flow, so it no longer needs pointer-events
            juggling to keep the header clickable around it.
          */}
          <div className="min-w-0">
            <PlayerSearchTrigger />
          </div>

          {/*
            NO `min-w-0` HERE, deliberately, and it is the whole reason the grid
            works. `1fr` means `minmax(auto, 1fr)`, so the track's floor is its
            content's min-content width -- which is what pushes the middle track
            narrower when the chips are wide. Adding min-w-0 sets that floor to
            zero, and since Badge is `shrink-0 whitespace-nowrap` the cluster then
            overflows its own track leftward and paints over the search. Which
            looks exactly like the absolute-positioning bug this replaced, and cost
            a round of measuring to tell apart.

            The search keeps its min-w-0: that one SHOULD give way.
          */}
          {/*
            ONE COMPONENT, RENDERED UNCONDITIONALLY. The status chips used to be
            spelled out here, each with its own visibility test — and the feed
            one was behind `{feed && …}`, which four real pages never satisfied.
            They describe the SERVER, so they belong on every page that shows the
            shell, and deciding WHICH of them to show — during a deploy, after
            one that failed — belongs to the cluster rather than to components
            that cannot see each other. See `ServerChips`, which paints the
            cluster, and `chipCluster` in lib/serverPhase, which decides it: one
            function saying which of the feed chip, Updating, Update failed, the
            update badge and the window badge may appear together. The owner's
            rule that draining supersedes "update available" is a rung in that
            ladder rather than a test any component makes for itself.
          */}
          <div className="flex items-center justify-end gap-2">
            {/*
              OUTSIDE `ServerChips`, AND OUTSIDE THE PRECEDENCE RULE INSIDE IT.
              `chipCluster` exists to make sure only one of the deploy/feed/
              update/maintenance chips speaks at a time; a critical br_ddb fault
              is not one of those and must not be suppressible by a deploy in
              flight. It sits first so the loudest thing in the header is also
              the leftmost. Renders nothing unless something is stated broken.
            */}
            <DdbHealthChip seed={ddb} />
            {/*
              THE SECOND SUBSYSTEM, AND THE SECOND CHIP. `dispatch` is this
              box's SSH channel to the game box — telemetry, the branch list and
              every deploy ride it — and it is outside `chipCluster` for exactly
              the reason br_ddb is: a deploy in flight must not be able to
              suppress the alarm saying the deploy channel is down.

              TWO CHIPS AND NOT ONE, because they name two different machines to
              go and look at. In practice they rarely both speak: reachability
              rides the ingest push, so a dead SSH channel silences the bundle
              reading rather than reddening it.
            */}
            <DispatchHealthChip seed={dispatch} />
            <ServerChips
              live={chipFeed.live}
              initialBadge={b.maintenance ?? null}
              initialPhase={initialPhase}
              lastPushAt={chipFeed.lastPushAt}
              now={chipFeed.now}
            />
            <ThemeToggle />
          </div>
        </header>

        {/*
          ABOVE THE OFF-MAIN BANNER on the rare page load where both are up.
          Being parked on a branch means the running code is unreviewed; br_ddb
          being down means bans are not checked at connect and match results are
          not saved. The second outranks the first, and the top strip is the one
          that gets read.

          IT IS NOT DISMISSIBLE AND HAS NO CLOSE CONTROL. It is a render of the
          current reading, so it ends when the fault does and returns if the
          fault does — see DdbHealth, which has no dismissed flag to go stale.
        */}
        <DdbHealthBanner seed={ddb} />

        {/*
          UNDER THE br_ddb STRIP on the rare load where both are up, and the
          order is the same judgement made one rung down. br_ddb being down
          means bans are not checked at connect and match results are not saved,
          which affects players while nobody acts. This being down means the
          console is blind and cannot deploy — serious, and a tool rather than a
          live service.

          IT SAYS THE TITLE AND NOT THE ERROR. The poller's text is a multi-line
          ssh command line naming a key path and the game box's address; it
          belongs in the popup this opens and on the Host page, not across the
          top of every page in the console.
        */}
        <DispatchHealthBanner seed={dispatch} />

        {/*
          Directly under the header and above everything else on the page,
          because it changes what everything else on the page MEANS: an incident
          may be a bug in an unmerged commit, and the code on main is not the
          code running. `pinnedBy` is only shown when the pin and the running
          ref agree — a pin staged for a switch that has not deployed yet names
          the wrong person for what is currently on the box.
        */}
        <OffMainBanner
          deployedRef={deployedRef}
          by={host?.pinnedRef === host?.deployedRef ? host?.pinnedBy : null}
          at={host?.pinnedRef === host?.deployedRef ? host?.pinnedAt : null}
        />

        {/* Announces an available update once per session, and again whenever
            one appears while the console is open. */}
        <UpdateWatcher />

        {/* Watches for a pointer or a key and ends the session when neither
            has happened for two hours. Renders nothing. */}
        {signedIn && <IdleGuard deadline={deadline} />}

        {/* Escape inside the pause-menu frame takes the whole overlay down.
            Renders nothing, and does nothing at all in a browser tab. The game
            cannot bind this itself: a cross-origin frame does not forward key
            events, so the key has to be sent from the side that receives it. */}
        {inGame && <FrameEscape />}

        {/* Asked on every login until it is answered, because the answer is
            what dismisses it. This renders on all thirteen routes, so a prompt
            with any other exit remounts on the next navigation — which is
            exactly what "More settings" used to do. See PrefsDialog.

            NOT IN THE PAUSE MENU. A modal that has to be answered before the
            console can be used is wrong on top of a live match, and what it
            asks for — a search through four hundred timezones — is not why
            anybody opened the Admin tab. Settings carries both controls, so
            an in-game admin loses nothing they cannot reach from a browser;
            until they do, times render in UTC with the zone named. */}
        {signedIn && prefs.shouldPrompt && !inGame && (
          <PrefsDialog initialTheme={prefs.theme} />
        )}

        <main className="animate-rise min-w-0 flex-1 px-5 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
