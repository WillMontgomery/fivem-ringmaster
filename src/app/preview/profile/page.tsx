import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { PlayerActions } from '@/components/PlayerActions'
import { ProfileView } from '@/components/ProfileView'
import type { Ban } from '@/lib/bans'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { CATEGORY_LABEL } from '@/lib/incidents'
import type { Profile, ProfileIncident, ProfileMatch } from '@/lib/profile'
import { cn } from '@/lib/utils'
import { thresholdFor } from '@/lib/xp'

/**
 * The profile page, without a game server or a session. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS. Almost everything interesting on this page is a state you
 * cannot reach by looking at it: match history (#153) has four states and three
 * of them are absences, the incidents table has an empty tab and a page
 * boundary, and the moderation buttons change shape depending on a grant. All
 * of those ship wrong behind a green build, because `tsc` and `next build` are
 * both perfectly happy with markup that renders as literal text — the last one
 * cost a visible `$<LocalTime ms={x} />` on a production page. The only way to
 * know what a panel says is to read it, and reading it otherwise requires a
 * live session, live AWS credentials and a played match.
 *
 * THAT IS ALSO HOW #22 ITEM 11 SURVIVED. "xp this level" truncated to
 * "2,707 / 2,8…" for most players at most levels, and nobody could see it
 * without a real game row. The `xp` axis below pins both the value from the
 * issue and the widest string the curve can ever produce, so the fix stays
 * checkable.
 *
 * FOUR INDEPENDENT AXES, because they are independent in life:
 *
 *   ?state=      match history — played / legacy / never / unreadable
 *   ?incidents=  0, 1, 10 and 23 rows, for the tabs and the page boundary
 *   ?xp=         the reported truncation value, and the curve's worst case
 *   ?mod=        the top bar's moderation buttons, in each of their shapes
 *
 * THE FIXTURE LIVES HERE, NOT IN lib/. src/lib/profile.ts deleted its
 * demoProfile() on the grounds that a fixture producing a plausible Profile is
 * a loaded gun in a repo where the thing being faked is a record a moderator
 * acts on — and it is right. Keeping this one inside src/app/preview means it
 * is importable only by a route that 404s in production and is eliminated from
 * the production bundle, rather than sitting in lib/ where any page could reach
 * for it. The names and licenses below are transparently synthetic, so a
 * screenshot of this page cannot be mistaken for a real person's record.
 *
 * THE BUTTONS RENDER BUT DO NOT WORK. PlayerActions posts to real endpoints;
 * here there is no session behind them, so the dialogs open and the requests
 * fail. This harness is for reading the page, not for exercising it.
 *
 * The 404 in production is not decoration: this renders admin chrome with no
 * auth. The check is on NODE_ENV, which Next inlines at build time.
 */
export default function PreviewProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const HOUR = 3_600_000
const BASE = Date.UTC(2026, 7, 15, 20, 0, 0)

const LICENSE = 'license:preview000000000000000000000000000'

/**
 * Shaped like what the game actually writes, including the two rows that exist
 * to be looked at:
 *
 *   the WIN            placement 1, `won` true — the gold badge
 *   the STORM FINISH   placement 1, `won` false — #133's case, which must NOT
 *                      render as a win however much it looks like one
 */
const MATCHES: ProfileMatch[] = [
  {
    matchId: 412,
    endedAt: BASE,
    mode: 'squad',
    placement: 1,
    total: 48,
    kills: 7,
    downs: 4,
    revives: 2,
    damage: 1642,
    survivedMs: 18 * 60_000 + 12_000,
    xpEarned: 1240,
    voltsEarned: 310,
    won: true,
  },
  {
    matchId: 411,
    endedAt: BASE - 1 * HOUR,
    mode: 'squad',
    placement: 1,
    total: 44,
    kills: 3,
    downs: 2,
    revives: 1,
    damage: 908,
    survivedMs: 17 * 60_000 + 40_000,
    xpEarned: 690,
    voltsEarned: 120,
    // Placement 1 and dead: the storm took the last squad standing, so nobody
    // won. The badge must stay grey.
    won: false,
  },
  {
    matchId: 409,
    endedAt: BASE - 3 * HOUR,
    mode: 'solo',
    placement: 12,
    total: 41,
    kills: 2,
    downs: 0,
    revives: 0,
    damage: 434,
    survivedMs: 9 * 60_000 + 5_000,
    xpEarned: 285,
    voltsEarned: 44,
    won: false,
  },
  {
    matchId: 404,
    endedAt: BASE - 9 * HOUR,
    mode: 'solo',
    placement: 38,
    total: 40,
    kills: 0,
    downs: 0,
    revives: 0,
    damage: 12,
    survivedMs: 92_000,
    xpEarned: 40,
    voltsEarned: 10,
    won: false,
  },
]

