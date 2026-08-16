import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { ProfileView } from '@/components/ProfileView'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import type { Profile, ProfileMatch } from '@/lib/profile'
import { cn } from '@/lib/utils'

/**
 * The profile page's match history, without a game server. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS. Match history (#153) has four states and three of them are
 * absences — and an absence is exactly the kind of thing that ships wrong
 * behind a green build, because `tsc` and `next build` are both perfectly happy
 * with markup that renders as literal text. The last one of those cost a
 * visible `$<LocalTime ms={x} />` on a production page. The only way to know
 * what a panel says is to read it, and reading it required playing a match on a
 * live server against a live table.
 *
 * `?state=` picks the case:
 *   played      matches recorded — the normal view, including a storm finish
 *   legacy      career totals but no per-match rows: everything they played
 *               happened before this feature existed. THE STATE THAT MATTERS,
 *               because it will be every existing player for months and must
 *               not read as "never played"
 *   never       no game row at all
 *   unreadable  the query failed, which is a third thing again
 *
 * THE FIXTURE LIVES HERE, NOT IN lib/. src/lib/profile.ts deleted its
 * demoProfile() on the grounds that a fixture producing a plausible Profile is
 * a loaded gun in a repo where the thing being faked is a record a moderator
 * acts on — and it is right. Keeping this one inside src/app/preview means it
 * is importable only by a route that 404s in production and is eliminated from
 * the production bundle, rather than sitting in lib/ where any page could reach
 * for it. The name and license below are also transparently synthetic, so a
 * screenshot of this page cannot be mistaken for a real person's record.
 *
 * The 404 in production is not decoration: this renders admin chrome with no
 * auth. The check is on NODE_ENV, which Next inlines at build time.
 */
export default function PreviewProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const HOUR = 3_600_000
const BASE = Date.UTC(2026, 7, 15, 20, 0, 0)

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

function fixture(
  matches: Profile['matches'],
  stats: Profile['stats'],
): Profile {
  return {
    license: 'license:preview000000000000000000000000000',
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
      ? { level: 14, xp: 41_200, balance: 3_180, owned: 6, equipped: { chute: 'chute_ember' } }
      : null,
    live: null,
    incidents: [],
    reportsFiled: [],
    bans: [],
    actions: [],
    matches,
  }
}

const views = {
  // The normal view.
  played: fixture(MATCHES, STATS),
  // THE ONE WORTH LOOKING AT HARDEST. Career totals, no per-match rows.
  legacy: fixture([], STATS),
  // Nobody has ever recorded a match for this license.
  never: fixture([], null),
  // The query failed. Not the same as either of the two above.
  unreadable: fixture(null, STATS),
} satisfies Record<string, Profile>

type ViewKey = keyof typeof views

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const key: ViewKey = state && state in views ? (state as ViewKey) : 'played'
  const p = views[key]
  const now = BASE + 5 * 60_000

  return (
    <AppShell
      active="/"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: now - 1_200, bootEpoch: 'preview', now }}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <nav className="flex gap-0.5 rounded-lg border border-border bg-card/60 p-1">
          {Object.keys(views).map((k) => (
            <a
              key={k}
              href={`/preview/profile?state=${k}`}
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

        <ProfileView p={p} now={now} />
      </div>
    </AppShell>
  )
}
