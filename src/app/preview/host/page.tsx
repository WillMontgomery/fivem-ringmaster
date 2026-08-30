import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { HostBoard } from '@/components/HostBoard'
import {
  HOST_DDB,
  HOST_DISPATCH,
  HOST_STATUS,
  HOST_WINDOWS,
} from '@/lib/__fixtures__/hostSamples'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { cn } from '@/lib/utils'
import type { hostView } from '@/lib/telemetry'

/**
 * The Host page, without a game server. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS, and it is the same argument /preview/anticheat makes: the
 * states this page has to get right are the ones you cannot summon. Seeing the
 * empty chart meant catching a console in the fifteen seconds before its first
 * sample; seeing the one-sample case meant catching it in the fifteen after.
 * Both are states an operator hits every single time they open the page on a
 * cold console, and neither was reviewable, which is exactly how an area chart
 * comes to draw a flat line at zero over a host nobody has heard from.
 *
 * ═══ IT RENDERS `HostBoard` NOW, NOT `HostCharts` ═══
 *
 * IT USED TO FEED THE CHARTS DIRECTLY AND SKIP THE BOARD, on two reasons. One
 * was mechanical: the board owns a five-second poll against /api/host, which is
 * session-guarded and 401s here forever. The other was a judgement — "the
 * charts are what is under review and the status cards above them are not".
 *
 * THE JUDGEMENT WAS WRONG AND IT COST TWO ROUND TRIPS WITH THE OWNER. The cards
 * shipped a Processor card printing a core count — a static fact of the machine
 * — on a row of live readings, and a commit chip still reading "update on dev"
 * a fortnight after the owner asked for "Update available", because the fix
 * landed in `UpdateBadge` and nobody knew this page held a second copy of the
 * string. Neither is subtle. Both were invisible, because the only way to reach
 * that markup was a signed-in session against a real game box.
 *
 * THE 401 IS A NON-EVENT, which is the part the old note over-weighted.
 * `HostBoard`'s poll already ignores any response that is not ok and holds the
 * last view — that is how it survives an unreachable box — so the fixture below
 * simply stays on screen. The header's `UpdateBadge` has been polling the same
 * endpoint from this very page all along.
 *
 * TWO AXES, because the cards and the charts read different halves of the view:
 *   `?state=`   the sample window — see HOST_WINDOWS.
 *   `?status=`  the process and commit readings — see HOST_STATUS.
 *
 * NO `max-w` WRAPPER, deliberately, unlike its neighbours. `/host` has none, so
 * a harness that adds one reviews the card grid at a width the real page never
 * has — and the card grid is the thing that keeps going wrong.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewHostPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string
    status?: string
    ddb?: string
    dispatch?: string
  }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string
    status?: string
    ddb?: string
    dispatch?: string
  }>
}) {
  const { state, status, ddb, dispatch } = await searchParams
  const window = state && state in HOST_WINDOWS ? state : 'full'
  const reading = status && status in HOST_STATUS ? status : 'behind'
  const fixture = HOST_STATUS[reading]!

  /**
   * THE THIRD AXIS, AND IT DRIVES THE CHROME AS WELL AS THE CARDS.
   *
   * `silent` is the default because it is the state a real console is in until
   * the game-side half of this lands — two em-dashes and no alarm — so the
   * harness opens on the truth rather than on a rehearsal.
   *
   * The same fixture goes to `HostBoard` (the two quiet cards) and to
   * `AppShell` (the chip, the banner and the popup), because those surfaces are
   * two halves of one feature and reviewing them apart is how a red card ends
   * up beside a calm header.
   */
  const ddbKey = ddb && ddb in HOST_DDB ? ddb : 'silent'
  const ddbFixture = HOST_DDB[ddbKey]!

  /**
   * THE FOURTH AXIS, AND `ok` IS ITS DEFAULT WHERE THE br_ddb ONE DEFAULTS TO
   * SILENCE.
   *
   * The two defaults differ because the two cold states differ. A real console
   * has never been told anything about br_ddb, so `silent` IS its truth. The
   * SSH channel, by contrast, is the thing every other reading on this page
   * arrived over — if the harness is showing samples and a commit, the channel
   * worked, and opening on a red one would put the page in a state that
   * contradicts the rest of the fixture around it.
   *
   * IT SEEDS `AppShell` AS WELL AS `HostBoard`, like `ddb`, so the chip and the
   * strip are reviewed in the same frame as the card. Reviewing the card alone
   * is how a red card ends up under a calm header.
   *
   * THE PAIR WORTH OPENING IS `?ddb=healthy&dispatch=key-unreadable`: a green
   * DynamoDB card beside a dead channel. That combination is what actually
   * happened, and it is what made the outage take an hour.
   */
  const dispatchKey = dispatch && dispatch in HOST_DISPATCH ? dispatch : 'ok'
  const dispatchFixture = HOST_DISPATCH[dispatchKey]!

  const initial: ReturnType<typeof hostView> = {
    /**
     * THE ONE AXIS VALUE THAT MOVES THIS FLAG, so the harness shows what the
     * real console shows.
     *
     * `unconfigured` is the only dispatch state that does NOT reach the card:
     * `HostBoard` returns the whole-page "not configured yet" panel first. With
     * this hardcoded `true` the harness rendered that key as a card reading
     * `Not configured` — a shape the app cannot produce — and the panel, which
     * is the real surface and now carries the two variable names the owner
     * asked for, was not reviewable anywhere at all.
     *
     * THAT IS THE SAME DEFECT THE FIXTURES EXIST TO PREVENT, one level up: a
     * harness that reviews a state the app never renders is worse than no
     * harness, because it is believed. The card's own fallback loses its
     * preview and keeps its reason — `DISPATCH_LABEL` is a total map over
     * `Dispatch` — which is the cheaper of the two losses.
     */
    configured: dispatchKey !== 'unconfigured',
    status: fixture.status,
    // An age is a fact about a reading. There is no reading in the `none` case,
    // so there is nothing for the footer to have measured.
    statusAgeMs: fixture.status ? 3_000 : null,
    samples: HOST_WINDOWS[window]!,
    lastError: dispatchFixture.lastError,
    dispatch: dispatchFixture.dispatch,
    refUpdate: fixture.refUpdate,
    updateTarget: null,
    ddb: ddbFixture.ddb,
    bundle: ddbFixture.bundle,
  }

  return (
    <AppShell
      active="/host"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: Date.now() - 1_200, bootEpoch: null, now: Date.now() }}
      ddb={{ ...ddbFixture.ddb, bundle: ddbFixture.bundle }}
      dispatch={dispatchFixture}
    >
      <div>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Host</h1>

          <div className="flex flex-wrap gap-2">
            <Picker
              param="status"
              keys={Object.keys(HOST_STATUS)}
              active={reading}
              other={`state=${window}&ddb=${ddbKey}&dispatch=${dispatchKey}`}
            />
            <Picker
              param="state"
              keys={Object.keys(HOST_WINDOWS)}
              active={window}
              other={`status=${reading}&ddb=${ddbKey}&dispatch=${dispatchKey}`}
            />
            <Picker
              param="ddb"
              keys={Object.keys(HOST_DDB)}
              active={ddbKey}
              other={`status=${reading}&state=${window}&dispatch=${dispatchKey}`}
            />
            <Picker
              param="dispatch"
              keys={Object.keys(HOST_DISPATCH)}
              active={dispatchKey}
              other={`status=${reading}&state=${window}&ddb=${ddbKey}`}
            />
          </div>
        </div>

        <HostBoard initial={initial} />
      </div>
    </AppShell>
  )
}

/** One row of fixture keys. Each link carries the other axis unchanged. */
function Picker({
  param,
  keys,
  active,
  other,
}: {
  param: string
  keys: string[]
  active: string
  other: string
}) {
  return (
    <nav className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-card/60 p-1">
      {keys.map((k) => (
        <a
          key={k}
          href={`/preview/host?${other}&${param}=${k}`}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
            k === active
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {k}
        </a>
      ))}
    </nav>
  )
}