const STATS: NonNullable<Profile['stats']> = {
  matches: 412,
  wins: 21,
  top10s: 96,
  kills: 604,
  deaths: 391,
  downs: 210,
  revives: 88,
  damageDealt: 184_220,
  playtimeMs: 61 * HOUR,
  soloMatches: 190,
  squadMatches: 222,
  lastMatchAt: BASE,
}

/*
 * XP, AS TWO EXACT POINTS ON THE REAL CURVE (#22 item 11).
 *
 * `reported` is the value from the issue: level 5 starts at 6,850 and runs
 * 2,850 XP wide, so 9,557 total XP renders as exactly "2,707 / 2,850" — the
 * string the owner watched truncate to "2,707 / 2,8…".
 *
 * `widest` is the worst the curve can produce anywhere: level 99 is 15,450 XP
 * wide, so one XP short of level 100 renders "15,449 / 15,450", fifteen
 * monospace characters. If the container holds that, it holds everything.
 */
const XP_CASES = {
  reported: { level: 5, xp: thresholdFor(5) + 2_707 },
  widest: { level: 99, xp: thresholdFor(100) - 1 },
} as const

type XpKey = keyof typeof XP_CASES

/*
 * INCIDENTS, IN BOTH DIRECTIONS.
 *
 * The generated rows are reports with a named filer, which is the three-piece
 * title from #22 item 5 — "Reported for Abusive chat" / "by" / "Xeon". The
 * three hand-written ones at the front are the cases the template does NOT
 * cover and which must not regress:
 *
 *   an ANTICHEAT escalation      no filer, category `system`. Falls back to the
 *                                summary as a single link, because "Reported
 *                                for System by —" is three pieces of nonsense.
 *   an IDENTIFIER-REUSE case     same, from a different stream.
 *   a report from a DELETED filer  a name with no license: the third piece is
 *                                plain text rather than a dead link.
 */
const CATEGORIES = [
  'abusive_chat',
  'cheating',
  'griefing',
  'teaming',
  'exploiting',
  'other',
]

const FILERS = [
  { name: 'Xeon', license: 'license:preview111111111111111111111111111' },
  { name: 'Marla', license: 'license:preview222222222222222222222222222' },
  { name: 'Kestrel', license: 'license:preview333333333333333333333333333' },
]

/** Cycle a fixture list. `noUncheckedIndexedAccess` is on, so `%` is not enough. */
function cycle<T>(list: T[], k: number): T {
  const item = list[k % list.length]
  if (item === undefined) throw new Error('empty fixture list')
  return item
}

function reportsAgainst(n: number): ProfileIncident[] {
  const special: ProfileIncident[] = [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'anticheat',
      at: BASE - 2 * HOUR,
      summary: 'Refusal rate escalated — 14 refusals across 3 matches',
      state: 'pending_review',
      category: 'system',
      subjectName: 'Preview Player',
      subjectLicense: LICENSE,
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      kind: 'identifier_reuse',
      at: BASE - 30 * HOUR,
      summary: 'Steam id already bound to a different license',
      state: 'resolved',
      category: 'system',
      subjectName: 'Preview Player',
      subjectLicense: LICENSE,
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000003',
      kind: 'report',
      at: BASE - 50 * HOUR,
      summary: 'Reported for abusive chat',
      state: 'resolved',
      category: 'abusive_chat',
      // A filer we no longer have a license for — the name must render as plain
      // text, not as a link to nowhere.
      reportedBy: 'A player who has since been removed',
      reportedByLicense: null,
      subjectName: 'Preview Player',
      subjectLicense: LICENSE,
    },
  ]

  const rows: ProfileIncident[] = []
  for (let k = 0; k < n; k++) {
    const one = special[k]
    if (one && n > 3) {
      rows.push(one)
      continue
    }
    const filer = cycle(FILERS, k)
    const category = cycle(CATEGORIES, k)
    rows.push({
      id: `bbbbbbbb-0000-4000-8000-${String(k).padStart(12, '0')}`,
      kind: 'report',
      at: BASE - (k + 4) * HOUR,
      summary: `Reported for ${category}`,
      state: k % 3 === 0 ? 'pending_review' : 'resolved',
      category,
      reportedBy: filer.name,
      reportedByLicense: filer.license,
      subjectName: 'Preview Player',
      subjectLicense: LICENSE,
    })
  }
  return rows.slice(0, n)
}

