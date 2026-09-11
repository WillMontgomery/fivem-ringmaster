import { levelFor } from './xp'

/**
 * The warmup stat board, decided rather than drawn (#247).
 *
 * ═══ WHAT THIS IS AND WHERE IT RUNS ═══
 *
 * A DUI is a Chromium instance the GAME CLIENT creates, on the player's own
 * machine, painting a web page onto a texture that a prop in the warmup area
 * wears. So the page below is fetched once per player per DUI, by a browser
 * this console has never met, over the public internet, with no session and no
 * cookie. Ringmaster's job is the page and its route; the Lua that creates the
 * surface belongs to the game repository and is somebody else's.
 *
 * That deployment shape decides almost everything in this file and the two
 * beside it, so it is worth stating the consequences up front rather than
 * rediscovering them one at a time:
 *
 *   NO AUTH, BY THE OWNER'S CHOICE. The URL is
 *   `/scoreboard?id=<license>` and a license is not a credential anywhere in
 *   either system. Every other Ringmaster route sits behind a session or a
 *   constant-time shared secret, and the game takes a license from the FiveM
 *   connection rather than from anything a person types. Presenting one here
 *   therefore authenticates nothing and is not meant to: it selects WHOSE
 *   numbers the per-player half shows and WHICH ROW is highlighted on the
 *   leaderboard, the same way a profile URL does.
 *
 *   READ ONLY, WITH NO WAY BACK INTO THE GAME. Nothing under this feature
 *   writes to DynamoDB, calls the game box, or takes an argument that reaches
 *   either. The page cannot act, and the route exports exactly one method.
 *
 *   CHROMIUM 103, NOT A CURRENT BROWSER. FiveM's CEF is eight years behind and
 *   `scripts/check-cef-css.mjs` already exists in this repo because the console
 *   learned that the expensive way. The board sidesteps the whole problem by
 *   not using the console's stylesheet at all: it is a self-contained document
 *   in plain sRGB, which is why it is served from a route handler rather than
 *   rendered as a page under the root layout.
 *
 *   EVERY MACHINE IN THE LOBBY AT ONCE. Up to a full field fetches this inside
 *   a few seconds at the top of every warmup, so the leaderboard is built once
 *   per TTL for the whole process and handed out from memory. See
 *   `lib/scoreboardStore.ts`.
 *
 * ═══ THIS FILE IS THE PURE HALF ═══
 *
 * Constants, the category catalog, the license rule, the ranking and the
 * formatting. It reaches nothing: no DynamoDB, no environment, no request. The
 * store fetches, the renderer draws, and `scoreboard.check.ts` drives all three
 * without a network, which is only possible because the decisions live here.
 */

/**
 * ═══ THE SURFACE IS 1280x720 AND THE GAME CLIENT PINS THE SAME TWO NUMBERS ═══
 *
 * `BR.Config.Board.width/height` in the gamemode's `br_lib/config/board.lua` is
 * 1280x720 and carries a warning that the two must agree. CHANGING EITHER NUMBER
 * HERE ALONE CROPS THE PAGE SILENTLY: `CreateDui(url, w, h)` takes pixels, a
 * texture of a different size does not rescale the document, and nothing on
 * either side raises an error. They are changed together or not at all.
 *
 * WHAT IT COSTS IN VRAM, ON EVERY CLIENT, FOR AS LONG AS THE PROP EXISTS. A DUI
 * is a live RGBA texture, so the bill is width x height x 4 bytes and nothing
 * amortizes it: 1920x1080 is 8.3 MB, 1280x720 is 3.7 MB. That is 4.6 MB per
 * player of headroom given back on a client already holding a battle royale
 * map, and it is spent whether anybody is looking at the prop or not.
 *
 * IT IS ALSO THE UNIT OF THE BLIT FiveM DOES EVERY GAME FRAME, for every DUI
 * that exists, animated or not. See the motion note in `lib/scoreboardPage.ts`
 * for why that sentence used to be a per-repaint number and should not have been.
 *
 * WHAT 1080p WOULD BUY, HONESTLY: more legible small text at a distance. It
 * does not, because the limit is not the page's resolution. A prop's texture is
 * sampled at whatever screen size the prop occupies, and a board a player is
 * standing a few meters away from occupies a few hundred pixels of their actual
 * screen. Doubling the source resolution of text that is already being
 * downsampled buys sharpness nobody can resolve. The answer to "can I read it
 * from over there" is type size, not texture size, which is why the type on
 * this board is large enough to look oversized in a desktop browser.
 *
 * FIXED, AND THE PAGE MUST NEVER SCROLL. A DUI has no scrollbar, no wheel and
 * no way to reach anything below the fold, so content that overflows is content
 * that does not exist. `scoreboardPage.ts` pins both axes and hides overflow,
 * and the check asserts it.
 */
export const BOARD_WIDTH = 1280
export const BOARD_HEIGHT = 720

