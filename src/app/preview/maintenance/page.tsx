import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { MaintenancePanel } from '@/components/MaintenancePanel'
import { DEMO_USER } from '@/lib/demo'
import { AUTO_AFTER_MS, type MaintenanceWindow } from '@/lib/maintenance'
import type { RefUpdate, UpdateTarget } from '@/lib/ssh'
import { cn } from '@/lib/utils'

/**
 * The maintenance page, without a game host. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS: this panel has more shapes than any other page in the console
 * — on main with an update, on main with nothing to do, parked on a branch,
 * a window draining, a window that switches branch — and every one of them
 * needs a live game box in a particular state to see. That is how
 * WillMontgomery/fivem-br-gamemode#146 shipped: the parked-on-a-branch shape
 * had no schedule button at all, which is obvious in two seconds of looking and
 * invisible in a type check. `tsc` and `next build` both pass on a page that
 * renders nothing, and they both passed on this one.
 *
 * `?state=` picks the case:
 *   parked         on `dev`, host has not said how far behind `dev` it is
 *   parked-behind  on `dev`, THREE NEW COMMITS ON `dev` — the discovered update
 *   parked-blocked the same three commits, and a box that will REFUSE to deploy
 *   parked-level   on `dev`, level with it — NO SCHEDULING BOX AT ALL
 *   parked-stale   on `dev`, a zero the host answered from stale refs — BOX STAYS
 *   parked-live    on `dev`, a plain update scheduled and draining
 *   parked-switch  on `dev`, a window that switches to another branch
 *   main-update    on main, behind — the ordinary case
 *   main-current   on main, nothing to deploy
 *   unpolled       NOBODY HAS ASKED THE HOST YET — the box must still be there
 *   unknown        the host has not said which ref it is on
 *   confirming     DEPLOYED, WAITING FOR br_ringmaster — the loading state
 *   unconfirmed    the same deploy, past the grace, never came back
 *   deploy-failed  the host refused the deploy; nothing restarted
 *
 * THE LAST THREE ARE THE COMPLETION GATE, and they are here for the same reason
 * the parked four are: they need a real game box in a real failure state to
 * see, which means in practice they are never looked at. `confirming` is the
 * state the owner reported missing — "after the drain it just jumps to 'up to
 * date'" — and the two after it are the only exits from it, so a change that
 * breaks one of the three and is only checked against the other two ships a
 * spinner with no way out.
 *
 * THE FOUR PARKED READINGS ARE THE POINT OF THE NEW ONES. "Behind its branch",
 * "level with it", "we have not been told" and "we were told by a host that
 * could not check" are four different readings, only the first is an update
 * waiting, and only the SECOND may take the scheduling box off the page. They
 * are indistinguishable in a type check and each needs a live game box in a
 * particular state to see, which is the same argument that produced this file.
 * `parked-blocked` IS A FIFTH READING AND A DIFFERENT QUESTION. The four above
 * all ask how far behind the branch is; that one asks whether the box would
 * take the deploy at all, and the answer travelled on the same payload for as
 * long as the branch picker has existed while the update card ignored it. It is
 * `parked-behind` with one extra field set, which is exactly how invisible the
 * defect was.
 *
 * The two that cost #146 are `parked` and `parked-stale`: an unknown count must
 * never read as "nothing to do" while an operator is looking at a branch they
 * just pushed to — and now that the box VANISHES on a zero rather than greying
 * out, there is no disabled control left to hint the action ever existed. Flip
 * between `parked-level` and `parked-stale`: one has the box, one does not, and
 * the underlying number is 0 in both.
 *
 * `unpolled` IS THE SAME TRAP ON MAIN, AND IT HAD NO FIXTURE UNTIL #26. The
 * main-branch distance used to be read as `updateAvailable ?? 0`, so a console
 * that had not yet heard from the game host computed a KNOWN zero and removed
 * its own scheduling box — #146 arrived at from the other ref, and reachable on
 * every console restart rather than only on a parked box. Flip between
 * `unpolled` and `main-current`: `behindMain` is null in one and 0 in the other,
 * they look nothing alike, and only the second may take the card away.
 *
 * The panel is passed `frozen` so it holds the fixture instead of polling the
 * real console out from under it. See the prop's own comment.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const NOW = Date.now()

/** The fields every window carries, so each view below states only what it varies. */
const BASE: MaintenanceWindow = {
  id: 'current',
  state: 'complete',
  createdAt: NOW - 40 * 60_000,
  createdBy: null,
  createdByName: 'system',
  note: '',
  drainStartsAt: 0,
  deployMode: 'when-empty',
  deployAt: null,
  updateAvailable: 0,
  updateFirstSeenAt: null,
}