/** Reports this player filed about other people. The other tab. */
function reportsFiledBy(n: number): ProfileIncident[] {
  const targets = [
    { name: 'Vance', license: 'license:preview444444444444444444444444444' },
    { name: 'Odile', license: 'license:preview555555555555555555555555555' },
  ]
  return Array.from({ length: n }, (_, k): ProfileIncident => {
    const target = cycle(targets, k)
    const category = cycle(CATEGORIES, k)
    return {
      id: `cccccccc-0000-4000-8000-${String(k).padStart(12, '0')}`,
      kind: 'report',
      at: BASE - (k + 1) * 2 * HOUR,
      summary: `Reported for ${category}`,
      state: k % 4 === 0 ? 'pending_review' : 'resolved',
      category,
      reportedBy: 'Preview Player',
      reportedByLicense: LICENSE,
      subjectName: target.name,
      subjectLicense: target.license,
    }
  })
}

/*
 * INCIDENT COUNTS: the two tabs at 0, 1, 10 and 11+ rows.
 *
 * TEN AND ELEVEN ARE THE INTERESTING PAIR. Ten is exactly one full page, where
 * the pagination control must NOT appear; eleven is the first row that makes a
 * second page exist. `many` uses 23 so there is a third page and a short last
 * one. The two tabs deliberately never hold the same number, so a tab switch
 * that forgot to reset the page is visible rather than lucky.
 */
const INCIDENT_CASES = {
  none: { against: 0, filed: 0 },
  one: { against: 1, filed: 0 },
  ten: { against: 10, filed: 1 },
  eleven: { against: 11, filed: 10 },
  many: { against: 23, filed: 11 },
} as const

type IncidentKey = keyof typeof INCIDENT_CASES

/*
 * THE MODERATION BUTTONS, IN EVERY SHAPE THEY TAKE (#22 items 1 and 2).
 *
 * The help text that used to explain these is gone, so what each button says on
 * hover is now the only explanation there is — which makes all four of these
 * worth looking at rather than one.
 */
const ACTIVE_BAN: Ban = {
  license: LICENSE,
  at: BASE - 200 * HOUR,
  by: 'license:previewadmin00000000000000000000000',
  byName: 'Preview Admin',
  reason: 'Aimbot, confirmed on capture',
  expiresAt: null,
  playerName: 'Preview Player',
}

const MOD_CASES = {
  online: { online: true, canBan: true, ban: null },
  offline: { online: false, canBan: true, ban: null },
  banned: { online: false, canBan: true, ban: ACTIVE_BAN },
  noscope: { online: true, canBan: false, ban: null },
} as const

type ModKey = keyof typeof MOD_CASES