/**
 * ═══ THE TWO DWELL TIMES, AND WHY THEY ARE TWO ═══
 *
 * The owner asked for the page to alternate "every 10 seconds or so", and then
 * for the page itself to own the transition: "I want the page itself to
 * automatically transition between these 2 views." These are deliberately NOT
 * one shared constant, because the two halves are not the same reading job and
 * he will tune them on the pad: the per-player half is five numbers about you,
 * which is read in a glance, and the leaderboard is five cards of five rows
 * each, which is not. Starting them apart is what makes the next change a number
 * rather than a refactor.
 *
 * THEY ARE SEPARATE NAMES AS WELL AS SEPARATE VALUES, and `scoreboard.check.ts`
 * asserts both. A single constant referenced twice would satisfy "the page
 * alternates" and quietly lose the property the owner asked for.
 *
 * A DWELL IS TIME SPENT STILL, NOT TIME INCLUDING THE TRANSITION. The swap is
 * scheduled dwell + TRANSITION_MS apart, so raising `TRANSITION_MS` does not
 * silently shorten the time either panel is readable.
 */
export const PLAYER_DWELL_MS = 10_000
export const BOARD_DWELL_MS = 15_000

/**
 * How long the squad slide is held, when there is one.
 *
 * ═══ A THIRD NUMBER, BECAUSE IT IS A THIRD READING JOB ═══
 *
 * Owner: "Let's also add a slide when in squads where the player will get to see
 * the stats of their squad mates!" That slide is up to four rows of five or six
 * numbers, which sits between the per-player half (five numbers about you, read
 * in a glance) and the leaderboard (five cards of five rows). So its dwell sits
 * between the two as well, and it is a third NAME rather than a reuse of either
 * for the same reason those two are separate: the owner tunes these on the pad
 * and a shared constant makes the next change a refactor.
 */
export const SQUAD_DWELL_MS = 12_000

/**
 * How long one view takes to hand over to the other.
 *
 * ═══ THIS IS HOW LONG THE SWAP RUNS, AND THAT IS ALL IT IS ═══
 *
 * AN EARLIER VERSION OF THIS COMMENT CALLED THE TRANSITION "the expensive part
 * of this page" AND PRICED IT IN MEGABYTES PER SECOND. That was wrong, it was
 * relayed to the owner as a constraint, and the correction is written out in
 * full in `lib/scoreboardPage.ts` under THE MOTION. The short version: FiveM
 * hands CEF a shared D3D11 texture and blits it on EVERY GAME FRAME whether or
 * not the page painted, so a still page and a moving one cost the client's
 * renderer exactly the same there. Motion is not free, but what it costs is
 * frame production inside CEF, not texture traffic.
 *
 * 620ms IS LONG ENOUGH TO READ AS A TRANSITION AND SHORT ENOUGH TO STOP. The
 * owner liked it as it is - "Nice transition between pages!" - so the number is
 * not being tuned.
 */
export const TRANSITION_MS = 620

/** How many rows one leaderboard card shows. */
export const TOP_N = 5

/**
 * ═══ THE LICENSE RULE ═══
 *
 * The owner specified the URL exactly, with the BARE license:
 *
 *   https://ringmaster.blitz-royale.com/scoreboard?id=b6f5a127...5f2ae3fb
 *
 * The stored key is not that. `br-players` is partitioned on the QUALIFIED
 * identifier `license:<40 hex>` (see `BR.Identity.qualified` in the gamemode's
 * `br_lib/shared/identity.lua`, and the `license.replace(/^license:/, '')` the
 * profile page already does at the other end of the same seam). So the id in
 * the URL and the id in DynamoDB differ by a prefix, and something has to
 * reattach it. This does, in one place, so the owner's URL works as written.
 *
 * BOTH SPELLINGS ARE ACCEPTED because refusing the qualified one would be a
 * gratuitous trap for whoever writes the Lua: a resource that already holds the
 * qualified string is the likelier caller, not the less likely one.
 *
 * LOWERCASED, AND THAT IS NOT COSMETIC. DynamoDB keys are compared as bytes, so
 * an uppercase id is a different partition and would answer "never played" for
 * a player with a full career. FiveM writes these lowercase; anything else is a
 * transcription and gets normalized rather than missed.
 *
 * FORTY HEX CHARACTERS OR NOTHING. The pattern is narrow on purpose: it is the
 * only validation between a query string on the public internet and a DynamoDB
 * key, and everything it lets through it also puts in a `GetItem`. It cannot
 * carry markup, a newline, a path segment or an expression, so no downstream
 * caller has to think about whether it might.
 */
const LICENSE_HEX = /^[0-9a-f]{40}$/

export function normalizeLicense(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim().toLowerCase()
  const bare = trimmed.startsWith('license:') ? trimmed.slice('license:'.length) : trimmed

  if (!LICENSE_HEX.test(bare)) return null
  return `license:${bare}`
}

/** The qualified form's prefix, exported so the store can filter a scan on it. */
export const LICENSE_PREFIX = 'license:'