/** A window an admin scheduled a few minutes ago and is now watching drain. */
const DRAINING: MaintenanceWindow = {
  ...BASE,
  state: 'draining',
  createdAt: NOW - 6 * 60_000,
  createdBy: 'license:abc123',
  createdByName: 'Will',
  note: 'a server update',
  drainStartsAt: NOW - 5 * 60_000,
  drainStartedAt: NOW - 5 * 60_000,
}

interface View {
  /** What the host says it is running. `null` is a host that has not answered. */
  deployedRef: string | null
  /**
   * How far behind its own branch the box is. `null` is "not known", which is
   * a state in its own right and NOT the same as zero — see the panel's prop.
   */
  refUpdate: RefUpdate | null
  /**
   * How far behind main. `null` is "the host has not answered", which is a state
   * in its own right and NOT the same as zero — the whole subject of #26.
   */
  behindMain: number | null
  /**
   * The two commits an update would move between. `null` is "we have not read
   * the branch list yet", which is why several fixtures below have an update and
   * no arrow: that is the honest first two minutes of a console's life.
   */
  updateTarget: UpdateTarget | null
  /**
   * The commit the host says it is running NOW. `null` is a host that has not
   * answered, or a dispatcher too old to send a full sha.
   *
   * REQUIRED, NOT OPTIONAL, so that adding a fixture is a decision about this
   * reading rather than an omission of it. It is `DEPLOYED_SHA` almost
   * everywhere, which is the shared premise of this whole harness — the two
   * states where it is not are the two that are worth looking at.
   */
  runningSha: string | null
  window: MaintenanceWindow | null
  players: number
}

/**
 * The two shas every fixture below reuses.
 *
 * ONE PAIR, SHARED, so a reviewer flipping between states sees the SAME two
 * commits move in and out of view rather than a fresh pair of random hex per
 * state — which would make "did the arrow change" impossible to answer by
 * looking. They also sit in `refAt` and in `targetOn` alike, because in
 * production the count and the arrow come out of ONE `branches` answer one line
 * apart, and a harness that let those two drift would stop being a rehearsal of
 * the real thing.
 *
 * They are fixtures and deliberately look like shas: a reviewer comparing this
 * harness against the real page should be able to tell at a glance that nothing
 * here was invented in a different shape from the real thing. Both are also live
 * hyperlinks in the card now, so following one goes to GitHub and 404s — which
 * is the correct outcome for an invented commit, and better than a link that
 * silently went nowhere.
 */
const DEPLOYED_SHA = '4f2b9c1de8a7365019bd4ac2e5f80917bb3c6d24'
const TIP_SHA = '9c1e77a4b02d5f38e6ab41cc7d90e2f5138ba604'
/**
 * A THIRD COMMIT, WHICH IS THE WHOLE OF THE OWNER'S REPORT IN ONE CONSTANT.
 *
 * "It's misleading to say we're going from X to Y but we actually end up on Z,
 * which is the latest." `DEPLOYED_SHA` is X, `TIP_SHA` is Y — the commit the
 * card named when the button was pressed — and this is Z, pushed while the
 * server was draining and picked up by `deploy.sh`'s own fetch when the deploy
 * finally ran. Three constants because there were always three commits; the
 * console only ever had names for two of them.
 */