function fixture(
  matches: Profile['matches'],
  stats: Profile['stats'],
  xp: XpKey,
  incidents: IncidentKey,
  mod: ModKey,
): Profile {
  const counts = INCIDENT_CASES[incidents]
  return {
    license: LICENSE,
    name: 'Preview Player',
    avatarUrl: null,
    identifiers: [
      { kind: 'license', value: 'preview000000000000000000000000000', firstSeen: BASE - 400 * HOUR },
    ],
    names: [{ name: 'Preview Player', firstSeen: BASE - 400 * HOUR, lastSeen: BASE }],
    firstSeen: BASE - 400 * HOUR,
    lastSeen: BASE,
    connected: stats ? { sessions: 74, playtimeMs: 96 * HOUR } : null,
    stats,
    progress: stats
      ? { ...XP_CASES[xp], balance: 3_180, owned: 6 }
      : null,
    // The live block only decides in-match detail; the "ONLINE NOW" chip and
    // the kick button both read the same fact, so they move together.
    live: MOD_CASES[mod].online
      ? { src: 12, state: 'in_match', matchId: 412, squadId: 3, hp: 100, inventory: [] }
      : null,
    incidents: reportsAgainst(counts.against),
    reportsFiled: reportsFiledBy(counts.filed),
    bans: [],
    /*
     * KICKS AND BANS, INCLUDING THE ROW THAT MUST NOT APPEAR (#22 item 6).
     *
     * `incident.resolve` targets the incident's SUBJECT, so every closure of
     * every report about this player landed in this list next to real kicks and
     * real bans, reading as the raw id "incident.resolve". Both of those are
     * fixed — the row is filtered out, and the label exists so the id can never
     * render bare. It is kept in this fixture precisely so a regression shows
     * up as an extra row rather than as nothing.
     */
    actions: [
      {
        at: BASE - 4 * HOUR,
        action: 'incident.resolve',
        outcome: 'ok',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Watched a match, looked fine — no action',
      },
      {
        at: BASE - 26 * HOUR,
        action: 'player.kick',
        outcome: 'ok',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Abusive in voice',
      },
      {
        at: BASE - 80 * HOUR,
        action: 'player.kick',
        outcome: 'failed',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Griefing',
      },
      {
        at: BASE - 200 * HOUR,
        action: 'ban.issue',
        outcome: 'ok',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Aimbot, confirmed on capture',
      },
    ],
    matches,
  }
}

const MATCH_CASES = {
  // The normal view.
  played: { matches: MATCHES, stats: STATS },
  // THE ONE WORTH LOOKING AT HARDEST. Career totals, no per-match rows.
  legacy: { matches: [], stats: STATS },
  // Nobody has ever recorded a match for this license.
  never: { matches: [], stats: null },
  // The query failed. Not the same as either of the two above.
  unreadable: { matches: null, stats: STATS },
} satisfies Record<string, { matches: Profile['matches']; stats: Profile['stats'] }>

type MatchKey = keyof typeof MATCH_CASES

/** One row of preview toggles. Keeps the other axes where they are. */
function Axis({
  name,
  keys,
  current,
  params,
}: {
  name: string
  keys: readonly string[]
  current: string
  params: Record<string, string>
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
        {name}
      </span>
      {keys.map((k) => (
        <a
          key={k}
          href={`/preview/profile?${new URLSearchParams({ ...params, [name]: k })}`}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
            k === current
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {k}
        </a>
      ))}
    </div>
  )
}

function pick<T extends string>(
  raw: string | string[] | undefined,
  options: Record<T, unknown>,
  fallback: T,
): T {
  return typeof raw === 'string' && raw in options ? (raw as T) : fallback
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const state = pick(sp.state, MATCH_CASES, 'played' as MatchKey)
  const incidents = pick(sp.incidents, INCIDENT_CASES, 'many' as IncidentKey)
  const xp = pick(sp.xp, XP_CASES, 'reported' as XpKey)
  const mod = pick(sp.mod, MOD_CASES, 'online' as ModKey)

  const params = { state, incidents, xp, mod }
  const { matches, stats } = MATCH_CASES[state]
  const p = fixture(matches, stats, xp, incidents, mod)
  const now = BASE + 5 * 60_000

  return (
    <AppShell
      active="/"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: now - 1_200, bootEpoch: 'preview', now }}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <nav className="space-y-1.5 rounded-lg border border-border bg-card/60 p-2">
          <Axis name="state" keys={Object.keys(MATCH_CASES)} current={state} params={params} />
          <Axis
            name="incidents"
            keys={Object.keys(INCIDENT_CASES)}
            current={incidents}
            params={params}
          />
          <Axis name="xp" keys={Object.keys(XP_CASES)} current={xp} params={params} />
          <Axis name="mod" keys={Object.keys(MOD_CASES)} current={mod} params={params} />
        </nav>

        <ProfileView
          p={p}
          now={now}
          banned={MOD_CASES[mod].ban !== null}
          categoryLabel={CATEGORY_LABEL}
          moderation={MOD_CASES[mod]}
        />
      </div>
    </AppShell>
  )
}