/**
 * One player's career row, reduced to what the board reads.
 *
 * PROJECTED RATHER THAN PASSED THROUGH. The game's row carries currency, owned
 * cosmetics, equipped ids and the stored level; none of that belongs on a wall
 * in the warmup area, and a shape that carried it would eventually put it
 * there. What is here is what the owner named, plus the xp the level is derived
 * from.
 *
 * ═══ DAMAGE DEALT AND PLAY TIME ARE GONE FROM THIS SHAPE, NOT JUST FROM THE
 *     LAYOUT ═══
 *
 * Owner, on seeing the first board: "Let's remove the damage and playtime from
 * the scoreboard view." They are removed from the ROW as well as from the
 * catalog, so nothing reads them, the store no longer projects them, and there
 * is no half-present field for somebody to put back on screen by accident. The
 * game still records both on the profile row; this board no longer asks.
 *
 * `level` IS ABSENT ON PURPOSE. The row has one and it is not trustworthy: it
 * is derived data written at match end from a read-modify-write, `lib/xp.ts`
 * documents the console showing level 2 for a player the lobby showed as level
 * 3 because of exactly that, and #116 has stopped storing it. The board computes
 * it from `xp` with the same function every other surface in this console uses.
 * A field that is not here cannot be read by mistake.
 */
export interface BoardRow {
  /** The partition key as the game wrote it: `license:<40 hex>`. */
  license: string
  /**
   * The in-game name, as of their last match.
   *
   * PLAYER AUTHORED, AND THE ONLY STRING ON THIS PAGE THAT IS. It is rendered
   * as a text node and never as markup; `scoreboardPage.ts` escapes it and the
   * check drives a name containing a script tag through the whole renderer.
   */
  name: string
  wins: number
  kills: number
  matches: number
  /** Revives GIVEN. See the `revives` category for where the game counts them. */
  revives: number
  /** Lifetime XP. The level is derived from this and never read from the row. */
  xp: number
  /**
   * Lifetime Volts spent.
   *
   * ⚠ READS ZERO ON EVERY ROW TODAY, AND THE `spend` CATEGORY BELOW SAYS WHY.
   * The field is projected and carried so that the day a lifetime total exists
   * the only edit left is flipping one `available`.
   */
  voltsSpent: number
}

export type CategoryKey = 'wins' | 'kills' | 'matches' | 'revives' | 'level' | 'spend'

/**
 * Everything a category knows how to do, whether or not it may do it yet.
 *
 * TWO LABELS, BECAUSE THE TWO HALVES OF THE PAGE ARE MAKING DIFFERENT CLAIMS.
 * `label` is what the leaderboard card says and is the owner's own wording,
 * verbatim and in capitals: "the cards should say things like 'Most wins' and
 * 'Top kills' and 'Top matches' and 'Most revives given' and 'Highest level'
 * (all caps of course)". `tileLabel` is the same phrase with the superlative
 * removed, because the per-player half is not a ranking: a tile reading
 * "MOST WINS  20" over one person's own number claims they hold the record.
 * Nothing is invented here - every tile label is his noun with his ranking word
 * taken off.
 *
 * TWO FUNCTIONS RATHER THAN ONE, and the split is the whole reason `level`
 * works. `sortValue` decides the ORDER and `display` decides the TEXT, and for
 * level those are different quantities: the order comes from lifetime xp, which
 * is monotonic and has no ties inside a level, and the text comes from
 * `levelFor(xp)`. Ranking on the displayed level instead would put every level
 * 12 player in an arbitrary heap and let the board reorder itself between
 * refreshes for no visible reason.
 *
 * `accent` IS INK, NOT AN EDGE. Each category carries its own color so the
 * cards read as several things rather than one grey wall - but it is spent on
 * TEXT and never on a bar, a rule or a border. Owner: "Don't add the low-effort
 * color borders. We don't need those and it makes the product look
 * AI-generated." See the stylesheet in `lib/scoreboardPage.ts`.
 */
interface CategoryShape {
  key: CategoryKey
  label: string
  tileLabel: string
  accent: string
  sortValue: (row: BoardRow) => number
  display: (row: BoardRow) => string
}

/** A category the board can actually rank. */
export interface AvailableCategory extends CategoryShape {
  available: true
}

/**
 * A category the owner asked for that the data cannot answer yet.
 *
 * ═══ IT CARRIES ITS RANKING AND ITS FORMATTING ANYWAY, AND THAT IS THE POINT
 *     ═══
 *
 * This used to be a narrower type with no `sortValue` and no `display`, so
 * turning a blocked category on meant writing both of them under time pressure
 * on the day the data landed. It carries them now, which makes the whole change
 * ONE BOOLEAN: flip `available` to true, drop `blockedBy`, and the ranking, the
 * per-player half, the squad slide, the column arithmetic and the check all pick
 * it up with no other edit. `scoreboard.check.ts` proves that by ranking the
 * blocked category through the very same code paths, with `available` forced on
 * in the check alone.
 *
 * `blockedBy` IS A NOTE TO THE NEXT READER OF THIS FILE AND NEVER REACHES THE
 * PAGE. AND THE CATEGORY IS DECLARED SO THAT IT CANNOT BE RENDERED AS ZERO IN
 * THE MEANTIME: `enabledCategories()` is the only way to get a list of
 * categories and it filters on `available`, so there is no path from here to a
 * spenders board of five people who have apparently spent nothing. A zero on a
 * leaderboard is not an absence, it is a claim about somebody.
 */
export interface BlockedCategory extends CategoryShape {
  available: false
  /** Why it cannot be ranked. Read by people, never rendered. */
  blockedBy: string
}