const LANDED_SHA = 'b7d3410e2fa9c85d6017ee3bb2495c8ad0f61e73'
/**
 * A FOURTH COMMIT: WHERE THE BOX ACTUALLY IS, WHICH THE ROW NEVER HEARD ABOUT.
 *
 * `LANDED_SHA` above is what the console WROTE DOWN at confirmation. This is
 * what the host is serving now — and they differ, because `deployLandedSha` is
 * written once and nothing ever refreshes it: anything that moves the box
 * afterwards (a deploy run on the game host, a restart, a switch) leaves the
 * record describing a server that has moved on. The owner's console had these
 * six commits apart, with the settled card printing the record under a green
 * tick while the branch picker on the same screen printed the fact.
 *
 * SO `parked-landed` IS A STANDING REHEARSAL OF THAT DIVERGENCE. The row still
 * carries `LANDED_SHA`; the card must show THIS one. If the two are ever the
 * same string again, the fixture stops being able to catch the regression.
 */
const RUNNING_SHA = 'e5a8c02f7b13d4906ce28fa5b7013d64ac9f8e21'

/**
 * A reading of the parked branch, as the telemetry poller would hold one.
 *
 * `blockedBy` IS THE ONLY WAY TO MAKE ONE INELIGIBLE, and the two fields are
 * derived from it rather than passed separately — which is how the game box
 * produces them: `eligible` is exactly "`ref_blocked_by` had nothing to say".
 * A fixture able to set them independently could describe a payload the
 * dispatcher cannot send, and the state worth rehearsing here is the real one.
 */
const refAt = (
  ref: string,
  behind: number,
  stale = false,
  blockedBy = '',
): RefUpdate => ({
  ref,
  behind,
  tipSha: TIP_SHA,
  deployedSha: DEPLOYED_SHA,
  eligible: blockedBy === '',
  blockedBy,
  stale,
  at: NOW - 30_000,
})

/**
 * WHY THE BOX REFUSED, IN THE BOX'S OWN WORDS.
 *
 * NOT INVENTED — this is what the game host actually printed the night the bug
 * was found, trimmed to the sentence `branches` carries per ref. Every other
 * string in this file is a plausible fixture; this one is a transcript, because
 * the whole point of the state below is that the console renders the host's
 * wording rather than any of its own.
 */
const BLOCKED_BY =
  "it changes tools/dispatch.sh. Deploying it would replace the console's " +
  'only channel to this box with code that has not been through PR review. ' +
  'Land changes to tools/ on main.'

/** The pair of commits a deploy on `ref` would move between. */
const targetOn = (ref: string, stale = false): UpdateTarget => ({
  ref,
  fromSha: DEPLOYED_SHA,
  toSha: TIP_SHA,
  stale,
  at: NOW - 30_000,
})

