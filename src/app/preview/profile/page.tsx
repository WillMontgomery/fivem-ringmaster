import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import {
  DiscordChromeProvider,
  DiscordChromeStateProvider,
} from '@/components/DiscordChrome'
import { ProfileView } from '@/components/ProfileView'
import { actionsTakenFrom, type ActedRow } from '@/lib/actionsTaken'
import { isActive, type Ban } from '@/lib/bans'
import { accentSurface } from '@/lib/contrast'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { CATEGORY_LABEL, VERDICT_LABEL } from '@/lib/incidents'
import type {
  DiscordChrome,
  DiscordNameChange,
  Profile,
  ProfileIncident,
  ProfileMatch,
} from '@/lib/profile'
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
 * NINE INDEPENDENT AXES, because they are independent in life:
 *
 *   ?state=      match history — played / legacy / never / unreadable
 *   ?incidents=  0, 1, 5, 6 and 43 rows, for the tabs and the page boundary
 *   ?xp=         the reported truncation value, and the curve's worst case
 *   ?mod=        the ban row: the top bar's buttons AND the BANNED chip beside
 *                the name, which read the same row. `banned` is permanent,
 *                `banned-temp` counts down and was issued by `system`, `served`
 *                is a real ban that has run out — no chip at all, which is the
 *                case the owner asked for and the one a harness that only ever
 *                passed `bans: []` could never show. `offline` and
 *                `banned-online` pull the Kick button's two hiding rules apart:
 *                it is drawn only for a player who is present AND not banned,
 *                and each of those cases isolates one half of that
 *   ?names=      the names the "Other names" row is built from: never renamed,
 *                renamed twice, and enough to fill the line
 *   ?discord=    the Discord chrome: absent, loading, timed out, full, the two
 *                accent colours that break a naive implementation, and an
 *                account with no display name
 *   ?admin=      does this account hold the Discord admin role. `yes` is the red
 *                ADMIN chip; `no` must render NOTHING, which is an absence you
 *                can only review by flipping to it. Reaching either for real
 *                needs a bot token, a guild and the right person
 *   ?taken=      the "Actions taken" panel, built by running real audit-shaped
 *                rows through the real `actionsTakenFrom`. `some` contains two
 *                separate double-count traps; see RAW_TAKEN
 *   ?back=       the breadcrumb: the live table, or the incident that sent you
 *                here. Flip it against `?discord=loading`, because the skeleton
 *                draws one too and the two must agree
 *
 * THE DISCORD AXIS IS THE ONE THAT CANNOT BE REACHED ANY OTHER WAY. Every other
 * state on this page needs a live session and an AWS credential; the Discord
 * ones additionally need a bot token, a particular player, and — for the states
 * that matter most — Discord to be slow or broken on demand. `?discord=white`
 * and `?discord=black` are the two accent colours that make an unclamped
 * implementation illegible, and neither of them can be produced by looking at a
 * real profile unless somebody happens to have chosen one.
 *
 * IT IS ALSO THE AXIS THAT NOW MOVES THE WHOLE PAGE. Since the owner asked for
 * "the entire profile page to show shadcn skeletons" while Discord is loading,
 * `?discord=` is no longer a switch on three elements — it chooses between the
 * full-page skeleton and the full page. The three cases that matter for that:
 *
 *   ?discord=loading   the skeleton, held still, so it can be read rather than
 *                      glimpsed. Flip between this and `full` to check that
 *                      nothing jumps when the real content lands.
 *   ?discord=slow      four seconds of the real machinery, end to end.
 *   ?discord=none      NO SKELETON AT ALL. The fast path the owner was explicit
 *                      about: no Discord id means nothing is coming, so nothing
 *                      is promised and the page renders at once.
 *
 * The toggle strip is outside `ProfileView`, so it survives the skeleton and you
 * can still switch axes while the page below is grey.
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
 *
 * SIX OF THEM, WHICH IS ONE MORE THAN A PAGE. At ten a page this list never
 * paginated in the harness, so the pagination control on the match panel was
 * unreviewable here — it only appeared on a real profile with a real history.
 * Five a page plus a sixth row makes it appear, with a one-row second page,
 * which is also the shape that catches an off-by-one in the range label.
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
  {
    matchId: 399,
    endedAt: BASE - 27 * HOUR,
    mode: 'squad',
    placement: 6,
    total: 46,
    kills: 4,
    downs: 3,
    revives: 3,
    damage: 1_117,
    survivedMs: 14 * 60_000 + 30_000,
    xpEarned: 520,
    voltsEarned: 78,
    won: false,
  },
  // The sixth row: on its own on page two, where the range label has to read
  // "6–6 of 6" rather than "6–5 of 6".
  {
    matchId: 395,
    endedAt: BASE - 34 * HOUR,
    mode: 'solo',
    placement: 22,
    total: 39,
    kills: 1,
    downs: 1,
    revives: 0,
    damage: 260,
    survivedMs: 6 * 60_000 + 40_000,
    xpEarned: 155,
    voltsEarned: 22,
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

const XEON = 'license:preview111111111111111111111111111'
const MARLA = 'license:preview222222222222222222222222222'
const KESTREL = 'license:preview333333333333333333333333333'
/** The two this player REPORTS, and the two they act on in `RAW_TAKEN`. */
const VANCE = 'license:preview444444444444444444444444444'
const ODILE = 'license:preview555555555555555555555555555'

const FILERS = [
  { name: 'Xeon', license: XEON },
  { name: 'Marla', license: MARLA },
  { name: 'Kestrel', license: KESTREL },
]

/**
 * The verdicts a resolved row can carry, cycled so all of them appear (#28).
 *
 * ALL FOUR SHAPES, NOT THREE. `null` is in this list on purpose and is the one
 * most likely to be got wrong later: a resolved row with no verdict reads
 * "resolved" and nothing more, while every row beside it reads "resolved ·
 * banned" or "resolved · no action". Seeing the two side by side is the only
 * way to notice if the bare one ever starts claiming a decision nobody made.
 *
 * A TEMPORARY BAN AND A PERMANENT ONE LOOK IDENTICAL HERE, and that is correct
 * rather than a gap: the chip says what was done, not for how long. The expiry
 * is on the incident page, which is where a ban's length is read.
 */
const VERDICTS: ProfileIncident['verdict'][] = [
  { action: 'ban', expiresAt: BASE + 7 * 24 * HOUR },
  { action: 'none' },
  { action: 'kick' },
  null,
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
      /*
       * NO VERDICT AT ALL — the case worth staring at (#28). A closure from
       * before the field existed, or one the system resolved itself. Its chip
       * must keep reading the bare word "resolved" and must NEVER narrow to
       * "no action": nobody decided anything, and saying otherwise is the
       * console inventing a decision. Every other row on this page narrows.
       */
      verdict: null,
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
      /* A permanent ban, which is the loudest the chip ever gets. */
      verdict: { action: 'ban', expiresAt: null },
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
    const resolved = k % 3 !== 0
    rows.push({
      id: `bbbbbbbb-0000-4000-8000-${String(k).padStart(12, '0')}`,
      kind: 'report',
      at: BASE - (k + 4) * HOUR,
      summary: `Reported for ${category}`,
      state: resolved ? 'resolved' : 'pending_review',
      // A PENDING ROW CARRIES NO VERDICT, EVER — the real write cannot produce
      // one, so neither may the harness. A fixture that showed a verdict beside
      // "pending review" would be reviewing a row that cannot exist.
      verdict: resolved ? cycle(VERDICTS, k) : null,
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
    { name: 'Vance', license: VANCE },
    { name: 'Odile', license: ODILE },
  ]
  return Array.from({ length: n }, (_, k): ProfileIncident => {
    const target = cycle(targets, k)
    const category = cycle(CATEGORIES, k)
    const resolved = k % 4 !== 0
    return {
      id: `cccccccc-0000-4000-8000-${String(k).padStart(12, '0')}`,
      kind: 'report',
      at: BASE - (k + 1) * 2 * HOUR,
      summary: `Reported for ${category}`,
      state: resolved ? 'resolved' : 'pending_review',
      // The tab where the verdict is the POINT: this is what came of the
      // reports this player filed, which is how a reporter's record becomes
      // readable at all.
      verdict: resolved ? cycle(VERDICTS, k + 1) : null,
      category,
      reportedBy: 'Preview Player',
      reportedByLicense: LICENSE,
      subjectName: target.name,
      subjectLicense: target.license,
    }
  })
}

/*
 * INCIDENT COUNTS: the two tabs at 0, 1, 5, 6 and 43 rows.
 *
 * FIVE AND SIX ARE THE INTERESTING PAIR, and they used to be ten and eleven.
 * The boundary these axes exist to pin is the page size, so when the profile
 * lists went from ten a page to five the old `ten` case stopped being "exactly
 * one full page, no control" and quietly became two pages — the one thing the
 * fixture was there to catch. Five is now the full page where the pagination
 * control must NOT appear; six is the first row that makes a second page.
 *
 * `many` GREW FROM 23 TO 43, because the control it has to exercise grew. The
 * old pager was two words and could not look different at four pages than at
 * forty. The new one draws a numbered button per page and elides the middle
 * with an ellipsis past seven — so 23 rows (five pages) never reaches the
 * elided state, and the moderation log, which reads two hundred audit rows at
 * ten a page, reaches it every time. Forty-three is nine pages: an ellipsis on
 * the right from page one, one on each side in the middle, one on the left at
 * the end, and a short last page of three.
 *
 * The two tabs still deliberately never hold the same number of pages — nine
 * against three — so a tab switch that forgot to reset the page shows up as an
 * impossible page rather than as a lucky-looking one.
 */
const INCIDENT_CASES = {
  none: { against: 0, filed: 0 },
  one: { against: 1, filed: 0 },
  five: { against: 5, filed: 1 },
  six: { against: 6, filed: 5 },
  many: { against: 43, filed: 11 },
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

/**
 * A TEMPORARY BAN, AND A SYSTEM-ISSUED ONE, IN THE SAME FIXTURE.
 *
 * The countdown on the BANNED chip's card has three shapes and only one of them
 * is reachable from `ACTIVE_BAN`: permanent says so and shows no clock, a live
 * expiry counts down, and an expiry already in the past is neither (nothing
 * sweeps this table — `bans.isActive` simply stops counting it). This is the
 * middle one, at four days and change from the preview's `now`.
 *
 * It is issued by `system` on purpose, which is the OTHER branch on that card:
 * `by` is null for a system ban, so the admin renders as plain text rather than
 * as a link to a profile that does not exist. An automatic ban is also the one
 * that realistically has an expiry on it.
 */
const TEMP_BAN: Ban = {
  license: LICENSE,
  at: BASE - 2 * HOUR,
  by: null,
  byName: 'system',
  reason: 'Anticheat: impossible movement across 3 matches',
  expiresAt: BASE + 99 * HOUR,
  playerName: 'Preview Player',
}

/**
 * A BAN THAT IS NO LONGER IN FORCE, WHICH MUST SHOW NO CHIP AT ALL.
 *
 * THE CASE THE OWNER WAS LOOKING AT. The identity bar used to render "1 BAN" for
 * any row in this table, so this player — banned once, served it, in good
 * standing since — wore a red chip beside their name for good. The chip is now
 * driven by `bans.isActive` alone: nothing here, and the ban itself in the
 * Kicks and bans panel below, which is where a history belongs.
 */
const SERVED_BAN: Ban = {
  ...ACTIVE_BAN,
  reason: 'Griefing — 24 hours',
  expiresAt: BASE - 10 * HOUR,
}

/* ---------------------------------------------------------------------------
 * ACTIONS TAKEN — the audit log read the other way round, and the two ways it
 * double-counts.
 *
 * THESE ARE RAW AUDIT ROWS, NOT FINISHED VIEW ROWS, and that is the entire point
 * of the fixture. `actionsTakenFrom` is what decides that a ban issued as an
 * incident verdict is ONE action rather than two, and a fixture that handed the
 * page a pre-collapsed list would review the markup while leaving the rule — the
 * only part that can be wrong — untested. The preview runs the shipped function
 * over rows shaped exactly as `/api/bans`, `/api/kick` and `closeWithVerdict`
 * actually write them.
 *
 * THIRTEEN ROWS, EIGHT OF WHICH SURVIVE. Both traps are in here:
 *
 *   INC_A   ban.issue + incident.resolve, same incidentId, verdict `ban`. The
 *           owner's case, written by /api/bans when it is handed an incident.
 *           ONE row reading "Banned Vance", linked to the incident, and NO
 *           `banned` verdict chip — the label already says it.
 *   Odile   ban.issue + player.kick carrying `becauseOf: 'ban.issue'`. The
 *           SECOND trap, and the one nobody thinks of: banning a connected
 *           player writes an enforcement kick a few milliseconds later. ONE row.
 *   INC_B   player.kick + incident.resolve, verdict `kick`. Same collapse from
 *           the other route. The kick row is `pending` on purpose — /api/kick
 *           deliberately never marks it `ok`.
 *   INC_C   a lone closure with verdict `none`. Survives, with a quiet "No
 *           action" chip: an admin who looked and found nothing did the job.
 *   INC_D   a closure with NO verdict in its detail — a row from before #28. No
 *           chip at all, because nobody recorded a decision and the page must
 *           not invent one.
 *
 * AND THREE ROWS THAT MUST NOT APPEAR AT ALL: a `maintenance.schedule`, a
 * `discord.unresolved`, and the enforcement kick above. Eight rows at five a page
 * also puts the collapse on both sides of a page boundary.
 * ------------------------------------------------------------------------- */

const INC_A = 'dddddddd-0000-4000-8000-00000000000a'
const INC_B = 'dddddddd-0000-4000-8000-00000000000b'
const INC_C = 'dddddddd-0000-4000-8000-00000000000c'
const INC_D = 'dddddddd-0000-4000-8000-00000000000d'

const RAW_TAKEN: ActedRow[] = [
  // ---- INC_A: the owner's case. Two rows, one act. ----
  {
    ts: BASE - 1 * HOUR,
    action: 'ban.issue',
    outcome: 'ok',
    targetLicense: VANCE,
    targetName: 'Vance',
    reason: 'Aimbot, confirmed on capture',
    detail: { expiresAt: null, permanent: true, incidentId: INC_A },
  },
  {
    // Written afterwards by closeWithVerdict, in the same request. Forty
    // milliseconds later, which is why the collapsed row takes the EARLIER
    // instant — the moment the admin acted.
    ts: BASE - 1 * HOUR + 40,
    action: 'incident.resolve',
    outcome: 'ok',
    targetLicense: VANCE,
    targetName: 'Vance',
    reason: 'Aimbot, confirmed on capture',
    detail: { incidentId: INC_A, kind: 'report', verdict: 'ban', expiresAt: null },
  },

  // ---- The enforcement kick: a ban against somebody who was connected. ----
  {
    ts: BASE - 5 * HOUR,
    action: 'ban.issue',
    outcome: 'ok',
    targetLicense: ODILE,
    targetName: 'Odile',
    reason: 'Griefing — 7 days',
    detail: { expiresAt: BASE + 7 * 24 * HOUR, permanent: false },
  },
  {
    ts: BASE - 5 * HOUR + 12,
    action: 'player.kick',
    outcome: 'ok',
    targetLicense: ODILE,
    targetName: 'Odile',
    reason: 'Griefing — 7 days',
    // The tell. Not a second decision — the ban being carried out.
    detail: { becauseOf: 'ban.issue' },
  },

  // ---- INC_B: a kick chosen as a verdict. Two rows, one act. ----
  {
    ts: BASE - 9 * HOUR,
    action: 'player.kick',
    outcome: 'pending',
    targetLicense: XEON,
    targetName: 'Xeon',
    reason: 'Abusive in voice',
    detail: { incidentId: INC_B },
  },
  {
    ts: BASE - 9 * HOUR + 30,
    action: 'incident.resolve',
    outcome: 'ok',
    targetLicense: XEON,
    targetName: 'Xeon',
    reason: 'Abusive in voice',
    detail: { incidentId: INC_B, kind: 'report', verdict: 'kick' },
  },

  // ---- INC_C: closed with no action. A decision, and it counts. ----
  {
    ts: BASE - 20 * HOUR,
    action: 'incident.resolve',
    outcome: 'ok',
    targetLicense: KESTREL,
    targetName: 'Kestrel',
    reason: 'Watched a match, looked fine',
    detail: { incidentId: INC_C, kind: 'report', verdict: 'none' },
  },

  // ---- An ordinary kick, decided on nothing. ----
  {
    ts: BASE - 30 * HOUR,
    action: 'player.kick',
    outcome: 'ok',
    targetLicense: MARLA,
    targetName: 'Marla',
    reason: 'AFK in the bus door',
  },

  // ---- A kick the game host refused. Must say so. ----
  {
    ts: BASE - 44 * HOUR,
    action: 'player.kick',
    outcome: 'failed',
    targetLicense: ODILE,
    targetName: 'Odile',
    reason: 'Spawn camping the lobby',
  },

  // ---- A lift. Not in the owner's three words; see COUNTED for why it is in. ----
  {
    ts: BASE - 60 * HOUR,
    action: 'ban.lift',
    outcome: 'ok',
    targetLicense: ODILE,
    targetName: 'Odile',
    reason: 'Appealed — capture was inconclusive',
  },

  // ---- Two rows that are not moderation of a player. Must NOT render. ----
  {
    ts: BASE - 70 * HOUR,
    action: 'maintenance.schedule',
    outcome: 'ok',
    targetLicense: null,
    targetName: null,
    reason: 'a server update',
  },
  {
    ts: BASE - 71 * HOUR,
    action: 'discord.unresolved',
    outcome: 'ok',
    targetLicense: null,
    targetName: null,
    reason: 'Discord answered 500',
    detail: { scope: 'ban', allowed: true },
  },

  // ---- INC_D: a closure from before verdicts existed. No chip. ----
  {
    ts: BASE - 90 * HOUR,
    action: 'incident.resolve',
    outcome: 'ok',
    targetLicense: XEON,
    targetName: 'Xeon',
    reason: 'Handled at the time',
    detail: { incidentId: INC_D, kind: 'report' },
  },
]

/**
 * The panel's two states, and the empty one is not a degenerate case.
 *
 * With `none` the panel renders ONLY when the ADMIN chip is showing, and shows
 * the house empty state inside it. Flip `?admin=` against `?taken=none` to watch
 * the panel appear and disappear.
 */
const TAKEN_CASES = {
  some: RAW_TAKEN,
  none: [] as ActedRow[],
} satisfies Record<string, ActedRow[]>

type TakenKey = keyof typeof TAKEN_CASES

/**
 * Does this account hold the Discord admin role? Both answers, one click.
 *
 * IT HAD FOUR VALUES AND NOW HAS TWO, because the page does. `unknown` (Discord
 * did not answer) and `unchecked` (no bot token) rendered a quiet ADMIN? chip and
 * nothing respectively; the owner has since ruled that neither renders anything —
 * "Change ADMIN? to just show nothing" — so `admin` collapsed to a boolean and
 * this axis collapsed with it rather than keeping two keys that produce an
 * identical page. A harness that offers a distinction the app cannot make is a
 * harness that teaches the wrong thing.
 *
 * `no` IS STILL WORTH A CLICK. It renders no chip at all, and an absence is
 * exactly the kind of thing that ships broken because nobody looked at it on
 * purpose — the same reason `?mod=served` exists.
 *
 * AND THIS AXIS IS INDEPENDENT OF `?discord=` ON PURPOSE. The role lookup is a
 * SECOND call to a different endpoint and fails separately: `?discord=timeout`
 * with `admin=yes` is the avatar call timing out while the member lookup answers,
 * and the red chip must survive it.
 */
const ADMIN_CASES = {
  yes: true,
  no: false,
} satisfies Record<string, boolean>

type AdminKey = keyof typeof ADMIN_CASES

/**
 * ═══ THE BREADCRUMB, WHICH DEPENDS ON HOW YOU GOT HERE ═══
 *
 * "Clicking on the player's profile in the incident page takes me to the
 * player's profile page - great! But the breadcrumbs there say 'back to live
 * players' and it should instead take me back to the incident" — the owner,
 * playtest.
 *
 * BOTH STATES ARE UNREACHABLE HERE OTHERWISE. On a real console this is decided
 * on the server: the incident page puts `?from=<case>` on its profile links and
 * `/players/[license]` honours it only after checking that the incident named
 * really does link to that profile. Reproducing that needs a live incident, so
 * the harness passes the DECISION — the same `backTo` the real page computes —
 * rather than the parameter, which would be a second implementation of the check
 * this page exists to look at rather than to re-derive.
 *
 *   live      undefined, which is what every other route into a profile gets
 *   incident  what the incident page produces, pointing at a case id
 *
 * WHAT THIS CANNOT SHOW is a `?from=` that is refused — a hand-typed case id
 * that names a real incident with no link to this player. It renders exactly as
 * `live`, which is the design, and the check that makes it so is unit-shaped
 * rather than visual: `linksToProfile` in lib/profileLink.
 */
const BACK_CASES = {
  live: undefined,
  incident: {
    href: '/incidents/aaaaaaaa-0000-4000-8000-000000000001',
    label: 'Back to incident',
  },
} satisfies Record<string, { href: string; label: string } | undefined>

type BackKey = keyof typeof BACK_CASES

const MOD_CASES = {
  online: { online: true, canBan: true, ban: null },
  /**
   * ABSENT, AND THEREFORE NO KICK BUTTON AT ALL.
   *
   * "let's remove the 'kick' button from the profile page if the user is
   * offline" — the owner. THIS CASE USED TO DRAW A DEAD BUTTON with a tooltip
   * saying nobody was there to kick, and it is the fixture that proves the
   * button is now gone rather than greyed. One button in the bar, not two.
   */
  offline: { online: false, canBan: true, ban: null },
  banned: { online: false, canBan: true, ban: ACTIVE_BAN },
  'banned-temp': { online: false, canBan: true, ban: TEMP_BAN },
  /**
   * BANNED AND STILL CONNECTED, and it is the case that keeps the two hiding
   * rules from being confused for one.
   *
   * `kick.shown` is `!banned && online` — TWO reasons the button can be absent,
   * and `banned` and `offline` above each satisfy both at once, so a missing
   * Kick on either proves only that at least one rule fired. This one holds
   * `online` TRUE and bans anyway: the player is kickable in every other
   * respect, so the absence here can only be the ban. Without it, deleting
   * `!banned` from that expression would still look right in the harness.
   *
   * It is a real state and a short-lived one — `/api/bans` kicks a connected
   * player in the same request that bans them, so a profile opened in between,
   * or one whose snapshot is a couple of seconds behind, sits here.
   */
  'banned-online': { online: true, canBan: true, ban: ACTIVE_BAN },
  served: { online: true, canBan: true, ban: SERVED_BAN },
  noscope: { online: true, canBan: false, ban: null },
} as const

type ModKey = keyof typeof MOD_CASES

/* ---------------------------------------------------------------------------
 * DISCORD
 *
 * THE IMAGES ARE INLINE SVG DATA URIs, not CDN links, and that is what makes
 * this harness usable. The skeleton is held until every image has DECODED (see
 * components/DiscordChrome), so a preview that pointed at cdn.discordapp.com
 * would exercise the gate only for whoever happened to have working DNS and no
 * proxy — and would exercise it against a real person's avatar. These load
 * locally, instantly, every time, and belong to nobody.
 *
 * They are deliberately ugly. A screenshot of this page must not be mistakable
 * for a real player's profile.
 * ------------------------------------------------------------------------- */

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const PREVIEW_AVATAR = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
     <rect width="128" height="128" fill="#2f3145"/>
     <circle cx="64" cy="50" r="24" fill="#8b5cf6"/>
     <path d="M16 128c0-28 21-46 48-46s48 18 48 46z" fill="#8b5cf6"/>
     <text x="64" y="120" font-family="monospace" font-size="13" fill="#c4b5fd"
           text-anchor="middle">PREVIEW</text>
   </svg>`,
)

/**
 * Stands in for Discord's generic default avatar.
 *
 * The real one is a CDN URL, and the real page uses it — but pointing this
 * harness at cdn.discordapp.com would make the image gate depend on the
 * network, which is the one thing a preview route must not do. Grey and
 * featureless, like the thing it represents.
 */
const PREVIEW_DEFAULT_AVATAR = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
     <rect width="128" height="128" fill="#5865f2"/>
     <circle cx="64" cy="50" r="22" fill="#ffffff"/>
     <path d="M20 128c0-26 20-42 44-42s44 16 44 42z" fill="#ffffff"/>
   </svg>`,
)

const PREVIEW_BANNER = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240">
     <defs>
       <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#7c3aed"/>
         <stop offset="0.5" stop-color="#0ea5e9"/>
         <stop offset="1" stop-color="#10b981"/>
       </linearGradient>
     </defs>
     <rect width="600" height="240" fill="url(#g)"/>
     <circle cx="140" cy="80" r="90" fill="#f472b6" opacity="0.55"/>
     <circle cx="470" cy="180" r="110" fill="#fbbf24" opacity="0.45"/>
   </svg>`,
)

/**
 * A name history with both fields in it, because they read differently.
 *
 * The @handle change is the rarer and more interesting one; the display-name
 * change is the common one. A profile with both is the only way to see that the
 * `@` prefix is applied to one and not the other.
 */
/*
 * `to` IS AS LOAD-BEARING AS `from` NOW, which it was not when this list was
 * written. The "Other names" row dates the CURRENT display name from the change
 * that ARRIVED at it — the first entry's `to: 'preview~'`, matching `globalName`
 * on the chrome — so the card can read "First seen as preview~ on …". Change one
 * without the other and that name silently loses its card.
 *
 * The `username` row is in here for the same reason it always was: to prove the
 * `@` prefix applies to one field and not the other, and now also that a handle
 * change cannot date a display name (the row filters on `field` first).
 */
const FORMER_NAMES: DiscordNameChange[] = [
  { field: 'globalName', from: 'Slippery Jim', to: 'preview~', at: BASE - 12 * HOUR },
  { field: 'username', from: 'jimbo_prv', to: 'preview_player', at: BASE - 40 * HOUR },
  { field: 'globalName', from: 'jimbo', to: 'Slippery Jim', at: BASE - 300 * HOUR },
  { field: 'globalName', from: 'newbie', to: 'jimbo', at: BASE - 380 * HOUR },
]

/*
 * THE IN-GAME NAME HISTORY, WHICH IS NOT THE DISCORD ONE.
 *
 * `p.names` is Ringmaster's own record of what the GAME called this license, and
 * it has never been near Discord — different stream, different shape, and it
 * survives `?discord=none` intact. It moved out of the Sessions panel and under
 * the in-game name in Identifiers (owner: "what's the 'also known as' doing in
 * the sessions box?"), which is the only reason it needs an axis: the fixture
 * used to carry exactly one name, so the block was UNREACHABLE in this harness
 * and had to be read on a live profile of somebody who happened to have renamed.
 *
 * THREE CASES, AND THE FIRST IS NOT A DEGENERATE ONE. With one name there is no
 * history, so the row does not render at all — the current name is already the
 * `<h1>` and a row repeating it is furniture. That absence is a decision and
 * therefore something to be able to look at.
 *
 *   one      never renamed. NO row in Identifiers.
 *   renamed  two former names, both inline, each with its "until".
 *   many     five, so the third and beyond collapse into "+3 more" — the
 *            overflow path `FormerNames` shares with the two Discord histories,
 *            and which no fixture exercised for game names before.
 */
const GAME_NAMES: Array<{ name: string; firstSeen: number; lastSeen: number }> = [
  { name: 'Preview Player', firstSeen: BASE - 120 * HOUR, lastSeen: BASE },
  { name: 'PreviewPlayer99', firstSeen: BASE - 200 * HOUR, lastSeen: BASE - 120 * HOUR },
  { name: 'xX_Preview_Xx', firstSeen: BASE - 260 * HOUR, lastSeen: BASE - 200 * HOUR },
  { name: 'PrevPlyr', firstSeen: BASE - 320 * HOUR, lastSeen: BASE - 260 * HOUR },
  { name: 'Preview', firstSeen: BASE - 370 * HOUR, lastSeen: BASE - 320 * HOUR },
  { name: 'unnamed_preview', firstSeen: BASE - 400 * HOUR, lastSeen: BASE - 370 * HOUR },
]

const NAME_CASES = {
  one: 1,
  renamed: 3,
  many: 6,
} as const

type NameKey = keyof typeof NAME_CASES

const PREVIEW_DISCORD_ID = '000000000000000001'

function chrome(
  /**
   * THE ADMIN ANSWER TRAVELS WITH THE CHROME, exactly as it does in production:
   * lib/discord.ts resolves the role check alongside the user fetch and puts it
   * on this object, so the chip cannot arrive separately from the face.
   *
   * A REQUIRED PARAMETER RATHER THAN AN OVERRIDE WITH A DEFAULT. A harness that
   * quietly defaulted this would make one of the two answers unreachable by
   * accident, which is the exact way `bans: []` made the ban chip unreviewable
   * here for months.
   */
  admin: boolean,
  overrides: Partial<DiscordChrome> = {},
): DiscordChrome {
  return {
    id: PREVIEW_DISCORD_ID,
    answered: true,
    avatarUrl: PREVIEW_AVATAR,
    real: true,
    bannerUrl: PREVIEW_BANNER,
    accent: accentSurface('#ff11ff'),
    username: 'preview_player',
    globalName: 'preview~',
    formerNames: FORMER_NAMES,
    admin,
    ...overrides,
  }
}

/**
 * A promise the harness can control, standing in for the live Discord call.
 *
 * `null` means "no Discord id" — the state the owner called out specifically:
 * no skeleton, no wait, render immediately. Everything else is a promise,
 * because a promise is what the real page passes.
 */
const DISCORD_CASES = {
  /* No Discord identifier on the registry row. Nothing is coming, so nothing is
     promised: no skeleton anywhere, and the card has no banner strip. */
  none: { label: 'no discord id', make: () => null },

  /*
   * THE WHOLE-PAGE SKELETON, HELD INDEFINITELY, so it can be read rather than
   * glimpsed. Every panel — identity, identifiers, play record, progression,
   * sessions, incidents, kicks and bans, match history — at roughly the shape of
   * the real content. The way to check that shape is to flip between this and
   * `full` and watch for anything that moves.
   *
   * This one does not go through a promise at all — the page pins the context
   * state directly. See the comment at the render for why every attempt to do
   * it with a promise wedges the request rather than the render. `make` is
   * never called for this key.
   */
  loading: { label: 'loading', make: () => null },

  /*
   * THE WAIT ELAPSING, then the reveal. The one case that shows the behaviour
   * the owner asked for end to end: full-page skeleton, images decoded off
   * screen, the entire profile appearing at one instant.
   *
   * FOUR SECONDS, NOT FIVE, so the reveal happens rather than the timeout — five
   * would race DISCORD_TIMEOUT_MS and turn this into a second copy of `timeout`.
   */
  slow: {
    label: 'slow then full',
    make: (admin: boolean) =>
      new Promise<DiscordChrome>((resolve) =>
        setTimeout(() => resolve(chrome(admin)), 4_000),
      ),
  },

  /*
   * DISCORD DID NOT ANSWER — a timeout, a 429, a missing token, all of which
   * land here identically. The stored names still show, marked "(last known)",
   * because they are Ringmaster's own record rather than Discord's.
   */
  timeout: {
    label: 'timed out',
    make: async (admin: boolean) =>
      chrome(admin, {
        answered: false,
        avatarUrl: PREVIEW_DEFAULT_AVATAR,
        real: false,
        bannerUrl: null,
        accent: null,
      }),
  },

  /* The whole thing: real avatar, banner, accent, both names, four renames. */
  full: {
    label: 'full profile',
    make: async (admin: boolean) => chrome(admin),
  },

  /*
   * THE TWO ACCENTS THAT BREAK A NAIVE IMPLEMENTATION.
   *
   * `#ffffff` painted raw is invisible against the light theme's white card and
   * takes its text with it; `#000000` does the same to the dark theme. Both go
   * through accentSurface, which clamps them to #c7c7c7 and #383838 and derives
   * the text colour from what came out — 11.47:1 and 11.06:1 respectively.
   *
   * LOOK AT THESE IN BOTH THEMES. The failure they exist to catch is a surface
   * dissolving into the page, and each of them only dissolves in one of the two.
   */
  white: {
    label: 'accent #ffffff',
    make: async (admin: boolean) =>
      chrome(admin, { accent: accentSurface('#ffffff') }),
  },
  black: {
    label: 'accent #000000',
    make: async (admin: boolean) =>
      chrome(admin, { accent: accentSurface('#000000') }),
  },

  /*
   * No accent and no banner: an ordinary Discord account. The card has a face
   * and a handle and no colour, which is what most players will look like.
   *
   * IT IS ALSO THE NO-BAND CASE, which the avatar has to survive. With neither a
   * banner nor an accent there is no strip across the top of the identity card,
   * so there is nothing for the avatar to straddle and it must NOT be lifted —
   * a lifted circle here hangs off the top of the card. `full` and `plain` are
   * the pair to look at together.
   *
   * AND IT IS THE UNDATED-NAME CASE, which is the third thing it now shows. With
   * no rename history at all, Ringmaster has never watched this player arrive at
   * their current display name — so there is no first sighting to put in "First
   * seen as X on Y", and that name must render as PLAIN TEXT with no card and no
   * dotted underline while the in-game names beside it keep theirs. Compare with
   * `full`, where the same name carries a card. An invented date here is exactly
   * what the owner ruled out.
   */
  plain: {
    label: 'no accent',
    make: async (admin: boolean) =>
      chrome(admin, { accent: null, bannerUrl: null, formerNames: [] }),
  },

  /*
   * AN ACCOUNT WITH NO DISPLAY NAME. Discord allows `global_name` to be cleared,
   * and the client then shows the @handle in its place.
   *
   * WHAT THIS CASE SHOWS HAS CHANGED, and it is the cost of merging the two name
   * rows into "Other names". It used to be the labelled row that reads "not set"
   * — absence rendered as absence. A row that is a LIST OF NAMES cannot say that:
   * with no display name and no Discord renames, the row falls back to whatever
   * IN-GAME names there are, and with `?names=one` beside this it disappears
   * entirely. That absence is the thing to look at here now.
   */
  noname: {
    label: 'no display name',
    make: async (admin: boolean) =>
      chrome(admin, { globalName: null, formerNames: [] }),
  },
} satisfies Record<
  string,
  { label: string; make: (admin: boolean) => Promise<DiscordChrome> | null }
>

type DiscordKey = keyof typeof DISCORD_CASES

function fixture(
  matches: Profile['matches'],
  stats: Profile['stats'],
  xp: XpKey,
  incidents: IncidentKey,
  mod: ModKey,
  discord: DiscordKey,
  names: NameKey,
  taken: TakenKey,
): Profile {
  const counts = INCIDENT_CASES[incidents]
  return {
    license: LICENSE,
    name: 'Preview Player',
    /*
     * THE DISCORD SNOWFLAKE IS A STORED IDENTIFIER AND THE DISPLAY NAME IS NOT,
     * and the identifiers panel now shows both — which is the whole point of the
     * owner's first item. The id is durable and keys the registry row; the name
     * under it is free text the player edits at will. They are only tellable
     * apart here if both are on screen at once, so the fixture carries both.
     *
     * IT TRACKS THE DISCORD AXIS. `?discord=none` means this player has never
     * linked an account, so a `discord` identifier row would contradict the
     * empty chrome sitting beside it.
     */
    identifiers: [
      { kind: 'license', value: 'preview000000000000000000000000000', firstSeen: BASE - 400 * HOUR },
      ...(discord === 'none'
        ? []
        : [
            {
              kind: 'discord',
              value: PREVIEW_DISCORD_ID,
              firstSeen: BASE - 380 * HOUR,
            },
          ]),
      { kind: 'steam', value: '11000010fd4b9b2', firstSeen: BASE - 380 * HOUR },
    ],
    // Newest first — index 0 is the current name and the tail is the history
    // the Identifiers panel renders as "formerly …". See GAME_NAMES.
    names: GAME_NAMES.slice(0, NAME_CASES[names]),
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
    /*
     * THE SAME ROW THE BUTTONS GET, MAPPED THE WAY THE REAL PAGE MAPS IT.
     *
     * This was `bans: []` — a fixture that made the identity bar's ban chip
     * unreviewable here, which is how a chip counting lifted and served bans
     * survived. The chip and the moderation buttons read one row on the real
     * page, so they read one row here too, and `?mod=` moves both together.
     */
    ban: MOD_CASES[mod].ban
      ? {
          at: MOD_CASES[mod].ban.at,
          reason: MOD_CASES[mod].ban.reason,
          by: MOD_CASES[mod].ban.byName,
          byLicense: MOD_CASES[mod].ban.by,
          expiresAt: MOD_CASES[mod].ban.expiresAt,
        }
      : null,
    /*
     * KICKS AND BANS, INCLUDING THE ROW THAT MUST NOT APPEAR (#22 item 6).
     *
     * `incident.resolve` targets the incident's SUBJECT, so every closure of
     * every report about this player landed in this list next to real kicks and
     * real bans, reading as the raw id "incident.resolve". Both of those are
     * fixed — the row is filtered out, and the label exists so the id can never
     * render bare. It is kept in this fixture precisely so a regression shows
     * up as an extra row rather than as nothing.
     *
     * SEVEN ROWS, SIX OF WHICH RENDER — one more than a page, for the same
     * reason match history now has six. It also puts the filtered row on the
     * page boundary: at five a page, "6 of 6" here and "7" anywhere would be
     * the filter having stopped working.
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
      {
        at: BASE - 260 * HOUR,
        action: 'player.kick',
        outcome: 'ok',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Spawn camping the lobby',
      },
      {
        at: BASE - 300 * HOUR,
        action: 'ban.lift',
        outcome: 'ok',
        actorName: 'Preview Admin',
        actorLicense: 'license:previewadmin00000000000000000000000',
        reason: 'Appealed — capture was inconclusive',
      },
      // An actor we have no license for: the name is plain text, not a link to
      // nowhere. Sixth rendered row, so it lands alone on page two.
      {
        at: BASE - 380 * HOUR,
        action: 'player.kick',
        outcome: 'ok',
        actorName: 'An admin who has since been removed',
        actorLicense: null,
        reason: null,
      },
    ],
    /*
     * THE REAL FUNCTION, ON REAL AUDIT SHAPES. This is not a list of finished
     * rows — it is `RAW_TAKEN` put through the same `actionsTakenFrom` the
     * profile route calls, so the collapse the owner asked for ("it shouldn't be
     * counted twice") is exercised here rather than imitated. Thirteen rows in,
     * eight out. See RAW_TAKEN for which five vanish and why.
     */
    actionsTaken: actionsTakenFrom(TAKEN_CASES[taken]),
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
  const discord = pick(sp.discord, DISCORD_CASES, 'full' as DiscordKey)
  const names = pick(sp.names, NAME_CASES, 'renamed' as NameKey)
  const admin = pick(sp.admin, ADMIN_CASES, 'yes' as AdminKey)
  const taken = pick(sp.taken, TAKEN_CASES, 'some' as TakenKey)
  const back = pick(sp.back, BACK_CASES, 'live' as BackKey)

  const params = { state, incidents, xp, mod, discord, names, admin, taken, back }
  const { matches, stats } = MATCH_CASES[state]
  const p = fixture(matches, stats, xp, incidents, mod, discord, names, taken)
  const now = BASE + 5 * 60_000
  const banRow = MOD_CASES[mod].ban

  // Built here and NOT awaited, exactly as the real page builds it — awaiting it
  // would hide the one behaviour half these cases exist to show.
  const chromePromise = DISCORD_CASES[discord].make(ADMIN_CASES[admin])

  const body = (
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
        {/* The in-game rename history, which is what the Identifiers panel's
            "In-game name" row is a history of. Independent of `discord`: these
            names come from the game, not from an account. */}
        <Axis
          name="names"
          keys={Object.keys(NAME_CASES)}
          current={names}
          params={params}
        />
        <Axis
          name="discord"
          keys={Object.keys(DISCORD_CASES)}
          current={discord}
          params={params}
        />
        {/* The Discord role check, and the `no` that must render nothing at all.
            Independent of `discord` on purpose: the role lookup is a SECOND call
            to a different endpoint, and it can answer while the user fetch times
            out. `?discord=timeout&admin=yes` is that pair, and the chip must
            survive it. See ADMIN_CASES for why there are two keys and not four. */}
        <Axis
          name="admin"
          keys={Object.keys(ADMIN_CASES)}
          current={admin}
          params={params}
        />
        {/* The "Actions taken" panel. With `none` it appears only while the
            ADMIN chip does — flip `admin` against it. */}
        <Axis
          name="taken"
          keys={Object.keys(TAKEN_CASES)}
          current={taken}
          params={params}
        />
        {/* The breadcrumb at the top of the page, in its two states. It is drawn
            by the SKELETON as well, so flip this against `?discord=loading` —
            both must say the same thing, or the crumb changes under the reader
            the moment Discord answers. */}
        <Axis
          name="back"
          keys={Object.keys(BACK_CASES)}
          current={back}
          params={params}
        />
        {/*
          The accent's actual numbers, printed rather than eyeballed. This is
          the only place the clamp and the derived foreground are visible as
          values instead of as a colour somebody has an opinion about — and it
          is how a change to lib/contrast.ts shows up as a different number on a
          page rather than as nothing at all.
        */}
        <AccentReadout discord={discord} />
      </nav>

      {/*
        `isActive`, NOT `ban !== null`, AND THAT IS THE POINT OF THE `served`
        CASE. The real page computes this prop with `bans.isActive` — the one
        place that decides what banned means — so a harness that shortcut it to
        "there is a row" would show the chip on exactly the profile the owner
        asked to stop showing it on, and would go on passing.

        IT NOW DRIVES THE KICK BUTTON TOO, which is why `served` matters twice
        over: that player has a real ban row, is online, and MUST still have a
        Kick button, because the ban has run out. One boolean, one rule, three
        things reading it — the chip, the Ban/Lift ban button, and whether Kick
        is drawn at all.
      */}
      <ProfileView
        p={p}
        now={now}
        banned={banRow !== null && isActive(banRow, now)}
        backTo={BACK_CASES[back]}
        categoryLabel={CATEGORY_LABEL}
        verdictLabel={VERDICT_LABEL}
        moderation={{
          online: MOD_CASES[mod].online,
          canBan: MOD_CASES[mod].canBan,
        }}
      />
    </div>
  )

  return (
    <AppShell
      active="/"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: now - 1_200, bootEpoch: 'preview', now }}
    >
      {/*
        ONE CASE TAKES A DIFFERENT ROUTE, and it is the one that has to.

        Every other Discord case builds its promise on the SERVER, exactly as the
        real page does, so what is being reviewed is the actual hand-off and not
        an imitation of it. `loading` cannot be done that way at all: a promise
        that never settles never closes the RSC stream either, so the request
        hangs and the tab spins — and moving the promise to the client does not
        help, because a client component is still rendered on the server and
        `use()` still suspends there. Measured, not assumed: both versions wedged
        a navigation for five minutes before this branch existed.

        So this one pins the state instead of producing it. The consequence is
        worth stating: `?discord=loading` exercises what the loading state LOOKS
        like and not the machinery that reaches it. `slow` exercises the
        machinery.

        THAT DISTINCTION MATTERS MORE NOW THAN IT DID, because the loading state
        is the entire page rather than three elements. `loading` is where you read
        the skeleton; `slow` is where you check that it actually ends, that the
        images were decoded before it did, and that the whole page arrives at
        once rather than in two waves.
      */}
      {discord === 'loading' ? (
        <DiscordChromeStateProvider state={{ status: 'loading' }}>
          {body}
        </DiscordChromeStateProvider>
      ) : (
        <DiscordChromeProvider promise={chromePromise}>{body}</DiscordChromeProvider>
      )}
    </AppShell>
  )
}

/** What `accentSurface` did to the colour this case asked for. */
function AccentReadout({ discord }: { discord: DiscordKey }) {
  const raw =
    discord === 'white' ? '#ffffff' : discord === 'black' ? '#000000' : '#ff11ff'
  const surface = accentSurface(raw)

  const shows = discord === 'white' || discord === 'black' || discord === 'full' || discord === 'slow'
  if (!surface || !shows) return null

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
      <span className="w-20 shrink-0 uppercase tracking-wider">accent</span>
      <span
        className="rounded px-2 py-0.5 font-mono"
        style={{ backgroundColor: surface.background, color: surface.foreground }}
      >
        {surface.raw} → {surface.background}
      </span>
      <span className="font-mono">
        text {surface.foreground} · {surface.ratio.toFixed(2)}:1
        {surface.clamped ? ' · clamped' : ' · unclamped'}
      </span>
    </div>
  )
}
