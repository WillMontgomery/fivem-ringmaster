/**
 * Contract checks for the warmup stat board (#247).
 *
 *   npx tsx src/lib/scoreboard.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts`, `grants.check.ts` and the rest:
 * this repo has no test framework and adding one to assert a hundred cases would
 * be the larger change. It is wired into `npm run verify` as `check:scoreboard`,
 * because a check nothing runs is this repository's signature failure and has
 * happened here before.
 *
 * ═══ WHY THIS FEATURE NEEDS A GATE MORE THAN MOST ═══
 *
 * Every failure it guards is invisible to whoever causes it. The page is read
 * inside a game, on Chromium 103, painted onto a prop, by players who cannot
 * open a console, report an error or even scroll. Whoever edits it is looking at
 * a current browser on a desktop, where every one of these regressions looks
 * perfect:
 *
 *   A. THE LICENSE RULE. What separates a query string on the public internet
 *      from a DynamoDB key.
 *   B. THE RANKING, THE ADMIN FILTER AND THE VIEWER'S OWN ROW. Including the
 *      rule that a zero is never ranked, which is what stops a fresh server
 *      presenting five people with no wins as the leaders.
 *   C. THE CATALOG. The owner's five labels verbatim, damage and play time gone,
 *      and Volts spent declared but unrankable so it cannot render as zeros.
 *   D. THE DOCUMENT. Escaping of player-authored names, Chromium 103 safety, the
 *      fixed surface, the embedded typefaces, the contrast floor, and THE MOTION:
 *      that it is bounded, that every animated property is one the compositor
 *      can run, and that `off` really is off.
 *   E. THE CACHE. That a full field arriving at once costs one table scan and
 *      not forty, and that a failed refresh leaves the last good board up.
 *   F. THE MIDDLEWARE EXEMPTION, driven through the SHIPPED middleware with
 *      NODE_ENV set to production. Without it the bounce answers this route with
 *      a 307 to `/login` and the prop wears a Discord login form.
 *   G. THE LEVEL. Derived from xp with the console's own curve, never read from
 *      the row's stored `level`, which #116 has stopped writing.
 *   H. THE FONTS ON DISK AND THE FONTS IN THE BUNDLE ARE THE SAME BYTES.
 *   I. `Access-Control-Allow-Origin`, ON EVERY STATUS, driven through the REAL
 *      route handler rather than asserted about it.
 *
 * ═══ THE CHECKS ARE WRITTEN TO BE ABLE TO FAIL ═══
 *
 * Each of these was reverted and run during development and the counts are in
 * the commit that introduced them: deleting `/scoreboard` from `bounceExempt`
 * fails F and nothing else; dropping `esc()` from the name interpolation fails D;
 * making the two dwell constants one value fails D; putting `box-shadow` in a
 * transition fails D; making `off` emit a transition fails D; dropping `viewer`
 * from `rankBoard` fails B; removing the header from `boardHeaders` fails I;
 * editing one byte of a woff2 without regenerating fails H.
 *
 * AND THE SAME WAS DONE FOR EVERY ASSERTION ADDED WITH THE SQUAD SLIDE, THE
 * ANIMATED BACKGROUND AND THE REMOVAL OF THE COLOR BORDERS. Seventeen mutations,
 * each applied to the real source, run, and reverted; none passed. Putting an
 * accent bar back on a card fails 24 cases; putting the accent border back on the
 * viewer's row fails 16; deleting the background fails 13; making every client
 * share one background phase fails 1; leaving an orb's loop open fails 1;
 * drifting the sheet a fractional period fails 1; promoting a layer that does not
 * move fails 3; transitioning `filter` fails 2; believing a dead feed about a
 * squad fails 2; rendering a squad of one fails 1; uncapping the squad fails 1;
 * dropping the name sort fails 2; dropping a mate with no career row fails 5;
 * flipping the spenders card on fails 8; pinning the column width back to 240
 * fails 6; showing the squad slide to a solo player fails 3; and dropping `esc()`
 * from the live squad name fails 7.
 */

/**
 * PRODUCTION, BEFORE ANYTHING READS IT. `src/middleware.ts` short-circuits the
 * signed-out bounce whenever `NODE_ENV !== 'production'`, so a check that ran in
 * the default mode would exercise an early return and pass whatever the
 * exemption said. Section F is the only reason this line exists.
 *
 * CAST, BECAUSE NEXT TYPES `NODE_ENV` AS READONLY. Assigning it directly is a
 * typecheck error - which is how this file arrived, failing `npm run typecheck`
 * while its own output said every case passed. A check that cannot be run by the
 * gate is not a gate.
 *
 * SAFE TO SET AFTER THE IMPORTS, which is where ES module hoisting actually puts
 * it: middleware reads `process.env.NODE_ENV` inside the request handler, not at
 * module scope. `origin.check.ts` relies on the same property.
 */
;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'https://console.example.com'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

/**
 * ═══ SECTION I DRIVES THE REAL ROUTE, SO DYNAMODB HAS TO FAIL FAST AND LOCALLY
 *     ═══
 *
 * The 503 answer is the one worth driving end to end, and reaching it means the
 * scan has to fail. Left alone the AWS SDK would hunt every credential provider
 * on the machine - and on a box that HAS credentials it would then make a real
 * DynamoDB call from inside a gate. Both are wrong: a check that behaves
 * differently on the deploy host than on a laptop is a check nobody can trust.
 *
 * So it is pointed at a closed port on loopback with one attempt and no metadata
 * service. `connect ECONNREFUSED` arrives in about thirty milliseconds, is the
 * same on every machine, and reaches the route's 503 through the store's real
 * error path rather than a stub of it.
 */
process.env.AWS_ACCESS_KEY_ID = 'check-not-a-real-key'
process.env.AWS_SECRET_ACCESS_KEY = 'check-not-a-real-secret'
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:1'
process.env.AWS_MAX_ATTEMPTS = '1'
process.env.AWS_EC2_METADATA_DISABLED = 'true'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NextRequest } from 'next/server'

import { GET } from '../app/scoreboard/route'
import middleware from '../middleware'
import { contrastRatio, parseHex, relativeLuminance } from './contrast'
import {
  BOARD_DWELL_MS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CATEGORIES,
  PLAYER_DWELL_MS,
  TOP_N,
  TRANSITION_MS,
  boardHeaders,
  enabledCategories,
  formatCount,
  normalizeLicense,
  playerPanelFrom,
  rankBoard,
  rankOf,
  squadColors,
  squadFrom,
  squadPanelFrom,
  SQUAD_COLORS,
  SQUAD_DWELL_MS,
  SQUAD_MAX_ROWS,
  type AvailableCategory,
  type BlockedCategory,
  type BoardRow,
  type LivePlayer,
} from './scoreboard'
import { EMBEDDED_FACES } from './scoreboardFonts'
import {
  CONTENT_HEIGHT,
  INNER_HEIGHT,
  INNER_WIDTH,
  PALETTE,
  PHASE_COUNT,
  SAFE_INSET,
  SQUAD_HEAD_H,
  TITLES,
  TITLE_H,
  columnWidth,
  contrastPairs,
  esc,
  renderScoreboard,
  squadNameSize,
  squadRowHeight,
  squadValueSize,
  type MotionLevel,
} from './scoreboardPage'
import {
  SNAPSHOT_TTL_MS,
  newSnapshotCache,
  snapshotFrom,
  type BoardSources,
} from './scoreboardStore'
import { levelFor } from './xp'