export type Category = AvailableCategory | BlockedCategory

/**
 * Every category, available or not.
 *
 * ═══ THE LABELS ARE THE OWNER'S, VERBATIM AND IN CAPITALS ═══
 *
 * "the cards should say things like 'Most wins' and 'Top kills' and 'Top
 * matches' and 'Most revives given' and 'Highest level' (all caps of course)".
 * Those five strings are below exactly as he wrote them, uppercased in the
 * SOURCE rather than by a `text-transform`, so that what this file says and what
 * the wall says are the same characters. There is no other prose anywhere on
 * this page: no title, no subtitle, no hint, no empty state.
 *
 * FIVE CATEGORIES, NOT SEVEN. Damage and play time were on the first board and
 * he removed them by name.
 */
export const CATEGORIES: readonly Category[] = [
  {
    key: 'wins',
    label: 'MOST WINS',
    tileLabel: 'WINS',
    accent: '#ffc65c',
    available: true,
    sortValue: (r) => r.wins,
    display: (r) => formatCount(r.wins),
  },
  {
    key: 'kills',
    label: 'TOP KILLS',
    tileLabel: 'KILLS',
    accent: '#ff8a7a',
    available: true,
    sortValue: (r) => r.kills,
    display: (r) => formatCount(r.kills),
  },
  {
    key: 'matches',
    label: 'TOP MATCHES',
    tileLabel: 'MATCHES',
    accent: '#7cc4ff',
    available: true,
    sortValue: (r) => r.matches,
    display: (r) => formatCount(r.matches),
  },
  {
    /**
     * ═══ REVIVES ARE RECORDED, AND THEY ARE REVIVES GIVEN ═══
     *
     * Checked in the gamemode repository rather than assumed, because the whole
     * card is a lie if it is counting the wrong side of the interaction:
     *
     *   `br_core/server/combat.lua` increments `reviver.revives` on the player
     *   who performed the revive, not on the one who was picked up.
     *   `br_stats/server/persist.lua` carries `revives = p.revives or 0` into
     *   the per-match deltas, and `revives` is on `STATS_ADDS` in br_ddb, which
     *   is the allowlist of attributes an atomic ADD may accumulate onto
     *   `{pk: license, sk: 'profile'}`.
     *
     * So `revives` on the profile row is a LIFETIME COUNT OF REVIVES GIVEN, and
     * the owner's label is accurate rather than approximately accurate.
     */
    key: 'revives',
    label: 'MOST REVIVES GIVEN',
    tileLabel: 'REVIVES GIVEN',
    accent: '#6ee7a8',
    available: true,
    sortValue: (r) => r.revives,
    display: (r) => formatCount(r.revives),
  },
  {
    /** Ordered by xp, shown as the level xp implies. See `AvailableCategory`. */
    key: 'level',
    label: 'HIGHEST LEVEL',
    tileLabel: 'LEVEL',
    accent: '#c9a6ff',
    available: true,
    sortValue: (r) => r.xp,
    display: (r) => formatCount(levelFor(r.xp)),
  },
  {
    /**
     * ═══ VOLTS SPENT IS RECORDED PER MATCH, AND NOWHERE AS A LIFETIME TOTAL ═══
     *
     * This entry used to say the number did not exist at all. It does now, and
     * the correction matters because the two facts lead to different work.
     *
     * WHAT LANDED (gamemode `03cce2d`, #293). `voltsSpent` is set on the roster
     * entry in `br_core/server/roster.lua`, added to in the success arm of
     * `BR.Market.charge` in `br_core/server/market.lua`, carried onto the results
     * row in `br_core/server/match.lua`, written into the history row by
     * `br_stats/server/persist.lua`, and allowlisted in br_ddb's
     * `HISTORY_NUMBERS`.
     *
     * WHAT DID NOT LAND, AND IS THE WHOLE GAP. `HISTORY_NUMBERS` governs the
     * `{pk: license, sk: 'match#...'}` ROWS. The lifetime aggregate is a
     * different allowlist, `STATS_ADDS` in `js-src/br_ddb/src/stats.js`, and
     * `voltsSpent` is not on it. So `{sk: 'profile'}` - the only row this
     * board's scan reads - HAS NO voltsSpent ATTRIBUTE AT ALL, and
     * `BoardRow.voltsSpent` reads zero for everybody.
     *
     * RANKING IT FROM HISTORY IS NOT A SMALL CHANGE, WHICH IS WHY IT IS NOT DONE
     * HERE. It would mean reading every `match#` row in `br-players` and summing
     * per license - the rows this store's scan filters OUT precisely because
     * they outnumber the profiles and keep growing. That is a different and much
     * more expensive read model, and it is a decision somebody makes on purpose.
     * The cheap fix is one line in the gamemode: add `voltsSpent` to
     * `STATS_ADDS` and to `deltasFor` in `persist.lua`, and this category becomes
     * `available: true` with a `sortValue` of `(r) => r.voltsSpent` and nothing
     * else in this repository changes.
     *
     * AND NOTHING BACKFILLS EITHER WAY. Matches played before `03cce2d` recorded
     * no spend, so the first months of any such board are a partial history
     * presented as a lifetime one. That is the owner's call to make knowingly.
     *
     * ═══ HE HAS NOW ASKED FOR THE CARD, SO THE CARD IS BUILT AND SWITCHED OFF
     *     ═══
     *
     * Owner, 2026-09-11: "Let's also add a 'Biggest spenders' category on the
     * scoreboard as well, and highest level too". Highest level already existed.
     * This one is written out in full - the label, the tile label, the accent,
     * the ranking and the formatting - and held behind `available: false`,
     * because rendering it today would put six cards of "0" on a wall and call
     * them the biggest spenders in the game. The ONLY edit left is flipping the
     * boolean below and deleting `blockedBy`; `scoreboard.check.ts` ranks this
     * exact object with `available` forced on and asserts the card comes out
     * right, so the flip is proven rather than hoped for.
     */
    key: 'spend',
    label: 'BIGGEST SPENDERS',
    /**
     * ⚠ THE ONE LABEL ON THIS PAGE THE OWNER DID NOT WRITE. Every other tile
     * label is his card label with his ranking word removed (MOST WINS -> WINS),
     * and that rule does not survive here: "BIGGEST SPENDERS" minus the
     * superlative is "SPENDERS", which is a word for a person and reads as a
     * claim when it sits over one player's own number. VOLTS SPENT is the
     * quantity itself, in the game's own name for its currency. It cannot reach
     * a screen while `available` is false, and it is in the report as something
     * for him to rule on before it can.
     */
    tileLabel: 'VOLTS SPENT',
    accent: '#ffd08a',
    available: false,
    sortValue: (r) => r.voltsSpent,
    display: (r) => formatCount(r.voltsSpent),
    blockedBy:
      'voltsSpent is on br_ddb HISTORY_NUMBERS (the match# rows) but not on ' +
      'STATS_ADDS, so the sk=profile row this board scans carries no lifetime ' +
      'total. Add voltsSpent to STATS_ADDS in js-src/br_ddb/src/stats.js and to ' +
      'deltasFor in br_stats/server/persist.lua, then flip available to true.',
  },
]