const views: Record<string, View> = {
  /**
   * THE BUG STATE, AND STILL A REACHABLE ONE. Parked on `dev` with no reading
   * of the branch yet — a console that has just booted, a host that is not
   * answering, or a branch deleted from the remote. `updateAvailable` is held
   * at zero by the driver because distance-from-main is not what a parked box
   * is tracking. Before #146 this rendered the off-main banner and then nothing
   * at all; it must now render the card, the button, and no commit count.
   *
   * NO ARROW EITHER, and that is the same fact told twice rather than a second
   * gap: the pair of commits rides the same `branches` reading the count does,
   * so a console that has not read the branch list has neither. The card says
   * what the button DOES instead of what the branch has done.
   */
  parked: {
    deployedRef: 'dev',
    refUpdate: null,
    behindMain: null,
    updateTarget: null,
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 7,
  },

  /**
   * THE STATE THIS FEATURE EXISTS FOR. Somebody pushed three commits to the
   * branch the live server is running, and the console found them without being
   * asked. Note `updateAvailable` is still zero: the distance from main is
   * untouched and this number is a different one, which is why the badge here
   * has to name `dev` and the main card's has to name main.
   */
  'parked-behind': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    behindMain: null,
    updateTarget: targetOn('dev'),
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 7,
  },

  /**
   * AHEAD AND REFUSED AT THE SAME TIME — THE STATE THAT SHIPPED A BROKEN
   * DEPLOY, and the combination that had no fixture until it had cost
   * something.
   *
   * Identical to `parked-behind` in every reading this page had ever consulted:
   * three commits waiting on `dev`, an arrow between two real commits, the
   * off-main banner above. The one thing that differs is a field the update
   * card used to throw away — the game box saying it will not deploy this ref
   * because it changes `tools/dispatch.sh`. The console held that sentence and
   * scheduled the deploy anyway; the refusal turned up on the box, from a
   * systemd unit, in a log.
   *
   * WHAT TO CHECK, and the first two are the whole bug: "Schedule update" is
   * GREYED, and the box's sentence is rendered BESIDE it rather than on hover —
   * a disabled control eats pointer events, so a tooltip would delete the
   * explanation in exactly the state that needs one (`docs/hover-text.md`). Then:
   * the card is still here, because there IS something to deploy and the reason
   * needs somewhere to live; the wording is the host's, unedited, with no
   * console-authored gloss around it; and "Revert to main" and "Deploy a
   * different branch" are both still live below. A branch the box will not
   * deploy must never be a branch nobody can leave.
   *
   * FLIP BETWEEN THIS AND `parked-behind`. Same count, same commits, same
   * banner; one schedules and one refuses. If they look alike, the fix is gone.
   */
  'parked-blocked': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3, false, BLOCKED_BY),
    behindMain: null,
    updateTarget: targetOn('dev'),
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 7,
  },

  /**
   * PARKED AND LEVEL — THE ONE STATE WITH NO SCHEDULING BOX AT ALL. The owner:
   * "the schedule an update box shouldn't even exist when there is no update
   * found." The deploy would end every match in progress and change nothing,
   * and `api/maintenance` refuses the same request with the same rule.
   *
   * FOUR THINGS TO CHECK HERE, and the last two are the ones that would make
   * this a bug rather than a feature: the scheduling card is gone; the space it
   * left says what is true and names `dev` rather than sitting empty; the parked
   * card above still offers REVERT TO MAIN; and "Deploy a different branch" is
   * still below it. A box level with its branch must not be a box an operator
   * cannot leave.
   */
  'parked-level': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 0),
    behindMain: null,
    // Level means the box IS the tip, so the pair collapses to one commit and
    // `updateTargetNow` withholds it. There is no card here to hang it on.
    updateTarget: { ...targetOn('dev'), toSha: DEPLOYED_SHA },
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 7,
  },

  /**
   * THE SAME SETTLED CARD, AFTER A DEPLOY THAT WENT PAST WHAT WAS SHOWN.
   *
   * THIS IS THE OWNER'S BUG, REHEARSED. The window claimed `TIP_SHA` when it was
   * scheduled — that was the arrow on the card at the moment the button was
   * pressed — and by the time the drain finished and `deploy.sh` ran its own
   * fetch, the branch had moved to `LANDED_SHA`. Everything the console said was
   * true when it said it and none of it was true afterwards, and the settled
   * card used to assert "running the latest code" with no commit to check.
   *
   * WHAT THE CARD SHOWS IS THE COMMIT, NOT THE DISCREPANCY. Landing past the
   * commit on the page is what a deploy that fetches and resets to the tip DOES,
   * and it is what "get the server current" means — so this rehearses a normal
   * outcome being reported honestly, not an alarm. `parked-level` above is the
   * same card with nothing recorded, which is every window scheduled before this
   * field existed and is the state that must still render.
   *
   * AND IT REHEARSES THE SECOND HALF TOO: THE RECORD HAS GONE STALE. The row
   * still says `LANDED_SHA` and the box is on `RUNNING_SHA`, because
   * `deployLandedSha` is written once at confirmation and nothing refreshes it —
   * so the moment anything moves the box outside a scheduled window, the record
   * and the fact part company. That is the state the owner screenshotted: the
   * settled card naming a commit six behind the one the branch picker and the
   * Host page were both naming on the same screen.
   *
   * WHAT TO CHECK, AND IT IS ONE STRING: the commit under the tick is
   * `RUNNING_SHA` (`e5a8c02f`), never `LANDED_SHA` (`b7d3410e`). The footer below
   * prints both, so they can be compared without opening this file. If they are
   * ever the same commit again this fixture has stopped being able to catch the
   * regression it exists for.
   */
  'parked-landed': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 0),
    behindMain: null,
    updateTarget: { ...targetOn('dev'), toSha: LANDED_SHA },
    runningSha: RUNNING_SHA,
    window: {
      ...BASE,
      shownSha: TIP_SHA,
      deployLandedSha: LANDED_SHA,
      completedAt: NOW - 6 * 60_000,
      deployConfirmedAt: NOW - 5 * 60_000,
    },
    players: 7,
  },

  /**
   * A ZERO THE HOST DOES NOT STAND BEHIND, WHICH IS NOT A ZERO. `stale` means
   * the box could not finish its `git fetch` inside the SSH budget and answered
   * from the refs it already had, so the count MAY UNDERCOUNT — and an
   * undercounted zero is "we have not looked", not "there is nothing there".
   * This must render and behave as `parked` does, button live: it is the
   * likeliest way to re-create fivem-br-gamemode#146, because it happens
   * exactly when GitHub is slow and somebody has just pushed.
   */
  'parked-stale': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 0, true),
    behindMain: null,
    /**
     * A STALE TIP IS STILL SHOWN, unlike a stale zero, and the asymmetry is
     * deliberate — see `updateTargetNow`. A stale zero is indistinguishable from
     * "we have not looked", so it must not refuse a deploy; a stale tip is a real
     * commit that really was the tip at the last successful fetch and may simply
     * have been overtaken. The arrow renders and says so in warn text.
     */
    updateTarget: targetOn('dev', true),
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 7,
  },

  /** A plain update of the parked branch, mid-drain. No `targetRef`: not a switch. */
  'parked-live': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    behindMain: null,
    updateTarget: targetOn('dev'),
    runningSha: DEPLOYED_SHA,
    window: DRAINING,
    players: 3,
  },

  /** A branch switch, which is the pinned-sha path and reads differently. */
  'parked-switch': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    behindMain: null,
    updateTarget: targetOn('dev'),
    runningSha: DEPLOYED_SHA,
    window: {
      ...DRAINING,
      targetRef: 'feature/loot-v2',
      targetSha: DEPLOYED_SHA,
    },
    players: 3,
  },

  /**
   * The ordinary case: on main, behind, with the 72-hour clock running.
   *
   * THE CARD SAYS "UPDATE AVAILABLE" AND NOT HOW MANY. The count is gone on the
   * owner's instruction; what stands where it was is the pair of commits, both
   * hyperlinked, plus the diff between them. Compare against `main-update-cold`
   * below, which is the same update before the branch list has been read.
   */
  'main-update': {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 3,
    updateTarget: targetOn('main'),
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
    },
    players: 12,
  },

  /**
   * ON MAIN, BEHIND, AND THE ARROW HAS NOT ARRIVED YET. The distance comes off
   * the fifteen-second `status` poll; the two commits come off the two-minute
   * `branches` one. So there is a real window in which the console knows there
   * is an update and does not yet know which commit it leads to — and the honest
   * rendering is the card, the button, and no arrow. It must not invent an end.
   */
  'main-update-cold': {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 3,
    updateTarget: null,
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
    },
    players: 12,
  },

  /** On main, level with it — the empty state. THE ONLY MAIN STATE WITH NO CARD. */
  'main-current': {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 0,
    updateTarget: null,
    runningSha: DEPLOYED_SHA,
    window: BASE,
    players: 12,
  },

  /**
   * NOBODY HAS ASKED THE GAME HOST YET, AND THE BOX MUST STILL BE THERE.
   *
   * THE STATE #26 EXISTS FOR, and the one with no fixture before it. The
   * telemetry poller holds `status` as null until its first SSH round trip
   * lands, and `ensureDriver` starts that poller and the driver's tick in the
   * same breath — so this is every console for the first seconds after every
   * restart, not a corner case. Read as `updateAvailable ?? 0` it was a KNOWN
   * zero, which meant the empty state below: a green tick and "the server is
   * running the latest code", asserted by a console that had never asked.
   *
   * WHAT TO CHECK: the scheduling card is present, its button is live, there is
   * no commit count, no arrow, and NO CLAIM EITHER WAY about how current the
   * server is. Flip to `main-current` — same ref, same window, `behindMain` 0
   * instead of null — and the card should vanish. If both look the same, the
   * three states have collapsed back into two.
   */
  unpolled: {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: null,
    updateTarget: null,
    // No `status` at all yet, so there is no commit either — the same null as
    // `behindMain` above and for the same reason. Nothing has been asked.
    runningSha: null,
    window: null,
    players: 12,
  },

  /**
   * THE DEPLOY VERB IS RUNNING — and in this harness, the one state where the
   * header's two readings disagree.
   *
   * WHY IT IS HERE. `AppShell` seeds the header chips from TWO reads: the badge
   * from whatever the page passes, and `initialPhase` from the maintenance
   * driver's cached window. In this harness the driver has never read anything,
   * so `initialPhase` is always `idle` — which makes this fixture the seed
   * contradiction the owner's second complaint came through: a badge saying
   * `updating` beside a phase saying nothing is happening. Before `chipCluster`
   * took whole readings and grew its `updating` rung, that pair rendered
   * "UPDATE AVAILABLE" next to a chip reading "UPDATING".
   *
   * WHAT TO CHECK: the header shows the feed chip and UPDATING, and NO update
   * badge — neither "Update available" nor "Up to date".
   */
  deploying: {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 3,
    updateTarget: targetOn('main'),
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      state: 'deploying',
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
      deployStartedAt: NOW - 30_000,
    },
    players: 0,
  },

  /**
   * THE DEPLOY IS DONE AND THE SERVER HAS NOT SPOKEN YET — the state the owner
   * could not see, because the page used to skip straight past it.
   *
   * WHAT MAKES IT THIS STATE RATHER THAN "UP TO DATE": the window is `complete`
   * with a `deployBootEpoch` recorded and no `deployConfirmedAt`. The harness
   * feeds `bootEpoch: 'preview'` from the shell, which is a DIFFERENT string —
   * so the panel is deliberately given no live feed at all (`frozen` turns the
   * poll off and the initial props are left null), which is exactly what a
   * console hears from a server that is still booting: nothing.
   *
   * WHAT TO CHECK: a spinner, the sentence naming `br_ringmaster`, and a
   * countdown that names the moment this becomes a failure. There must be NO
   * green tick and no scheduling card anywhere on the page.
   */
  confirming: {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 0,
    updateTarget: null,
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      completedAt: NOW - 45_000,
      deployStartedAt: NOW - 70_000,
      deployBootEpoch: 'boot-before-the-restart',
      deployConfirmedAt: null,
      deployError: null,
    },
    players: 0,
  },

  /**
   * THE SAME DEPLOY, FIVE MINUTES LATER, STILL SILENT — the terminal state.
   *
   * THE HALF THAT MAKES THE LOADING STATE HONEST. A spinner with no exit is a
   * hang, so the wait is bounded by `RESTART_GRACE_MS` and lands here: a stated
   * failure, above controls that are all still live, because by this point
   * acting is the entire point of reading it.
   *
   * WHAT TO CHECK: the danger card is present AND the scheduling/branch
   * controls below it are still usable. A failure that takes away the way out
   * is worse than the failure.
   */
  unconfirmed: {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 0,
    updateTarget: null,
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      completedAt: NOW - 11 * 60_000,
      deployStartedAt: NOW - 12 * 60_000,
      deployBootEpoch: 'boot-before-the-restart',
      deployConfirmedAt: null,
      deployError: null,
    },
    players: 0,
  },

  /**
   * THE OTHER FAILURE, AND IT IS NOT THE SAME ONE. The host refused the deploy,
   * so nothing restarted and the server is still running what it was running.
   * That distinction decides where somebody goes to fix it, which is why the
   * two states have different words and different fixtures.
   *
   * `updateAvailable` IS STILL SET, deliberately: `markComplete` clears the
   * update signal only on success, because a failed deploy leaves the update
   * genuinely waiting. So this fixture must show the failure card AND the
   * scheduling card under it.
   */
  'deploy-failed': {
    deployedRef: 'main',
    refUpdate: null,
    behindMain: 3,
    updateTarget: targetOn('main'),
    runningSha: DEPLOYED_SHA,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
      completedAt: NOW - 4 * 60_000,
      deployStartedAt: NOW - 5 * 60_000,
      deployBootEpoch: 'boot-before-the-restart',
      deployConfirmedAt: null,
      deployError: 'the game host refused to switch to feature/loot-v2',
    },
    players: 0,
  },

  /**
   * A dispatcher too old to report its ref. Deliberately in the set: "unknown"
   * must keep behaving exactly like main here, which is the opposite polarity
   * to the automation gate, and it is the regression that would be easiest to
   * cause while fixing the parked case.
   */
  unknown: {
    deployedRef: null,
    refUpdate: null,
    behindMain: 3,
    /**
     * NO ARROW, DELIBERATELY, and for a different reason from `unpolled`. A host
     * that will not name its ref cannot have a reading PAIRED to that ref, and
     * `updateTargetNow` refuses an unpaired one — the same rule that stops the
     * previous branch's commits appearing under a new branch's name for the few
     * seconds after a switch. The card is still here, because the distance from
     * main is a fact and this box folds in with main for everything a human
     * reads.
     */
    updateTarget: null,
    /**
     * AND NO COMMIT EITHER, for the same age reason the ref is missing. `sha`
     * and `deployedRef` are both fields a newer dispatcher grew; a box too old
     * to name its branch sends neither, and `runningShaNow` returns null rather
     * than reaching for the abbreviated `commit` beside it.
     */
    runningSha: null,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
    },
    players: 12,
  },
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const key = state && state in views ? state : 'parked'
  const fixture = views[key]!

  /**
   * THE DESTINATION READING IS RE-STAMPED AT REQUEST TIME, AND IT HAS TO BE.
   *
   * `updateTargetNow` refuses a reading older than `TARGET_MAX_AGE_MS`, which is
   * the fix for the owner's "the hash on the maintenance page isn't the latest
   * hash" — a reading nothing is refreshing must stop being rendered as one. The
   * fixtures below are built from `NOW`, a module-scope `Date.now()` evaluated
   * when this file is first loaded, so on a server that has been up for an hour
   * every `at` in this harness is an hour old and the arrow would vanish from
   * EVERY state here — a reviewer flipping between `?state=parked-behind` and
   * `?state=parked-blocked` would see no commits at all and read the harness as
   * broken rather than the gate as working.
   *
   * ONLY `at` MOVES. `stale`, the shas and the ref are the fixture's, untouched,
   * so each state still rehearses exactly what it was written to rehearse. What
   * this says is "this reading is current", which is the condition every one of
   * these states was authored under and none of them declared because there was
   * nothing to declare it to.
   */
  const view = {
    ...fixture,
    updateTarget: fixture.updateTarget
      ? { ...fixture.updateTarget, at: Date.now() }
      : null,
  }

  const deadline = view.window?.updateFirstSeenAt
    ? view.window.updateFirstSeenAt + AUTO_AFTER_MS
    : null

  return (
    <AppShell
      active="/maintenance"
      user={DEMO_USER}
      badges={{
        maintenance:
          view.window?.state === 'draining'
            ? 'draining'
            : view.window?.state === 'deploying'
              ? 'updating'
              : view.window?.state === 'scheduled'
                ? 'scheduled'
                : null,
      }}
      feed={{ lastPushAt: NOW - 1_200, bootEpoch: 'preview', now: NOW }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Maintenance
            </h1>
            <p className="text-sm text-muted-foreground">
              Take the server down gently: stop new players joining, let the
              running matches finish, then deploy the latest code and restart.
            </p>
          </div>
        </div>

        <nav className="mb-5 flex flex-wrap gap-0.5 rounded-lg border border-border bg-card/60 p-1">
          {Object.keys(views).map((k) => (
            <a
              key={k}
              href={`/preview/maintenance?state=${k}`}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
                k === key
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k}
            </a>
          ))}
        </nav>

        <MaintenancePanel
          initial={view.window}
          initialPlayers={view.players}
          canRun
          initialDeployedRef={view.deployedRef}
          initialRefUpdate={view.refUpdate}
          initialBehindMain={view.behindMain}
          initialUpdateTarget={view.updateTarget}
          initialRunningSha={view.runningSha}
          frozen
        />

        {/*
          THE FOOTER STATES BOTH DISTANCES SEPARATELY, because the whole failure
          mode this harness is here to catch is the two being read as one. If
          the card above ever shows a count that matches neither line here, that
          is the bug.
        */}
        {/*
          THE FOOTER STATES ALL THREE READINGS SEPARATELY, and "(not known)" is
          now spelled out for the main one as well. The failure this harness
          catches is two different distances being read as one; the failure #26
          fixed is a third state — not yet measured — being read as zero. Both
          are invisible unless the underlying values are printed as they are, so
          `(not known)` and `0` appear here as different strings and never as the
          same one.
        */}
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground/60">
          Design harness — fixtures only, nothing is read from a game host and
          the panel does not poll. Deployed ref{' '}
          <code className="font-mono">{view.deployedRef ?? '(not reported)'}</code>
          , behind main {view.behindMain ?? '(not known)'}, behind its own branch{' '}
          {view.refUpdate
            ? `${view.refUpdate.behind} (${view.refUpdate.ref})${
                view.refUpdate.stale ? ', from stale refs — read as not known' : ''
              }${view.refUpdate.eligible ? '' : ', which the host refuses to deploy'}`
            : '(not known)'}
          , moving{' '}
          {view.updateTarget
            ? `${view.updateTarget.fromSha.slice(0, 8)} → ${view.updateTarget.toSha.slice(0, 8)} on ${view.updateTarget.ref}${
                view.updateTarget.stale ? ', from stale refs' : ''
              }`
            : '(not known)'}
          {/*
            THE LIVE COMMIT AND THE RECORDED ONE, SIDE BY SIDE AND NEVER MERGED.
            They are two different facts — what the box is on now, and what one
            past deploy was observed to land on — and the bug this harness
            rehearses is the second being rendered where a reader was asking the
            first. Printed apart here so `parked-landed` can be checked at a
            glance: the card above must show the running one.
          */}
          , running{' '}
          {view.runningSha ? view.runningSha.slice(0, 8) : '(not known)'},
          recorded landing{' '}
          {view.window?.deployLandedSha
            ? view.window.deployLandedSha.slice(0, 8)
            : '(not recorded)'}
          {deadline ? ', automatic deadline set' : ', no automatic deadline'}.
          Not reachable in production.
        </p>
      </div>
    </AppShell>
  )
}