let failed = 0
/** Every case actually executed, loops included, so the gate reports real counts. */
let ran = 0
function fail(label: string, detail: string): void {
  failed++
  console.error(`  FAIL  ${label} - ${detail}`)
}
function expect(label: string, got: unknown, want: unknown): void {
  ran++
  if (got !== want) fail(label, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}
function expectTrue(label: string, got: boolean): void {
  ran++
  if (!got) fail(label, 'was false')
}

/**
 * Source files this check reads as text.
 *
 * READING SOURCE IS THE REPO'S ESTABLISHED SHAPE for a route whose behavior
 * cannot be fully driven offline - `scripts/check-health-route.mjs` does exactly
 * this and says why. It is used here for two properties only: that every
 * response in the route is built through `boardHeaders`, and that the store no
 * longer projects the two attributes the owner removed.
 *
 * `process.cwd()` RATHER THAN `import.meta.url`, because tsx runs these checks
 * as CommonJS in this repo and `import.meta` is not available there. npm run
 * always starts at the package root; if it did not, the read throws and the
 * check exits non-zero rather than skipping.
 */
const ROOT = process.cwd()
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

/**
 * EVERYTHING IN ONE ASYNC FUNCTION, matching `bans.check.ts` and the four other
 * checks that need to await something. This repo's tsx runs these as CommonJS,
 * where a top-level await is a transform error rather than a slow start.
 */
async function main(): Promise<void> {

// ===========================================================================
// A. THE LICENSE RULE
// ===========================================================================

console.log('A. the license rule')

/** The owner's own example, from the issue. */
const OWNER_ID = 'b6f5a1273092df7eb6a8c2a981418f275f2ae3fb'
const OWNER_KEY = `license:${OWNER_ID}`

expect("the owner's URL, exactly as he wrote it", normalizeLicense(OWNER_ID), OWNER_KEY)
expect('the qualified spelling is accepted too', normalizeLicense(OWNER_KEY), OWNER_KEY)
expect(
  'uppercase is normalized, because a DynamoDB key is compared as bytes',
  normalizeLicense(OWNER_ID.toUpperCase()),
  OWNER_KEY,
)
expect('surrounding whitespace is trimmed', normalizeLicense(`  ${OWNER_ID}  `), OWNER_KEY)

/**
 * EVERY ONE OF THESE MUST BE null. This function is the only thing between an
 * unauthenticated query string and a `GetItem`, so the list is deliberately
 * paranoid about shapes that could only matter if something downstream were
 * careless.
 */
for (const [label, input] of [
  ['missing entirely', null],
  ['undefined', undefined],
  ['empty', ''],
  ['whitespace', '   '],
  ['thirty-nine hex characters', OWNER_ID.slice(0, 39)],
  ['forty-one hex characters', `${OWNER_ID}a`],
  ['not hex', 'z6f5a1273092df7eb6a8c2a981418f275f2ae3fb'],
  ['a name', 'Slippery Jim'],
  ['markup', '<script>alert(1)</script>'],
  ['a path traversal', `../../${OWNER_ID}`],
  ['a newline smuggled in', `${OWNER_ID}\nx`],
  ['a null byte', `${OWNER_ID}\0`],
  ['a DynamoDB expression', 'pk = :x OR 1=1'],
  ['the qualified prefix twice', `license:license:${OWNER_ID}`],
  ['a different identifier kind', `discord:${OWNER_ID}`],
  ['forty characters of something else', 'x'.repeat(40)],
] as Array<[string, string | null | undefined]>) {
  expect(`refused: ${label}`, normalizeLicense(input), null)
}

// ===========================================================================
// B. THE RANKING, THE ADMIN FILTER AND THE VIEWER'S OWN ROW
// ===========================================================================

console.log('\nB. the ranking')

function row(over: Partial<BoardRow> & { name: string }): BoardRow {
  return {
    license: `license:${over.name.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
    wins: 0,
    kills: 0,
    matches: 0,
    revives: 0,
    xp: 0,
    voltsSpent: 0,
    ...over,
  }
}

const ROWS: BoardRow[] = [
  row({ name: 'alpha', wins: 30, kills: 900, matches: 400, revives: 12, xp: 90_000 }),
  row({ name: 'bravo', wins: 20, kills: 800, matches: 300, revives: 40, xp: 70_000 }),
  row({ name: 'charlie', wins: 20, kills: 700, matches: 200, revives: 3, xp: 50_000 }),
  row({ name: 'delta', wins: 10, kills: 600, matches: 100, revives: 0, xp: 30_000 }),
  row({ name: 'echo', wins: 5, kills: 500, matches: 50, revives: 1, xp: 10_000 }),
  row({ name: 'foxtrot', wins: 1, kills: 400, matches: 25, revives: 0, xp: 5_000 }),
]

const wins = () => enabledCategories().find((c) => c.key === 'wins')!
const level = () => enabledCategories().find((c) => c.key === 'level')!

{
  const board = rankBoard(ROWS)
  const winsCard = board.categories.find((c) => c.key === 'wins')

  expect('every enabled category ranks', board.categories.length, enabledCategories().length)
  expect('a card holds at most TOP_N rows', winsCard?.entries.length, TOP_N)
  expect('first place is the highest value', winsCard?.entries[0]?.name, 'alpha')
  /** A tie breaks on name so the board does not reorder itself between refreshes. */
  expect('a tie breaks deterministically, first', winsCard?.entries[1]?.name, 'bravo')
  expect('a tie breaks deterministically, second', winsCard?.entries[2]?.name, 'charlie')
  expect('values are formatted, not raw', winsCard?.entries[0]?.value, '30')
  expect('the ranking says how many rows it considered', board.considered, ROWS.length)
  expect('a card carries its own color', winsCard?.accent, wins().accent)
}

console.log('\nB. rows that must never reach a wall')

{
  const polluted = [
    ...ROWS,
    /**
     * `br-players` HOLDS MORE THAN PLAYERS. The report-award queue lives at
     * `{pk: 'br:reportaward', sk: 'queue'}` today and the game repository is free
     * to add more. Filtering the scan on `sk = 'profile'` catches that one;
     * requiring a qualified license as the key catches the ones nobody has
     * written yet, which is the half that survives a repo this console does not
     * control.
     */
    { ...row({ name: 'bookkeeping', wins: 9_999 }), license: 'br:reportaward' },
    /** A row created by a purchase alone never gets a name. */
    { ...row({ name: 'x', wins: 9_998 }), name: '' },
    { ...row({ name: 'x', wins: 9_997 }), name: '   ' },
  ]

  const board = rankBoard(polluted)
  const entries = board.categories.find((c) => c.key === 'wins')?.entries ?? []
  expect('a non-player row is not ranked', entries[0]?.name, 'alpha')
  expectTrue(
    'an unnamed row is not ranked',
    !entries.some((e) => e.name.trim() === ''),
  )
  expect('and they are not counted as considered', board.considered, ROWS.length)
}

console.log('\nB. a zero is never a rank')

{
  /** Every row present and real, and nobody has done anything. */
  const fresh = [row({ name: 'alpha' }), row({ name: 'bravo' })]
  const board = rankBoard(fresh)
  expect(
    'a board with nothing true to say has no categories at all',
    board.categories.length,
    0,
  )
  expect('and it still counted the rows', board.considered, 2)
}

{
  /** One player with one win, everybody else on nothing. */
  const nearlyFresh = [row({ name: 'alpha', wins: 1 }), row({ name: 'bravo' })]
  const board = rankBoard(nearlyFresh)
  expect('only the category with a real value renders', board.categories.length, 1)
  expect('and it holds only the non-zero row', board.categories[0]?.entries.length, 1)
}

expect('rankOf refuses to rank a zero', rankOf(ROWS, wins(), 0), null)
expect('rankOf refuses to rank a negative', rankOf(ROWS, wins(), -5), null)
expect('rankOf: above everybody', rankOf(ROWS, wins(), 100), 1)
expect('rankOf: below everybody', rankOf(ROWS, wins(), 1), 6)
/** Everybody tied shares a rank rather than being ordered arbitrarily behind. */
expect('rankOf: a tie shares the rank', rankOf(ROWS, wins(), 20), 2)

console.log('\nB. the admin filter, which is live in both positions')

{
  const hidden = new Set([ROWS[0]!.license])

  const shown = rankBoard(ROWS)
  const filtered = rankBoard(ROWS, { hidden })

  expect(
    'flag off: an admin is on the board, because that is the default',
    shown.categories.find((c) => c.key === 'wins')?.entries[0]?.name,
    'alpha',
  )
  expect(
    'flag on: the admin is gone and the next player is first',
    filtered.categories.find((c) => c.key === 'wins')?.entries[0]?.name,
    'bravo',
  )
  expectTrue(
    'flag on: the admin appears in no category at all',
    filtered.categories.every((c) => c.entries.every((e) => e.name !== 'alpha')),
  )
  expect('flag on: the considered count drops by one', filtered.considered, ROWS.length - 1)

  /** Hiding must move ranks too, or the two halves of the page disagree. */
  expect('flag off: a player ranks behind the admin', rankOf(ROWS, wins(), 20), 2)
  expect('flag on: they move up', rankOf(ROWS, wins(), 20, { hidden }), 1)
}

console.log("\nB. the viewer's own row")

/**
 * Owner: "if the player viewing the scoreboard is anywhere on it - highlight
 * that row."
 *
 * THE MATCH IS ON THE LICENSE AND NEVER ON THE NAME. Names are player authored
 * and are not unique; two people may share one, and highlighting both would tell
 * one of them something false about themselves. The pair of rows below has the
 * same name under two different licenses and exists to hold that.
 */
{
  const board = rankBoard(ROWS, { viewer: ROWS[2]!.license })
  const entries = board.categories.find((c) => c.key === 'wins')!.entries

  expect('exactly one row is marked', entries.filter((e) => e.you).length, 1)
  expect('and it is the viewer', entries.find((e) => e.you)?.name, 'charlie')
  expectTrue(
    'the viewer is marked in every category they appear in',
    board.categories
      .filter((c) => c.entries.some((e) => e.name === 'charlie'))
      .every((c) => c.entries.find((e) => e.name === 'charlie')!.you),
  )

  const none = rankBoard(ROWS)
  expectTrue(
    'with no viewer, nothing is marked',
    none.categories.every((c) => c.entries.every((e) => !e.you)),
  )

  const stranger = rankBoard(ROWS, { viewer: `license:${'f'.repeat(40)}` })
  expectTrue(
    'a viewer who is not on the board marks nobody',
    stranger.categories.every((c) => c.entries.every((e) => !e.you)),
  )

  const twins: BoardRow[] = [
    { ...row({ name: 'twin', wins: 9 }), license: `license:${'1'.repeat(40)}` },
    { ...row({ name: 'twin', wins: 8 }), license: `license:${'2'.repeat(40)}` },
  ]
  const tw = rankBoard(twins, { viewer: `license:${'2'.repeat(40)}` })
  const twEntries = tw.categories.find((c) => c.key === 'wins')!.entries
  expect('two players with one name: only one is highlighted', twEntries.filter((e) => e.you).length, 1)
  expect('and it is the one whose license matched', twEntries[1]?.you, true)

  /** A hidden admin is not on the board, so their own row cannot light up. */
  const hiddenSelf = rankBoard(ROWS, {
    hidden: new Set([ROWS[2]!.license]),
    viewer: ROWS[2]!.license,
  })
  expectTrue(
    'an admin who is filtered out is not highlighted either',
    hiddenSelf.categories.every((c) => c.entries.every((e) => !e.you)),
  )
}

console.log('\nB. the per-player half')

{
  const hidden = new Set([ROWS[0]!.license])
  const panel = playerPanelFrom(ROWS[1]!, ROWS, {})

  expect('it carries the player name', panel.name, 'bravo')
  expect('the same categories, in the same order', panel.stats.length, enabledCategories().length)
  expect(
    'the tile labels are the card labels with the superlative removed',
    panel.stats.map((s) => s.label).join('|'),
    enabledCategories().map((c) => c.tileLabel).join('|'),
  )
  expect('a value is theirs', panel.stats.find((s) => s.key === 'wins')?.value, '20')
  expect('a rank is comparative', panel.stats.find((s) => s.key === 'wins')?.rank, 2)
  expect(
    'each category is ranked on its own numbers, not on one overall order',
    panel.stats.find((s) => s.key === 'revives')?.rank,
    1,
  )
  expect(
    'a zero value carries no rank at all',
    playerPanelFrom(ROWS[3]!, ROWS, {}).stats.find((s) => s.key === 'revives')?.rank,
    null,
  )

  const filtered = playerPanelFrom(ROWS[1]!, ROWS, { hidden })
  expect(
    'the admin filter reaches the per-player ranks',
    filtered.stats.find((s) => s.key === 'wins')?.rank,
    1,
  )

  const nobody = playerPanelFrom(row({ name: 'zulu' }), ROWS, {})
  expectTrue(
    'a player who has done nothing gets values and no ranks',
    nobody.stats.every((s) => s.rank === null),
  )
}

// ===========================================================================
// B2. THE SQUAD, RESOLVED FROM THE LIVE SNAPSHOT
// ===========================================================================

console.log('\nB2. who is in the squad, and when we may not say')

/**
 * ═══ THE ONLY THING THE ROUTE IS GIVEN IS A LICENSE ═══
 *
 * Owner: "Let's also add a slide when in squads where the player will get to see
 * the stats of their squad mates!" and, on the risk: "If the live snapshot
 * cannot answer who is in the squad right now, say so plainly rather than
 * falling back to something that looks right and is not."
 *
 * So the rules below are the "say so plainly" half, written as returns of null.
 * Every one of them was checked against the gamemode rather than assumed:
 * `BR.Party.formSquads` runs on the WARMUP edge (`br_core/server/match.lua`),
 * which is the same edge `br_core/client/board.lua` creates this DUI on, and it
 * RETURNS before assigning anything in solo mode (`br_core/server/party.lua`).
 * So a warmup squads player always has a `squadId` and a warmup solo player
 * never does.
 */
const SQ = 'm0a3f1sq2'
const L = (n: number) => `license:${String(n).repeat(40).slice(0, 40)}`

/**
 * THE SERVER IDS ARE DELIBERATELY OUT OF NAME ORDER, because the two orderings
 * on this slide are different on purpose and a fixture where they agreed would
 * pass whichever one the code used. The rows are sorted by NAME; the colors are
 * keyed on the game's own index, which is the squad's server ids ASCENDING
 * (`BR.Party.memberIndex`). See the squad color block below.
 */
const PAD: LivePlayer[] = [
  { license: L(1), name: 'zulu', squadId: SQ, src: 12 },
  { license: L(2), name: 'alpha', squadId: SQ, src: 4 },
  { license: L(3), name: 'mike', squadId: SQ, src: 30 },
  { license: L(4), name: 'other squad', squadId: 'm0a3f1sq1', src: 7 },
  { license: L(5), name: 'solo', squadId: null, src: 2 },
  /** br_stats has not filled a license in yet. Cannot be matched to anybody. */
  { license: null, name: 'nameless', squadId: SQ, src: 9 },
]

{
  const found = squadFrom(PAD, L(1), 'live')
  expectTrue('a squadded viewer resolves a squad', found !== null)
  expect('and it is their own', found?.squadId, SQ)
  expect('with only the members of it', found?.members.length, 3)
  expectTrue(
    'a row with no license is not a member, because nothing can be looked up for it',
    !found?.members.some((m) => m.license === null),
  )
  expect('ordered by name, so the slide does not reshuffle', found?.members[0]?.name, 'alpha')
  expect('and deterministically all the way down', found?.members[2]?.name, 'zulu')
  expectTrue(
    'the other squad is nowhere on it',
    !found?.members.some((m) => m.name === 'other squad'),
  )
}

expect(
  'a solo player gets no slide at all, which is the two-slide case',
  squadFrom(PAD, L(5), 'live'),
  null,
)
expect(
  'a viewer who is not on the server gets none either',
  squadFrom(PAD, `license:${'f'.repeat(40)}`, 'live'),
  null,
)
expect('and neither does an empty pad', squadFrom([], L(1), 'live'), null)

/**
 * A SQUAD OF ONE IS NOT A SQUAD. Owner: "Never render an empty or single-member
 * squad slide." It is what a squads match looks like once everybody else has
 * disconnected, and a slide about your squad showing one row is a worse answer
 * than the two slides a solo player gets.
 */
expect(
  'a squad whose other members have all left renders nothing',
  squadFrom([{ license: L(1), name: 'zulu', squadId: SQ }], L(1), 'live'),
  null,
)

/**
 * ═══ AND THE FEED HAS TO BE WORTH BELIEVING ═══
 *
 * `dead` is fifteen missed pushes and `offline` is a console that has never been
 * pushed to. In both cases the snapshot may be describing a previous match, and
 * naming three people who are not standing there is precisely the "looks right
 * and is not" the owner ruled out. `stale` is three missed pushes on a
 * two-second cadence and is allowed: a squad is formed ONCE at the top of warmup
 * and does not change, so six seconds of lag cannot move anybody.
 */
expectTrue('a live feed answers', squadFrom(PAD, L(1), 'live') !== null)
expectTrue('a stale feed still answers, because a squad does not move', squadFrom(PAD, L(1), 'stale') !== null)
expect('a dead feed refuses', squadFrom(PAD, L(1), 'dead'), null)
expect('an offline console refuses', squadFrom(PAD, L(1), 'offline'), null)

/**
 * THE LAYOUT GUARD. `maxSquadSize` is four in the gamemode's config, on a box
 * this console does not own and does not get told about. A squad of nine would
 * otherwise lay out nine rows on a surface that cannot scroll.
 */
{
  const huge = Array.from({ length: 9 }, (_, i) => ({
    license: L(i + 1),
    name: `p${i}`,
    squadId: SQ,
  }))
  expect(
    'an oversized squad is capped rather than overflowing the surface',
    squadFrom(huge, L(1), 'live')?.members.length,
    SQUAD_MAX_ROWS,
  )
}

console.log('\nB2. the squad panel')

{
  const members = squadFrom(PAD, L(1), 'live')!.members
  const careers = new Map<string, BoardRow>([
    [L(1), { ...row({ name: 'stale name', wins: 7, kills: 70 }), license: L(1) }],
    [L(2), { ...row({ name: 'alpha', wins: 2, kills: 20 }), license: L(2) }],
  ])

  const panel = squadPanelFrom({
    members,
    careerOf: (l) => careers.get(l) ?? null,
    viewer: L(1),
  })

  expect('one row per member', panel.mates.length, 3)
  expect('one heading per category', panel.labels.length, enabledCategories().length)
  expect(
    'and the headings are the tile labels, which are the owner words',
    panel.labels.map((l) => l.label).join('|'),
    enabledCategories().map((c) => c.tileLabel).join('|'),
  )
  expect('one value per category per row', panel.mates[0]?.values.length, enabledCategories().length)

  expect('exactly one row is the viewer', panel.mates.filter((m) => m.you).length, 1)
  expect('and it is them', panel.mates.find((m) => m.you)?.name, 'zulu')

  /**
   * THE NAME IS THE LIVE ONE. The career row carries who they were at the end of
   * their last match; the snapshot carries who is standing on the pad. On a
   * slide whose subject is the three people beside you, the live name is the
   * true one - and it is the only one a player who has never finished a match
   * has at all.
   */
  expect('the live name wins over the stored one', panel.mates.find((m) => m.you)?.name, 'zulu')

  expect(
    'a mate with a career shows it',
    panel.mates.find((m) => m.name === 'alpha')?.values[0],
    '2',
  )
  /**
   * AND A MATE WITH NO CAREER ROW SHOWS ZEROS RATHER THAN BEING DROPPED. This is
   * not the mistake the leaderboard refuses to make. A zero on a leaderboard is
   * a RANKING claim - it presents five people who have done nothing as the best
   * in the game. A zero here is a fact about one named person who has genuinely
   * not won a match, next to squad mates who have. Dropping them would be the
   * real lie: a squad of two shown when three people are about to drop together.
   */
  expect(
    'a mate who has never finished a match is still on the slide',
    panel.mates.filter((m) => m.name === 'mike').length,
    1,
  )
  /**
   * "ZEROS" MEANS WHAT EACH CATEGORY MAKES OF A ZERO ROW, not the character 0.
   * `level` renders `levelFor(0)`, which is 1, because a player at no xp is
   * level one and not level nought - the same derivation the lobby and the
   * profile use. Asserting the literal string would have pinned a bug.
   */
  const nobody = row({ name: 'mike' })
  expect(
    'with what a zero row renders as, category by category',
    panel.mates.find((m) => m.name === 'mike')?.values.join('|'),
    enabledCategories().map((c) => c.display(nobody)).join('|'),
  )

  /** With no colors supplied there are none, and the slide renders neutral. */
  expectTrue('no colors were asked for, so no mate has one', panel.mates.every((m) => m.color === null))
}

console.log("\nB3. a squad mate's row is the color their blip is")

/**
 * ═══ THIS IS THE ONE COLOUR ON THE BOARD THIS CONSOLE DID NOT CHOOSE ═══
 *
 * `BR.SquadColours` is the palette a player already sees on their squad mates'
 * minimap blips and destination markers, and `BR.Party.memberIndex` decides who
 * wears which: every ROSTER ENTRY sharing the squad id, server ids sorted
 * ASCENDING, 1-based, wrapped over the eight. The gamemode's own comment says
 * what that ordering buys - "every client numbers the squad identically and a
 * teammate keeps the same colour for the whole match."
 *
 * SO THE CLAIM THE SLIDE MAKES IS FALSIFIABLE, which is the whole reason to use
 * this palette rather than eight pretty colors: a player can look at the row,
 * look at their minimap, and catch us. What follows is the arithmetic that
 * decides whether they can.
 */
{
  const colors = squadColors(PAD, SQ)!
  expectTrue('a squad with server ids on every member resolves colors', colors !== null)

  /**
   * THE ORDER IS SERVER ID AND NOT NAME, AND THE FIXTURE DISAGREES ON PURPOSE.
   * By name the squad is alpha, mike, zulu. By server id it is alpha(4),
   * nameless(9), zulu(12), mike(30). Every color below is off the second list.
   */
  expect('the lowest server id takes the first color', colors.get(L(2)), SQUAD_COLORS[0])
  expect('and the next licensed member takes the THIRD', colors.get(L(1)), SQUAD_COLORS[2])
  expect('and the highest takes the fourth', colors.get(L(3)), SQUAD_COLORS[3])

  /**
   * WHICH IS THE POINT OF THAT SKIP. `nameless` is a roster entry with no
   * license yet, so it is not on the slide - but the GAME counted it when it
   * numbered the squad, so it owns the second color and zulu is third. Keying
   * the palette on the rows this console can show would hand zulu the second
   * color and put every mate behind them one seat out of step with their own
   * minimap.
   */
  expect('the member with no license still consumes their seat', colors.size, 3)

  /** A squad bigger than the palette wraps, exactly as `BR.SquadColour` does. */
  const big: LivePlayer[] = Array.from({ length: 9 }, (_, i) => ({
    license: `license:${String(i).repeat(40).slice(0, 40)}`,
    name: `p${i}`,
    squadId: SQ,
    src: 100 + i,
  }))
  const wrapped = squadColors(big, SQ)!
  expect(
    'the ninth member wears the first color again',
    wrapped.get(big[8]!.license!),
    SQUAD_COLORS[0],
  )

  /**
   * AND A SNAPSHOT WITHOUT SERVER IDS GETS NO COLOURS AT ALL. There is no way
   * to know where an id-less member sits in the game's ordering, so every index
   * after them is a guess - which is not a missing color, it is four wrong
   * ones. The slide falls back to neutral rows, which say nothing rather than
   * something false.
   */
  const idless = PAD.map((p) => ({ license: p.license, name: p.name, squadId: p.squadId }))
  expect('one member with no server id and the whole squad goes neutral', squadColors(idless, SQ), null)
  expect('and a squad id nobody is in has nothing to color', squadColors(PAD, 'm0a3f1sq9'), null)

  /** The panel carries the color through to the mate, keyed on their license. */
  const painted = squadPanelFrom({
    members: squadFrom(PAD, L(1), 'live')!.members,
    careerOf: () => null,
    viewer: L(1),
    colors,
  })
  expect('alpha is painted first-color on the slide', painted.mates.find((m) => m.name === 'alpha')?.color, SQUAD_COLORS[0])
  expect('and the viewer gets theirs too', painted.mates.find((m) => m.you)?.color, SQUAD_COLORS[2])
}

// ===========================================================================
// C. THE CATALOG
// ===========================================================================

console.log("\nC. the owner's five labels, verbatim")

/**
 * ═══ HIS WORDS, IN HIS CAPITALS, WRITTEN OUT HERE RATHER THAN DERIVED ═══
 *
 * "the cards should say things like 'Most wins' and 'Top kills' and 'Top
 * matches' and 'Most revives given' and 'Highest level' (all caps of course)".
 *
 * THE LIST IS TYPED OUT RATHER THAN READ OFF THE CATALOG, which is the only way
 * it can fail. A check that compares the catalog to itself passes whatever the
 * catalog says; this one fails the moment somebody improves his wording.
 */
const OWNER_LABELS = [
  'MOST WINS',
  'TOP KILLS',
  'TOP MATCHES',
  'MOST REVIVES GIVEN',
  'HIGHEST LEVEL',
]

expect(
  'five cards, and they say what he asked them to say',
  enabledCategories().map((c) => c.label).join(' | '),
  OWNER_LABELS.join(' | '),
)
expectTrue(
  'and they are capitalized in the source, not by a text-transform',
  enabledCategories().every((c) => c.label === c.label.toUpperCase()),
)

console.log('\nC. damage and play time are gone, not hidden')

/**
 * Owner: "Let's remove the damage and playtime from the scoreboard view." Gone
 * from the catalog is the visible half; gone from the PROJECTION is the half
 * that matters, because an attribute this board still asks DynamoDB for is an
 * attribute somebody can put back on screen without deciding to.
 */
expectTrue(
  'no damage category',
  !CATEGORIES.some((c) => c.key === ('damage' as never)),
)
expectTrue(
  'no play time category',
  !CATEGORIES.some((c) => c.key === ('playtime' as never)),
)
{
  const storeText = read('src/lib/scoreboardStore.ts')
  expectTrue(
    'the store no longer projects damageDealt',
    !storeText.includes('damageDealt'),
  )
  expectTrue(
    'the store no longer projects playtimeSec',
    !storeText.includes('playtimeSec'),
  )
}

console.log('\nC. biggest spenders: the data layer is ready and the card is not')

{
  const spend = CATEGORIES.find((c) => c.key === 'spend')
  expectTrue('the category is declared, so the shape is already decided', !!spend)
  expect('it is not available', spend?.available, false)
  expectTrue(
    'and it says why, for the next reader rather than for the page',
    typeof (spend as { blockedBy?: string } | undefined)?.blockedBy === 'string' &&
      (spend as { blockedBy: string }).blockedBy.length > 0,
  )
  /**
   * THE REASON CHANGED AND THE CHECK PINS THE NEW ONE. `voltsSpent` used to exist
   * nowhere; since the gamemode's `03cce2d` it exists on the match HISTORY rows
   * and still not on the profile aggregate. A note that still said "recorded
   * nowhere" would send the next person hunting for the wrong thing.
   */
  expectTrue(
    'the reason names the allowlist that is actually missing it',
    (spend as { blockedBy: string }).blockedBy.includes('STATS_ADDS'),
  )
  expectTrue(
    'enabledCategories cannot return it',
    !enabledCategories().some((c) => c.key === 'spend'),
  )
  expectTrue(
    'the ranking cannot produce it',
    !rankBoard(ROWS).categories.some((c) => c.key === 'spend'),
  )
  expectTrue(
    'and the per-player half cannot either',
    !playerPanelFrom(ROWS[0]!, ROWS, {}).stats.some((s) => s.key === 'spend'),
  )

  /**
   * EVEN WITH A REAL NUMBER ON THE ROW IT RENDERS NOTHING, which is what makes
   * this a blocked category rather than an empty one. The day the aggregate
   * lands, flipping `available` is the whole change.
   */
  const spenders = [row({ name: 'alpha', voltsSpent: 5_000, wins: 1 })]
  expectTrue(
    'a row carrying voltsSpent still produces no spenders card',
    !rankBoard(spenders).categories.some((c) => c.key === 'spend'),
  )

  /** The projection carries it, so the flip needs no store change. */
  const storeText = read('src/lib/scoreboardStore.ts')
  expectTrue(
    'the store projects voltsSpent, so the data layer is ready today',
    storeText.includes("'#spent': 'voltsSpent'"),
  )

  /**
   * ═══ AND THE CARD IS PROVEN, NOT PROMISED ═══
   *
   * The claim this file makes about the blocked category is that flipping ONE
   * BOOLEAN produces a working card. A comment saying so is worth nothing: the
   * whole failure mode of a blocked feature is that it has never once been run,
   * so the day the number lands somebody discovers the ranking was never
   * written, or the column arithmetic does not fit six, under time pressure.
   *
   * So the real object is taken off the real catalog, `available` is forced on
   * HERE AND NOWHERE ELSE, and it is driven through the real `rankBoard`, the
   * real `playerPanelFrom` and the real renderer. Nothing in `src` changes.
   */
  const flipped = { ...(spend as BlockedCategory), available: true } as AvailableCategory
  const withSpend = [...enabledCategories(), flipped]

  /** Every category non-zero, so all six really do rank and lay out. */
  const ROWS_WITH_SPEND: BoardRow[] = [
    row({ name: 'alpha', wins: 3, kills: 3, matches: 3, revives: 3, xp: 30, voltsSpent: 900 }),
    row({ name: 'bravo', wins: 2, kills: 2, matches: 2, revives: 2, xp: 20, voltsSpent: 12_500 }),
    row({ name: 'charlie', wins: 1, kills: 1, matches: 1, revives: 1, xp: 10, voltsSpent: 0 }),
  ]

  const ranked = rankBoard(ROWS_WITH_SPEND, { categories: withSpend })
  const card = ranked.categories.find((c) => c.key === 'spend')

  expectTrue('with the flag flipped, the card ranks', card !== undefined)
  expect('and it is the owner label', card?.label, 'BIGGEST SPENDERS')
  expect('the biggest spender is first', card?.entries[0]?.name, 'bravo')
  expect('and the number is grouped like every other number', card?.entries[0]?.value, '12,500')
  expectTrue(
    'a player who has spent nothing is not on it, same as every other card',
    !card?.entries.some((e) => e.name === 'charlie'),
  )

  const panel = playerPanelFrom(ROWS_WITH_SPEND[1]!, ROWS_WITH_SPEND, { categories: withSpend })
  const tile = panel.stats.find((s) => s.key === 'spend')
  expect('the per-player half gains a tile', tile?.value, '12,500')
  expect('with its rank', tile?.rank, 1)
  expect('and the tile label is the one that is not his', tile?.label, 'VOLTS SPENT')

  /**
   * SIX CARDS FIT THE SURFACE, which is the half of this that used to be a
   * literal 240 and would have silently dropped a column off a page that cannot
   * scroll. See `columnWidth`.
   */
  const six = renderScoreboard({
    board: ranked,
    player: panel,
    motion: 'off',
  })
  /** Six on the leaderboard and six tiles, each carrying its category class. */
  expect('six columns are laid out', six.split('class="col c-').length - 1, 12)
  expectTrue(
    'and the sixth one is painted like the other five',
    six.includes('.c-spend .card {') && six.includes('.c-spend .tile {'),
  )
  expectTrue(
    'and the card width is the six-column one, not the five-column one',
    six.includes(`width: ${columnWidth(6)}px`) && !six.includes('width: 240px'),
  )
}

console.log('\nC. the column arithmetic fits, at every count')

/**
 * ═══ THE PROPERTY IS "AS WIDE AS POSSIBLE WITHOUT OVERFLOWING", AT ANY COUNT
 *     ═══
 *
 * A DUI cannot scroll, so a row of cards one pixel too wide does not wrap into a
 * scrollable region, it wraps into a region that does not exist and the last card
 * is simply not on the wall. Nothing errors. The board looks finished.
 *
 * BOTH DIRECTIONS ARE ASSERTED. Too wide loses a column; too narrow leaves a
 * column-width of dead space on the right that reads as a missing card. So the
 * width has to be the LARGEST that fits, which is what pins it to one value
 * rather than to a range.
 */
for (let n = 3; n <= 8; n++) {
  const w = columnWidth(n)
  const used = n * w + (n - 1) * 12
  expectTrue(`${n} columns fit in ${INNER_WIDTH}px (${used}px used)`, used <= INNER_WIDTH)
  expectTrue(
    `${n} columns waste less than a pixel each (${INNER_WIDTH - used}px left)`,
    INNER_WIDTH - used < n,
  )
}
/**
 * ═══ AND THE WIDTH IS THE SAFE AREA'S, NOT THE SURFACE'S ═══
 *
 * Owner, 2026-09-11: "It doesn't look like the crop landed with the redesign."
 *
 * THIS ASSERTION USED TO READ `columnWidth(5) === 240` AND THAT NUMBER WAS THE
 * BUG. 240 is 1280 minus 32px of padding divided five ways to the pixel, which
 * is to say the columns were fitted to the whole physical surface - and the prop
 * the board is painted on has a bezel that covers the outer few percent of it,
 * so the outer cards were cut off mid-character in game.
 *
 * SO IT IS PINNED TO `INNER_WIDTH` NOW, RECOMPUTED RATHER THAN RESTATED. The
 * value moves the moment `SAFE_INSET` moves, which is exactly what the owner
 * needs to be able to do: dial one number to what his bezel actually eats and
 * have the layout follow it without a redesign.
 */
expect(
  'five columns fill the safe area rather than the surface',
  columnWidth(5),
  Math.floor((INNER_WIDTH - 4 * 12) / 5),
)
expectTrue(
  'and the safe area is a real inset on both axes',
  INNER_WIDTH < BOARD_WIDTH && INNER_HEIGHT < BOARD_HEIGHT,
)
/**
 * SIX TO EIGHT PERCENT PER SIDE IS THE BAND THE OWNER NAMED, and it is asserted
 * as a band rather than as the single value so that tuning it is a one-line
 * change and abandoning the safe area entirely is not.
 */
{
  const insetX = (BOARD_WIDTH - INNER_WIDTH) / 2 / BOARD_WIDTH
  const insetY = (BOARD_HEIGHT - INNER_HEIGHT) / 2 / BOARD_HEIGHT
  expectTrue(
    `the horizontal inset is title-safe (${(insetX * 100).toFixed(1)}% per side)`,
    insetX >= 0.05 && insetX <= 0.1,
  )
  expectTrue(
    `the vertical inset is title-safe (${(insetY * 100).toFixed(1)}% per side)`,
    insetY >= 0.05 && insetY <= 0.1,
  )
}
/**
 * THE REST OF THE SAFE AREA IS ASSERTED AGAINST THE RENDERED DOCUMENT and is
 * therefore further down, under "the safe area reaches the document" - this
 * section runs before the fixtures are rendered.
 */

/**
 * THE SQUAD ROWS FIT AT EVERY SIZE THE GUARD ALLOWS. The game's own
 * `maxSquadSize` is four, so four is the count that matters and it gets the
 * taller floor; five and six exist only because `SQUAD_MAX_ROWS` protects the
 * layout against a config change on a box this console does not own, and for
 * those the bar is that they fit and stay legible rather than that they look
 * generous.
 */
/**
 * ═══ AND THEY FIT WHILE THEY ARE STILL ARRIVING, WHICH IS THE HALF THAT WAS
 *     WRONG ═══
 *
 * Every card, tile and squad row enters from 20px below where it settles. On the
 * leaderboard that is free - the cards end 75px clear of the bottom. On the
 * squad slide the rows are sized to FILL the panel, so the last one entered at
 * 724px on a 720px surface and had its bottom edge and its rounded corner
 * clipped for the length of the transition. Measured in a real browser, not
 * reasoned about: a still screenshot of the finished state shows nothing wrong.
 *
 * So the bound below is the ENTERING position, not the settled one.
 */
const ENTRANCE_PX = 20
for (let n = 2; n <= SQUAD_MAX_ROWS; n++) {
  const h = squadRowHeight(n)
  const content = n * h + (n - 1) * 12 + SQUAD_HEAD_H + 12
  /** Centered in the panel, so the slack is split evenly above and below. */
  const slackBelow = Math.floor((CONTENT_HEIGHT - content) / 2)
  expectTrue(
    `${n} squad rows fit in ${CONTENT_HEIGHT}px (${content}px used)`,
    content <= CONTENT_HEIGHT,
  )
  expectTrue(
    `${n} squad rows are still inside the surface while they arrive (${slackBelow}px of travel room)`,
    slackBelow >= ENTRANCE_PX,
  )
  /**
   * ═══ THE ROW CLEARS ITS OWN TYPE, WHICH USED TO BE TWO MAGIC NUMBERS ═══
   *
   * This read `h >= (n <= 4 ? 130 : 85)` - two constants standing in for "the
   * 34px numeral fits", written when the row height was fixed and the type was
   * fixed too. Both of those stopped being true in the same change: the safe
   * area and the title between them take 152px out of what the slide divides,
   * so a six-row squad now gets 68px per row rather than 89.
   *
   * A FIXED FLOOR WOULD HAVE FAILED HERE FOR THE WRONG REASON. 68px is not too
   * short for a row - it is too short for a 40px numeral, which is a different
   * statement and is fixable by scaling the numeral, which is what
   * `squadValueSize` now does. So the assertion is the real relationship: the
   * name and the value both fit inside the row with room for the line box, at
   * whatever size they came out.
   */
  const name = squadNameSize(h)
  const value = squadValueSize(h)
  expectTrue(
    `${n} squad rows clear the type they carry (${h}px row, ${name}px name, ${value}px value)`,
    Math.max(name, value) * 1.35 <= h,
  )
  /**
   * AND THE TYPE IS STILL LEGIBLE AT A DISTANCE, THROUGH A TEXTURE. Scaling to
   * fit is only an answer while the answer is still readable; below this the
   * honest report is that the squad does not fit, not a row of four-point type.
   * The game's own maximum squad is four and that case is held to the size the
   * slide has always rendered.
   */
  expectTrue(
    `${n} squad rows are still readable (${value}px numeral)`,
    value >= (n <= 4 ? 34 : 22),
  )
}

// ===========================================================================
// D. THE DOCUMENT
// ===========================================================================

console.log('\nD. the document')

/**
 * A NAME BUILT TO BREAK OUT. Player names are typed by the account holder and
 * painted on a wall every other player is looking at; this is the one string on
 * the page that an outsider controls.
 */
const HOSTILE = `<script>alert(1)</script>" onload='x' & <b>bold</b>`

const HOSTILE_ROWS: BoardRow[] = [
  {
    ...row({ name: HOSTILE, wins: 99, kills: 99, matches: 99, revives: 99, xp: 99 }),
    license: `license:${'a'.repeat(40)}`,
  },
  ...ROWS,
]

const VIEWER = HOSTILE_ROWS[0]!.license

function render(motion: MotionLevel): string {
  return renderScoreboard({
    board: rankBoard(HOSTILE_ROWS, { viewer: VIEWER }),
    player: playerPanelFrom(HOSTILE_ROWS[0]!, HOSTILE_ROWS, {}),
    motion,
  })
}

const FULL = render('full')
const TRANSITIONS = render('transitions')
const OFF = render('off')

const BOARD_ONLY = renderScoreboard({
  board: rankBoard(ROWS),
  player: null,
  motion: 'full',
})

/**
 * THE SAME BOARD WITH A SQUAD ON IT.
 *
 * THE HOSTILE NAME IS ON A SQUAD MATE AND NOT ON THE VIEWER, deliberately. The
 * leaderboard's names come from a DynamoDB row; the squad slide's come from the
 * live snapshot, which is `GetPlayerName` on the game box. Two sources, two
 * interpolations, and the escaping has to hold at both - so the injection is
 * driven through the one the first HOSTILE_ROWS does not reach.
 */
const SQUAD_PAD: LivePlayer[] = [
  { license: VIEWER, name: 'quiet', squadId: SQ, src: 5 },
  { license: L(2), name: HOSTILE, squadId: SQ, src: 11 },
  { license: L(3), name: 'mike', squadId: SQ, src: 22 },
]

const SQUAD_RENDER = renderScoreboard({
  board: rankBoard(HOSTILE_ROWS, { viewer: VIEWER }),
  player: playerPanelFrom(HOSTILE_ROWS[0]!, HOSTILE_ROWS, {}),
  squad: squadPanelFrom({
    members: SQUAD_PAD,
    careerOf: () => null,
    viewer: VIEWER,
    /** WITH COLORS, so `squadStyles` is exercised by every document assertion. */
    colors: squadColors(SQUAD_PAD, SQ),
  }),
  motion: 'full',
})

/** The label is only ever printed, so it is wider than `MotionLevel`. */
const LEVELS: Array<[string, string]> = [
  ['full', FULL],
  ['transitions', TRANSITIONS],
  ['off', OFF],
  /**
   * THE SQUAD DOCUMENT GOES THROUGH EVERY GENERAL ASSERTION IN THIS SECTION,
   * not only the ones below that are about squads: the escaping, the fixed
   * surface, the CEF 103 parse, the compositable allowlist, the fetch ban and
   * the absence of a message listener are all properties of THE DOCUMENT, and a
   * third panel is a third chance to break each of them.
   */
  ['full+squad', SQUAD_RENDER],
]

console.log(
  `   full ${FULL.length.toLocaleString()} bytes, ` +
    `transitions ${TRANSITIONS.length.toLocaleString()}, ` +
    `off ${OFF.length.toLocaleString()}`,
)

console.log('\nD. player names are text, never markup')

for (const [name, doc] of LEVELS) {
  expectTrue(`${name}: the injected script tag does not survive`, !doc.includes('<script>alert(1)'))
  expectTrue(`${name}: nor does the attribute break`, !doc.includes(`onload='x'`))
  expectTrue(`${name}: nor the bold tag`, !doc.includes('<b>bold</b>'))
  expectTrue(`${name}: it is escaped instead`, doc.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  expectTrue(`${name}: the ampersand is escaped once, not twice`, !doc.includes('&amp;amp;'))
  expect(`${name}: exactly one script element, and it is ours`, doc.split('<script').length - 1, 1)
  expect(`${name}: and it is closed exactly once`, doc.split('</script>').length - 1, 1)
}

expect('esc: ampersand first, so nothing is double-encoded', esc('&<>'), '&amp;&lt;&gt;')
expect('esc: both quote characters', esc(`"'`), '&quot;&#39;')
expect('esc: an ordinary name is untouched', esc('Slippery Jim'), 'Slippery Jim')

console.log('\nD. the surface is fixed and cannot scroll')

for (const [name, doc] of LEVELS) {
  expectTrue(`${name}: width is pinned to ${BOARD_WIDTH}px`, doc.includes(`width: ${BOARD_WIDTH}px`))
  expectTrue(`${name}: height is pinned to ${BOARD_HEIGHT}px`, doc.includes(`height: ${BOARD_HEIGHT}px`))
  expectTrue(`${name}: overflow is hidden, a DUI has no scrollbar`, doc.includes('overflow: hidden'))
  expectTrue(`${name}: no media query to make it responsive`, !/@media/.test(doc))
}

console.log('\nD. the safe area reaches the document')

/**
 * ═══ THE CROP IS A PHYSICAL BEZEL AND THIS IS THE WHOLE DEFENCE AGAINST IT ═══
 *
 * Owner, 2026-09-11: "It doesn't look like the crop landed with the redesign."
 *
 * The prop's model box is wider than its lit screen, so a strip down each edge
 * of this page is behind plastic in game. Nothing in this repository can see
 * that, and no amount of rendering the page in a browser shows it - which is
 * exactly why the inset has to be held by the suite rather than by whoever
 * remembers.
 */
for (const [name, doc] of LEVELS) {
  /**
   * THE PANEL'S PADDING IS THE INSET. This is the one declaration that decides
   * whether the safe area exists at all: every other number derives from
   * `INNER_WIDTH` and `INNER_HEIGHT`, and all of them would still be
   * self-consistent on a panel padded 16px.
   */
  expectTrue(
    `${name}: the panel is padded to the safe area, not to a margin`,
    doc.includes(
      `padding: ${Math.round(BOARD_HEIGHT * SAFE_INSET)}px ${Math.round(BOARD_WIDTH * SAFE_INSET)}px;`,
    ),
  )
  /**
   * AND THE BACKGROUND STILL COVERS THE WHOLE SURFACE, which is the other half
   * of the fix and the half a content inset can silently lose. Only the CONTENT
   * is inset; if the wash and the vignette were inset with it, the board would
   * wear a black frame that reads as a mistake from the first glance.
   */
  for (const layer of ['.wash {', '.vig {'] as const) {
    const block = doc.slice(doc.indexOf(layer))
    const body = block.slice(0, block.indexOf('}'))
    expectTrue(
      `${name}: ${layer} still paints the full ${BOARD_WIDTH}x${BOARD_HEIGHT}`,
      body.includes(`width: ${BOARD_WIDTH}px`) && body.includes(`height: ${BOARD_HEIGHT}px`),
    )
  }
  /**
   * AND NO SLIDE LAYS CONTENT OUT AGAINST THE PANEL. The three slides divide
   * `CONTENT_HEIGHT`, which is the safe area with the title already taken out of
   * it. A slide left on `height: 100%` would fill the padded panel and push its
   * last row up under the title's own band.
   */
  for (const selector of ['.cards {', '.pstack {', '.squad {'] as const) {
    const block = doc.slice(doc.indexOf(selector))
    const body = block.slice(0, block.indexOf('}'))
    expectTrue(
      `${name}: ${selector} is sized to the content height, not the panel`,
      body.includes(`height: ${CONTENT_HEIGHT}px`),
    )
  }
}

console.log("\nD. the owner's three titles, verbatim and alone")

/**
 * ═══ HIS WORDS, AND THE FIRST WORDS EVER ADDED TO THIS SURFACE ═══
 *
 * 2026-09-11: "The scoreboard page should also have a title at the top reading
 * 'LEADERBOARD' and the player stats should have one reading 'PLAYER STATS' and
 * the squad one reading 'SQUAD STATS'."
 *
 * ASSERTED THE SAME WAY HIS CATEGORY LABELS ARE, and for the same reason: the
 * standing rule for this page is that nothing on it is written by anybody but
 * him, so the risk is not that a title goes missing, it is that a helpful
 * subtitle appears beside one.
 */
{
  const titled = SQUAD_RENDER
  for (const [id, title] of [
    ['board', TITLES[0]],
    ['player', TITLES[1]],
    ['squad', TITLES[2]],
  ] as Array<[string, string]>) {
    expectTrue(`the ${id} slide carries "${title}"`, titled.includes(`>${title}</h1>`))
    expect(`and exactly once`, titled.split(`>${title}</h1>`).length - 1, 1)
  }
  expect('there are exactly three titles on a three-slide board', titled.split('<h1').length - 1, 3)
  /**
   * AND NOTHING IS ADDED BESIDE THEM. Every heading is the title and the closing
   * tag, with no second element and no text node after the word.
   */
  for (const heading of titled.match(/<h1[^>]*>([^]*?)<\/h1>/g) ?? []) {
    const text = /<h1[^>]*>([^]*?)<\/h1>/.exec(heading)?.[1] ?? ''
    expectTrue(
      `the heading "${text}" is the owner's word and nothing else`,
      (TITLES as readonly string[]).includes(text),
    )
  }
  /** A solo player has two slides and therefore two titles, not three. */
  expect('a solo board carries two', FULL.split('<h1').length - 1, 2)
  /**
   * ON THE COMMENT-STRIPPED DOCUMENT, because the stylesheet quotes the owner's
   * whole sentence - all three titles - in the prose beside the rule that sets
   * them. Searching the raw document finds the explanation and reports that a
   * solo board is showing the squad title.
   */
  expectTrue('and not the squad one', !stripComments(FULL).includes(TITLES[2]))
  /** And the title band is real height rather than a heading with default margins. */
  expectTrue(
    'the title has a height of its own, so the slides can subtract it',
    FULL.includes(`height: ${TITLE_H}px`),
  )
}

console.log("\nD. the viewer's row is marked in the markup")

expectTrue('the highlighted row reaches the document', FULL.includes('<li class="you"'))
expect(
  'and it is marked once per card the viewer appears on',
  FULL.split('<li class="you"').length - 1,
  rankBoard(HOSTILE_ROWS, { viewer: VIEWER }).categories.filter((c) =>
    c.entries.some((e) => e.you),
  ).length,
)
expectTrue(
  'a board with no viewer marks nothing',
  !BOARD_ONLY.includes('class="you"'),
)

console.log('\nD. the accent is ink and fill, never an edge')

/**
 * ═══ TWO NOTES FROM THE OWNER, AND THEY ARE THE SAME NOTE ═══
 *
 * "Don't add the low-effort color borders. We don't need those and it makes the
 * product look AI-generated."
 *
 * "your agent is literally just coloring the text. Stop doing low-effort
 * things. Color the interface. Color the cards. have gradients. add PIZZAZZ"
 *
 * ═══ THIS RULE USED TO SAY `color:` AND ONLY `color:`, WHICH WAS THE WRONG
 *     READING ═══
 *
 * It was written from the first note alone and it forbade the second one: a
 * card could not be painted in its category's hue because a fill is not ink.
 * What followed was a board of flat near-black rectangles with one tinted word
 * on each, which is precisely what he then threw out.
 *
 * SO THE LINE IS BETWEEN FILL AND EDGE RATHER THAN BETWEEN INK AND EVERYTHING.
 * What he objected to, three times, is a SINGLE TOKEN OF COLOR DROPPED ON A FLAT
 * SURFACE - a 4px bar, a saturated slab, a tinted label. A gradient that runs
 * through a whole card is not that, and a 4px accent stripe still is. So an
 * accent may be:
 *
 *   `color:`            ink. The label, the podium numerals, the leader's value.
 *   `background-image:` fill. The card's gradient, the header band, the glow.
 *   `background-color:` fill, for the same reason.
 *
 * and it may not be anything else. `border`, `border-top`, `border-left-color`,
 * `outline` and every property nobody has thought of fail, because this is an
 * allowlist of the two roles rather than a list of the shapes he named.
 *
 * READ OUT OF THE DECLARATION RATHER THAN OFF THE PRECEDING CHARACTERS. The old
 * version asserted the color was preceded by exactly `color:`, which is a test
 * a gradient stop fails for the right reason and a `background-image` with four
 * stops fails for the wrong one. This walks back to the start of the
 * declaration - the last `;` or `{` before it - and reads the property name.
 */
const INK_OR_FILL = new Set(['color', 'background-image', 'background-color'])

function propertyAt(doc: string, at: number): string {
  const start = Math.max(doc.lastIndexOf(';', at), doc.lastIndexOf('{', at))
  const declaration = doc.slice(start + 1, at)
  return /([a-z-]+)\s*:/.exec(declaration)?.[1] ?? '(none)'
}

for (const [name, doc] of LEVELS) {
  for (const category of CATEGORIES) {
    let at = doc.indexOf(category.accent)
    while (at !== -1) {
      const property = propertyAt(doc, at)
      expectTrue(
        `${name}: ${category.key}'s color lands in ${property}, which is ink or fill`,
        INK_OR_FILL.has(property),
      )
      at = doc.indexOf(category.accent, at + 1)
    }
  }
  expectTrue(`${name}: no accent bar element survives`, !doc.includes('class="rule"'))
  expectTrue(`${name}: and no rule to style one`, !/\.rule\s*\{/.test(doc))
  expectTrue(`${name}: no border-left-color anywhere`, !doc.includes('border-left-color'))
  /**
   * AND NO BORDER IS THICKER THAN A HAIRLINE, whatever color it is. Every edge
   * on this page is one pixel of `PALETTE.edge`; the 4px bar he named was the
   * shape, and a 3px or 6px one in a neutral grey would read as the same
   * decoration with the color taken off.
   */
  expectTrue(
    `${name}: every border is one pixel`,
    /** `border-radius` is a corner and not an edge, so it is not in this. */
    !/border(-(top|right|bottom|left))?(-width)?:\s*(?!1px)\d+px/.test(doc),
  )
}

/**
 * AND THE CARDS ARE ACTUALLY PAINTED, which is the half a ban cannot assert.
 * Every enabled category must appear in the document as a fill as well as as
 * ink - otherwise this whole section passes perfectly on the flat board it was
 * written to replace.
 */
for (const category of enabledCategories()) {
  expectTrue(
    `full: ${category.key} has a column class to paint`,
    FULL.includes(`class="col c-${category.key}"`),
  )
  expectTrue(
    `full: and a card fill in its own color`,
    new RegExp(`\\.c-${category.key} \\.card \\{\\n  background-image:`).test(FULL),
  )
  expectTrue(
    `full: and a header band in it`,
    new RegExp(`\\.c-${category.key} \\.card h2 \\{[^}]*background-image:`).test(FULL),
  )
}

/**
 * AND THE HIGHLIGHT THE OWNER ASKED FOR IS STILL THERE. Removing the accent bar
 * from the viewer's row must not have removed the row's fill with it: "if the
 * player viewing the scoreboard is anywhere on it - highlight that row."
 */
expectTrue(
  'the highlighted row still has its fill',
  new RegExp(
    `\\.card li\\.you, \\.mate\\.you \\{[^}]*background: ${PALETTE.you};`,
  ).test(FULL),
)

console.log("\nD. the viewer's row wears the inventory's focus treatment")

/**
 * ═══ THE OWNER POINTED AT A SPECIFIC THING HE LOOKS AT EVERY MATCH ═══
 *
 * 2026-09-11: "the rows we have now, when the player is in the leaderboard it's
 * just highlighted - we should also use the colored+beveled corners for that row
 * like the br_ui inventory does when each slot is in focus. You get the idea?"
 *
 * WHAT HE IS POINTING AT IS `.plate.is-active` in the gamemode's
 * `ui-src/src/index.css`, and this section asserts the PARTS of it rather than
 * that a row "looks focused", because the parts are what makes it recognizable
 * as the same object:
 *
 *   THE CHAMFER IS ON TWO OPPOSITE CORNERS AND NOT FOUR. br_ui's polygon cuts
 *   the top-right and the bottom-left. That asymmetry is the signature; four cut
 *   corners read as a rounded box, which is the shape this whole pass is
 *   removing.
 *
 *   THE CUT EDGES ARE REDRAWN. Clipping an element removes its border along the
 *   diagonals too, so without the two pseudo-elements each cut corner reads as
 *   an unfinished edge rather than as a bevel.
 *
 *   THE BEVEL AND THE EDGE COME FROM ONE VARIABLE. br_ui: "Recolour the
 *   variable, never the border." A row whose border was recolored directly would
 *   end up with diagonals in a different color from its own edge, which is the
 *   exact failure that note exists to prevent.
 */
{
  const doc = stripComments(FULL)
  const rule = /\.card li\.you, \.mate\.you \{([^}]*)\}/.exec(doc)?.[1] ?? ''

  expectTrue('the focused row is clipped at all', rule.includes('clip-path: polygon('))
  /**
   * READ OUT OF THE POLYGON RATHER THAN MATCHED AS A STRING. The four corners
   * that matter are the two that are cut and the two that are not, and a
   * whitespace change to the declaration must not be able to fail this.
   */
  const polygon = /clip-path: polygon\(([^)]*\)[^;]*)/.exec(rule)?.[1] ?? ''
  expectTrue(
    'the top-right corner is cut back by --cut',
    polygon.includes('calc(100% - var(--cut)) 0') && polygon.includes('100% var(--cut)'),
  )
  expectTrue(
    'the bottom-left corner is cut back by --cut',
    polygon.includes('var(--cut) 100%') && polygon.includes('0 calc(100% - var(--cut))'),
  )
  expectTrue(
    'and the other two corners are square, which is the whole signature',
    polygon.trim().startsWith('0 0,') && polygon.includes('100% 100%'),
  )
  expectTrue(
    'the bevel opens to br_ui\'s --cut-max rather than to a number written here',
    rule.includes('--cut: var(--cut-max);'),
  )
  expectTrue(
    'and --cut-max is declared on the surfaces themselves, so it can be overridden per surface',
    doc.includes('--cut-max:'),
  )

  /** The two diagonals that redraw the border along the cuts. */
  const diagonals =
    /\.card li\.you::after, \.card li\.you::before,\n\.mate\.you::after, \.mate\.you::before \{([^}]*)\}/.exec(
      doc,
    )?.[1] ?? ''
  expectTrue('the cut edges are redrawn', diagonals.includes('linear-gradient(45deg'))
  expectTrue(
    'in the same variable the border uses, which is the point of the variable',
    diagonals.includes('var(--edgec)') && rule.includes('border: 1px solid var(--edgec)'),
  )
  expectTrue(
    'and they are the size of the cut',
    diagonals.includes('width: var(--cut);') && diagonals.includes('height: var(--cut);'),
  )
  expectTrue(
    'one at the top right and one at the bottom left',
    doc.includes('.card li.you::after, .mate.you::after { top: 0; right: 0; }') &&
      doc.includes('.card li.you::before, .mate.you::before { bottom: 0; left: 0; }'),
  )

  /**
   * ═══ AND THE EDGE IS THE ONE COLORED EDGE ON THE PAGE, DELIBERATELY ═══
   *
   * The section above this one refuses a category accent anywhere but ink and
   * fill, on the owner's note that color borders "makes the product look
   * AI-generated". This is the exception he asked for by name, so it is written
   * down as an exception rather than allowed to slip past because the value
   * happens to be a DERIVED color that the accent scan does not recognize.
   *
   * WHAT KEEPS IT FROM BECOMING THE GENERAL CASE AGAIN: `--edgec` may carry a
   * color only on a rule whose selector contains `.you`. Every other surface on
   * the page declares it as `PALETTE.edge` and nothing else may.
   */
  const declarations = [...doc.matchAll(/([^{;}]*)\{[^}]*--edgec:\s*([^;]+);/g)]
  expectTrue('some rule sets the focus edge', declarations.length > 0)
  for (const [, selector, value] of declarations) {
    const focused = (selector ?? '').includes('.you')
    expectTrue(
      `--edgec: ${value?.trim()} is ${focused ? 'on a focused row' : 'the neutral hairline'}`,
      focused || value?.trim() === PALETTE.edge,
    )
  }
  /**
   * AND EVERY CATEGORY ACTUALLY LIGHTS ITS OWN ROW, which is the half a ban
   * cannot assert. Without this the whole section passes on a board where every
   * focused row wears the same neutral white.
   */
  for (const category of enabledCategories()) {
    expectTrue(
      `${category.key}'s focused row takes its own light`,
      new RegExp(`\\.c-${category.key} \\.card li\\.you \\{\\n  --edgec: #`).test(doc),
    )
  }
  /**
   * THE GROWTH IS DELIBERATELY NOT REPRODUCED. `.plate.is-active` also scales
   * and lifts, which is right for a slot with air around it and wrong for a row
   * in a list whose card is sized to its five rows TO THE PIXEL and clips its
   * overflow. A transform here would clip the row's own edges off.
   */
  expectTrue(
    'and the focused row does not grow, because the card it is in cannot give it room',
    !/\.card li\.you[^{]*\{[^}]*transform:/.test(doc),
  )
}

console.log('\nD. the motion, and what it is allowed to animate')

/**
 * ═══ THE ONLY PROPERTIES THAT MAY BE ANIMATED ON THIS SURFACE ═══
 *
 * WHILE ANYTHING ON THIS PAGE IS ANIMATING, CEF's COMPOSITOR IS DRIVEN AT UP TO
 * 240 FRAMES A SECOND on every machine in the pad - `NUIWindow.cpp` hardcodes
 * `windowless_frame_rate = 240` and no convar or native changes it. The page
 * cannot lower that rate. What it CAN decide is what each of those frames costs,
 * and `transform` and `opacity` are the two properties Chromium runs on the
 * compositor against layers that are already rastered: no style recalc, no
 * layout, no paint, no re-raster. Anything else on that list pays all of it on
 * Blink's main thread, 240 times a second. `visibility` is allowed because it is
 * animated DISCRETELY - it flips once at the end of a fade and never
 * interpolates.
 *
 * (THIS PARAGRAPH USED TO PRICE IT IN TEXTURE TRAFFIC AND THAT WAS WRONG. FiveM
 * blits the whole surface every game frame whether the page moved or not, from a
 * shared D3D11 texture, so there is no per-repaint upload to economize on. See
 * `lib/scoreboardPage.ts`, which carries the correction and the sources.)
 *
 * EVERYTHING ELSE IS BANNED BY THIS LIST RATHER THAN BY A NAMED BLACKLIST, which
 * is the half that survives: a blacklist of `filter`, `box-shadow` and `width`
 * is a list somebody adds `border-radius` beside. An allowlist refuses the
 * property nobody thought of.
 */
const COMPOSITABLE = new Set(['opacity', 'transform', 'visibility'])

/**
 * The document with its CSS comments removed.
 *
 * THE STYLESHEET EXPLAINS ITSELF IN PROSE and that prose contains the words this
 * section is looking for - "No glow, no pulse, no animation" is a sentence
 * saying the right thing that reads to a regular expression as an `animation:`
 * declaration. Matching against the comments would either fail on a correct page
 * or force the comments to be written around the check, which is the tail wagging
 * the dog.
 *
 * SAFE TO RUN OVER THE WHOLE DOCUMENT, base64 font payload included: the
 * sequence `/*` cannot occur in base64, whose alphabet has no asterisk.
 */
/**
 * A DECLARATION AND NOT A `const`, WHICH IS LOAD BEARING IN A FILE THAT RUNS TOP
 * TO BOTTOM. This is a script: every section below executes as it is reached, and
 * the focused-row section earlier in the file needs this. A `const` arrow would
 * be in its temporal dead zone there and the suite would throw rather than fail.
 */
function stripComments(doc: string): string {
  return doc.replace(/\/\*[\s\S]*?\*\//g, '')
}

for (const [name, full] of LEVELS) {
  const doc = stripComments(full)
  const declarations = doc.match(/transition:[^;}]+/g) ?? []
  for (const decl of declarations) {
    /**
     * `transition: opacity 620ms ease, transform 420ms cubic-bezier(.2,.8,.2,1)`
     * -> the property names.
     *
     * THE PARENTHESISED PARTS ARE REMOVED FIRST, because a timing function is
     * full of commas and splitting on those without this reads `0.8` as a
     * property name. The first version of this check did exactly that and
     * reported six failures that were not failures, which is its own lesson: a
     * gate that cries wolf gets turned off.
     */
    const properties = decl
      .replace(/^transition:/, '')
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0] ?? '')
      .filter((p) => p !== '')
    for (const property of properties) {
      expectTrue(
        `${name}: transitions ${property}, which the compositor can run`,
        COMPOSITABLE.has(property),
      )
    }
  }

  /** The keyframes may only move a transform. */
  const keyframes = doc.match(/@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? []
  for (const block of keyframes) {
    const props = (block.match(/([a-z-]+)\s*:/g) ?? []).map((m) =>
      m.replace(/\s*:$/, '').trim(),
    )
    for (const property of props) {
      expectTrue(
        `${name}: a keyframe sets ${property}, which the compositor can run`,
        COMPOSITABLE.has(property),
      )
    }
  }

  /**
   * ═══ THE TWO THAT RE-RASTERIZE, AND THE ONE THAT WAS BANNED WITH THEM BY
   *     MISTAKE ═══
   *
   * `filter` and `backdrop-filter` stay out entirely. A blur is a read of the
   * layer beneath and a re-raster of this one, and `backdrop-filter` forces a
   * readback of the whole compositing surface, which on this page is the whole
   * 1280x720 texture.
   *
   * `box-shadow` WAS ON THIS LIST AND SHOULD NOT HAVE BEEN. The reasoning was
   * "it re-rasterizes its layer", which is true of a shadow that is CHANGING and
   * false of one that is not: a static shadow is painted once into the same
   * raster as the border and the fill it belongs to, and never touched again.
   * Banning it cost the cards the one cue that makes a surface sit ON a
   * background rather than be a hole cut in it, and the owner's verdict on the
   * result was that the board looked flat and cheap.
   *
   * WHAT ACTUALLY MATTERED IS HELD BY THE ALLOWLIST ABOVE. `box-shadow` is not
   * in COMPOSITABLE, so a transition or a keyframe that moves one fails this
   * section already - which is a rule about what may be ANIMATED rather than a
   * rule about what may exist, and it is the rule that was wanted.
   */
  for (const banned of ['filter:', 'backdrop-filter:']) {
    expectTrue(`${name}: no ${banned} anywhere in the document`, !doc.includes(banned))
  }
  expectTrue(
    `${name}: the cards do have depth`,
    doc.includes('box-shadow:'),
  )

  /**
   * NO UNBOUNDED LOOP DRIVEN FROM SCRIPT. The background drift is CSS, which the
   * compositor runs without waking the main thread; a `requestAnimationFrame`
   * loop or a `setInterval` would be main-thread work forever and is the thing a
   * later "just poll for updates" edit would add.
   */
  expectTrue(`${name}: no requestAnimationFrame`, !/requestAnimationFrame/.test(doc))
  expectTrue(`${name}: no setInterval`, !/setInterval/.test(doc))
}

console.log('\nD. off really is off')

expectTrue('off: no transition property at all', !/transition:/.test(stripComments(OFF)))
expectTrue('off: no animation property at all', !/animation:/.test(stripComments(OFF)))
expectTrue('off: no keyframes at all', !/@keyframes/.test(stripComments(OFF)))
expectTrue('off: no drifting layer in the document', !OFF.includes('class="drift"'))
expect('off: the emitted transition length is zero', /TRANSITION_MS = (\d+)/.exec(OFF)?.[1], '0')

console.log('\nD. transitions is bounded and still between swaps')

expectTrue('transitions: the panels do transition', /transition:/.test(stripComments(TRANSITIONS)))
expectTrue(
  'transitions: and nothing in it is an infinite animation',
  !/@keyframes/.test(stripComments(TRANSITIONS)),
)
for (const [name, doc] of [
  ['transitions', TRANSITIONS],
  ['off', OFF],
] as Array<[string, string]>) {
  /**
   * READ AS A CLASS PREFIX RATHER THAN AS AN EXACT ATTRIBUTE. Every moving layer
   * carries a family class and its own, `class="beam bm1"`, so a test for
   * `class="beam"` matches nothing and passes for the wrong reason - which is
   * exactly what it did when the second sweep landed.
   */
  for (const family of ['orb', 'beam', 'sheet', 'mote', 'pulse']) {
    expectTrue(
      `${name}: no ${family} layer is in the document at all`,
      !new RegExp(`class="${family}[ "]`).test(doc),
    )
  }
  /**
   * THE STILL LAYERS DO SURVIVE, and that is the point of the split: `off` is
   * the level for a struggling pad, not a level that looks unfinished. The
   * wash and the vignette are one raster each at load and nothing after.
   */
  expectTrue(`${name}: but the wash and the vignette are still painted`, doc.includes('class="wash"') && doc.includes('class="vig"'))
  expectTrue(`${name}: and nothing is promoted, because nothing moves`, !doc.includes('will-change'))
  expectTrue(`${name}: no animation-delay`, !doc.includes('animation-delay'))
}
expect(
  'transitions: the emitted transition length is TRANSITION_MS',
  /TRANSITION_MS = (\d+)/.exec(TRANSITIONS)?.[1],
  String(TRANSITION_MS),
)
expectTrue(
  'transitions: the CSS duration is the same number',
  TRANSITIONS.includes(`opacity ${TRANSITION_MS}ms`),
)

console.log('\nD. the animated background, which only full has')

/**
 * ═══ THE OWNER ASKED FOR THIS BY NAME AND THIS IS WHAT HOLDS ITS SHAPE ═══
 *
 * "Also give us an animated background (be sure it will work on CEF 103)." What
 * is asserted is not that it looks good - nothing here can see it - but the four
 * properties that decide whether it is affordable and whether it renders at all
 * in the game: HOW MANY layers move, that every one of them is PROMOTED, that
 * every one of them animates only a property the compositor can run (the
 * allowlist above already holds that), and that each loop CLOSES so the wall
 * does not jump once a minute in front of somebody standing at it.
 */
/**
 * ═══ IT WAS FIVE LAYERS AND IT IS EIGHTEEN, ON THE OWNER'S SECOND NOTE ═══
 *
 * 2026-09-11: "Also please spice up the background further. We need more moving
 * pieces to this."
 *
 * EVERY MOVING LAYER IS A FAMILY CLASS PLUS ITS OWN, and that is what this list
 * is keyed on. The family carries the promotion and the loop; the element
 * carries its geometry, its own period and its own random phase.
 */
const MOVING_LAYERS = [
  ['orb', 'o1'],
  ['orb', 'o2'],
  ['orb', 'o3'],
  ['beam', 'bm1'],
  ['beam', 'bm2'],
  ['sheet', 'drift'],
  ['sheet', 'weave'],
  ['pulse', ''],
  ...Array.from({ length: 10 }, (_, i) => ['mote', `mt${i}`]),
] as Array<[string, string]>

/** The ten motes, by name, for the sections that have to walk their keyframes. */
const MOTES = MOVING_LAYERS.filter(([family]) => family === 'mote').map(([, key]) => key)

for (const [family, key] of MOVING_LAYERS) {
  const className = key === '' ? family : `${family} ${key}`
  expect(
    `full: exactly one ${key === '' ? family : key} layer`,
    FULL.split(`class="${className}"`).length - 1,
    1,
  )
}
/**
 * AND THE COUNT IS ASSERTED IN BOTH DIRECTIONS. A layer added to the page and
 * not to this list would not be checked for a closed loop, for a compositable
 * property or for a phase of its own - which is how one silently synchronized
 * layer gets onto every machine in the pad.
 */
expect(
  'full: and there are no moving layers the suite does not know about',
  (FULL.match(/class="(orb|beam|sheet|mote|pulse)[ "]/g) ?? []).length,
  MOVING_LAYERS.length,
)
/**
 * ═══ EVERY MOVING LAYER IS PROMOTED, AND NOTHING ELSE IS ═══
 *
 * `will-change: transform` is what keeps a layer rastered once and moved by the
 * compositor rather than re-rastered at each new position. It is also a GPU
 * texture per element, so it is asserted in BOTH directions: the two rules that
 * need it have it, and there are exactly two of them. A third would be promotion
 * sprinkled on something that does not move.
 */
for (const [rule, selector, property] of [
  ['the three orbs', '.orb {', 'transform'],
  ['the two sweeps', '.beam {', 'transform'],
  ['the two striped sheets', '.sheet {', 'transform'],
  ['the ten motes', '.mote {', 'transform'],
  /** The one layer that moves by alpha rather than by position. */
  ['the breathing pool', '.pulse {', 'opacity'],
] as Array<[string, string, string]>) {
  const block = FULL.slice(FULL.indexOf(selector))
  const body = block.slice(0, block.indexOf('}'))
  expectTrue(`full: ${rule} are promoted`, body.includes(`will-change: ${property}`))
}
/**
 * ═══ PROMOTION IS SPENT FIVE TIMES FOR EIGHTEEN LAYERS, WHICH IS THE POINT ═══
 *
 * `will-change` is a real GPU texture per element, so the count of DECLARATIONS
 * is the page's honest promotion budget: five families rather than eighteen
 * sprinkled declarations. A sixth would be promotion on something that does not
 * move, or a layer that got its own rule instead of joining a family.
 *
 * COUNTED ON THE COMMENT-STRIPPED DOCUMENT. The stylesheet explains itself in
 * prose and that prose says "will-change" out loud, so counting the raw document
 * counts the explanation as if it were a declaration - which it did, and the
 * answer was six.
 */
expect(
  'full: and promotion is spent five times for eighteen layers, not sprinkled',
  (stripComments(FULL).match(/will-change:/g) ?? []).length,
  5,
)
expect(
  'full: every one of them loops forever',
  (stripComments(FULL).match(/infinite/g) ?? []).length,
  /** One shared declaration per family: orb, beam, sheet, mote, pulse. */
  5,
)

/**
 * ═══ EACH ORB'S PATH CLOSES, WHICH IS WHAT STOPS THE JUMP ═══
 *
 * A wandering layer whose 100% keyframe is not its 0% keyframe teleports back at
 * the end of every loop. That is invisible in a preview - nobody watches a
 * preview for a minute - and it is the single most obvious defect possible on a
 * wall somebody stands in front of for the length of a warmup.
 */
for (const wanderer of ['o1', 'o2', 'o3', ...MOTES]) {
  const block = new RegExp(`@keyframes ${wanderer} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? ''
  const first = /0%\s*\{\s*transform:\s*([^;]+);/.exec(block)?.[1]?.trim()
  const last = /100%\s*\{\s*transform:\s*([^;]+);/.exec(block)?.[1]?.trim()
  expectTrue(`full: ${wanderer} declares both ends of its loop`, !!first && !!last)
  expect(`full: ${wanderer}'s loop closes where it started`, last, first)
  /** And it has to actually go somewhere in between, or it is a still layer. */
  const stops = [...block.matchAll(/transform:\s*translate3d\(([^)]*)\)/g)].map((m) => m[1])
  expectTrue(`full: ${wanderer} actually travels`, new Set(stops).size > 1)
}

/**
 * ═══ AND THE MOTE FIELD IS SCATTERED RATHER THAN GRIDDED ═══
 *
 * Ten dots on an arithmetic progression is a pattern, and a pattern moving behind
 * a leaderboard reads as a rendering artifact rather than as atmosphere. The
 * positions come out of a deterministic scatter, so this asserts the PROPERTY
 * that scatter exists for: no two motes share a position, and they do not all sit
 * at the same size or on the same loop.
 */
{
  const doc = stripComments(FULL)
  const lefts = new Set<string>()
  const sizes = new Set<string>()
  const durations = new Set<string>()
  for (const key of MOTES) {
    const rule = new RegExp(`\\.${key} \\{([^}]*)\\}`).exec(doc)?.[1] ?? ''
    lefts.add(`${/left: (-?[\d.]+)px/.exec(rule)?.[1]},${/top: (-?[\d.]+)px/.exec(rule)?.[1]}`)
    sizes.add(/width: ([\d.]+)px/.exec(rule)?.[1] ?? '')
    durations.add(/animation-duration: ([\d.]+)s/.exec(rule)?.[1] ?? '')
  }
  expect('full: every mote is somewhere different', lefts.size, MOTES.length)
  expectTrue('full: and they are not all the same size', sizes.size > 2)
  expectTrue('full: nor all on the same loop', durations.size > 4)
}

/**
 * THE SHEET'S LOOP HAS NO SEAM, AND THAT IS ARITHMETIC RATHER THAN TASTE. The
 * stripes repeat every 160px along a 120deg gradient, whose unit vector is
 * (sqrt(3)/2, 1/2). The keyframe translates by (-138.564, -80), and the
 * projection of that onto the gradient direction has to be a whole number of
 * periods or the layer jumps every cycle.
 *
 * READ OUT OF THE `drift` KEYFRAME BY NAME, not out of the first translate in
 * the document. The orbs above also translate, so a search for "the first move
 * with a non-zero x and y" now finds an orb and measures the wrong layer - which
 * is exactly what it did when the orbs landed, and the check failed loudly
 * rather than quietly measuring something else, which is the whole point.
 */
/**
 * ═══ AND IT IS RECOMPUTED FROM THE SHEET'S OWN ANGLE AND PERIOD NOW ═══
 *
 * This used to hardcode `sqrt(3)/2` and `160` - the 120deg direction and the
 * stripe period of the one sheet that existed. There are two sheets on different
 * angles with different periods, and two copies of that arithmetic with four
 * magic numbers between them is two things to get wrong.
 *
 * SO THE ANGLE AND THE PERIOD ARE READ OUT OF THE GRADIENT. The angle is the
 * first argument of the `repeating-linear-gradient`; the period is its largest
 * stop position, which is where the pattern repeats. A
 * `repeating-linear-gradient(Ddeg, ...)` runs along the unit vector
 * (sin D, -cos D) in screen coordinates, so any translation whose projection onto
 * that vector is a whole number of periods is seamless and everything else jumps
 * once per cycle.
 */
for (const sheet of ['drift', 'weave']) {
  const rule = new RegExp(`\\.${sheet} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? ''
  const angle = Number(/repeating-linear-gradient\(\s*(-?[\d.]+)deg/.exec(rule)?.[1])
  const period = Math.max(
    ...[...rule.matchAll(/\s([\d.]+)px[,\n)]/g)].map((m) => Number(m[1])),
    0,
  )

  const block = new RegExp(`@keyframes ${sheet} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? ''
  const move = /to\s*\{\s*transform:\s*translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px, 0\)/.exec(block)

  expectTrue(`full: the ${sheet} sheet declares an angle and a period`, angle > 0 && period > 0)
  expectTrue(`full: the ${sheet} keyframe actually moves`, move !== null)
  if (move && angle > 0 && period > 0) {
    const radians = (angle * Math.PI) / 180
    const projection = Math.abs(
      Number(move[1]) * Math.sin(radians) + Number(move[2]) * -Math.cos(radians),
    )
    const periods = projection / period
    /**
     * THE TOLERANCE IS ON BOTH ARMS AND IT HAS TO BE. The translation is written
     * to three decimal places (`114.315px` for `132 cos 30`), so the projection
     * lands a few ten-thousandths short of a whole period rather than on it -
     * which is a rounding artifact of the stylesheet and not a seam. A bare
     * `periods >= 1` reads 0.99999 as "less than one period" and fails a
     * correct sheet.
     */
    expectTrue(
      `full: the ${sheet} sheet travels a whole number of its own ${period}px stripe periods (${periods.toFixed(4)})`,
      Math.abs(periods - Math.round(periods)) < 0.001 && periods >= 0.999,
    )
  }
}
/**
 * AND THE TWO SHEETS ARE ACTUALLY DIFFERENT, which is the only reason there are
 * two. Two sheets on the same angle at the same speed are one sheet drawn twice.
 */
{
  const angles = ['drift', 'weave'].map((sheet) =>
    /repeating-linear-gradient\(\s*(-?[\d.]+)deg/.exec(
      new RegExp(`\\.${sheet} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? '',
    )?.[1],
  )
  expectTrue('full: the two sheets cross rather than agree', angles[0] !== angles[1])
}

/**
 * ═══ THE SWEEP HAS NO SEAM EITHER, AND ITS REASON IS DIFFERENT ═══
 *
 * An orb closes its loop because it wanders inside the frame and a 100%
 * keyframe that is not the 0% one teleports in full view. The sweep cannot
 * close - it crosses the board in one direction - so it is seamless a different
 * way: it is ENTIRELY OFF THE SURFACE at both ends of its animation, and the
 * reset happens where nobody can see it.
 *
 * WHICH IS GEOMETRY AND THEREFORE CHECKABLE. The layer is a rotated rectangle,
 * so its footprint on the page is the bounding box of the rotation:
 * `w*cos + h*sin` wide, centered on the element's own center because that is
 * where `transform-origin` defaults to. At 0% the right edge of that box has to
 * be left of zero and at 100% its left edge has to be past `BOARD_WIDTH`.
 *
 * IT IS RECOMPUTED HERE RATHER THAN ASSERTED AS TWO MAGIC NUMBERS, because
 * every one of the five inputs is a number somebody will nudge by eye - the
 * angle, the width, the height, the offset and the travel - and four of the
 * five change the answer.
 */
/**
 * BOTH SWEEPS ARE CHECKED AND THEY TRAVEL IN OPPOSITE DIRECTIONS, so "off the
 * left edge" and "off the right edge" are not fixed sides. What is asserted is
 * that BOTH ends of the journey are entirely off the surface, whichever way round
 * they are.
 */
for (const sweep of ['bm1', 'bm2']) {
  const rule = new RegExp(`\\.${sweep} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? ''
  const shared = /\.beam \{([^]*?)\n\}/.exec(FULL)?.[1] ?? ''
  const num = (property: string): number =>
    Number(
      new RegExp(`${property}:\\s*(-?[\\d.]+)px`).exec(rule)?.[1] ??
        new RegExp(`${property}:\\s*(-?[\\d.]+)px`).exec(shared)?.[1] ??
        Number.NaN,
    )

  const left = num('left')
  const width = num('width')
  /** The height is on the shared `.beam` rule, which is why `num` reads both. */
  const height = num('height')

  const block = new RegExp(`@keyframes ${sweep} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? ''
  const ends = [...block.matchAll(/translate3d\((-?[\d.]+)px, 0, 0\) rotate\((-?[\d.]+)deg\)/g)]

  expectTrue(`full: the ${sweep} sweep declares both ends of its travel`, ends.length === 2)
  if (ends.length === 2 && Number.isFinite(left + width + height)) {
    const angle = (Number(ends[0]![2]) * Math.PI) / 180
    const footprint =
      Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))
    const center = left + width / 2

    const at = (travel: number): number => center + travel
    const first = at(Number(ends[0]![1]))
    const last = at(Number(ends[1]![1]))

    const clear = (x: number): boolean =>
      x + footprint / 2 < 0 || x - footprint / 2 > BOARD_WIDTH

    expectTrue(
      `full: the ${sweep} sweep starts entirely off the surface (${(first - footprint / 2).toFixed(0)}..${(first + footprint / 2).toFixed(0)}px)`,
      clear(first),
    )
    expectTrue(
      `full: and ends entirely off the other side (${(last - footprint / 2).toFixed(0)}..${(last + footprint / 2).toFixed(0)}px)`,
      clear(last) && Math.sign(first) !== Math.sign(last),
    )
    /** And it has to actually cross, rather than leave and come back. */
    expectTrue(
      `full: and it crosses the whole board on the way`,
      Math.abs(last - first) > BOARD_WIDTH,
    )
    expect(
      `full: and the ${sweep} sweep does not change angle on the way across`,
      ends[0]![2],
      ends[1]![2],
    )
  }
}
/**
 * AND THE TWO SWEEPS CROSS, which is the only reason there are two: one blade
 * every half minute is a wall that does something occasionally, two on periods
 * that do not divide each other never pass at the same place twice.
 */
{
  const angleOf = (sweep: string): string | undefined =>
    /rotate\((-?[\d.]+)deg\)/.exec(
      new RegExp(`@keyframes ${sweep} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? '',
    )?.[1]
  const durationOf = (sweep: string): string | undefined =>
    /animation-duration: ([\d.]+)s/.exec(
      new RegExp(`\\.${sweep} \\{([^]*?)\\n\\}`).exec(FULL)?.[1] ?? '',
    )?.[1]

  expectTrue('full: the two sweeps are tilted differently', angleOf('bm1') !== angleOf('bm2'))
  expectTrue('full: and run on different periods', durationOf('bm1') !== durationOf('bm2'))
  expectTrue(
    'full: which do not divide each other, so they never repeat an arrangement',
    Number(durationOf('bm2')) % Number(durationOf('bm1')) !== 0,
  )
}

console.log('\nD. the background starts at a random point, per client')

/**
 * ═══ THE OWNER RULED SYNCHRONIZATION OUT AND THIS IS THE WHOLE MECHANISM ═══
 *
 * "the content doesn't need to be time synced on everyone's client. Each one
 * having a different background is fine - nobody will know."
 *
 * THE DELAYS MUST BE NEGATIVE. A positive `animation-delay` is a PAUSE, so a
 * page that drew a positive one would sit motionless for up to a minute at the
 * top of a warmup - the exact opposite of the request, and the kind of thing
 * that reads as "the background is broken on my machine". A negative delay means
 * "already running", which starts it mid-loop with no wait.
 */
{
  const delays = [...FULL.matchAll(/animation-delay:\s*(-?[\d.]+)s/g)].map((m) => Number(m[1]))
  expect('full: one delay per moving layer', delays.length, MOVING_LAYERS.length)
  /**
   * AND THE ROUTE DRAWS EXACTLY THAT MANY NUMBERS. `PHASE_COUNT` is what the
   * route's `randomPhases()` is sized from, so a fifth moving layer added
   * without raising it would silently get phase zero on every client in the
   * lobby - the one layer that IS synchronized, which is the failure nobody
   * would ever see.
   */
  expect('full: and the route is told to draw that many', PHASE_COUNT, MOVING_LAYERS.length)
  expectTrue(
    'full: and every one of them is negative, so nothing waits to start',
    delays.every((d) => d <= 0),
  )

  /**
   * A FULL-LENGTH SET OF PHASES, DERIVED FROM `PHASE_COUNT` RATHER THAN WRITTEN
   * OUT. These were five literals, and five literals against eighteen layers
   * would have left thirteen of them on the renderer's `?? 0` fallback - so the
   * "different phases render a different document" case below would have passed
   * while thirteen layers were identical in both, which is the failure this
   * whole section exists to catch.
   */
  const spread = (from: number): number[] =>
    Array.from({ length: PHASE_COUNT }, (_, i) => ((from + i * 0.137) % 1))

  const same = renderScoreboard({
    board: rankBoard(HOSTILE_ROWS, { viewer: VIEWER }),
    player: playerPanelFrom(HOSTILE_ROWS[0]!, HOSTILE_ROWS, {}),
    motion: 'full',
    phases: spread(0.1),
  })
  const again = renderScoreboard({
    board: rankBoard(HOSTILE_ROWS, { viewer: VIEWER }),
    player: playerPanelFrom(HOSTILE_ROWS[0]!, HOSTILE_ROWS, {}),
    motion: 'full',
    phases: spread(0.1),
  })
  const other = renderScoreboard({
    board: rankBoard(HOSTILE_ROWS, { viewer: VIEWER }),
    player: playerPanelFrom(HOSTILE_ROWS[0]!, HOSTILE_ROWS, {}),
    motion: 'full',
    phases: spread(0.43),
  })

  /**
   * AND EVERY LAYER'S DELAY ACTUALLY MOVED, not just the first five. Comparing
   * the two documents as a whole would pass on one changed character.
   */
  const delaysOf = (doc: string): string[] =>
    [...doc.matchAll(/animation-delay:\s*(-?[\d.]+)s/g)].map((m) => m[1] ?? '')
  expect('full: every layer carries a delay', delaysOf(same).length, PHASE_COUNT)
  expect(
    'full: and every one of them moves when the phases do',
    delaysOf(same).filter((d, i) => d !== delaysOf(other)[i]).length,
    PHASE_COUNT,
  )

  /** The renderer is pure, which is why the route holds the `Math.random()`. */
  expect('the same phases render the same document', same, again)
  expectTrue('and different phases render a different one', same !== other)
  expectTrue(
    'the difference is only the delays, not the board',
    same.replace(/animation-delay:[^;]+;/g, '') === other.replace(/animation-delay:[^;]+;/g, ''),
  )
}

console.log('\nD. the two dwell times are two, and the transition is added to them')

expectTrue('the player dwell is named in the page', FULL.includes('PLAYER_DWELL_MS'))
expectTrue('the board dwell is named in the page', FULL.includes('BOARD_DWELL_MS'))
expectTrue(
  'they are different values, which is the property the owner asked for',
  (PLAYER_DWELL_MS as number) !== (BOARD_DWELL_MS as number),
)
expectTrue(`the player value is emitted`, FULL.includes(String(PLAYER_DWELL_MS)))
expectTrue(`the board value is emitted`, FULL.includes(String(BOARD_DWELL_MS)))
/**
 * A DWELL IS TIME SPENT STILL. Scheduling the next swap at `dwell` alone would
 * mean the transition ate into the time either view was readable, so raising
 * TRANSITION_MS would silently shorten both.
 */
expectTrue(
  'the next swap is scheduled dwell PLUS transition',
  FULL.includes('+ TRANSITION_MS'),
)

expectTrue('the squad dwell is named when there is a squad', SQUAD_RENDER.includes('SQUAD_DWELL_MS'))
expectTrue('and its value is emitted', SQUAD_RENDER.includes(String(SQUAD_DWELL_MS)))

console.log('\nD. with no per-player half there is nothing to alternate')

expectTrue('no second panel', !BOARD_ONLY.includes('id="player"'))
expectTrue('no script at all', !BOARD_ONLY.includes('<script'))
expectTrue('no timer', !BOARD_ONLY.includes('setTimeout'))
expectTrue('and the leaderboard is still there', BOARD_ONLY.includes('id="board"'))

console.log('\nD. two slides in solos, three in squads')

/**
 * ═══ THE RULE THE OWNER GAVE, HELD IN THE DOCUMENT RATHER THAN IN A COMMENT
 *     ═══
 *
 * "the slide appears ONLY when the viewer is in a squad, so solos cycles two
 * slides and squads cycles three."
 */
expectTrue('solos: there is no squad panel', !FULL.includes('id="squad"'))
expect('solos: the cycle names two panels', (FULL.match(/\['(board|player|squad)',/g) ?? []).length, 2)

expectTrue('squads: there is one', SQUAD_RENDER.includes('id="squad"'))
expect(
  'squads: the cycle names three',
  (SQUAD_RENDER.match(/\['(board|player|squad)',/g) ?? []).length,
  3,
)
expect(
  'and exactly one of them starts visible',
  (SQUAD_RENDER.match(/class="panel on"/g) ?? []).length,
  1,
)
expectTrue(
  'which is the leaderboard, because it is what first paint should be',
  SQUAD_RENDER.includes('<div id="board" class="panel on"'),
)

console.log('\nD. the squad slide, rendered')

{
  expect(
    'one heading per category',
    SQUAD_RENDER.split('class="mlabel"').length - 1,
    enabledCategories().length,
  )
  expect('one row per mate', SQUAD_RENDER.split('class="mate').length - 1, 3)
  expect('the viewer is marked once', SQUAD_RENDER.split('class="mate you').length - 1, 1)

  /**
   * AND EVERY ROW CARRIES ITS MATE'S OWN COLOUR, the viewer's included. The
   * viewer's row is the one that can lose it: `.mate.you` sets the `background`
   * shorthand, which zeroes `background-image`, so the color rule has to be two
   * classes deep to win. A single-class rule would leave exactly one row grey
   * and it would be the row the player is looking for.
   */
  expect('one color rule per mate', SQUAD_RENDER.split('.mate.sqc-').length - 1, 6)
  expectTrue(
    "and the viewer's row is one of them",
    SQUAD_RENDER.includes('class="mate you sqc-'),
  )

  /**
   * PLAYER NAMES ON THIS SLIDE ARE THE LIVE ONES AND ARE EQUALLY PLAYER
   * AUTHORED. They come from `GetPlayerName` rather than from a DynamoDB row,
   * which is a DIFFERENT source from the leaderboard's names and therefore a
   * second place the escaping has to hold. The hostile name below is a squad
   * mate, not the viewer.
   */
  expectTrue('a hostile squad mate name does not survive as markup', !SQUAD_RENDER.includes('<script>alert(1)'))
  expectTrue('it is escaped instead', SQUAD_RENDER.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  expect('and there is still exactly one script element', SQUAD_RENDER.split('<script').length - 1, 1)
}

console.log('\nD. the page cannot throw on the DUI message it is sent')

/**
 * br_core's shared DUI plumbing pushes `{"t":"scale","text":1}` into every
 * browser it owns on the first frame (`br_core/client/dui.lua`). It is an
 * interface-size preference for the game's own pages and means nothing here.
 * This document registers no `message` listener at all, which is the only
 * handling that cannot throw on a shape it did not expect.
 */
for (const [name, doc] of LEVELS) {
  expectTrue(`${name}: no message listener`, !/addEventListener\(\s*['"]message/.test(doc))
  expectTrue(`${name}: no onmessage handler`, !/onmessage/.test(doc))
}

console.log('\nD. Chromium 103 can parse all of it')

/**
 * THE ENGINE IS EIGHT YEARS OLD AND THE FAILURE IS SILENT. `oklch()` is Chrome
 * 111; a custom property holding one is accepted at parse time and fails later at
 * substitution, so the page looks perfect in a desktop browser and arrives
 * unstyled in the game. `scripts/check-cef-css.mjs` exists because this console
 * learned that from a screenshot. This document sidesteps the whole class by
 * never using anything newer than flexbox, and this is what holds it there.
 */
for (const [name, doc] of LEVELS) {
  for (const [label, pattern] of [
    ['oklch', /okl(ch|ab)\(/i],
    ['color-mix', /color-mix\(/i],
    [':has()', /:has\(/],
    ['container queries', /@container/],
    ['optional chaining in the script', /\?\./],
    ['a nullish coalesce in the script', /\?\?/],
  ] as Array<[string, RegExp]>) {
    expectTrue(`${name}: no ${label}`, !pattern.test(doc))
  }
}

console.log('\nD. the document fetches nothing')

/**
 * ONE REQUEST AND NO SECOND ONE. This is fetched by a game client on somebody's
 * home connection at the same moment it is streaming a map. A webfont over the
 * wire, a stylesheet or an image would be a second round trip that can hang, and
 * a DUI that hangs is a prop wearing a half-painted page with nothing to say so.
 *
 * `url(` IS NOW ALLOWED AND `@font-face` IS EXPECTED, because the typefaces are
 * embedded. What is asserted instead is the property those bans were standing in
 * for: EVERY `url(` IN THE DOCUMENT IS A `data:` URI. That is the real rule, and
 * it is the one a future `url(/logo.svg)` breaks.
 */
for (const [name, doc] of LEVELS) {
  for (const [label, pattern] of [
    ['an absolute URL', /https?:\/\//],
    ['a protocol-relative URL', /["'(]\/\//],
    ['a stylesheet link', /<link/i],
    ['an image', /<img/i],
    ['a frame', /<iframe/i],
    ['a CSS import', /@import/i],
  ] as Array<[string, RegExp]>) {
    expectTrue(`${name}: no ${label}`, !pattern.test(doc))
  }

  const urls = doc.match(/url\(([^)]*)/g) ?? []
  expectTrue(`${name}: the document does reference something with url()`, urls.length > 0)
  for (const u of urls) {
    expectTrue(
      `${name}: every url() is inline, not a fetch (${u.slice(0, 24)}...)`,
      u.startsWith('url(data:'),
    )
  }
}

console.log("\nD. the typefaces are the project's own")

/**
 * Owner: "And what is the font being used? Doesn't seem to be ours." It was not:
 * the first board asked for `'Segoe UI', Tahoma, Arial`.
 *
 * THE PROJECT HAS EXACTLY TWO FACES and the gamemode's `ui-src/tailwind.config.ts`
 * names them: `display: Anton`, `sans: Barlow`. These are the same two files the
 * game ships, embedded rather than linked.
 */
expect('two faces, no more', EMBEDDED_FACES.length, 2)
expect(
  'and they are the two the game uses',
  EMBEDDED_FACES.map((f) => f.family).sort().join(','),
  'Anton,Barlow',
)
for (const [name, doc] of LEVELS) {
  expect(`${name}: one @font-face per face`, (doc.match(/@font-face/g) ?? []).length, 2)
  expectTrue(`${name}: the display face is asked for`, doc.includes(`'Anton'`))
  expectTrue(`${name}: the body face is asked for`, doc.includes(`'Barlow'`))
  expectTrue(
    `${name}: and nothing still asks for the wrong one`,
    !doc.includes('Tahoma'),
  )
}

console.log('\nD. the palette is legible')

/**
 * A WCAG FLOOR ON A SURFACE THAT HAS LESS MARGIN THAN A WEB PAGE, not more: this
 * is read at a distance, through a texture that is being downsampled, on a
 * monitor and a gamma this console has never seen. `check-contrast.mjs` holds
 * the console's Discord accent surfaces to the same number for a related reason.
 *
 * THE CATEGORY ACCENTS ARE PULLED OFF THE CATALOG rather than listed here, so a
 * sixth category added tomorrow is measured on the day it is added.
 *
 * AND IT IS `CATEGORIES`, NOT `enabledCategories()`. The blocked spenders
 * category carries an accent that cannot reach a screen yet, which is exactly
 * why it has to be measured NOW: the day somebody flips one boolean is not the
 * day to discover the color they picked is illegible on a card.
 *
 * ═══ THE BACKGROUNDS ARE THE REAL ONES NOW, AND THEY USED TO BE A CONSTANT
 *     ═══
 *
 * Every accent used to be measured against the flat `#171c26` a card was. There
 * are no flat cards any more: a label sits on a header band which is its accent
 * at 24% over a card top which is that accent again at 13%, which is LIGHTER
 * than the old value and therefore a harder test for light type. `contrastPairs`
 * in the renderer composites each of those and hands back the pair, so what is
 * measured here is what a player is actually looking at rather than a surface
 * that no longer exists.
 *
 * THE SQUAD COLORS ARE IN TOO. A mate's name is painted in their own blip color
 * on their own row, and those eight hexes come from the GAMEMODE rather than
 * from this repository - so the one thing this console can do about them is
 * find out early if one of them cannot be read on a dark row.
 */
const FLOOR = 4.5
const PAIRS = contrastPairs(CATEGORIES, SQUAD_COLORS)
for (const [label, fg, bg] of PAIRS) {
  const f = parseHex(fg)
  const b = parseHex(bg)
  if (!f || !b) {
    fail(`contrast: ${label}`, `${fg} on ${bg} did not parse`)
    continue
  }
  ran++
  const ratio = contrastRatio(relativeLuminance(f), relativeLuminance(b))
  const mark = ratio < FLOOR ? 'FAIL' : '  ok'
  if (ratio < FLOOR) failed++
  console.log(`  ${mark}  ${label.padEnd(20)} ${fg} on ${bg}  ${ratio.toFixed(2)}:1`)
}

/**
 * ═══ AND NONE OF THEM IS PURPLE ═══
 *
 * `br_lib/shared/enums.lua`, on the squad palette: "NEVER PURPLE, in any slot:
 * purple belongs to the storm alone." The gamemode backs that with
 * `--color-storm: #c026d3`, and a player who has learned that purple means the
 * wall is closing in should not meet a purple wall in the warmup area.
 *
 * A HUE BAND RATHER THAN A LIST OF BANNED HEXES, because the rule is about the
 * color and not about one value somebody typed. `level` was `#c9a6ff` and the
 * background's second light was `rgba(201, 166, 255)`; a list would have caught
 * those two and nothing else.
 *
 * 255 TO 320 DEGREES. Blue ends around 250 and magenta-pink starts around 320 -
 * `#f472b6`, which is on the game's own squad palette at hue 330 and is
 * therefore, by the gamemode's own reckoning, not purple.
 */
function hueOf(color: string): number {
  const c = parseHex(color)
  if (!c) return -1
  /** `parseHex` already returns the three channels as 0..1. */
  const [r, g, b] = c
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

for (const c of CATEGORIES) {
  const hue = hueOf(c.accent)
  expectTrue(
    `${c.key}'s accent is not the storm's color (${c.accent}, hue ${hue.toFixed(0)})`,
    hue < 255 || hue >= 320,
  )
}
for (const [name, doc] of LEVELS) {
  expectTrue(`${name}: no purple survives anywhere in the document`, !/#c9a6ff|#c026d3|201, 166, 255/i.test(doc))
}

console.log('\nD. formatting')

expect('counts are grouped', formatCount(1234567), '1,234,567')
expect('and grouped the same way wherever the server is', formatCount(1000), '1,000')
expect('a fraction is truncated rather than shown', formatCount(12.7), '12')
expect('a non-number is zero rather than NaN on a wall', formatCount(Number.NaN), '0')

// ===========================================================================
// E. THE CACHE
// ===========================================================================

console.log('\nE. one scan serves the whole lobby')

interface Counters {
  scans: number
  adminReads: number
  errors: string[]
}

function sources(
  clock: { now: number },
  counters: Counters,
  behavior: { reject?: boolean } = {},
): BoardSources {
  return {
    async scanProfiles() {
      counters.scans++
      if (behavior.reject) throw new Error('AccessDeniedException')
      return ROWS
    },
    async adminLicenses() {
      counters.adminReads++
      return [ROWS[0]!.license]
    },
    now: () => clock.now,
    log: (_level, message) => counters.errors.push(message),
  }
}

{
  const clock = { now: 1_000_000 }
  const counters: Counters = { scans: 0, adminReads: 0, errors: [] }
  const cache = newSnapshotCache()
  const deps = sources(clock, counters)

  const first = await snapshotFrom(cache, { hideAdmins: false }, deps)
  expectTrue('a cold start builds a board', first !== null)
  expect('one scan', counters.scans, 1)
  expect(
    'the admin table is not read at all with the flag off',
    counters.adminReads,
    0,
  )

  await snapshotFrom(cache, { hideAdmins: false }, deps)
  await snapshotFrom(cache, { hideAdmins: false }, deps)
  expect('a second and third read inside the TTL cost nothing', counters.scans, 1)

  /** The stampede: a full field arrives in the same instant, past the TTL. */
  clock.now += SNAPSHOT_TTL_MS + 1
  await Promise.all(
    Array.from({ length: 48 }, () => snapshotFrom(cache, { hideAdmins: false }, deps)),
  )
  expect('forty-eight simultaneous requests cost exactly one scan', counters.scans, 2)
}

{
  const clock = { now: 2_000_000 }
  const counters: Counters = { scans: 0, adminReads: 0, errors: [] }
  const cache = newSnapshotCache()
  const deps = sources(clock, counters)

  const built = await snapshotFrom(cache, { hideAdmins: true }, deps)
  expect('the flag on reads the admin table once per build', counters.adminReads, 1)
  expect('and the snapshot carries the licenses', built?.admins.size, 1)
  expectTrue(
    'which are the ones the ranking then drops',
    rankBoard(built!.rows, { hidden: built!.admins }).categories
      .find((c) => c.key === 'wins')!
      .entries.every((e) => e.name !== 'alpha'),
  )
}

console.log('\nE. a failed refresh leaves the last good board up')

{
  const clock = { now: 3_000_000 }
  const counters: Counters = { scans: 0, adminReads: 0, errors: [] }
  const cache = newSnapshotCache()

  const good = await snapshotFrom(cache, { hideAdmins: false }, sources(clock, counters))
  expectTrue('a board was built', good !== null)

  const broken = sources(clock, counters, { reject: true })
  clock.now += SNAPSHOT_TTL_MS + 1

  const served = await snapshotFrom(cache, { hideAdmins: false }, broken)
  expectTrue('the stale board is served rather than nothing', served !== null)
  expect('and it is the one we already had', served?.at, good?.at)

  /** Let the failing refresh settle before asking what it logged. */
  await new Promise((r) => setTimeout(r, 0))
  expect('the failure is logged', counters.errors.length, 1)
  expectTrue(
    'and the log names the fallback rather than just the exception',
    counters.errors[0]!.includes('last good copy'),
  )

  clock.now += SNAPSHOT_TTL_MS + 1
  await snapshotFrom(cache, { hideAdmins: false }, broken)
  await new Promise((r) => setTimeout(r, 0))
  /**
   * ON THE TRANSITION, NOT ON THE TICK. Every client in the lobby polls this;
   * logging per failure would bury the journal somebody would be reading to find
   * out why the wall is stale.
   */
  expect('a second failure does not log again', counters.errors.length, 1)
}

{
  const clock = { now: 4_000_000 }
  const counters: Counters = { scans: 0, adminReads: 0, errors: [] }
  const cache = newSnapshotCache()
  const broken = sources(clock, counters, { reject: true })

  const nothing = await snapshotFrom(cache, { hideAdmins: false }, broken)
  expect(
    'a cold start that fails has nothing to serve, and says so with null',
    nothing,
    null,
  )
}

// ===========================================================================
// F. THE MIDDLEWARE EXEMPTION
// ===========================================================================

console.log('\nF. the route is reachable without a session')

expect(
  'this check really is running in production mode, or F asserts nothing',
  process.env.NODE_ENV,
  'production',
)

const HOST = 'ringmaster.blitz-royale.com'

function through(path: string, init: { method?: string; origin?: string } = {}): number {
  const headers = new Headers({ host: HOST })
  if (init.origin) headers.set('origin', init.origin)
  return middleware(
    new NextRequest(`https://${HOST}${path}`, { method: init.method ?? 'GET', headers }),
  ).status
}

/**
 * A 307 HERE IS A DISCORD LOGIN FORM PAINTED ON A PROP. A DUI follows redirects
 * and renders whatever arrives with a 200, so the failure is not an error on
 * screen, it is the wrong page rendered confidently.
 */
expect('the board, with no cookie', through(`/scoreboard?id=${OWNER_ID}`), 200)
expect('and with no query string either', through('/scoreboard'), 200)

/**
 * THE EXEMPTION IS AN EXACT PATH, NOT A PREFIX, and these are what hold it
 * there. A `startsWith('/scoreboard')` would open every future path under that
 * name to an unauthenticated fetch by having been named similarly.
 */
expect('a lookalike path is still bounced', through('/scoreboardx'), 307)
expect('a path beneath it is still bounced', through('/scoreboard/secret'), 307)

/** The bounce still bounces, or the case above proves nothing. */
expect('an ordinary page with no cookie', through('/players'), 307)
expect('the root with no cookie', through('/'), 307)

/**
 * SKIPPING THE BOUNCE IS NOT SKIPPING THE ORIGIN REFUSAL. Nothing skips that,
 * and it runs before this path is looked at.
 */
expect(
  'a cross-origin write aimed at this path is still refused',
  through('/scoreboard', { method: 'POST', origin: 'https://evil.example' }),
  403,
)

// ===========================================================================
// G. THE LEVEL IS DERIVED
// ===========================================================================

console.log('\nG. the level comes from xp, never from the row')

{
  /**
   * `br-players` CARRIED A STORED `level` AND IT IS NOT TRUSTWORTHY. It was
   * derived data written at match end from a read-modify-write, `lib/xp.ts`
   * records this console showing level 2 for a player the lobby showed as level
   * 3 because of exactly that, and #116 has stopped writing it. `BoardRow` has no
   * such field, and this proves that a row carrying one anyway is ignored rather
   * than preferred.
   */
  const withStoredLevel = {
    ...row({ name: 'mike', xp: 90_000 }),
    level: 99,
  } as BoardRow

  const shown = level().display(withStoredLevel)
  expect('a stored level on the row is ignored', shown, formatCount(levelFor(90_000)))
  expectTrue('and it is not 99', shown !== '99')

  /**
   * ORDERED BY XP, SHOWN AS THE LEVEL. Two players inside the same level have
   * the same displayed number and a strict order, which is what stops the card
   * reshuffling a heap of level 12s every time the cache refreshes.
   */
  const a = row({ name: 'aaa', xp: 90_000 })
  const b = row({ name: 'bbb', xp: 90_500 })
  expect('the two are the same level', level().display(a), level().display(b))
  expectTrue('but xp orders them', level().sortValue(b) > level().sortValue(a))

  const card = rankBoard([a, b]).categories.find((c) => c.key === 'level')
  expect('and the higher xp is first', card?.entries[0]?.name, 'bbb')
}

// ===========================================================================
// H. THE EMBEDDED FONTS ARE THE FILES ON DISK
// ===========================================================================

console.log('\nH. the embedded fonts match the woff2 beside them')

/**
 * ═══ THE FAILURE THIS CATCHES IS A COMMENT THAT DISAGREES WITH THE BYTES ═══
 *
 * `src/lib/scoreboardFonts.ts` is generated from `src/lib/fonts/*.woff2` by
 * `scripts/build-scoreboard-fonts.mjs` and is committed so that a clean clone
 * builds with no generation step. The cost of committing generated output is
 * that it can drift: somebody swaps a face on disk, does not regenerate, and the
 * repository now says one thing and serves another. Decoding and comparing is
 * cheap and removes the whole class.
 */
for (const face of EMBEDDED_FACES) {
  const onDisk = readFileSync(resolve(ROOT, 'src/lib/fonts', face.file))
  const embedded = Buffer.from(face.base64, 'base64')

  expect(`${face.file}: the declared length is the real one`, face.bytes, onDisk.length)
  expect(`${face.file}: the embedded length matches`, embedded.length, onDisk.length)
  expectTrue(`${face.file}: byte for byte identical`, embedded.equals(onDisk))
  /** woff2, not woff and not a ttf renamed. A ttf here would be four times the size. */
  expect(`${face.file}: it really is woff2`, embedded.subarray(0, 4).toString('latin1'), 'wOF2')
}

/**
 * THE LICENSE TRAVELS WITH THE FONT. Both faces are SIL Open Font License 1.1,
 * which requires the notice to be distributed with them. Nothing here is paid
 * for; this asserts the notices are actually present rather than assumed.
 */
for (const notice of ['OFL-Anton.txt', 'OFL-Barlow.txt']) {
  const text = read(`src/lib/fonts/${notice}`)
  expectTrue(`${notice} is the OFL`, text.includes('SIL OPEN FONT LICENSE Version 1.1'))
}

// ===========================================================================
// I. ACCESS-CONTROL-ALLOW-ORIGIN
// ===========================================================================

console.log('\nI. Access-Control-Allow-Origin, on every answer')

/**
 * ═══ WHY THIS IS A GATE AND NOT A LINE OF DOCUMENTATION ═══
 *
 * The game client cannot tell "Ringmaster answered 503" from "Ringmaster is
 * gone" without it. `br_core/client/board.lua` spells the problem out: there is
 * no load callback for a DUI and `IS_DUI_AVAILABLE` is true even against a DNS
 * failure, so the only party who can report is a page - and the page has to be
 * on a `cfx-nui-` origin to reach Lua at all. That shell page fetches this route
 * cross-origin, and without this header its only option is `mode: 'no-cors'`,
 * which returns an opaque response and cannot read a status code.
 *
 * SO THE 503 IS THE ANSWER THAT MOST NEEDS THE HEADER, and it is the one a
 * "tidy up the error paths" edit is most likely to lose. Both non-200 answers
 * are driven through the REAL exported handler below.
 */
{
  const headers = boardHeaders('text/html; charset=utf-8')
  expect('the helper sets the header', headers['access-control-allow-origin'], '*')
  expect('and does not cache', headers['cache-control'], 'no-store')
  expect('and carries the type it was given', headers['content-type'], 'text/html; charset=utf-8')
}

{
  /**
   * THE ROUTE'S OWN NOISE IS SILENCED FOR THE DURATION. Reaching the 503 means
   * the scan really fails, which logs. That is correct behavior and it is not
   * what this section is reading.
   */
  const realError = console.error
  console.error = () => {}

  const bad = await GET(new Request(`https://${HOST}/scoreboard?id=not-a-license`))
  const none = await GET(new Request(`https://${HOST}/scoreboard`))
  const outage = await GET(new Request(`https://${HOST}/scoreboard?id=${OWNER_ID}`))

  console.error = realError

  expect('a bad id is a 400', bad.status, 400)
  expect('and it carries the header', bad.headers.get('access-control-allow-origin'), '*')
  expect('a missing id is a 400', none.status, 400)
  expect('and it carries the header', none.headers.get('access-control-allow-origin'), '*')
  /**
   * DynamoDB is pointed at a closed port at the top of this file, so this is the
   * real outage path through the real store, not a stub of it.
   */
  expect('an unreachable table is a 503', outage.status, 503)
  expect('and it carries the header', outage.headers.get('access-control-allow-origin'), '*')
  expect('the 503 body is one word with nothing to parse', await outage.text(), 'no board')
}

/**
 * AND THE 200 CARRIES IT TOO, WHICH CANNOT BE DRIVEN WITHOUT A TABLE. What can
 * be proved instead is that there is no second way to build a response: every
 * `new Response` in the route takes its headers from `boardHeaders`, so a 200
 * missing the header would have to be a response built some other way, and that
 * is exactly what this counts.
 */
{
  const routeText = read('src/app/scoreboard/route.ts')
  const responses = (routeText.match(/new Response\(/g) ?? []).length
  const helpers = (routeText.match(/boardHeaders\(/g) ?? []).length
  expectTrue('the route builds more than one response', responses >= 2)
  expect('every response in the route gets its headers from one place', helpers, responses)
  expectTrue(
    'and no response sets a content-type by hand beside it',
    !/headers:\s*\{/.test(routeText),
  )
}

// ===========================================================================
}

void main().then(
  () => {
    console.log()
    if (failed > 0) {
      console.error(`check:scoreboard - ${failed} failing case(s)`)
      console.error(
        'The warmup board is read inside the game, on Chromium 103, painted ' +
          'onto a prop. Nobody looking at it can report an error. See ' +
          'src/lib/scoreboard.ts.',
      )
      process.exit(1)
    }
    console.log(`check:scoreboard - all ${ran} cases pass`)
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:scoreboard - threw', e)
    process.exit(1)
  },
)