/** The categories that can be ranked today. The only way to enumerate them. */
export function enabledCategories(): AvailableCategory[] {
  return CATEGORIES.filter((c): c is AvailableCategory => c.available)
}

export interface BoardEntry {
  /** Player authored. Escaped at render. */
  name: string
  /** Already formatted for display. */
  value: string
  /**
   * Is this the player looking at the board?
   *
   * Owner: "if the player viewing the scoreboard is anywhere on it - highlight
   * that row." The comparison is on the qualified license and never on the name,
   * because names are player-authored and are not unique: two people may share
   * one, and highlighting both would tell one of them something false.
   */
  you: boolean
}

export interface RankedCategory {
  key: CategoryKey
  label: string
  accent: string
  entries: BoardEntry[]
}

export interface Leaderboard {
  categories: RankedCategory[]
  /** How many rows the ranking actually considered, after every filter. */
  considered: number
}

/**
 * Is this row a real player with a name we can put on a wall?
 *
 * TWO REJECTIONS, BOTH DELIBERATE.
 *
 * A ROW WHOSE KEY IS NOT A LICENSE IS NOT A PLAYER. `br-players` holds more than
 * players: the report-award queue lives at `{pk: 'br:reportaward', sk: 'queue'}`
 * and the game repository is free to hang more bookkeeping off the same table.
 * Filtering the scan on `sk = 'profile'` excludes today's known one; requiring
 * the partition key to be a qualified license excludes the ones nobody has
 * written yet, which is the half that survives contact with a repo this console
 * does not control.
 *
 * A ROW WITH NO NAME CANNOT BE ATTRIBUTED. `name` is a conditional SET that only
 * a match payout supplies, so a row created by a purchase alone has none. An
 * unnamed line on a leaderboard is worse than a missing one: it is a rank
 * awarded to nobody, and the alternative of falling back to the license would
 * paint a player's identifier on a wall every other player can see.
 */
function rankable(row: BoardRow): boolean {
  return (
    typeof row.license === 'string' &&
    row.license.startsWith(LICENSE_PREFIX) &&
    typeof row.name === 'string' &&
    row.name.trim() !== ''
  )
}

/**
 * What the ranking needs to know about the world beyond the rows.
 *
 * `viewer` IS A QUALIFIED LICENSE OR NOTHING. `normalizeLicense` has already run
 * by the time anything here sees it, so this never compares a bare id against a
 * qualified key and quietly highlights nobody.
 */
export interface RankOptions {
  hidden?: ReadonlySet<string>
  viewer?: string | null
  /**
   * Which categories to rank. Defaults to `enabledCategories()`, which is what
   * every caller in the application passes by omission.
   *
   * IT EXISTS SO THE BLOCKED CATEGORY CAN BE PROVEN RATHER THAN PROMISED.
   * `BiggestSpenders` is written out in full and switched off, and the claim
   * made about it is that flipping one boolean produces a correct card. The only
   * way to hold that claim is to rank the real object through this real function
   * with `available` forced on, which is what `scoreboard.check.ts` does with
   * this argument and nothing else does.
   */
  categories?: readonly AvailableCategory[]
}

