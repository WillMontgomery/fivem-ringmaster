import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { MatchView } from '@/components/MatchView'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { ledgerFrom, type MatchLedger } from '@/lib/matchLedger'

/**
 * The match page, without a game server, a session or AWS credentials.
 * DEVELOPMENT ONLY.
 *
 * ═══ WHY IT EXISTS, WHICH IS THE SAME REASON THE OTHER HARNESSES DO ═══
 *
 * Every interesting state on this page is an ABSENCE, and an absence is precisely
 * what `tsc` and `next build` are both perfectly happy with. A page that renders
 * `0` where it should render an em dash compiles, deploys and reads as a fact:
 * #51's "a zero is a claim" is a rendering bug that no type can catch. The only
 * way to know what a cell says is to look at it, and looking at it otherwise
 * requires a live session, live credentials, and a match played on each side of
 * the `03cce2d` boundary — the second of which cannot be arranged at all, because
 * nothing backfills.
 *
 * FOUR AXES, because they are independent in life:
 *
 *   ?state=modern    a squad match recorded since #293 — squads, spend, start
 *   ?state=legacy    the same match as written BEFORE #293: no spend, no squad
 *                    grouping, no start time, and every one of them an em dash
 *   ?state=solo      a solo match, which has no downs or revives columns at all
 *   ?state=nowinner  the storm took the last squad standing: somebody placed
 *                    first and nobody won, which is why `won` is stored rather
 *                    than derived from `placement === 1`
 *
 * THE LEDGERS ARE BUILT THROUGH `ledgerFrom`, not hand-written. The fixture is
 * the ROW shape br_ddb writes, and the real assembly turns it into the real
 * ledger — so if the reader's absent/zero logic drifts, this page drifts with it
 * instead of masking it. Same discipline as `/preview` parsing its snapshot
 * through the live ingest schema.
 *
 * THE 404 IN PRODUCTION IS NOT DECORATION. This route renders admin chrome with
 * no auth at all, so it must not exist on a deployed box. The check is on
 * NODE_ENV, which Next inlines at build time, so the branch is eliminated from
 * the production bundle rather than merely unreachable.
 */
export default function PreviewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const ID = 0xd93aa
const ENDED = 1_757_700_000_000
const STARTED = ENDED - 18 * 60_000

const NAMES: Record<string, string> = {
  'license:11000010000101': 'Vex',
  'license:11000010000102': 'Ordnance',
  'license:11000010000103': 'kettle',
  'license:11000010000104': 'Bramble_',
  'license:11000010000105': 'nightjar',
  'license:11000010000106': 'Sable',
  // DELIBERATELY ABSENT FROM THE REGISTRY, so one row on the page renders a bare
  // license. That is the honest fallback for a player who predates the snapshot
  // feed, and it has to be looked at: a license in a name column is wide, and
  // this is the harness that shows whether it wrecks the layout.
  // 'license:11000010000107': never seen
}

/** One participant row, as br_ddb writes it TODAY. */
function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    matchId: ID,
    endedAt: ENDED,
    startedAt: STARTED,
    mode: 'squad',
    total: 24,
    downs: 1,
    revives: 0,
    survivedMs: 12 * 60_000,
    xpEarned: 210,
    voltsEarned: 180,
    voltsSpent: 0,
    won: false,
    ...over,
  }
}

const MODERN_ROWS: Record<string, unknown>[] = [
  row({ pk: 'license:11000010000101', squadId: 'md93aasq1', placement: 1, kills: 6, damage: 1412, survivedMs: 17 * 60_000, xpEarned: 640, voltsEarned: 420, voltsSpent: 250, won: true, revives: 2 }),
  row({ pk: 'license:11000010000102', squadId: 'md93aasq1', placement: 1, kills: 3, damage: 806, survivedMs: 17 * 60_000, xpEarned: 510, voltsEarned: 380, voltsSpent: 0, won: true, revives: 1 }),
  row({ pk: 'license:11000010000103', squadId: 'md93aasq2', placement: 3, kills: 9, damage: 2380, survivedMs: 15 * 60_000, xpEarned: 470, voltsEarned: 310, voltsSpent: 1_140 }),
  row({ pk: 'license:11000010000104', squadId: 'md93aasq2', placement: 3, kills: 1, damage: 240, survivedMs: 11 * 60_000, xpEarned: 180, voltsEarned: 120, voltsSpent: 60 }),
  row({ pk: 'license:11000010000105', squadId: 'md93aasq5', placement: 7, kills: 2, damage: 517, survivedMs: 8 * 60_000, xpEarned: 140, voltsEarned: 90, voltsSpent: 0 }),
  // A two-digit squad index, because the format is not one character and the
  // colour ramp wraps at eight.
  row({ pk: 'license:11000010000106', squadId: 'md93aasq12', placement: 9, kills: 0, damage: 61, survivedMs: 90_000, xpEarned: 40, voltsEarned: 20, voltsSpent: 0 }),
  // No squad id at all on an otherwise modern row, and no registry entry either.
  row({ pk: 'license:11000010000107', squadId: '', placement: 11, kills: 0, damage: 0, survivedMs: 40_000, xpEarned: 10, voltsEarned: 0, voltsSpent: 0 }),
]

/** The same match, as br_ddb wrote one before `03cce2d`. */
const LEGACY_ROWS = MODERN_ROWS.map((r) => {
  const copy = { ...r }
  delete copy.startedAt
  delete copy.squadId
  delete copy.voltsSpent
  return copy
})

const SOLO_ROWS = MODERN_ROWS.slice(0, 5).map((r, i) => ({
  ...r,
  mode: 'solo',
  squadId: '',
  placement: i + 1,
  won: i === 0,
}))

/**
 * NOBODY WON. Every `won` is false and somebody still placed first — the storm
 * took the last squad standing, which is the case #133 and `wonMatch` exist for
 * and the one a page that derived the winner from `placement === 1` would get
 * wrong while looking completely reasonable.
 */
const NO_WINNER_ROWS = MODERN_ROWS.map((r) => ({ ...r, won: false }))

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams

  const rows =
    state === 'legacy'
      ? LEGACY_ROWS
      : state === 'solo'
        ? SOLO_ROWS
        : state === 'nowinner'
          ? NO_WINNER_ROWS
          : MODERN_ROWS

  const ledger: MatchLedger = ledgerFrom(ID, rows, new Map(Object.entries(NAMES)))!

  return (
    <AppShell
      active="/"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{
        lastPushAt: Date.now() - 1_200,
        bootEpoch: 'preview',
        now: Date.now(),
        // FALSE, so a fixture page does not fetch real state over the top of
        // itself. Same as every other harness in this directory.
        live: false,
      }}
    >
      <MatchView ledger={ledger} />
    </AppShell>
  )
}