/**
 * Rank every available category over one snapshot of the player table.
 *
 * PURE, AND THAT IS WHY THE ADMIN FILTER IS AN ARGUMENT. `hidden` is a set of
 * qualified licenses to leave out. Deciding WHO is an admin needs DynamoDB and a
 * config flag and belongs to the store; APPLYING that decision is arithmetic and
 * belongs here, where the check can drive it both ways in a millisecond.
 *
 * ═══ A CATEGORY WITH NO NON-ZERO ENTRY DOES NOT EXIST ═══
 *
 * Zero is filtered out of every card, and a card left with nothing is dropped
 * rather than rendered empty. This is the same rule the blocked spenders
 * category is subject to, applied to the case where the number exists and is
 * genuinely nought: on a freshly deployed server the top five by wins would
 * otherwise be five people with no wins, presented as the leaders. They are not
 * leaders, they are the first five rows the scan happened to return.
 *
 * The consequence is worth stating because the route depends on it: a board with
 * nothing true to say produces NO categories, and the route answers 503 so the
 * client falls back to static. Silence is the honest empty state, and it is also
 * the one that needs no words on screen.
 *
 * TIES BREAK ON NAME, ASCENDING. Something has to, or two players on 14 kills
 * swap places every time the cache refreshes and the board flickers between two
 * orderings for no reason a viewer could ever explain.
 *
 * A HIDDEN VIEWER IS STILL HIDDEN. If the admin filter is on and the person
 * looking at the board is an admin, they are not on it, so no row lights up.
 * That follows from the filter running first and is asserted rather than assumed.
 */
export function rankBoard(
  rows: readonly BoardRow[],
  options: RankOptions = {},
): Leaderboard {
  const hidden = options.hidden ?? new Set<string>()
  const viewer = options.viewer ?? null

  const eligible = rows.filter((r) => rankable(r) && !hidden.has(r.license))

  const categories: RankedCategory[] = []
  for (const category of options.categories ?? enabledCategories()) {
    const entries = eligible
      .filter((r) => category.sortValue(r) > 0)
      .sort((a, b) => {
        const d = category.sortValue(b) - category.sortValue(a)
        return d !== 0 ? d : a.name.localeCompare(b.name)
      })
      .slice(0, TOP_N)
      .map((r) => ({
        name: r.name,
        value: category.display(r),
        you: viewer !== null && r.license === viewer,
      }))

    if (entries.length === 0) continue
    categories.push({
      key: category.key,
      label: category.label,
      accent: category.accent,
      entries,
    })
  }

  return { categories, considered: eligible.length }
}

/**
 * Where one value sits among the rows the board considered.
 *
 * COUNTS STRICTLY GREATER AND ADDS ONE, which means everybody tied on a value
 * shares a rank rather than being ordered arbitrarily behind each other. A
 * player and the person they are level with should not be told they are 40th
 * and 41st on the strength of a `localeCompare`.
 *
 * NULL AT ZERO. A rank among people who have all done nothing is not a fact
 * about anybody, and "#412 in revives" for a player with no revives reads as an
 * accusation rather than a statistic.
 *
 * MEASURED AGAINST THE SNAPSHOT, WHILE THE VALUE COMES FROM A FRESH READ. Those
 * can disagree by up to one cache TTL, and the direction is harmless: a player
 * who just won a match sees the win immediately and their rank catches up on the
 * next refresh. The alternative, holding their own numbers back to match the
 * snapshot, would show somebody a board that had forgotten the match they just
 * finished.
 */
export function rankOf(
  rows: readonly BoardRow[],
  category: AvailableCategory,
  value: number,
  options: { hidden?: ReadonlySet<string> } = {},
): number | null {
  if (value <= 0) return null

  const hidden = options.hidden ?? new Set<string>()
  let ahead = 0
  for (const row of rows) {
    if (!rankable(row) || hidden.has(row.license)) continue
    if (category.sortValue(row) > value) ahead++
  }
  return ahead + 1
}

export interface PlayerStat {
  key: CategoryKey
  label: string
  accent: string
  value: string
  /** Null when the underlying value is zero. See {@link rankOf}. */
  rank: number | null
}

export interface PlayerPanel {
  /** Player authored. Escaped at render. */
  name: string
  stats: PlayerStat[]
}

/**
 * The per-player half.
 *
 * ═══ THE SAME FIVE STATS, PLUS WHERE THEY STAND ═══
 *
 * The owner was unsure what belonged here: "perhaps all the same, but specific
 * to their profile?". So it is the same categories in the same order with the
 * same colors, which is what makes the two halves read as one board rather than
 * as two features, and the "specific to their profile" part is the rank. A
 * number on its own is a number; a number next to the position it earns is the
 * thing somebody standing on a warmup pad actually wants to know.
 *
 * THE LABEL IS THE TILE LABEL, NOT THE CARD LABEL. See `AvailableCategory`.
 *
 * IT IS BUILT FROM THE PLAYER'S OWN ROW, NOT BY FINDING THEM IN THE SNAPSHOT. A
 * player who has never appeared in a leaderboard still has a career, and a
 * player who finished a match thirty seconds ago is not in the cached scan yet.
 * Their values are theirs; only the rank is comparative.
 */
export function playerPanelFrom(
  row: BoardRow,
  rows: readonly BoardRow[],
  options: {
    hidden?: ReadonlySet<string>
    /** See {@link RankOptions.categories}. Defaults to `enabledCategories()`. */
    categories?: readonly AvailableCategory[]
  } = {},
): PlayerPanel {
  return {
    name: row.name,
    stats: (options.categories ?? enabledCategories()).map((category) => ({
      key: category.key,
      label: category.tileLabel,
      accent: category.accent,
      value: category.display(row),
      rank: rankOf(rows, category, category.sortValue(row), options),
    })),
  }
}

/**
 * ═══ THE SQUAD SLIDE (#247) ═══
 *
 * Owner: "Let's also add a slide when in squads where the player will get to see
 * the stats of their squad mates!"
 *
 * THE ROUTE IS GIVEN ONE LICENSE AND NOTHING ELSE, so the squad has to be
 * answered here rather than asked for. What answers it is the console's own LIVE
 * SNAPSHOT: the game pushes every connected player to `/api/ingest` every two
 * seconds, `BR.Roster.ringmaster` carries `license` and `squadId` on each row
 * (`RINGMASTER_FIELDS`, `br_core/server/roster.lua`), and `lib/state.ts` holds
 * the latest one in this process. The scoreboard route reads it directly, the
 * same way `app/players/[license]/page.tsx` already does.
 *
 * ═══ AND IT REALLY CAN ANSWER IT, WHICH WAS NOT OBVIOUS ═══
 *
 * Checked in the gamemode rather than assumed, because a slide that looks right
 * and is not would be worse than no slide:
 *
 *   SQUAD IDS ARE STAMPED AT WARMUP, NOT AT MATCH START. `BR.Match.onEnter`
 *   calls `BR.Party.formSquads(m)` the moment the match enters WARMUP
 *   (`br_core/server/match.lua`), which is the same edge that creates this very
 *   board: `br_core/client/board.lua`'s `onPad()` is
 *   `BR.State.me.state == BR.PlayerState.WARMUP` and nothing else. So for the
 *   whole life of the DUI the squad is already formed.
 *
 *   THE FORMAT IS `m<5 hex>sq<n>` SINCE #291 and nothing here parses it. The id
 *   is compared as an opaque string, so the shape may change again without
 *   touching this file. `components/MatchCard.tsx` is still the one place that
 *   reads the trailing index.
 *
 *   SOLO PLAYERS HAVE NO SQUAD ID AT ALL, and that is by construction rather
 *   than by luck: `formSquads` clears `squadId` for every member and then
 *   RETURNS before assigning any when `mode == SOLO` (`br_core/server/party.lua`).
 *   So the rule the owner asked for - three slides in squads, two in solos -
 *   falls out of the data instead of needing a mode flag the route does not have.
 *
 *   THE PRE-MATCH `partyId` IS NOT IN THE SNAPSHOT and is deliberately not used.
 *   It is not on `RINGMASTER_FIELDS`, so a party that has not yet become a squad
 *   is invisible here. That is the correct answer for this surface anyway: the
 *   board only exists during warmup, and by warmup the party IS the squad.
 */
export interface LivePlayer {
  /** Qualified, as the game sends it: `license:<40 hex>`. Null before br_stats fills it. */
  license: string | null
  name: string
  squadId: string | null
}

/**
 * The most squad rows this slide will ever lay out.
 *
 * THE GAME'S OWN LIMIT IS FOUR (`BR.Config.Match.maxSquadSize`), so this is not
 * a rule, it is a LAYOUT GUARD: a config change on a box this console does not
 * own must not be able to push a sixth row off a surface that cannot scroll. If
 * squads ever do grow past this the slide shows the first rows by name order and
 * the layout survives, which is the failure worth having.
 */
export const SQUAD_MAX_ROWS = 6

/**
 * Who is in the viewer's squad right now, or nothing.
 *
 * ═══ FIVE WAYS THIS RETURNS NULL, AND EVERY ONE OF THEM IS THE HONEST ANSWER
 *     ═══
 *
 *   THE FEED IS NOT TRUSTWORTHY. `feed` is the console's own one-word verdict
 *   from `lib/feedHealth`, derived from the age of the last push. `dead` is
 *   fifteen missed pushes and `offline` is a console that has never been pushed
 *   to; in both cases the snapshot is either absent or old enough that it may be
 *   describing a previous match, and a squad slide built from that would name
 *   people who are not there. `stale` is allowed through deliberately: it is
 *   three missed pushes on a two-second cadence, and a squad is formed ONCE at
 *   the top of warmup and then does not change, so six seconds of lag cannot
 *   move anybody between squads.
 *
 *   THE VIEWER IS NOT IN THE SNAPSHOT. Nothing can be said about a squad we
 *   cannot find the person in.
 *
 *   THE VIEWER HAS NO SQUAD ID. Solos, or a player still in the lobby. This is
 *   the common case and it is not a failure.
 *
 *   FEWER THAN TWO MEMBERS. Owner's rule, verbatim: "Never render an empty or
 *   single-member squad slide." A squad of one is what a squads match looks like
 *   when everybody else has disconnected, and a slide reading "your squad" over
 *   one row is a worse answer than the two slides a solo player gets.
 *
 * ORDERED BY NAME, ASCENDING, and the viewer is not floated to the top. It is
 * the same tie-break the leaderboard uses and for the same reason: something has
 * to order these, and an order that changes between page loads is a board that
 * appears to reshuffle for no reason. The viewer is found by their highlight.
 */
export function squadFrom(
  players: readonly LivePlayer[],
  viewer: string,
  feed: 'live' | 'stale' | 'dead' | 'offline',
): { squadId: string; members: LivePlayer[] } | null {
  if (feed === 'dead' || feed === 'offline') return null

  const me = players.find((p) => p.license === viewer)
  if (!me) return null

  const squadId = me.squadId
  if (typeof squadId !== 'string' || squadId === '') return null

  const members = players
    .filter((p) => p.squadId === squadId && typeof p.license === 'string')
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SQUAD_MAX_ROWS)

  if (members.length < 2) return null
  return { squadId, members }
}

export interface SquadMate {
  /** Player authored. Escaped at render. */
  name: string
  /** Is this the person standing in front of the board? */
  you: boolean
  /** One per category, in catalog order, already formatted. */
  values: string[]
}

export interface SquadPanel {
  /** The column headings: the tile labels, in catalog order. */
  labels: { key: CategoryKey; label: string; accent: string }[]
  mates: SquadMate[]
}

/**
 * The squad slide, from the live members and whatever careers we hold.
 *
 * ═══ THE NAME COMES FROM THE SNAPSHOT AND THE NUMBERS COME FROM THE TABLE ═══
 *
 * Two sources on purpose. The snapshot's `name` is who is standing on the pad
 * right now, straight off `GetPlayerName`, and it exists for everybody. The
 * profile row's name is who they were at the end of their last match and is
 * absent for anybody who has never finished one. On a slide whose whole subject
 * is the four people beside you, the live name is the true one.
 *
 * A MATE WITH NO CAREER ROW SHOWS ZEROS, AND THAT IS NOT THE SAME MISTAKE THE
 * LEADERBOARD REFUSES TO MAKE. A zero on a leaderboard is a RANKING claim: it
 * says these five are the best in the game at something none of them has done. A
 * zero here is a fact about one named person who has genuinely not won a match
 * yet, next to their squad mates who have. Dropping them instead would be the
 * real lie: it would show a squad of three when four people are about to drop
 * together.
 */
export function squadPanelFrom(input: {
  members: readonly LivePlayer[]
  careerOf: (license: string) => BoardRow | null
  viewer: string
  categories?: readonly AvailableCategory[]
}): SquadPanel {
  const categories = input.categories ?? enabledCategories()

  return {
    labels: categories.map((c) => ({ key: c.key, label: c.tileLabel, accent: c.accent })),
    mates: input.members.map((m) => {
      const license = m.license ?? ''
      const career = license === '' ? null : input.careerOf(license)
      const row: BoardRow = career ?? {
        license,
        name: m.name,
        wins: 0,
        kills: 0,
        matches: 0,
        revives: 0,
        xp: 0,
        voltsSpent: 0,
      }
      return {
        name: m.name,
        you: license !== '' && license === input.viewer,
        values: categories.map((c) => c.display(row)),
      }
    }),
  }
}

/**
 * ═══ EVERY ANSWER THIS FEATURE SENDS, INCLUDING THE REFUSALS ═══
 *
 * ONE FUNCTION, BECAUSE THE HEADER THAT MATTERS MOST IS ON THE FAILURES. Owner:
 * "be sure to add Access-Control-Allow-Origin". The reason it cannot be added to
 * the 200 alone is written out in full at the top of `src/app/scoreboard/route.ts`:
 * the game's fallback-to-static probe lives on a `cfx-nui-` origin, and without
 * this header a cross-origin fetch can only run `mode: 'no-cors'`, which returns
 * an opaque response and CANNOT READ A STATUS. A 503 nobody can read is a 503
 * that did not happen.
 *
 * A WILDCARD IS THE RIGHT VALUE HERE, not a shortcut. The route is deliberately
 * unauthenticated, sends no cookie, accepts no credentials and returns only what
 * anybody holding that license could already fetch with curl. And the origin
 * that needs naming, `https://cfx-nui-<resource>`, cannot be written as a source
 * expression at all - `next.config.mjs` spends thirty lines on why.
 *
 * `no-store` TRAVELS WITH IT because the document contains one named player's
 * career and a shared cache that keyed loosely would show one player another
 * player's panel.
 *
 * IT IS A FUNCTION AND NOT A CONSTANT so the content type is the only thing a
 * caller chooses, and `scoreboard.check.ts` asserts that the route's response
 * count and its call count here are equal: a response built any other way is a
 * response that could be missing the header.
 */
export function boardHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  }
}

/**
 * A whole number with thousands separators.
 *
 * FIXED TO en-US RATHER THAN THE HOST LOCALE. This renders on a server whose
 * locale is an accident of the AMI and is read by players who are not there. A
 * board that groups with spaces or dots because a machine image changed is a
 * board nobody asked to change.
 */
export function formatCount(n: number): string {
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0
  return safe.toLocaleString('en-US')
}
