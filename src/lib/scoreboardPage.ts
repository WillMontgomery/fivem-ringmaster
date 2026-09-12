import {
  BOARD_DWELL_MS,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  PLAYER_DWELL_MS,
  SQUAD_DWELL_MS,
  TOP_N,
  TRANSITION_MS,
  UI_SCALE,
  type Leaderboard,
  type PlayerPanel,
  type SquadPanel,
} from './scoreboard'
import { EMBEDDED_FACES } from './scoreboardFonts'

/**
 * The warmup board as one self-contained HTML document (#247).
 *
 * ═══ WHY THIS IS A STRING AND NOT A REACT PAGE ═══
 *
 * A page under `src/app` inherits the root layout, and the root layout is wrong
 * for this surface in every particular: it imports `globals.css` (a palette
 * authored in `oklch`, which needs the whole downlevel pipeline
 * `scripts/check-cef-css.mjs` exists to police), it loads two webfonts, it
 * mounts a preferences provider, a tooltip provider and a toaster, it reads
 * cookies, and it emits a `<body class="min-h-screen">` for a viewport this
 * document does not have. None of that is reachable from a game client's DUI
 * and all of it would ship to one.
 *
 * So the board is served from a route handler, which has no layout at all, and
 * this file writes the document. What that buys, concretely:
 *
 *   ONE REQUEST. No stylesheet, no font file, no script file, no image, no
 *   favicon. The DUI fetches this URL and is finished, which matters because
 *   the fetch is happening from a player's own machine over the public internet
 *   at the same moment their client is streaming a map. The two typefaces
 *   travel inside the document as `data:` URIs for exactly this reason.
 *
 *   PLAIN sRGB, SO CEF 103 PARSES ALL OF IT. Every color below is a six-digit
 *   hex or an `rgba()`. There is no `oklch`, no `oklab`, no `color-mix`, no
 *   `:has()` and no container query, so there is nothing to downlevel and
 *   nothing to fall back to. `scoreboard.check.ts` asserts that, because the
 *   failure mode is invisible to whoever causes it: the page looks right in a
 *   modern browser and arrives unstyled in the game.
 *
 *   NO HYDRATION. Nothing on this page is interactive and nothing can be. The
 *   only script is the swap timer below.
 *
 *   NO MESSAGE LISTENER. br_core's shared DUI plumbing pushes
 *   `{"t":"scale","text":1}` into every browser it owns on the first frame
 *   (`br_core/client/dui.lua`). That is an interface-size preference for the
 *   game's own pages and means nothing here. This document registers no
 *   `message` handler at all, which is both the cheapest way to ignore it and
 *   the only way that cannot throw on a shape it did not expect. The check
 *   asserts the absence.
 *
 * ═══ THE MOTION, AND THE CORRECTION OF WHAT IT WAS SAID TO COST ═══
 *
 * Owner: "Also give us an animated background (be sure it will work on CEF
 * 103)." And, separately: "make it cheap to render as much as possible (while
 * still appearing smooth) but also know the content doesn't need to be time
 * synced on everyone's client. Each one having a different background is fine -
 * nobody will know."
 *
 * ⚠ THIS FILE USED TO SAY CONTINUOUS MOTION COST ROUGHLY 110 MB/s OF TEXTURE
 * TRAFFIC PER CLIENT. THAT WAS WRONG AND THE OWNER WAS TOLD IT. He pushed back
 * with the right question - resources stream YouTube through a DUI today and
 * nobody reports a frame cost - and the FiveM and CEF sources agree with him.
 * The facts, each read out of the source rather than inferred:
 *
 *   THERE IS NO PER-REPAINT TEXTURE UPLOAD ON WINDOWS. `NUIWindow::Initialize`
 *   sets `info.shared_texture_enabled = (!CfxIsWine() && nuiSharedResourcesEnabled)`
 *   and `nui_useSharedResources` defaults to true, so CEF hands over a D3D11
 *   SHARED HANDLE and FiveM does a GPU-local blit. Nothing crosses the PCIe bus
 *   per frame and no megabyte-per-second figure applies.
 *
 *   AND THAT BLIT HAPPENS EVERY GAME FRAME WHETHER THE PAGE MOVED OR NOT.
 *   `NUIRenderCallbacks.cpp` connects to `OnRender` and calls `UpdateFrame()` on
 *   EVERY registered NUI window unconditionally; the `m_dirtyFlag` gate exists
 *   only in the software fallback branch. So the claim "a still page costs
 *   nothing" was also wrong: a still DUI and a moving DUI cost the game's
 *   renderer the same full-surface `CopyResource` per frame, and animation's
 *   marginal contribution THERE is exactly zero.
 *
 *   THE FRAME RATE IS NOT 30. `NUIWindow.cpp` hardcodes
 *   `settings.windowless_frame_rate = 240`, no convar and no native exposes it,
 *   and the cfx CEF fork turns that straight into the OSR compositor's vsync
 *   interval (`SetDisplayVSyncParameters(..., 1000000/240 us)`). Dirty rects are
 *   not a lever either: the fork always reports the full surface as damaged, and
 *   CEF upstream documents that as a known limitation.
 *
 * ═══ SO WHAT DOES CONTINUOUS MOTION ACTUALLY COST, AND WHAT SHAPES THIS FILE
 *     ═══
 *
 * ONE THING: FRAME PRODUCTION INSIDE CEF. While anything on the page is
 * animating, CEF's compositor is asked for frames at up to 240 per second, in
 * process, on every machine in the pad. That is the real bill and the page
 * cannot lower the rate. What the page CAN decide is what each of those frames
 * costs, and the difference between the two answers is enormous:
 *
 *   1. EVERY ANIMATED PROPERTY IS `transform` OR `opacity`. Those are on
 *      Blink's `kCompositableProperties` list, so the animation ticks on the
 *      compositor against layers that are already rastered: no style recalc, no
 *      layout, no paint, no re-raster. Animating `background-position`, a
 *      gradient's stops, `filter`, `backdrop-filter`, `width` or `top` would put
 *      all of that on Blink's main thread 240 times a second instead.
 *   2. A PROMOTED LAYER IS A GPU TEXTURE, so `will-change: transform` is spent
 *      deliberately and counted, not sprinkled. Four moving layers, sized to
 *      what they actually cover.
 *   3. THE TRANSITION IS STILL BOUNDED. `TRANSITION_MS`, then the page settles
 *      and only the background is still asking for frames.
 *
 * ═══ NOTHING NEEDS A SHARED CLOCK, AND THE PAGE TAKES HIM UP ON IT ═══
 *
 * Owner: "Each one having a different background is fine - nobody will know."
 * Every moving layer gets a NEGATIVE `animation-delay` drawn at random when the
 * page is rendered, which starts it at an arbitrary point in its own loop. Two
 * players at the same prop see different backgrounds, there is no seed, no start
 * time and no synchronization mechanism of any kind, and there was never going
 * to be agreement without deliberately building some.
 *
 * SO THERE IS A KNOB, AND IT IS READ BY THE PAGE. `SCOREBOARD_MOTION` is one of
 * `full`, `transitions` or `off`, and it lands on the `<body>` class:
 *
 *   full         the view transition, PLUS the animated background. This is the
 *                only level that renders the thing the owner asked for.
 *   transitions  the view transition and nothing else. No animated background.
 *   off          no animation at all. The instant swap the board shipped with.
 *
 * It is an environment variable rather than a build-time constant so the trade
 * can be made on the pad without a redeploy. See `lib/env.ts`.
 */

export type MotionLevel = 'full' | 'transitions' | 'off'

/**
 * The palette, in the only color syntax CEF 103 can be trusted with.
 *
 * Held as named constants rather than written into the CSS inline so that
 * `scoreboard.check.ts` can put the pairs that carry text through
 * `lib/contrast.ts` and hold them to the same WCAG floor the console's own
 * accent surfaces are held to. This board is read at a distance, through a
 * texture, on somebody else's monitor and gamma; it has less margin than a web
 * page, not more.
 *
 * THE PER-CATEGORY ACCENTS ARE NOT HERE, they are on the category in
 * `lib/scoreboard.ts`, because the color belongs to the thing it names. The
 * check pulls them off the catalog and holds them to the same floor.
 */
export const PALETTE = {
  /** The floor of the page, under every gradient. */
  page: '#070a11',
  /** The neutral a card's fill is built from, before its category tints it. */
  card: '#141a26',
  /** Where every card gradient lands at the bottom. */
  deep: '#0a0e17',
  /**
   * THE ONE-PIXEL EDGE, AND IT IS NEUTRAL ON PURPOSE. Owner: "Don't add the
   * low-effort color borders." The cards are colored in their own gradients and
   * none of those colors is allowed to touch a border. `scoreboard.check.ts`
   * reads the CSS property every accent lands in and refuses anything but ink
   * and fill.
   *
   * IT IS br_ui's OWN HAIRLINE NOW AND IT USED TO BE A BESPOKE SLATE. The game's
   * `.panel` in `ui-src/src/index.css` is `border: 1px solid
   * rgba(255, 255, 255, 0.10)` with `border-radius: 0`, and the note beside it
   * says why it is grey rather than accent: "Grey is a panel that has an edge,
   * not a panel that is shouting." White at 10% over this board's `card`
   * composites to almost exactly the `#2b3446` that was here, so nothing moved
   * visually - what changed is that the number is now the game's number, and a
   * surface that sits over a lighter fill gets a lighter edge for free instead
   * of wearing a slate that was mixed for one background.
   *
   * THE ONE EXCEPTION IS THE VIEWER'S OWN ROW, WHICH THE OWNER ASKED FOR BY
   * NAME. See `FOCUS_EDGE` and the focused-row block in the stylesheet.
   */
  edge: 'rgba(255, 255, 255, 0.10)',
  text: '#f2f5fa',
  label: '#9fb0cc',
  muted: '#8698b5',
  /** The highlighted row's neutral fill, under its category's own gradient. */
  you: '#202a3c',
  /** The numeral on a highlighted row, which needs more than `muted` gives. */
  youMuted: '#b9c8e2',
  /**
   * The project's own two, used where the board is speaking for itself rather
   * than for a category: the player's name band and the page's own light.
   * `--color-royale-accent` and `--color-volts` in the gamemode's `index.css`.
   */
  cyan: '#22d3ee',
  gold: '#d9ae35',
} as const

/**
 * ═══ THE SURFACE VOCABULARY, TAKEN OUT OF br_ui RATHER THAN INVENTED ═══
 *
 * Owner, 2026-09-11: "Can we also get the cards to use square corners like the
 * rest of br_ui and perhaps take some design elements from br_ui as well like
 * the rows?"
 *
 * So this is not a restyle by taste. The gamemode's own interface is in
 * `ui-src/src/index.css` and it states its geometry in one block, which is
 * copied here rather than approximated:
 *
 *     --r-panel: 0.7rem;
 *     --cut-max: 0.75rem;
 *     --cut: 0px;
 *
 * and a comment above it: "--cut is the bevel a .plate opens to when it takes
 * focus; at rest a plate is perfectly square."
 *
 * WHAT EACH BORROWED PIECE IS AND WHERE IT CAME FROM:
 *
 *   SQUARE CORNERS. `.panel` and `.plate` are both `border-radius: 0`. That
 *   decision has its own note in br_ui ("The square edge arrived here by
 *   mistake ... The owner saw it before I did and kept it"), so it is the
 *   house shape rather than a default nobody chose. Every card, tile, row and
 *   band on this board is now square. The only `border-radius` left on the
 *   page is `50%` on the round background layers, which is a circle and not a
 *   corner.
 *
 *   THE TOP LIGHT. `.plate`'s fill is
 *   `linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.015) 46%)`
 *   over a near-opaque base. That two-stop sheen, at those exact numbers, is
 *   what makes a br_ui surface read as a piece of hardware facing a light, and
 *   it now sits on top of each card's own category gradient.
 *
 *   `--edgec`, WHICH IS A MECHANISM AND NOT A COLOR. br_ui: "--edgec drives the
 *   border AND both redrawn chamfers, so a component that recolours its edge (a
 *   rarity slot, a selected tab) can never end up with a mismatched diagonal.
 *   Recolour the variable, never the border." Every surface on this board now
 *   takes its border from `var(--edgec)`, so the focused row below recolors one
 *   variable and the chamfers follow it.
 */

/** br_ui's `--cut-max`, in this page's fixed pixels: 0.75rem at a 16px root. */
const CUT_PX = 12

/**
 * ═══ EVERY BORDER ON THIS BOARD, IN ONE NUMBER, AND IT IS THREE TIMES WHAT IT
 *     WAS ═══
 *
 * Owner, 2026-09-11: "And triple the border thickness on everything that has
 * borders for the entire scoreboard."
 *
 * ONE CONSTANT AND NOT EIGHT EDITS. Six declarations carried a `1px` before
 * this: the card, the tile, the squad card, the viewer's focused surface, the
 * rule under a card's heading and the rule under a slide title. Tripling them by
 * hand is six chances to miss one, and a board with one hairline left among six
 * heavy edges looks like a rendering fault rather than a design.
 *
 * ═══ AND THE TWO REDRAWN DIAGONALS HAVE TO THICKEN WITH THEM ═══
 *
 * The focused surface is br_ui's `.plate.is-active`: its top-right and
 * bottom-left corners are chamfered by a `clip-path`, which removes the BORDER
 * along both diagonals, and two pseudo-elements draw it back with a 45deg
 * gradient. br_ui's own numbers are a 1px border and a 1.2px diagonal - the
 * diagonal is slightly fatter because a 45deg gradient edge is measured
 * perpendicular to the line rather than across the box. That RATIO is what is
 * preserved here, not the literal 1.2: a 3px border with a 1.2px diagonal would
 * be a focused row whose two cut corners are visibly unfinished next to the four
 * edges that are not, which is the exact defect the variable exists to prevent.
 *
 * THE GRADIENT TAKES THE HALF WIDTH, because it is stated as a band either side
 * of the 50% line. `scoreboard.check.ts` recomputes both numbers from `EDGE_PX`
 * rather than matching what is written.
 */
export const EDGE_PX = 3
const CHAMFER_PX = EDGE_PX * 1.2
const CHAMFER_HALF = CHAMFER_PX / 2

/**
 * The edge of the ONE surface on this page that is allowed a bright one.
 *
 * br_ui's inventory sets `--edgec: active ? '#ffffff' : hex` - the rarity color
 * at rest, plain white when the slot is the one in your hands. The board has no
 * rest state to contrast against (a row is either yours or it is not), so the
 * viewer's row takes the category's own light rather than white: see
 * `tone().bright`, which is that accent mixed 42% toward white, and the
 * per-category block that assigns it. This is the neutral fallback for a row
 * whose category or squad color did not resolve, and it is br_ui's own
 * `.plate` default value.
 */
const FOCUS_EDGE = 'rgba(255, 255, 255, 0.30)'

/**
 * ═══ THE COLOR MATH, WHICH IS WHY A CATEGORY CARRIES ONE HEX AND WEARS EIGHT
 *     ═══
 *
 * A card is a gradient from a tinted top to a near-black bottom, with a header
 * band, a podium of three numerals at decreasing heat, a leader's number in a
 * bright tint and a floor glow under the tile's numeral. Writing those out per
 * category would be forty hexes maintained by hand, five of which somebody
 * would eventually get subtly wrong - and the day a sixth category is switched
 * on, forty-eight.
 *
 * SO THEY ARE DERIVED, IN sRGB, AT RENDER TIME. Plain componentwise mixing
 * rather than anything perceptual: the output has to be a six-digit hex CEF 103
 * parses without a downlevel step, `color-mix()` is Chrome 111, and the inputs
 * are all light saturated colors being pulled toward two near-blacks, which is
 * the case where sRGB mixing and a perceptual space disagree least.
 *
 * AND EVERY DERIVED PAIR THAT CARRIES TEXT IS MEASURED. `contrastPairs()` below
 * returns the real composited backgrounds rather than the untinted `card`, so
 * the floor is held against what a player actually looks at.
 */
function channels(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

function hex(c: readonly [number, number, number]): string {
  return `#${c.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`
}

/** `t` of `b` over `a`. `mix(card, accent, 0.13)` is a card with a hint of it. */
export function mix(a: string, b: string, t: number): string {
  const x = channels(a)
  const y = channels(b)
  return hex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as unknown as [number, number, number])
}

/** The same color at an alpha, for a gradient stop that has to fade to nothing. */
export function rgba(color: string, alpha: number): string {
  const [r, g, b] = channels(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Everything one category's surfaces are painted with, from its one accent.
 *
 * THE NAMES ARE THE SURFACES AND NOT THE COLORS, so a reader of the stylesheet
 * below can see what each value is FOR without decoding a percentage.
 */
export function tone(accent: string): {
  accent: string
  /** The lightest point of the card: its tinted top. Text is measured on this. */
  top: string
  /** Where the tint has almost gone, a little under half way down. */
  mid: string
  /** The top of the header band, composited, which is lighter again. */
  band: string
  /** The numeral on the leading row, and the numeral on a tile. */
  bright: string
  /** Second and third on the podium, fading toward the neutral rest. */
  second: string
  third: string
  /** The tile is tinted harder than a card, because it is one number. */
  tileTop: string
  /** Your own row, composited: the category's light laid over the slate. */
  youTop: string
} {
  const top = mix(PALETTE.card, accent, 0.13)
  return {
    accent,
    top,
    mid: mix(PALETTE.card, accent, 0.05),
    /**
     * 0.14 AND NOT 0.22, AND THE NUMBER CAME OUT OF THE CONTRAST GATE. At 0.22
     * the band was handsome and three of the six labels measured between 4.0
     * and 4.4 against it - under the floor, on a surface that is read at a
     * distance through a downsampled texture. The band is still the loudest
     * thing on the card; it is just not brighter than its own writing.
     */
    band: mix(top, accent, 0.14),
    bright: mix(accent, '#ffffff', 0.42),
    second: mix(accent, PALETTE.muted, 0.45),
    third: mix(accent, PALETTE.muted, 0.75),
    tileTop: mix(PALETTE.card, accent, 0.19),
    youTop: mix(PALETTE.you, accent, 0.3),
  }
}

/**
 * The player's name sits on a band of the project's own cyan.
 *
 * COMPOSITED THROUGH THE BACKGROUND AND NOT OVER `page`, because the band is
 * translucent and the brightest part of the wash is behind exactly where it
 * sits: the top-left of the surface, where the cyan light is. Measuring it
 * against the flat page would measure a darker surface than the one the name is
 * on. So this is the wash's own lightest stop, plus that light, plus the band.
 */
const NAME_BAND = mix(mix('#0c1a25', PALETTE.cyan, 0.2), PALETTE.cyan, 0.26)

/**
 * The brightest the page can be behind a slide title, per slide.
 *
 * ═══ THERE ARE THREE OF THESE NOW AND THERE USED TO BE ONE ═══
 *
 * Owner: "Stop using the same boring colors on each page." Each panel lays its
 * own translucent wash over the shared background (see `slideStyles`), so the
 * surface under a title is no longer the same on all three slides and measuring
 * one of them would be measuring a surface two thirds of the board does not have.
 *
 * THE PLAYER SLIDE'S IS UNCHANGED, WHICH IS THE POINT. "I like the colors on the
 * player stats page. Keep those and change the rest" - it has no panel wash at
 * all, so the value below is exactly what it has always been: the wash's own
 * lightest stop plus the cyan light, at the top left where the title sits.
 */
const TITLE_GROUND = mix('#0c1a25', PALETTE.cyan, 0.2)
/** `BR.RarityInfo.legendary`, which is the leaderboard's own light. */
export const LEGENDARY = '#ffb020'
/**
 * Every text-on-background pair on this board, against what is really behind it.
 *
 * ═══ IT IS A FUNCTION NOW AND IT WAS A LIST, BECAUSE THE BACKGROUNDS ARE
 *     DERIVED ═══
 *
 * The old list measured every accent against the flat `#171c26` a card used to
 * be. There is no flat card any more: the surface under a label is that card's
 * own header band, which is the accent at 22% over a top that is already the
 * accent at 13% - LIGHTER than the old card, and therefore a harder test, which
 * is exactly why it has to be the one that runs. Measuring against the
 * untinted base would have been measuring a surface nobody looks at.
 *
 * THE WORST CASE OF A GRADIENT IS ITS LIGHTEST STOP, since every piece of type
 * here is light on dark. Each card and tile runs from a tinted top down to
 * `deep`, so the top is what is measured and the rest of the fill is strictly
 * safer.
 */
export function contrastPairs(
  categories: ReadonlyArray<{ key: string; accent: string }>,
  squadColors: readonly string[] = [],
): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [
    /**
     * THE HEADING'S NEUTRAL FALLBACK, which nothing should ever render. Every
     * card on screen gets a category class and the class sets the label's own
     * color; this is what a card whose class had no rule would show, and it is
     * measured so that the failure mode is dull rather than illegible.
     */
    /**
     * THE SLIDE TITLE IS THE ONLY PIECE OF TYPE ON THIS PAGE WITH NO CARD UNDER
     * IT, so it is measured against the brightest thing the background can be
     * where it sits: the top-left, where the wash's own lightest stop and the
     * cyan light both are. That is the same surface the player's name band is
     * composited over, minus the band itself.
     */
    ['player slide title', PALETTE.text, TITLE_GROUND],
    /**
     * AND THE LEADERBOARD'S TITLE SITS ON ITS OWN LIGHT. `#board`'s wash is a
     * legendary-amber pool centered above the top edge, so the brightest thing
     * under the title is that stop composited over the same ground - which is a
     * LIGHTER surface than the player slide's and therefore the harder of the two
     * to hold white type on. The squad slide's lights are measured per blip
     * color below, for the same reason and with the same arithmetic.
     */
    ['board slide title', PALETTE.text, mix(TITLE_GROUND, LEGENDARY, 0.22)],
    ['card title', PALETTE.label, PALETTE.card],
    ['entry name', PALETTE.text, PALETTE.card],
    ['entry value', PALETTE.text, PALETTE.card],
    ['rank numeral', PALETTE.muted, PALETTE.card],
    ['player name', PALETTE.text, NAME_BAND],
    ['tile rank', PALETTE.muted, PALETTE.card],
    /**
     * THE HIGHLIGHTED ROW IS A SECOND BACKGROUND AND EVERY TEXT ON IT IS A NEW
     * PAIR. `muted` on `you` measures below the floor, which is the whole
     * reason `youMuted` exists; leaving it would have put the one row the owner
     * asked to make MORE visible below the floor the rest of the board meets.
     */
    ['your name', PALETTE.text, PALETTE.you],
    ['your numeral', PALETTE.youMuted, PALETTE.you],
  ]

  for (const c of categories) {
    const t = tone(c.accent)
    pairs.push(
      [`${c.key} label`, t.accent, t.band],
      [`${c.key} leader`, t.bright, t.top],
      [`${c.key} second`, t.second, t.top],
      [`${c.key} third`, t.third, t.top],
      [`${c.key} tile value`, t.bright, t.tileTop],
      [`${c.key} your name`, PALETTE.text, t.youTop],
    )
  }

  /**
   * ═══ EVERY SURFACE A SQUAD MATE'S BLIP COLOR PAINTS, AND NOT ONE OF THEM IS
   *     TYPE ═══
   *
   * This used to measure the blip color as INK, because the mate's name was
   * painted in it. The owner threw that out - "the column font colors are
   * just.... too much lol" - so the color is now the card's fill and its name
   * band, exactly the way a category's accent paints a leaderboard card, and
   * what has to be measured is the WHITE AND GREY TYPE ON TOP OF IT.
   *
   * THESE EIGHT ARE THE HARD CASE AND THEY ARE NOT OURS TO ADJUST. `BR.SquadColours`
   * is eight LIGHT saturated colors chosen to be legible as minimap blips, so a
   * band built from one of them is the lightest surface anywhere on this board
   * that carries text. If a stop has to come down to hold the floor, it comes
   * down for all eight rather than being tuned per color.
   *
   * THE TITLE PAIR IS HERE TOO, because `#squad`'s wash is one light per mate
   * and the title sits over whichever of them is leftmost.
   */
  for (const color of squadColors) {
    const t = tone(color)
    pairs.push(
      [`mate ${color} name`, PALETTE.text, t.band],
      [`mate ${color} label`, PALETTE.label, t.top],
      [`mate ${color} value`, PALETTE.text, t.top],
      [`mate ${color} your name`, PALETTE.text, t.youTop],
      [`mate ${color} your label`, PALETTE.text, t.youTop],
      [`squad slide title on ${color}`, PALETTE.text, mix(TITLE_GROUND, color, 0.2)],
    )
  }

  return pairs
}

/**
 * Every string that reaches the document goes through this.
 *
 * PLAYER NAMES ARE PLAYER AUTHORED. They arrive from the game's own row, having
 * been typed by whoever owns the account, and they are painted on a surface
 * every other player in the lobby is looking at. There is exactly one escaping
 * function and every interpolation below calls it; the check drives a name
 * containing a script tag, an attribute break and an entity through the whole
 * renderer and asserts none of them survive as markup.
 *
 * BOTH QUOTE CHARACTERS, THOUGH NOTHING HERE INTERPOLATES INTO AN ATTRIBUTE
 * TODAY. That is precisely why they are escaped: the day somebody adds a
 * `title=` to the name span, this function is already correct rather than
 * needing to be noticed.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The two faces, inline.
 *
 * ═══ THE FONT IS THE PROJECT'S OWN, AND IT WAS NOT BEFORE ═══
 *
 * Owner: "And what is the font being used? Doesn't seem to be ours." It was not.
 * The first board asked for `'Segoe UI', Tahoma, Arial` and got whatever the
 * player's machine happened to have.
 *
 * THE PROJECT HAS EXACTLY TWO TYPEFACES and the gamemode repository states the
 * split in one line, in `ui-src/src/index.css`: "Barlow carries every word.
 * Anton carries every quantity and every shout." `ui-src/tailwind.config.ts`
 * backs that up with `display: Anton` and `sans: Barlow`. This board uses the
 * same two for the same two jobs: Anton for the labels, the positions and the
 * numbers, Barlow for the player names.
 *
 * THEY REACH THE PAGE AS BASE64 INSIDE THE DOCUMENT, because the game UI's CSS
 * is not reachable from here (a DUI on a player's machine shares nothing with
 * br_ui) and a second request is a request that can hang. The bytes are the
 * fontsource woff2 the game ships, checked into `src/lib/fonts/`, turned into
 * `lib/scoreboardFonts.ts` by `scripts/build-scoreboard-fonts.mjs`. Both are SIL
 * Open Font License 1.1 with the notices checked in beside them. Nothing is
 * paid for and nothing is fetched from a font host.
 *
 * LATIN ONLY, WHICH IS WHAT THE GAME SHIPS TOO. A name in Cyrillic or Greek
 * falls through to the generic fallback per glyph, exactly as it does in the
 * game's own HUD.
 *
 * `font-display: block` RATHER THAN `swap`. There is no network fetch to wait
 * on, so the usual argument for `swap` does not apply; what it would buy is a
 * flash of fallback metrics on a surface nobody can re-read.
 */
function faces(): string {
  return EMBEDDED_FACES.map(
    (f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${
      f.weight
    };font-display:block;src:url(data:font/woff2;base64,${f.base64}) format('woff2')}`,
  ).join('\n')
}

const DISPLAY = `'Anton', 'Segoe UI', sans-serif`
const BODY = `'Barlow', 'Segoe UI', sans-serif`

/**
 * ═══ THE THREE TITLES, IN HIS WORDS AND HIS CAPITALS ═══
 *
 * Owner, 2026-09-11: "The scoreboard page should also have a title at the top
 * reading 'LEADERBOARD' and the player stats should have one reading 'PLAYER
 * STATS' and the squad one reading 'SQUAD STATS'."
 *
 * THESE ARE THE FIRST WORDS ANYBODY HAS EVER BEEN ASKED TO ADD TO THIS PAGE, and
 * the standing rule for the surface has been that the only words on it are his
 * category labels and the players' own names. So they are quoted rather than
 * composed, they are constants rather than three string literals loose in three
 * markup functions, and `scoreboard.check.ts` asserts each one appears exactly
 * once and that no fourth piece of prose appears beside them.
 *
 * NOTHING ELSE GOES HERE. No subtitle, no caption, no "YOUR SQUAD", no squad
 * number, no player count, no timestamp, no empty state. Anything that seems to
 * need words goes to the owner as a question instead.
 */
const TITLE_BOARD = 'LEADERBOARD'
const TITLE_PLAYER = 'PLAYER STATS'
const TITLE_SQUAD = 'SQUAD STATS'

/** The three, in slide order, for the check and for anything that has to list them. */
export const TITLES = [TITLE_BOARD, TITLE_PLAYER, TITLE_SQUAD] as const

/**
 * ═══ THE ANIMATED BACKGROUND, EMITTED ONLY UNDER `full` ═══
 *
 * Owner: "Also give us an animated background (be sure it will work on CEF
 * 103)." What follows is that background, and every decision in it is either the
 * CEF 103 constraint or the frame-cost one from the header.
 *
 * ═══ IT WAS FIVE MOVING LAYERS AND IT IS EIGHTEEN, ON HIS SECOND NOTE ═══
 *
 * Owner, 2026-09-11: "Also please spice up the background further. We need more
 * moving pieces to this."
 *
 * AND THE HOLDING BACK THAT NUMBER USED TO EXPRESS IS GONE ON PURPOSE. The five
 * were five because an earlier pass believed continuous motion cost roughly
 * 110 MB/s of texture traffic per client, which was measured to be wrong and is
 * corrected in full in the header above: FiveM blits the whole surface every
 * game frame from a shared D3D11 handle whether the page moved or not, so a
 * still board and a moving one cost the game's renderer the same. What motion
 * costs is frame production inside CEF, and what THAT costs depends only on
 * whether each frame is a composite or a repaint.
 *
 * SO THE EIGHTEEN ARE ALL COMPOSITES AND THE COUNT IS FREE TO GROW:
 *
 *   THREE ORBS that wander on closed paths. The page's light.
 *   TWO SWEEPS that cross the board in opposite directions on periods that do
 *     not divide each other, so they never pass at the same place twice.
 *   TWO STRIPED SHEETS at different angles, periods and speeds, whose
 *     interference moves at neither one's rate.
 *   ONE BREATHING POOL of cyan, which animates opacity and does not move at all.
 *   TEN MOTES, five to fourteen pixels square, each on its own closed wander.
 *
 * WHAT IT COSTS IS RASTER, NOT FRAMES, AND THAT IS WHY THE SHAPES ARE WHAT THEY
 * ARE. A promoted layer is a real GPU texture on the player's machine: the two
 * new full-surface layers are about seven megabytes between them, and all ten
 * motes together are about eleven KILOBYTES. The budget went on count where
 * count is nearly free and on area only where area buys depth. Roughly twenty
 * megabytes of layer raster in total, once, on a client already holding a
 * battle royale map.
 *
 * ONLY `transform` AND `opacity` MOVE. The orbs, the motes and the sweeps are
 * gradients rasterized ONCE at load and then translated by the compositor; the
 * sheets are repeating linear gradients rasterized once and translated; the pool
 * is rastered once and re-composited at a new alpha. Nothing animates a gradient
 * stop, a `background-position`, a `filter` or a size, all of which look
 * identical in a desktop preview and put a full re-raster on Blink's main thread
 * 240 times a second in the game.
 *
 * EVERYTHING HERE IS OLDER THAN CHROME 103 BY YEARS. `@keyframes`, `transform`,
 * `radial-gradient`, `repeating-linear-gradient`, `border-radius`, `opacity`,
 * `will-change` and a negative `animation-delay`. No `color-mix`, no `oklch`, no
 * `:has()`, no container query, no nesting, no view transition.
 *
 * ═══ EVERY WANDERING PATH IS A CLOSED LOOP, WHICH IS WHY THERE IS NO JUMP ═══
 *
 * The 100% keyframe is identical to the 0% keyframe on every orb and every mote,
 * so the animation restarts exactly where it ended. `ease-in-out` between stops
 * is what turns four corners into a wander rather than four visible direction
 * changes, and the durations are long enough (20 to 67 seconds) that nothing on
 * this wall reads as motion you are meant to watch.
 *
 * The two sweeps and the two sheets are seamless by different arguments, and
 * both are written out beside the rules themselves rather than here.
 *
 * ═══ AND THE PHASES ARE RANDOM PER CLIENT ═══
 *
 * Owner: "the content doesn't need to be time synced on everyone's client. Each
 * one having a different background is fine - nobody will know." So each layer
 * gets a NEGATIVE `animation-delay` drawn when the page is rendered, which is
 * the one-line way to start an infinite loop at an arbitrary point in itself.
 * Negative rather than positive because a positive delay is a pause: the board
 * would sit still for the first half minute of every warmup.
 *
 * THE RANDOMNESS IS AN ARGUMENT AND NOT A `Math.random()` CALL IN HERE, so this
 * function stays pure and `scoreboard.check.ts` can render the same document
 * twice and compare it. The route supplies the real numbers. See `PHASE_COUNT`.
 */

/**
 * ═══ HOW MANY MOTES THERE ARE, AND WHY THEY ARE THE CHEAP WAY TO ADD MOTION
 *     ═══
 *
 * Owner, 2026-09-11: "please spice up the background further. We need more
 * moving pieces to this."
 *
 * THE OBVIOUS WAY TO ADD MOVING PIECES IS THE EXPENSIVE ONE. Another full-board
 * sheet or another 900px orb is another five megabytes of layer raster on every
 * machine in the pad, and there is a ceiling to how many of those the page can
 * spend before it is holding more texture than the board is worth.
 *
 * A MOTE IS 5 TO 14 PIXELS SQUARE. Ten of them together are about eleven
 * KILOBYTES of raster - three orders of magnitude under one sheet - and they are
 * the layers a person actually reads as "things moving", because they are
 * discrete objects on their own paths rather than a texture sliding behind the
 * cards. The compositor cost is ten more quads, which is what a compositor is
 * for.
 *
 * SO THE BUDGET WENT ON COUNT RATHER THAN AREA, and that is the whole shape of
 * this pass: two more full-surface layers where they buy depth, ten tiny ones
 * where they buy life.
 */
const MOTES = 10

/**
 * ═══ EVERY MOVING LAYER ON THE PAGE, IN THE ORDER ITS PHASE IS DRAWN ═══
 *
 * THIS IS A LIST NOW AND IT WAS TWO PARALLEL ARRAYS - a `PHASE_COUNT` of 5 and a
 * `PERIODS` of five numbers, indexed against each other by position. That is a
 * shape that works right up until somebody adds a layer and updates one of them,
 * and the failure is the quiet kind: a layer whose phase index runs off the end
 * of the array gets phase zero on every client in the lobby, which is the one
 * layer that IS synchronized. Nobody would ever see it.
 *
 * NOW THERE IS ONE LIST, `PHASE_COUNT` IS ITS LENGTH, and the route is sized
 * from that. Adding a layer is adding a row.
 *
 * THE PERIODS ARE DELIBERATELY NOT MULTIPLES OF EACH OTHER. Eighteen layers on
 * loops from 20 to 67 seconds return to the same arrangement roughly never, so
 * the background does not visibly repeat inside one warmup even before the
 * random per-client phase offsets are applied.
 */
const LAYERS: ReadonlyArray<{ key: string; period: number }> = [
  { key: 'o1', period: 41 },
  { key: 'o2', period: 53 },
  { key: 'o3', period: 67 },
  { key: 'bm1', period: 29 },
  { key: 'bm2', period: 43 },
  { key: 'drift', period: 20 },
  { key: 'weave', period: 31 },
  { key: 'pulse', period: 23 },
  ...Array.from({ length: MOTES }, (_, i) => ({
    key: `mt${i}`,
    /** 30 to 60 seconds, spread so no two adjacent motes share a loop. */
    period: 30 + ((i * 5) % 11) * 3,
  })),
]

export const PHASE_COUNT = LAYERS.length

/**
 * `-<n>s`, from a phase in [0, 1).
 *
 * ALWAYS NEGATIVE, WHICH IS THE WHOLE TRICK. A positive `animation-delay` is a
 * pause before the animation starts, so a random positive one would leave the
 * board motionless for up to a minute at the top of a warmup. A negative one
 * means "this animation has already been running that long", which starts it
 * mid-loop with no wait. A phase of a whole period covers the loop exactly once.
 */
function delayFor(phase: number, index: number): string {
  const period = LAYERS[index]?.period ?? 20
  const clamped = Number.isFinite(phase) ? Math.min(Math.max(phase, 0), 1) : 0
  return `-${(clamped * period).toFixed(2)}s`
}

/** The period of the layer with this key, so a rule can name its own loop. */
function periodOf(key: string): number {
  return LAYERS.find((l) => l.key === key)?.period ?? 20
}

/** The phase index of the layer with this key. */
function indexOf(key: string): number {
  return LAYERS.findIndex((l) => l.key === key)
}

/**
 * A deterministic value in [0, 1) from one integer.
 *
 * ═══ THIS IS NOT RANDOMNESS AND MUST NOT BECOME IT ═══
 *
 * The mote field needs to look scattered rather than gridded, which means ten
 * positions, ten sizes and forty path offsets that do not fall on an arithmetic
 * progression. `Math.random()` would produce those and would also make
 * `renderScoreboard` impure, which is the one property `scoreboard.check.ts`
 * leans on hardest: it renders the same board twice and compares the two
 * documents byte for byte.
 *
 * SO THE SCATTER IS A PURE FUNCTION OF THE MOTE'S INDEX. The per-client variety
 * the owner asked for is entirely in the PHASES, which the route draws and
 * passes in - the field's shape is the same on every machine and its timing is
 * not, which is the half that is actually visible.
 *
 * A PLAIN LINEAR CONGRUENTIAL STEP, and the seeds are small enough (under a few
 * hundred) that the multiply stays exact in a double.
 */
function scatter(seed: number): number {
  return ((seed * 1103515245 + 12345) % 2147483648) / 2147483648
}

/**
 * ═══ THE MOTE FIELD ═══
 *
 * Ten small soft dots, each on its own closed wander, each started at its own
 * random point in its own loop. They are the "more moving pieces" the owner
 * asked for and they are the cheapest thing on this page by three orders of
 * magnitude - see `MOTES`.
 *
 * EVERY PATH CLOSES, for the same reason the orbs' do: a 100% keyframe that is
 * not the 0% keyframe teleports the layer back in full view once per loop. That
 * is invisible in a preview and it is the single most obvious defect available
 * on a wall somebody stands in front of for a whole warmup. The check recomputes
 * it rather than trusting this sentence.
 *
 * THEY LIVE IN THE MARGIN, MOSTLY, AND THAT IS DELIBERATE NOW THAT THERE IS ONE.
 * The safe area leaves a 90px band down each side and 50px top and bottom in
 * which nothing is ever drawn but background, so the field is weighted toward
 * the edges of the surface where it is actually visible rather than scattered
 * evenly under opaque cards.
 */
function moteStyles(phases: readonly number[]): string {
  const rules: string[] = []
  const frames: string[] = []

  for (let i = 0; i < MOTES; i++) {
    const key = `mt${i}`
    const at = indexOf(key)
    /**
     * 7 TO 19 PIXELS, AND IT WAS 5 TO 14. Rendered at 1280x720 and looked at,
     * the smaller field was very nearly invisible against the wash - which is
     * the exact note the orbs got last pass ("the board looked flat and cheap")
     * arriving again on a different layer. Motion nobody can see is motion that
     * was not added.
     */
    const size = 7 + Math.floor(scatter(i * 7 + 1) * 4) * 4
    /**
     * WEIGHTED TO THE EDGES. `edge` is 0 for the left band and 1 for the right,
     * alternating, and the lateral position is drawn inside that band plus a
     * little of the panel it borders. A mote under a card is a mote nobody sees.
     */
    const edge = i % 2
    const x = Math.round(
      edge === 0
        ? scatter(i * 11 + 3) * 300
        : DESIGN_WIDTH - 300 + scatter(i * 11 + 3) * 300,
    )
    const y = Math.round(scatter(i * 13 + 5) * (DESIGN_HEIGHT + 60) - 30)
    const alpha = (0.28 + scatter(i * 17 + 7) * 0.4).toFixed(2)
    /** A drifting mote is mostly vertical, with enough lateral wander to read. */
    const amp = 70 + Math.round(scatter(i * 19 + 9) * 130)
    const lat = 26 + Math.round(scatter(i * 23 + 11) * 54)
    const tint = i % 3 === 0 ? PALETTE.gold : PALETTE.cyan

    rules.push(`
.${key} {
  left: ${x}px;
  top: ${y}px;
  width: ${size}px;
  height: ${size}px;
  background-image: radial-gradient(circle closest-side,
    ${rgba(tint, Number(alpha))} 0%,
    ${rgba(tint, Number(alpha) * 0.35)} 55%,
    ${rgba(tint, 0)} 100%);
  animation-name: ${key};
  animation-duration: ${periodOf(key)}s;
  animation-delay: ${delayFor(phases[at] ?? 0, at)};
}`)

    frames.push(`
@keyframes ${key} {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(${lat}px, ${-Math.round(amp * 0.45)}px, 0); }
  50%  { transform: translate3d(${Math.round(lat * 0.3)}px, ${-amp}px, 0); }
  75%  { transform: translate3d(${-lat}px, ${-Math.round(amp * 0.55)}px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}`)
  }

  return `
/* ── THE MOTES ───────────────────────────────────────────────────────────────
   ONE PROMOTED-LAYER DECLARATION FOR ALL TEN. 'will-change' is a GPU texture
   per element and these are 5 to 14 pixels square, so ten of them together
   cost about eleven kilobytes - but the DECLARATION is written once, which is
   what keeps the page's promotion budget countable. */
.mote {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}${rules.join('')}${frames.join('')}`
}

function driftStyles(phases: readonly number[]): string {
  const d = (key: string): string => {
    const at = indexOf(key)
    return delayFor(phases[at] ?? 0, at)
  }

  return `
.orb {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}
.o1 {
  left: -240px;
  top: -300px;
  width: 860px;
  height: 860px;
  background-image: radial-gradient(circle closest-side,
    ${rgba(PALETTE.cyan, 0.26)} 0%,
    ${rgba(PALETTE.cyan, 0.1)} 45%,
    ${rgba(PALETTE.cyan, 0)} 100%);
  animation-name: o1;
  animation-duration: ${periodOf('o1')}s;
  animation-delay: ${d('o1')};
}
.o2 {
  left: 740px;
  top: 280px;
  width: 800px;
  height: 800px;
  background-image: radial-gradient(circle closest-side,
    ${rgba(PALETTE.gold, 0.2)} 0%,
    ${rgba(PALETTE.gold, 0.07)} 45%,
    ${rgba(PALETTE.gold, 0)} 100%);
  animation-name: o2;
  animation-duration: ${periodOf('o2')}s;
  animation-delay: ${d('o2')};
}
.o3 {
  left: 320px;
  top: -360px;
  width: 680px;
  height: 680px;
  background-image: radial-gradient(circle closest-side,
    rgba(45, 212, 191, 0.18) 0%,
    rgba(45, 212, 191, 0.06) 45%,
    rgba(45, 212, 191, 0) 100%);
  animation-name: o3;
  animation-duration: ${periodOf('o3')}s;
  animation-delay: ${d('o3')};
}
@keyframes o1 {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(180px, 90px, 0); }
  50%  { transform: translate3d(90px, 260px, 0); }
  75%  { transform: translate3d(-70px, 140px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes o2 {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(-200px, -120px, 0); }
  50%  { transform: translate3d(-120px, -300px, 0); }
  75%  { transform: translate3d(80px, -160px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes o3 {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(140px, 180px, 0); }
  50%  { transform: translate3d(-160px, 240px, 0); }
  75%  { transform: translate3d(-220px, 60px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}

/* ── THE BREATHING LIGHT ─────────────────────────────────────────────────────
   The one layer that animates OPACITY rather than position, which is the other
   property Chromium runs on the compositor without re-rastering. It does not
   move at all: it is a soft pool of the project's cyan sitting over the top of
   the board that swells and fades on a ${periodOf('pulse')} second cycle, so
   the light on the surface changes even in the stretch between two sweeps.

   IT IS THE CHEAPEST KIND OF MOTION THERE IS. A layer whose opacity changes is
   rastered once and re-composited at a new alpha; nothing about its content is
   recomputed. */
.pulse {
  position: absolute;
  left: 180px;
  top: -300px;
  width: 720px;
  height: 720px;
  border-radius: 50%;
  background-image: radial-gradient(circle closest-side,
    ${rgba(PALETTE.cyan, 0.17)} 0%,
    ${rgba(PALETTE.cyan, 0.05)} 52%,
    ${rgba(PALETTE.cyan, 0)} 100%);
  will-change: opacity;
  animation: pulse ${periodOf('pulse')}s ease-in-out infinite;
  animation-delay: ${d('pulse')};
}
@keyframes pulse {
  0%   { opacity: 0.30; }
  50%  { opacity: 1; }
  100% { opacity: 0.30; }
}

/* ── THE SWEEPS, AND THERE ARE TWO OF THEM NOW ───────────────────────────────
   A tall soft blade of light that crosses the whole board and is off the
   surface the rest of the time. These are the layers meant to be NOTICED
   rather than felt: the orbs are weather and a sweep is an event.

   TWO, CROSSING, ON PERIODS THAT DO NOT DIVIDE EACH OTHER. Owner: "We need more
   moving pieces to this." One blade every ${periodOf('bm1')} seconds is a wall
   that does something occasionally; a second one travelling the other way on
   ${periodOf('bm2')} seconds, tilted the other way and in the warm half of the
   palette, means the two pass each other at a different place on the board
   every time and the surface never settles into one repeating event.

   THEIR LOOPS DO NOT NEED TO CLOSE THE WAY AN ORB'S DOES, and that is geometry
   rather than an exemption. An orb wanders inside the frame, so a 100% keyframe
   that is not the 0% one teleports in full view. These START AND END COMPLETELY
   OUTSIDE the 1280px surface - the first one's right edge is still left of zero
   at 0% and its left edge is already past 1280 at 100%, and the second one does
   the same journey backwards - so the instant either resets there is nothing on
   screen to jump. scoreboard.check.ts recomputes both ends of both blades
   against the board width, from the angle, the size and the travel, rather than
   taking any of that on trust. */
.beam {
  position: absolute;
  height: 1400px;
  will-change: transform;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
}
.bm1 {
  top: -320px;
  left: -560px;
  width: 300px;
  background-image: linear-gradient(90deg,
    rgba(190, 235, 255, 0) 0%,
    rgba(190, 235, 255, 0.05) 38%,
    rgba(214, 244, 255, 0.10) 50%,
    rgba(190, 235, 255, 0.05) 62%,
    rgba(190, 235, 255, 0) 100%);
  animation-name: bm1;
  animation-duration: ${periodOf('bm1')}s;
  animation-delay: ${d('bm1')};
}
.bm2 {
  top: -320px;
  left: 1560px;
  width: 200px;
  background-image: linear-gradient(90deg,
    rgba(255, 214, 150, 0) 0%,
    rgba(255, 214, 150, 0.035) 40%,
    rgba(255, 228, 176, 0.075) 50%,
    rgba(255, 214, 150, 0.035) 60%,
    rgba(255, 214, 150, 0) 100%);
  animation-name: bm2;
  animation-duration: ${periodOf('bm2')}s;
  animation-delay: ${d('bm2')};
}
@keyframes bm1 {
  from { transform: translate3d(0px, 0, 0) rotate(16deg); }
  to   { transform: translate3d(2360px, 0, 0) rotate(16deg); }
}
@keyframes bm2 {
  from { transform: translate3d(0px, 0, 0) rotate(-12deg); }
  to   { transform: translate3d(-2280px, 0, 0) rotate(-12deg); }
}

/* ── THE SHEETS, AND THERE ARE TWO OF THOSE NOW TOO ──────────────────────────
   A sheet is a repeating stripe pattern rasterized ONCE and translated by the
   compositor forever. Nothing about it animates a gradient stop, a
   background-position or a size, all of which look identical in a desktop
   preview and put a full re-raster on Blink's main thread instead.

   THE SECOND ONE CROSSES THE FIRST, which is the whole reason for it. One
   sheet drifting at 120deg reads as a texture sliding; two sheets on different
   angles, different stripe periods and different speeds read as a surface with
   depth, because the interference between them moves at neither one's rate.

   EACH LOOP IS SEAMLESS BY ARITHMETIC RATHER THAN BY REPETITION, and the rule
   is the same for both: translate by exactly one stripe period ALONG the
   gradient's own direction. A 'repeating-linear-gradient(Ddeg, ...)' runs along
   the unit vector (sin D, -cos D) in screen coordinates, so a period of P
   travels (P sin D, -P cos D). At 120deg with P = 160 that is (138.564, 80),
   and the first sheet takes it NEGATED, so it runs backwards along its own
   stripes. At 150deg with P = 132 it is (66, 114.315), which the second sheet
   takes as written - so the two travel in opposing directions. ANY OTHER PAIR OF
   NUMBERS GIVES A JUMP ONCE PER CYCLE, which is invisible in a preview and
   obvious to somebody standing in front of a wall for two minutes.
   scoreboard.check.ts recomputes the projection for both sheets, reading the
   angle and the period out of the gradient rather than being told them.

   AND EACH SHEET IS THE SMALLEST RECTANGLE THAT COVERS ITS OWN TRAVEL, WHICH
   ALSO DECIDES WHERE IT STARTS. The first drifts up and left, so it sits at the
   origin and is 1280+139 by 720+80. The second drifts down and right, so it
   starts ABOVE AND LEFT of the surface by its own travel and is 1280+70 by
   720+120. A 200% x 200% layer would have been the lazy way to be safe and would
   have cost about nine megabytes of raster each. */
.sheet {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
}
.drift {
  width: 1440px;
  height: 820px;
  opacity: 0.75;
  background-image: repeating-linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.075) 0px,
    rgba(255, 255, 255, 0.075) 2px,
    rgba(255, 255, 255, 0) 2px,
    rgba(255, 255, 255, 0) 44px,
    ${rgba(PALETTE.cyan, 0.09)} 44px,
    ${rgba(PALETTE.cyan, 0.09)} 47px,
    rgba(255, 255, 255, 0) 47px,
    rgba(255, 255, 255, 0) 104px,
    ${rgba(PALETTE.gold, 0.07)} 104px,
    ${rgba(PALETTE.gold, 0.07)} 106px,
    rgba(255, 255, 255, 0) 106px,
    rgba(255, 255, 255, 0) 160px
  );
  animation-name: drift;
  animation-duration: ${periodOf('drift')}s;
  animation-delay: ${d('drift')};
}
.weave {
  top: -120px;
  left: -70px;
  width: 1360px;
  height: 840px;
  opacity: 0.6;
  background-image: repeating-linear-gradient(
    150deg,
    rgba(255, 255, 255, 0.05) 0px,
    rgba(255, 255, 255, 0.05) 2px,
    rgba(255, 255, 255, 0) 2px,
    rgba(255, 255, 255, 0) 61px,
    ${rgba(PALETTE.gold, 0.06)} 61px,
    ${rgba(PALETTE.gold, 0.06)} 63px,
    rgba(255, 255, 255, 0) 63px,
    rgba(255, 255, 255, 0) 132px
  );
  animation-name: weave;
  animation-duration: ${periodOf('weave')}s;
  animation-delay: ${d('weave')};
}
@keyframes drift {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-138.564px, -80px, 0); }
}
@keyframes weave {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(66px, 114.315px, 0); }
}
${moteStyles(phases)}`
}

/**
 * The view transition, emitted under `full` and `transitions` and NOT under
 * `off`.
 *
 * ═══ WHY IT IS A WHOLE BLOCK THAT DISAPPEARS RATHER THAN A SELECTOR PREFIX ═══
 *
 * The first shape of this had every rule prefixed `body.m-full, body.m-transitions`
 * and shipped the rules to every reader including `off`. That is dead CSS that
 * looks live: `off` is meant to be the level somebody sets when the pad is
 * struggling, and a document that still carries the transition rules is one
 * `class` attribute away from running them. The check asserts that `off` contains
 * no `transition` anywhere, which only holds because this whole function is
 * skipped.
 *
 * EVERY ANIMATED PROPERTY IS `opacity`, `transform` OR `visibility`, and the
 * check enforces that as an ALLOWLIST rather than a list of forbidden ones. The
 * first two are the pair Chromium runs on the compositor without re-rastering;
 * `visibility` is animated discretely, flipping once at the end of a fade, which
 * is what lets the leaving panel stop being rastered at all.
 *
 * THE STAGGER FITS INSIDE THE BUDGET RATHER THAN EXTENDING IT, and it is
 * computed rather than written out. See the note inside.
 */
/**
 * ═══ THE SQUAD SLIDE'S TRANSITION WAS PRESENT, RUNNING AND INVISIBLE ═══
 *
 * Owner, 2026-09-11: "The squads page doesn't have any transitions it seems."
 *
 * IT WAS NOT ABSENT AND IT WAS MEASURED BEFORE ANYTHING WAS CHANGED. Driving the
 * served document in a browser and sampling computed style 90ms into a swap onto
 * the squad slide returned opacity 0.29 / 0.07 / 0 / 0 down the four rows, with
 * transforms of 7.6px / 14.4px / 20px / 20px and transition-delays of 0, 50, 100
 * and 150ms. The rows were fading and travelling exactly as specified.
 *
 * WHAT HE WAS ACTUALLY SEEING, AND WHY IT READ AS NOTHING. Two things, and both
 * of them are gone with the table:
 *
 *   THE ONE HIGH-CONTRAST THING ON THE SLIDE DID NOT MOVE. The five category
 *   headings lived in `.shead`, which was not in the animated set at all - not
 *   `.card`, not `.tile`, not `.mate`, not `.stitle`. So five saturated colored
 *   words appeared instantly at full opacity in their final position while
 *   everything else drifted up behind them. The eye reads the brightest element
 *   as the slide's arrival, and that element was arriving with a cut.
 *
 *   AND WHAT DID ANIMATE WAS FOUR DARK FULL-WIDTH SLABS. A 20px rise on a
 *   1100x106 row whose fill is near-black on a near-black background is a
 *   travel of a fifth of the row's own height across the width of the screen.
 *   The leaderboard's signature is five discrete cards stepping in left to
 *   right; four wide bars fading up in near-lockstep is not the same gesture and
 *   does not read as one.
 *
 * SO THE FIX IS THE LAYOUT, NOT THE TIMING. The squad slide is columns of cards
 * now, so it takes the `.col:nth-child()` stagger every other slide takes, from
 * the same computation, with nothing left outside the animated set. It arrives
 * the way the other two arrive because it is built the way they are built.
 *
 * ═══ THE STAGGER IS DIVIDED INTO THE BUDGET, NOT ADDED TO IT ═══
 *
 * Five columns step by 50ms and the last one starts at 200ms, which plus its own
 * 420ms lands exactly on `TRANSITION_MS`. A sixth would have pushed the last
 * start to 250ms and the whole swap to 670ms, so `TRANSITION_MS` would have
 * quietly stopped being the honest description of how long the surface is busy.
 * The step is computed from the SLOT count: the last visible column always
 * starts at `TRANSITION_MS - CARD_MS`, whatever the count is.
 *
 * AND IT CYCLES WITH THE SLOTS RATHER THAN RUNNING OFF THE END. When the
 * leaderboard is drifting there are twice as many columns in the document as
 * there are slots on screen (see `marqueeStyles`), and a stagger that kept
 * stepping would have the twelfth card starting 500ms after the first - half a
 * second after the swap was supposed to be over. Position 6 therefore steps with
 * position 1. Nobody can see more than `slots` of them at once by construction.
 */
function transitionStyles(columns: number, slots: number): string {
  const span = Math.max(slots, 1)
  const step = span > 1 ? (TRANSITION_MS - CARD_MS) / (span - 1) : 0
  const delays = Array.from({ length: columns }, (_, i) => {
    const at = `${i + 1}`
    return `.col:nth-child(${at}) .card, .col:nth-child(${at}) .tile { transition-delay: ${Math.round(
      (i % span) * step,
    )}ms; }`
  }).join('\n')

  return `
.panel {
  transition:
    opacity ${TRANSITION_MS}ms ease,
    visibility 0s linear ${TRANSITION_MS}ms;
}
.panel.on {
  transition:
    opacity ${TRANSITION_MS}ms ease,
    visibility 0s linear 0s;
}
.card, .tile, .stitle {
  opacity: 0;
  transform: translate3d(0, ${ENTRANCE_PX}px, 0);
  transition:
    opacity ${CARD_MS}ms ease,
    transform ${CARD_MS}ms cubic-bezier(0.22, 0.8, 0.28, 1);
}
.panel.on .card, .panel.on .tile, .panel.on .stitle {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
${delays}`
}

/**
 * ═══ THE DRIFT, AND THE ARITHMETIC THAT MAKES ITS LOOP SEAMLESS ═══
 *
 * Owner: "having 6 columns we should have them scroll right to left".
 *
 * THE SHAPE. `.cards` (and `.tiles`) is a fixed-width window onto a `.track`
 * holding TWO copies of the columns end to end. The track translates left by
 * exactly ONE COPY'S WIDTH over the whole cycle and then restarts. At the moment
 * it restarts, copy two is sitting precisely where copy one was, so the frame
 * before the wrap and the frame after it are the same image: there is no jump,
 * no seam and no gap, and it is true by arithmetic rather than by looking right.
 *
 *   shift = count x (cardWidth + GUTTER)
 *
 * and the gutter between the last card of copy one and the first of copy two is
 * the same `gap` as every other, which is the half that is easy to get wrong -
 * a track laid out with margins instead of a gap wraps one gutter short.
 *
 * THE WINDOW IS NEVER EMPTY, AND THAT IS ALSO ARITHMETIC. At the far end of the
 * cycle the visible window runs from `shift` to `shift + INNER_WIDTH`, so the
 * track must be at least that long: `2 x count x (w + G) - G >= count x (w + G)
 * + INNER_WIDTH`, i.e. `count x (w + G) >= INNER_WIDTH + G`. That holds for any
 * count past `SLOTS` by construction, because `SLOTS` cards plus their gutters
 * are already the whole safe area. `scoreboard.check.ts` recomputes it rather
 * than trusting this paragraph.
 *
 * `linear` AND NOT `ease`. An eased marquee speeds up and slows down inside
 * every cycle, which on a continuous drift reads as the board breathing. It also
 * breaks the seam: the velocity at 100% would not match the velocity at 0%.
 *
 * ONLY `transform` MOVES, so the track is one composited layer translating over
 * already-rastered content, which is the same rule every background layer on
 * this page follows. It is the one large promotion the content layer pays for
 * and it is declared once. See the header for what that costs and does not.
 *
 * ═══ IT STARTS AT ZERO, WHICH IS THE ONE PLACE THIS PAGE DOES NOT RANDOMIZE ═══
 *
 * Every moving layer in the background takes a random negative `animation-delay`
 * so that no two clients agree. This one deliberately does not: the first frame
 * of a warmup should be the top of the leaderboard, with MOST WINS in the first
 * slot, rather than a board caught mid-scroll with a card sliced by the window.
 * The variety the owner asked for is in the background; the content's starting
 * position is information.
 *
 * ═══ AND THE EDGES FADE RATHER THAN CUTTING ═══
 *
 * A hard clip at the safe-area boundary would slice a card mid-character 90px
 * inside the lit screen with background still visible beyond it, which is
 * exactly the defect the owner reported when the prop's bezel was doing it. A
 * mask fades the leaving and entering cards out over `FADE_FRACTION` of a card
 * instead, so
 * nothing is ever cut and nothing readable sits at the boundary. The mask is
 * static: it is rastered once with the window and the moving layer is composited
 * into it, so it is a render surface rather than a repaint.
 *
 * ⚠ THE MASK IS THE CLIP, AND `overflow: hidden` IS DELIBERATELY NOT USED. That
 * was the first shape of this and rendering it showed what it cost: a tile is
 * exactly as tall as the row holding it, so clipping to the row cut the tile's
 * drop shadow off at its own edge and flattened the per-player slide - the one
 * slide the owner asked to be left exactly as it is ("I like the colors on the
 * player stats page. Keep those and change the rest"). Padding the row out to
 * make room would have moved the gap between his name and his numbers, which is
 * the same slide by a slower route.
 *
 * SO THE MASK IS THREE TIMES THE ROW'S HEIGHT AND CENTERED ON IT. A mask paints
 * over the element's overflow as well as its content, and `no-repeat` makes
 * everything outside the mask box transparent - so a mask sized `100% 300%`
 * fades the two horizontal edges exactly as intended and leaves a whole row's
 * height of slack above and below for shadows to fall into. One declaration
 * doing the clipping in one axis, which is the thing CSS has no property for.
 *
 * `-webkit-` LONGHANDS THROUGHOUT, WITH THE UNPREFIXED SHORTHAND BESIDE THEM.
 * CEF 103 is Chromium 103, where the prefixed forms are the ones that have
 * worked for a decade; the unprefixed `mask` is there for anything newer.
 */
const FADE_FRACTION = 0.3

/**
 * ⚠ ONE TRACK'S ARITHMETIC, AND THERE ARE TWO TRACKS WITH DIFFERENT COUNTS.
 *
 * THIS WAS WRITTEN AS ONE SHARED `@keyframes` AND IT WAS WRONG, which rendering
 * it caught and no amount of reading would have. The leaderboard drops a
 * category nothing has been done in; the per-player slide always carries one
 * tile per ENABLED category. So on a young server the board can be five cards
 * while the tile row is six - and a single shift computed from the larger count
 * would translate the board's track by SIX strides when its copy is only FIVE
 * wide. The wrap would jump by a card width, forever, on the one slide the
 * arithmetic exists to keep seamless.
 *
 * SO EACH TRACK GETS ITS OWN KEYFRAMES, ITS OWN DURATION AND ITS OWN DECISION
 * ABOUT WHETHER IT MOVES AT ALL. They share the card WIDTH, because both slides
 * lay out in `.col` and a board whose cards were a different size from its tiles
 * would stop reading as one board.
 */
function marqueeStyles(input: {
  /** The panel the track lives in: `#board` or `#player`. */
  panel: string
  /** The element that is the window onto it. */
  window: string
  /** Its own keyframes name, because the shift is its own. */
  name: string
  /** How many DISTINCT columns it holds. The track carries two copies of them. */
  count: number
  /** The shared column width. */
  w: number
  /** Anything the window itself needs beyond the mask. */
  extra?: string
}): string {
  const { panel, window: win, name, count, w, extra = '' } = input
  /**
   * THE FADE IS A FRACTION OF A CARD RATHER THAN A FIXED NUMBER OF PIXELS, so it
   * stays the same gesture at any slot count. 36px was tried first and looked at:
   * on a 210px card it is a hard cut with a soft pixel on it, which is the defect
   * it exists to avoid. 30% is wide enough to read as a card leaving and narrow
   * enough that the card behind it is fully lit well before the middle.
   */
  const fade = Math.round(w * FADE_FRACTION)
  const FADE = `linear-gradient(90deg, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 1) ${fade}px, rgba(0, 0, 0, 1) calc(100% - ${fade}px), rgba(0, 0, 0, 0) 100%)`
  const stride = w + GUTTER
  const shift = count * stride
  const duration = count * SCROLL_MS_PER_CARD

  return `
${panel} ${win} {
  justify-content: flex-start;
  -webkit-mask-image: ${FADE};
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: 100% 300%;
  -webkit-mask-position: center;
  mask-image: ${FADE};
  mask-repeat: no-repeat;
  mask-size: 100% 300%;
  mask-position: center;${extra}
}
${panel} .track {
  flex: 0 0 auto;
  animation: ${name} ${duration}ms linear infinite;
  will-change: transform;
}
@keyframes ${name} {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-${shift}px, 0, 0); }
}`
}

/**
 * ═══ THE COLUMN ARITHMETIC, WHICH IS NOW DERIVED AND WAS A LITERAL ═══
 *
 * IT USED TO BE 1280 - 2 x 16 padding = 1248, and five 240px cards with four
 * 12px gutters is 1248. It fitted to the pixel, which is why 240 was never a
 * round number chosen by eye: a card one pixel wider wraps the last column onto a
 * second row that has nowhere to go on a surface that cannot scroll.
 *
 * AND FITTING THE RAW BOARD WIDTH TO THE PIXEL IS EXACTLY WHY THE OUTER CARDS
 * WERE BEING CROPPED BY THE PROP'S BEZEL. The divisor is `INNER_WIDTH` now,
 * which is the SAFE AREA rather than the surface - see `SAFE_INSET` below, which
 * is the one number that decides it.
 *
 * AND IT WAS EXACTLY AS BRITTLE AS THAT SOUNDS. The owner has asked for a sixth
 * card ("Let's also add a 'Biggest spenders' category"), and a sixth 240px card
 * is 1500px of content in 1248px of panel: the board would have silently dropped
 * a column off the bottom of a surface nobody can scroll, on the day the gamemode
 * shipped the missing number, with nothing in this repository failing. So the
 * width is computed from the count and `scoreboard.check.ts` recomputes it for
 * every count from three to eight.
 *
 * SIX COLUMNS ONLY WORK BECAUSE THE LABELS ARE SET IN ANTON, which is condensed:
 * "MOST REVIVES GIVEN" measures about 150px at 19px in Anton and about 215px in
 * Barlow. At six columns the card is 198px wide with 170px of usable width, so
 * the longest label is still inside it. The type choice and the column count are
 * the same decision.
 *
 * ⚠ AND THE OWNER HAS SINCE RULED THAT SIX DO NOT GO IN FIVE SLOTS. See `SLOTS`.
 * The arithmetic above is still what decides a card's width; what changed is the
 * number handed to it when there are more categories than slots.
 */
const GUTTER = 12

/**
 * ═══ THE BOARD IS FIVE WIDE, AND A SIXTH CATEGORY DRIFTS THROUGH IT ═══
 *
 * Owner, 2026-09-11: "when are we adding the 'biggest spenders' section? I think
 * the screen being 5 wide makes sense and having 6 columns we should have them
 * scroll right to left"
 *
 * SO THIS IS HOW MANY CARDS ARE ON SCREEN, AND IT IS NOT HOW MANY EXIST. Up to
 * five categories, each gets a slot and nothing moves. Past five, the cards
 * become a track that drifts leftward through the same five slots, and every
 * category comes round.
 *
 * THE ALTERNATIVE HE TURNED DOWN WAS SQUEEZING, and it is worth recording why he
 * is right. `columnWidth(6)` is 173px against five slots' 210px, which takes
 * 37px out of a card whose header already has to hold "MOST REVIVES GIVEN" - the
 * owner's own wording, which cannot be shortened and has to be made to fit. Six
 * narrow cards is a board that is worse everywhere to accommodate one card; five
 * full-size ones plus motion is a board that is unchanged everywhere and takes
 * longer to read completely.
 *
 * IT GOVERNS THE TILE ROW TOO, and that follows from "the screen being 5 wide
 * makes sense" rather than from tidiness: the per-player slide has one tile per
 * ENABLED category, so it is the same six in the same width with the same label
 * problem. Two slides sharing one rule is also what keeps them reading as one
 * board. The squad slide is NOT governed by it - its columns are PEOPLE, the
 * game's own maximum squad is four, and all four must be on screen together for
 * the slide to make the comparison it exists to make.
 */
export const SLOTS = 5

/**
 * ═══ HOW FAST THE BOARD DRIFTS, AND IT IS A NUMBER HE CAN TUNE ═══
 *
 * The time the track takes to advance by exactly one card and one gutter. So the
 * whole cycle is this times the number of categories, and any one card is on
 * screen for this times `SLOTS`.
 *
 * 9 SECONDS BECAUSE A LEADERBOARD HAS TO BE READABLE WHILE IT MOVES. At five
 * slots a card is 210 design pixels wide, so this is about 25 pixels a second: a name
 * moves its own width in roughly six seconds and a card takes 45 seconds to
 * cross the board. That is slow enough that the eye tracks a row without
 * chasing it, and the whole six-card cycle is 54 seconds.
 *
 * IT IS DELIBERATELY NOT TIED TO `BOARD_DWELL_MS`. The leaderboard is up for 12
 * seconds at a time and the page never reloads during a warmup, so the track
 * keeps drifting while the other slides are showing and the board comes back at
 * a different offset each time. A player standing through one warmup sees all
 * six; a player glancing once sees five full-size cards rather than six cramped
 * ones. Tying the two together would have made every visit start on MOST WINS
 * and the sixth card the one nobody ever sees.
 *
 * MOTION IS NOT THE CONSTRAINT HERE and that is measured rather than assumed:
 * FiveM blits the whole surface from a shared D3D11 handle every game frame
 * whether the page moved or not, so what a moving board costs is frame
 * production inside CEF, and this is one composited layer translating. See the
 * header. The constraint is reading speed, which is what this number is.
 */
export const SCROLL_MS_PER_CARD = 9_000

/**
 * ═══ THE SAFE AREA, WHICH IS A BUG FIX AND NOT A MARGIN PREFERENCE ═══
 *
 * Owner, 2026-09-11: "It doesn't look like the crop landed with the redesign."
 *
 * WHAT IS ACTUALLY WRONG. The board is painted onto a prop whose MODEL BOX is
 * wider than its LIT SCREEN, so the physical bezel of the prop crops the outer
 * edges of the page. In game the first and last cards are cut off mid-character.
 * The page is not overflowing and nothing here is mis-measured: the document is
 * exactly 1280x720 and 1280x720 of it is being drawn. A strip of it is simply
 * behind plastic.
 *
 * THE FIX IS THIS SIDE'S AND NOT THE GAME'S, WHICH IS THE OWNER'S INSTRUCTION.
 * "we need to not change the position or size of the DUI any further. It has to
 * stay as-is and we need to address the visuals on the ringmaster side." So
 * `widthM` is not touched and is not proposed.
 *
 * AND RENDERING AT 1920x1080 WOULD NOT HAVE HELPED, WHICH HE ASKED. The aspect
 * ratio is unchanged, so exactly the same FRACTION of the page falls outside the
 * bezel; all it would buy is more pixels in the part that is cropped, at 8.3 MB
 * of live RGBA per client against 3.7. Worse, 1280x720 is pinned on both sides
 * (`BR.Config.Board.width/height`) and a mismatch crops the page silently with
 * no error anywhere. The two numbers stay.
 *
 * SO THE PAGE INSETS ITS OWN CONTENT, THE WAY BROADCAST TELEVISION DOES. Title
 * safe is the oldest solution to exactly this problem - a signal that has to
 * survive being displayed on a device whose visible area you do not control -
 * and the answer is to put nothing that must be read near the edge.
 *
 * ═══ SEVEN PERCENT, AND IT IS ONE NUMBER SO HE CAN DIAL IT ═══
 *
 * `SAFE_INSET` is the FRACTION of each axis given up on each side, and it is the
 * only number that has to change to re-fit the board to whatever his bezel
 * actually eats. Everything else - the panel padding, the column width, the
 * squad row height, the content height the three slides lay out inside - is
 * derived from it. Nothing below reads `DESIGN_WIDTH` for layout any more, which
 * is the property that was missing: the columns used to be computed to fit
 * `1280 - 32` to the pixel, which is precisely why content ran to the very edge.
 *
 * WHY 0.07. Broadcast title-safe is conventionally 5% per side on a modern
 * signal and 10% on an old one, and the prop is nearer the old case: a physical
 * frame rather than a tolerance. 7% is the middle of the 6-8% range that is the
 * usual starting point, it costs 90px of the 1280 and 50px of the 720 on each
 * side, and it leaves 1100x620 - which is still wider than the six-column layout
 * needs and taller than the tallest slide. If he reports the crop is still
 * biting, this goes to 0.08 and nothing else moves.
 *
 * THE BACKGROUND STILL PAINTS THE FULL 1280x720 and deliberately so. Only the
 * CONTENT is inset; `.wash`, `.vig` and every moving layer are sized to the whole
 * surface, so the cropped margin is background rather than nothing. A board with
 * a black frame around it would read as a mistake from the first glance.
 */
export const SAFE_INSET = 0.07
export const SAFE_X = Math.round(DESIGN_WIDTH * SAFE_INSET)
export const SAFE_Y = Math.round(DESIGN_HEIGHT * SAFE_INSET)

export const INNER_WIDTH = DESIGN_WIDTH - 2 * SAFE_X
export const INNER_HEIGHT = DESIGN_HEIGHT - 2 * SAFE_Y

/**
 * The title band, and what is left under it for the slide itself.
 *
 * HIS THREE WORDS GO HERE. "The scoreboard page should also have a title at the
 * top reading 'LEADERBOARD' and the player stats should have one reading 'PLAYER
 * STATS' and the squad one reading 'SQUAD STATS'." They are the first words he
 * has ever asked to be ADDED to this page, so they are exact and there is
 * nothing beside them - no subtitle, no caption, no count.
 *
 * `CONTENT_HEIGHT` IS WHAT EVERY SLIDE DIVIDES UP, and it is the height with the
 * title already taken out. The alternative - letting each slide subtract the
 * title itself - is three places to get it wrong on a surface that cannot
 * scroll, and the squad slide is the one that would have lost.
 */
/**
 * 54 AND NOT 46, AND THE FOUR PIXELS ARE ARITHMETIC RATHER THAN TASTE. The band
 * is `border-box`, so its 10px of padding and its 1px rule come OUT of it: at 46
 * the content box was 35px holding a 40px line box, which overflowed a band that
 * hides its overflow. It happened to look right because Anton's ink is about
 * three quarters of its em and fitted anyway - which is a layout that is correct
 * by luck and stops being correct the first time the type size moves.
 */
export const TITLE_H = 54
const TITLE_GAP = 14
export const CONTENT_HEIGHT = INNER_HEIGHT - TITLE_H - TITLE_GAP

export function columnWidth(columns: number): number {
  if (columns < 1) return INNER_WIDTH
  return Math.floor((INNER_WIDTH - (columns - 1) * GUTTER) / columns)
}

/**
 * One leaderboard row, and the header band above five of them.
 *
 * THE HEADER'S HEIGHT IS PINNED IN THE CSS RATHER THAN LEFT TO ITS PADDING, and
 * that is what makes this number true. It used to be padding plus whatever line
 * box Anton produced at that size, which happened to come close to 55 and would
 * have stopped doing so the next time anybody touched the type - pushing the
 * fifth row past the bottom of a card that cannot scroll, in the game, on a
 * wall, with nothing here failing.
 */
const ROW_H = 88
const HEAD_H = 58
/**
 * THE HEADER, FIVE ROWS, AND THE CARD'S OWN TOP AND BOTTOM BORDER, EXACTLY.
 *
 * `+ 2 * EDGE_PX` AND IT USED TO BE `+ 2`, which is this pass's one real
 * re-layout. The card is `border-box`, so its own border comes out of its
 * height: at a 1px edge the card was 500 and at a 3px edge it is 504, and
 * leaving the literal would have taken four pixels off the fifth row inside a
 * card whose overflow is hidden - the fifth row clipped, on a wall, with nothing
 * here failing. `.card h2`'s `line-height` is the same correction one element
 * down.
 */
const CARD_H = HEAD_H + TOP_N * ROW_H + 2 * EDGE_PX

/** How long one card or tile takes to arrive. See `transitionStyles`. */
const CARD_MS = 420

/**
 * How far a card, tile or squad row travels on its way in.
 *
 * ═══ IT IS A LAYOUT NUMBER AS WELL AS A MOTION ONE, WHICH IS WHY IT IS HERE
 *     ═══
 *
 * The entrance starts each element 20px BELOW where it settles, so for the first
 * 420ms of a slide everything on it is 20px lower than the layout says. On the
 * leaderboard that is free: the cards end 75px above the bottom of the panel. On
 * the squad slide it was not. The rows are sized to fill the panel, so the last
 * one entered at 724px on a surface that is 720px tall and had its bottom edge
 * and its rounded corner clipped off for the length of the transition - visible
 * on a wall, invisible in every still preview of the finished state.
 *
 * So `squadRowHeight` subtracts twice this from what it has to divide up, and
 * the stack is centered, which leaves exactly this much air above and below for
 * the travel to use. The two uses are the same constant so they cannot drift.
 */
const ENTRANCE_PX = 20

/**
 * ═══ THE COLOR, CATEGORY BY CATEGORY ═══
 *
 * One block per category on screen, generated from its accent by `tone()`. This
 * is where the owner's note actually lands:
 *
 *   "your agent is literally just coloring the text. Stop doing low-effort
 *   things. Color the interface. Color the cards. have gradients. add PIZZAZZ"
 *
 * WHAT EACH CATEGORY NOW PAINTS, in order of how much of the surface it is:
 *
 *   THE CARD'S WHOLE FILL. A vertical ramp from a top tinted with the accent
 *   down to near black, plus a wide soft glow bleeding down from above the
 *   card's top edge. That is the thing that was missing: a card used to be one
 *   flat grey no matter what it counted.
 *
 *   THE HEADER BAND. Its own gradient in the same hue, strongest at the top.
 *
 *   THE PODIUM. First, second and third numerals step down from the accent
 *   toward the neutral the fourth and fifth already use, so the ranking has a
 *   temperature as well as a number. The leader's VALUE is brighter still.
 *
 *   THE VIEWER'S ROW. A wash of the accent across the highlight fill, fading
 *   out to the right. This is what replaced the slab of blue he called harsh.
 *
 *   THE TILE, harder tinted than a card, with the glow at its floor and the
 *   numeral itself in a bright tint of the hue.
 *
 * AND NOT ONE EDGE, ANYWHERE. Every border on this page is `PALETTE.edge`,
 * neutral grey, at one pixel. `scoreboard.check.ts` finds every occurrence of
 * every accent in the finished document and reads the CSS property it landed
 * in; anything that is not ink or fill fails.
 */
function categoryStyles(
  categories: ReadonlyArray<{ key: string; accent: string }>,
): string {
  return categories
    .map(({ key, accent }) => {
      const t = tone(accent)
      return `
.c-${key} .card {
  background-image:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.015) 46%),
    radial-gradient(340px 220px at 50% -8%,
      ${rgba(accent, 0.26)} 0%,
      ${rgba(accent, 0.06)} 55%,
      ${rgba(accent, 0)} 100%),
    linear-gradient(176deg, ${t.top} 0%, ${t.mid} 46%, ${PALETTE.deep} 100%);
}
.c-${key} .card h2 {
  color: ${accent};
  background-image: linear-gradient(180deg,
    ${rgba(accent, 0.14)} 0%,
    ${rgba(accent, 0.06)} 58%,
    ${rgba(accent, 0.01)} 100%);
}
.c-${key} li:nth-child(1) .pos { color: ${accent}; }
.c-${key} li:nth-child(2) .pos { color: ${t.second}; }
.c-${key} li:nth-child(3) .pos { color: ${t.third}; }
.c-${key} li:nth-child(1) .val { color: ${t.bright}; }
/* THE ONE COLORED EDGE ON THIS PAGE, AND IT IS THE OWNER'S OWN REQUEST. See the
   focused-row block in the stylesheet: this is the value br_ui's inventory sets
   to white when a slot takes focus, and it drives the border AND both redrawn
   chamfers from one declaration, which is the point of the variable. */
.c-${key} .card li.you {
  --edgec: ${t.bright};
  background-image: linear-gradient(90deg,
    ${rgba(accent, 0.3)} 0%,
    ${rgba(accent, 0.11)} 52%,
    ${rgba(accent, 0.02)} 88%,
    ${rgba(accent, 0)} 100%);
}
.c-${key} .tile {
  background-image:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.015) 46%),
    radial-gradient(300px 230px at 50% 104%,
      ${rgba(accent, 0.32)} 0%,
      ${rgba(accent, 0.08)} 55%,
      ${rgba(accent, 0)} 100%),
    linear-gradient(178deg, ${t.tileTop} 0%, ${t.mid} 52%, ${PALETTE.deep} 100%);
}
.c-${key} .tlabel { color: ${accent}; }
.c-${key} .tval { color: ${t.bright}; }`
    })
    .join('\n')
}

/**
 * One squad mate's CARD, in that mate's own blip color.
 *
 * ═══ HE THREW OUT THE COLUMNS AND KEPT THE COLOR, WHICH ARE TWO DIFFERENT
 *     NOTES ═══
 *
 * Owner, 2026-09-11: "The squads page ... the column font colors are just....
 * too much lol. I prefer cards for each of the players please."
 *
 * WHAT HE IS REJECTING IS NOT THE BLIP COLOR. `7112db1` painted each squad ROW
 * and each NAME in that mate's blip color, and put the five category headings
 * across the top in five category accents. So a slide with four people on it
 * carried nine colored strings of TEXT in a table, which is the same "just
 * coloring the text" he has now objected to three separate times.
 *
 * AND THE BLIP COLOR IS THE ONE COLOR ON THIS BOARD WE DID NOT CHOOSE. It is
 * `BR.SquadColours` - what is on that person's minimap blip, their destination
 * marker and its world beam - so a card painted in it makes a claim the player
 * can check by glancing at their own minimap. Throwing it out with the layout
 * would have answered a different note than the one he wrote.
 *
 * ═══ SO IT IS CARRIED THE WAY A CARD CARRIES COLOR, WHICH IS `categoryStyles`
 *     ═══
 *
 * This function is deliberately the same shape as the one above it, with the
 * blip color where a category's accent goes: the card's whole fill ramps from a
 * tinted top to near black, a wide glow bleeds down from above its top edge, the
 * name band takes the same hue, and the viewer's card takes the inventory's
 * focus edge in their own color. Every derived value comes from the same
 * `tone()` the leaderboard uses, so the two slides are one board.
 *
 * ⚠ AND NOT ONE PIECE OF TYPE ON THE CARD IS PAINTED IN IT. The name is
 * `PALETTE.text` on the tinted band and every label and value under it is the
 * neutral the leaderboard uses. That is the whole correction: the color is the
 * object, not the writing on it.
 *
 * `sq-<row>` ON THE COLUMN AND NOT ON THE CARD, matching `c-<key>`, so both
 * families are a class on the wrapper and a descendant selector on what it
 * paints. The row index is the slide's ordering (by name) and the COLOR came
 * from `squadColors`, which is the game's ordering (by server id); the two are
 * deliberately different numbers and must not be confused.
 */
function squadStyles(
  mates: ReadonlyArray<{ color: string | null; you: boolean }>,
): string {
  return mates
    .map((mate, i) => {
      if (!mate.color) return ''
      const c = mate.color
      const t = tone(c)
      /**
       * THE VIEWER'S OWN CARD TAKES THE INVENTORY'S FOCUS EDGE IN THEIR OWN BLIP
       * COLOR. Everywhere else on the board that edge is the CATEGORY's light,
       * because the surface belongs to a category; on this slide a card belongs
       * to a PERSON, and the one color that is already theirs is the one on the
       * minimap. Mixed 42% toward white by the same rule `tone().bright` uses,
       * so a dark blip color still reads as a lit edge rather than as a border
       * that failed to paint.
       */
      const focus = mate.you
        ? `
.sq-${i} .card.you {
  --edgec: ${t.bright};
  background-image: linear-gradient(90deg,
    ${rgba(c, 0.3)} 0%,
    ${rgba(c, 0.12)} 44%,
    ${rgba(c, 0.04)} 76%,
    ${rgba(c, 0)} 100%),
    radial-gradient(340px 220px at 50% -8%,
      ${rgba(c, 0.26)} 0%,
      ${rgba(c, 0.06)} 55%,
      ${rgba(c, 0)} 100%),
    linear-gradient(176deg, ${t.youTop} 0%, ${mix(PALETTE.you, c, 0.12)} 46%, ${PALETTE.deep} 100%);
}`
        : ''
      return `
.sq-${i} .card {
  background-image:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.015) 46%),
    radial-gradient(340px 220px at 50% -8%,
      ${rgba(c, 0.26)} 0%,
      ${rgba(c, 0.06)} 55%,
      ${rgba(c, 0)} 100%),
    linear-gradient(176deg, ${t.top} 0%, ${t.mid} 46%, ${PALETTE.deep} 100%);
}
/* THE NAME BAND, AT THE LEADERBOARD'S OWN 0.14 AND NOT AT A NUMBER PICKED HERE.
   That stop came out of the contrast gate rather than out of taste - at 0.22 the
   band was handsome and three of six labels measured under the floor on it - and
   a squad mate's blip color is drawn from a palette of eight LIGHT saturated
   colors, which is the harder case of the two. The name on it is PALETTE.text,
   measured against this exact composite in contrastPairs. */
.sq-${i} .card h2 {
  background-image: linear-gradient(180deg,
    ${rgba(c, 0.14)} 0%,
    ${rgba(c, 0.06)} 58%,
    ${rgba(c, 0.01)} 100%);
}${focus}`
    })
    .join('\n')
}

/**
 * ═══ EACH SLIDE'S OWN LIGHT, AND THE ONE THAT IS PINNED ═══
 *
 * Owner, 2026-09-11: "Stop using the same boring colors on each page. Change the
 * colors between the pages please". And then, narrowing it: "I like the colors
 * on the player stats page. Keep those and change the rest".
 *
 * ═══ HOW PLAYER STATS IS HELD STILL, WHICH IS A STRUCTURAL ANSWER AND NOT A
 *     PROMISE ═══
 *
 * The three slides shared one background: `.wash`, `.vig` and the moving layers
 * sit UNDER all three panels, and every panel was transparent. So recoloring
 * "the background" would have recolored the one slide he asked to keep.
 *
 * THE IDENTITY IS THEREFORE A PANEL-LEVEL WASH AND `#player` HAS NO RULE AT ALL.
 * Not a neutral rule, not a rule that happens to evaluate to what it was: the
 * function below emits nothing for it. The per-player slide's pixels are the
 * shared wash exactly as before, and there is no shared token that a change to
 * the other two can move, because the other two do not change any token - they
 * each add a layer of their own on top of the common floor. `scoreboard.check.ts`
 * asserts that no `#player` selector exists anywhere in the document, which is
 * the assertion that would fail the day somebody "tidies" this into three cases.
 *
 * AND IT IS TRANSLUCENT ON PURPOSE. An opaque panel fill would hide the orbs,
 * sweeps and motes behind it, which is the animated background the owner asked
 * for two passes ago. These are lights laid over it, not a replacement for it.
 *
 * ═══ LEADERBOARD: LEGENDARY AMBER, AND IT SITS UNDER THE CATEGORIES ═══
 *
 * `BR.RarityInfo`'s legendary `#FFB020`. A leaderboard is the one surface in the
 * warmup area that is about being the best at something, and legendary is the
 * game's own word for that; it is also the furthest from the cool cyan-teal the
 * per-player slide keeps, so the two do not read as the same page.
 *
 * IT CANNOT COMPETE WITH THE CATEGORY COLORS AND IT DOES NOT HAVE TO. The five
 * or six cards are opaque - a `background-color` under their gradients - so this
 * light only reaches the margins, the gutters and the band around the title. The
 * information on this slide is which card is which color, and none of it is
 * painted on anything this touches.
 *
 * ═══ SQUAD: THE MATES' OWN BLIP COLORS, WHICH ARE ALREADY ITS PALETTE ═══
 *
 * One soft light per person, in their blip color, positioned across the panel in
 * the order their cards are. So the slide's identity is literally the people on
 * it: a different squad is a different colored page, a solo lobby never sees it,
 * and it agrees with the minimap the player is already looking at. Nothing about
 * it was chosen here.
 *
 * WHEN THE COLORS CANNOT BE DERIVED THERE IS NO WASH. `squadColors` is all or
 * nothing - one mate missing a server id and every index after them would be one
 * seat out - and a squad slide with invented lights would be the same lie in a
 * different property. It falls back to the shared background, like the
 * per-player slide.
 *
 * NO PURPLE IN ANY OF IT. `br_lib/shared/enums.lua`: "NEVER PURPLE, in any slot:
 * purple belongs to the storm alone." Amber is not near it, and the eight squad
 * colors do not contain one.
 */
function slideStyles(
  mates: ReadonlyArray<{ color: string | null; you: boolean }>,
): string {
  const board = `
#board {
  background-image:
    radial-gradient(1180px 540px at 50% -16%,
      ${rgba(LEGENDARY, 0.22)} 0%,
      ${rgba(LEGENDARY, 0.07)} 46%,
      ${rgba(LEGENDARY, 0)} 100%),
    radial-gradient(720px 420px at 3% 106%,
      ${rgba(LEGENDARY, 0.12)} 0%,
      ${rgba(LEGENDARY, 0)} 100%),
    radial-gradient(720px 420px at 97% 106%,
      ${rgba(LEGENDARY, 0.12)} 0%,
      ${rgba(LEGENDARY, 0)} 100%),
    linear-gradient(180deg,
      rgba(26, 15, 2, 0.62) 0%,
      rgba(12, 7, 1, 0.34) 58%,
      rgba(0, 0, 0, 0) 100%);
}`

  const colors = mates.map((m) => m.color).filter((c): c is string => Boolean(c))
  if (colors.length === 0) return board

  /**
   * ONE LIGHT PER PERSON, CENTERED ON WHERE THEIR CARD IS. `(i + 0.5) / n` is
   * the middle of their column, so the wash behind a card is that card's own
   * color rather than a gradient that happens to pass nearby.
   */
  const lights = colors
    .map((c, i) => {
      const at = Math.round(((i + 0.5) / colors.length) * 1000) / 10
      return `    radial-gradient(560px 520px at ${at}% 46%,
      ${rgba(c, 0.2)} 0%,
      ${rgba(c, 0.06)} 52%,
      ${rgba(c, 0)} 100%)`
    })
    .join(',\n')

  return `${board}
#squad {
  background-image:
${lights},
    linear-gradient(180deg,
      rgba(3, 7, 13, 0.58) 0%,
      rgba(2, 4, 8, 0.30) 58%,
      rgba(0, 0, 0, 0) 100%);
}`
}

/**
 * The stylesheet.
 *
 * FIXED PIXELS THROUGHOUT AND NOT ONE MEDIA QUERY. The surface is exactly one
 * size forever; a responsive board would be flexibility nothing can exercise and
 * a second layout nobody will ever look at.
 *
 * `overflow: hidden` ON BOTH ELEMENTS IS LOAD BEARING. A DUI has no scrollbar,
 * no wheel and no keyboard, so anything past the fold is not merely awkward to
 * reach, it does not exist. Hiding it makes an overflow show up as a clipped
 * card during review rather than as a silently missing one in play.
 *
 * ═══ THE COLOR, AFTER THE OWNER SAW IT ═══
 *
 * "Don't add the low-effort color borders. We don't need those and it makes the
 * product look AI-generated."
 *
 * So every accent EDGE is gone: the 4px bar across the top of each card, the
 * matching bar on each per-player tile, and the 4px left border that used to
 * mark the viewer's own row. What the accents still do is INK - the leading
 * numeral on a card, the label on a tile, the column heading on the squad slide -
 * because he asked for color in the first place ("Some animated background and
 * transitions and colors") and taking the color out entirely would be answering
 * a different note than the one he wrote.
 *
 * THE ONE-PIXEL EDGE AROUND A CARD IS NOT AN ACCENT AND STAYS. It is
 * `PALETTE.edge`, the same neutral grey as the rule under a card's heading, and
 * it is what separates a card from the page rather than what decorates it.
 * `scoreboard.check.ts` asserts the absence by looking for CATEGORY COLORS in
 * border and bar positions specifically, not for the word "border".
 */
function styles(input: {
  motion: MotionLevel
  phases: readonly number[]
  /** The most columns any one track RENDERS, which is not how many slots there are. */
  columns: number
  /** How many of them are on screen at once. See `SLOTS`. */
  slots: number
  /** How many DISTINCT cards the leaderboard has, and 0 when it does not drift. */
  boardScroll: number
  /** How many DISTINCT tiles the per-player slide has, and 0 when it does not drift. */
  tileScroll: number
  /** How many stat rows one squad card lists: one per category on the slide. */
  squadStats: number
  /** Every category on screen, deduplicated, in catalog order. */
  categories: ReadonlyArray<{ key: string; accent: string }>
  /** The squad cards, in the order they are rendered. See `squadStyles`. */
  mates: ReadonlyArray<{ color: string | null; you: boolean }>
}): string {
  const { motion, phases, columns, slots, boardScroll, tileScroll, squadStats, categories, mates } = input
  const w = columnWidth(slots)

  /** The squad's own column arithmetic: one card per mate, across the safe area. */
  const mw = columnWidth(Math.max(mates.length, 1))
  const mateRowH = mateStatRowHeight(squadStats)
  const mateCardH = mateCardHeight(squadStats)

  return `
${faces()}
/* ── THE ONE DECLARATION THAT TURNS A 1280x720 DESIGN INTO A 1920x1080 TEXTURE
   ─────────────────────────────────────────────────────────────────────────────
   Owner, 2026-09-11: "what resolution are we using for the DUI right now? If
   it's still 720p can we bump it to 1080p or 1440p?" ... "Yeah let's go 1080p"

   WHAT HE ASKED FOR IS A SHARPER BOARD, NOT A SMALLER ONE, and those are what
   the two obvious implementations produce. This page has no responsive layout
   and every number on it is an absolute pixel, so simply raising the surface to
   1920x1080 would leave every type size, gutter and border at two thirds of the
   share of the screen it has now: the board he approved, rendered small, with a
   band of empty background around it.

   SO THE LAYOUT STAYS IN THE PIXELS IT WAS JUDGED IN and the document is scaled
   to the surface. Everything below is authored in DESIGN_WIDTH x DESIGN_HEIGHT
   and this multiplies all of it by BOARD_WIDTH / DESIGN_WIDTH.

   'zoom' AND NOT 'transform: scale()', AND THE DIFFERENCE IS THE WHOLE POINT. A
   transform is a compositor operation: Blink may raster the subtree at 1x and
   stretch the result, which is exactly the upscaled-720p softness the owner is
   asking to be rid of. 'zoom' is a LAYOUT scale - the document is laid out and
   every glyph is rasterized at the scaled size - so the type is genuinely drawn
   at ${UI_SCALE}x. It is the oldest non-standard property in the engine and has
   worked since long before CEF 103, which is the other half of why it is safe
   here: nothing about it is a 2022-era feature.

   AND THE ASPECT RATIO MUST MATCH OR THIS IS A LIE. One zoom cannot satisfy two
   different ratios, and a mismatch would run content off one axis with nothing
   raising an error. scoreboard.check.ts asserts the two are equal, and 1440p is
   this same constant again. */
html {
  margin: 0;
  padding: 0;
  width: ${DESIGN_WIDTH * UI_SCALE}px;
  height: ${DESIGN_HEIGHT * UI_SCALE}px;
  overflow: hidden;
  background: ${PALETTE.page};
}
/* THE ZOOM IS ON THE BODY AND NOT ON THE ROOT, WHICH IS NOT A STYLE CHOICE. A
   'zoom' on the root element scales the root's CONTENTS but leaves the initial
   containing block alone, so an 'html' sized in design pixels paints a design
   sized document in the corner of the surface with the rest left black - which
   is exactly what it did the first time this was rendered and looked at. The
   root therefore carries the REAL surface size, and the body carries the design
   size and the scale that turns one into the other. */
body {
  margin: 0;
  padding: 0;
  zoom: ${UI_SCALE};
  width: ${DESIGN_WIDTH}px;
  height: ${DESIGN_HEIGHT}px;
  overflow: hidden;
  background: ${PALETTE.page};
  color: ${PALETTE.text};
  font-family: ${BODY};
  -webkit-font-smoothing: antialiased;
}

/* ── THE BACKGROUND ──────────────────────────────────────────────────────────
   .wash is four gradients painted once and never touched again. It is the floor
   of the palette, it costs one raster at load and nothing after it, and it is
   emitted at every motion level, because a still gradient is not animation and
   off should still look like something.

   IT USED TO BE TWO GRADIENTS AT 0.15 ALPHA OVER A FLAT NEAR-BLACK, which is
   to say it was invisible: every screenshot of the old board is a black
   rectangle with five darker rectangles on it. The base is a real diagonal ramp
   now - deep teal-navy at the top left down to almost nothing at the bottom
   right - and the two lights on top of it are the project's own cyan and gold
   at four times the alpha they had.

   NO PURPLE, AND ONE OF THESE USED TO BE PURPLE. br_lib/shared/enums.lua:
   "NEVER PURPLE, in any slot: purple belongs to the storm alone." The light in
   the bottom right corner was a pale violet, which is a wall of storm color in
   the one place in the game a player is safe. It is gold now.

   THE MOVING LAYERS ARE IN driftStyles() AND EXIST ONLY UNDER full: three orbs
   on closed paths, one blade of light that sweeps across, one striped sheet.
   Each promoted, each animating nothing but transform, each started at a random
   point in its own loop. See that function for the arithmetic and the header
   for what a frame actually costs on this surface. */
.wash {
  position: absolute;
  top: 0;
  left: 0;
  width: ${DESIGN_WIDTH}px;
  height: ${DESIGN_HEIGHT}px;
  background-image:
    radial-gradient(900px 620px at 10% -14%,
      ${rgba(PALETTE.cyan, 0.2)} 0%,
      ${rgba(PALETTE.cyan, 0.07)} 42%,
      ${rgba(PALETTE.cyan, 0)} 100%),
    radial-gradient(880px 600px at 94% 112%,
      ${rgba(PALETTE.gold, 0.17)} 0%,
      ${rgba(PALETTE.gold, 0.05)} 44%,
      ${rgba(PALETTE.gold, 0)} 100%),
    radial-gradient(700px 520px at 74% 4%,
      rgba(45, 212, 191, 0.1) 0%,
      rgba(45, 212, 191, 0.03) 46%,
      rgba(45, 212, 191, 0) 100%),
    linear-gradient(158deg, #0c1a25 0%, #080f18 38%, #06090f 72%, #04060a 100%);
}
/* THE VIGNETTE, WHICH IS WHAT MAKES THE CARDS SIT ON SOMETHING. It is painted
   OVER the moving layers and UNDER the panels, so the light pools get darker
   toward the four corners and the eye lands in the middle of the board where
   the content is. Static, one raster, and it is the cheapest depth on the page:
   without it the orbs run straight off the edges and the whole surface reads as
   evenly lit, which is the same flatness by a different route. */
.vig {
  position: absolute;
  top: 0;
  left: 0;
  width: ${DESIGN_WIDTH}px;
  height: ${DESIGN_HEIGHT}px;
  background-image:
    radial-gradient(120% 108% at 50% 42%,
      rgba(0, 0, 0, 0) 36%,
      rgba(0, 0, 0, 0.34) 72%,
      rgba(0, 0, 0, 0.72) 100%);
}
${motion === 'full' ? driftStyles(phases) : ''}

/* ── THE VIEWS ───────────────────────────────────────────────────────────────
   EVERY PANEL IS IN THE DOCUMENT AND ALL BUT ONE ARE HIDDEN. visibility rather
   than display because a hidden one has to be able to fade IN, and display is
   not animatable; visibility is, discretely, which is exactly what is wanted:
   the entering panel becomes visible at once and the leaving one goes hidden at
   the END of its fade, so the surface is never composing two visible full-size
   layers for longer than the transition.

   THERE ARE TWO OR THREE OF THEM. Owner: "Let's also add a slide when in squads
   where the player will get to see the stats of their squad mates!" A solo
   player gets the leaderboard and their own numbers; a squadded player gets a
   third. Which is decided entirely by whether there is a squad to show - see
   squadFrom in lib/scoreboard.ts. */
.panel {
  position: absolute;
  top: 0;
  left: 0;
  width: ${DESIGN_WIDTH}px;
  height: ${DESIGN_HEIGHT}px;
  box-sizing: border-box;
  /* THE SAFE AREA. Not a margin taste: the prop's bezel crops the page and this
     is how much of it. One constant, and every other number on the slide is
     derived from what is left. See SAFE_INSET. */
  padding: ${SAFE_Y}px ${SAFE_X}px;
  opacity: 0;
  visibility: hidden;
}
.panel.on {
  opacity: 1;
  visibility: visible;
}

/* ── THE TITLE ───────────────────────────────────────────────────────────────
   Owner, 2026-09-11: "The scoreboard page should also have a title at the top
   reading 'LEADERBOARD' and the player stats should have one reading 'PLAYER
   STATS' and the squad one reading 'SQUAD STATS'."

   HIS WORDS, HIS CAPITALS, AND NOTHING BESIDE THEM. These are the first words
   ever added to this page that are not a category label or a player's own name,
   so they are exact and they are alone: no subtitle, no caption, no squad
   number, no count of anything.

   THE TYPE IS br_ui's SCREEN HEADING, COPIED RATHER THAN MATCHED BY EYE. Every
   sub-screen in the game sets its title as
   'font-display text-[3rem] uppercase tracking-[0.1em] leading-none'
   (ui-src/src/screens/Locker.tsx, Market.tsx). That is Anton, uppercase, 0.1em
   of tracking and a collapsed line box, and it is what is here at the size this
   surface reads at.

   'leading-none' PLUS FLEX CENTERING IS THE WHOLE REASON BOTH ARE PRESENT, and
   it is the same note '.mname' carries: Anton's line box has a deep descent, so
   a title vertically centered by its LINE BOX sits visibly high in its band.
   Collapsing the box to the type size and centering the box puts the glyphs
   where the middle is.

   THE HAIRLINE UNDER IT IS br_ui's PANEL EDGE and it is not a decoration with a
   color in it - it is PALETTE.edge, the same neutral white-alpha every card on
   this page is outlined in. Without it a single word floats in the top left of a
   dark surface with nothing relating it to the slide underneath. */
.stitle {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: ${TITLE_H}px;
  margin: 0 0 ${TITLE_GAP}px 0;
  padding: 0 0 10px 0;
  border-bottom: ${EDGE_PX}px solid ${PALETTE.edge};
  font-family: ${DISPLAY};
  font-size: 40px;
  font-weight: 400;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${PALETTE.text};
  white-space: nowrap;
  overflow: hidden;
}

${motion === 'off' ? '' : transitionStyles(columns, slots)}

/* ── THE LEADERBOARD ─────────────────────────────────────────────────────── */
.cards {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: ${CONTENT_HEIGHT}px;
}
/* THE TRACK IS ALWAYS IN THE DOCUMENT AND USUALLY DOES NOTHING. It is a plain
   centered flex row of columns at five categories or fewer, which is byte for
   byte the layout the board has always had; marqueeStyles adds the animation and
   the window when there are more slots' worth of cards than there are slots. One
   structure rather than two means the still case and the moving case cannot
   drift apart. */
.track {
  display: flex;
  align-items: center;
  gap: ${GUTTER}px;
}
.col { width: ${w}px; }
/* ── A CARD IS AN OBJECT, NOT A RECTANGLE WITH TEXT IN IT ─────────────────────
   Owner, on the version this replaces: "Color the interface. Color the cards.
   have gradients. add PIZZAZZ."

   FOUR THINGS MAKE IT AN OBJECT and every one of them is here rather than in
   the per-category block, because they are the same on every card:

     A FILL THAT GOES SOMEWHERE. The neutral default below runs from a lifted
     top to deep at the bottom; the category block overrides it with the same
     shape in that category's own hue. A flat fill is what made the old board
     read as a wireframe.

     A DROP SHADOW, so the card sits ON the background instead of being a hole
     cut in it. This page banned box-shadow outright at one point on the
     grounds that it re-rasterizes; a STATIC one is rastered once with the rest
     of the card and never again, and the property that mattered - that nothing
     ANIMATES it - is held by the compositable allowlist in the check, which is
     a rule about what may be animated rather than about what may exist.

     A LIGHT EDGE ALONG THE TOP, one inset pixel of white at 7%. It is the
     single cheapest cue that a surface is facing up toward a light, and this
     page has a light: the wash and the orbs behind it. It is br_ui's '.panel'
     shadow, to the digit.

     A NEUTRAL HAIRLINE AROUND IT. Still PALETTE.edge, still grey, still not
     the category's color. The card is colored by its FILL.

   AND IT IS SQUARE NOW, WHICH IS THE GAME'S SHAPE RATHER THAN A PREFERENCE.
   Owner, 2026-09-11: "Can we also get the cards to use square corners like the
   rest of br_ui". Both of br_ui's surface classes are 'border-radius: 0' and the
   note beside them records that the owner saw the square edge arrive by accident
   and kept it. So the 12px radius is gone from every card, tile, row and band on
   this page. The only 'border-radius' left is '50%' on the round background
   layers, which is a circle rather than a corner.

   THE TWO-STOP SHEEN ON TOP OF THE FILL IS br_ui's '.plate', COPIED AT ITS OWN
   NUMBERS: 'linear-gradient(180deg, rgba(255,255,255,0.10),
   rgba(255,255,255,0.015) 46%)'. That is what makes a surface in the game read
   as a piece of hardware facing a light rather than as a tinted rectangle, and
   it sits over each category's own gradient rather than replacing it.

   '--edgec' RATHER THAN A BORDER COLOR, WHICH IS A MECHANISM AND NOT A RENAME.
   br_ui: "--edgec drives the border AND both redrawn chamfers, so a component
   that recolours its edge can never end up with a mismatched diagonal. Recolour
   the variable, never the border." The viewer's row below is exactly such a
   component, and this is the seam it recolors. */
.card, .tile {
  --edgec: ${PALETTE.edge};
  /* br_ui's --cut-max at a 16px root. The bevel a focused surface OPENS to; a
     surface at rest is perfectly square and does not carry a clip-path at all. */
  --cut-max: ${CUT_PX}px;
}
.card {
  box-sizing: border-box;
  width: ${w}px;
  height: ${CARD_H}px;
  background-color: ${PALETTE.card};
  background-image:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.015) 46%),
    linear-gradient(176deg,
      ${mix(PALETTE.card, '#ffffff', 0.06)} 0%,
      ${PALETTE.card} 42%,
      ${PALETTE.deep} 100%);
  border: ${EDGE_PX}px solid var(--edgec);
  border-radius: 0;
  overflow: hidden;
  box-shadow:
    0 16px 34px rgba(0, 0, 0, 0.5),
    0 2px 6px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
/* THE HEADING IS A BAND, NOT A LINE OF TEXT. It gets its own fill in the
   category's color, its own light at the top and a neutral rule under it, so
   the top of every card is a masthead rather than a label floating on the same
   flat plane as the rows. This is where the label's color stopped being the
   only colored thing on the card. */
.card h2 {
  margin: 0;
  box-sizing: border-box;
  height: ${HEAD_H}px;
  padding: 0 12px;
  line-height: ${HEAD_H - EDGE_PX}px;
  font-family: ${DISPLAY};
  /* SCALED WITH THE COLUMN, WITH A FLOOR, WHICH IS THE SAME TRICK '.tval' USES
     AND FOR THE SAME REASON. "MOST REVIVES GIVEN" is eighteen characters and it
     is the owner's own wording, so it cannot be shortened - it has to be made to
     fit. At six columns the card is ${columnWidth(6)}px and a 21px label does not
     go in it. The floor is what stops the answer to a seventh column being type
     nobody can read from a few meters through a texture; past that the label
     ellipsizes, which is the honest failure rather than the invisible one. */
  font-size: ${Math.max(18, Math.min(21, Math.round((21 * w) / 240)))}px;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: ${PALETTE.label};
  border-bottom: ${EDGE_PX}px solid ${PALETTE.edge};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* ── THE ROW'S OWN METRICS, TIGHTENED FOR THE SAFE AREA ──────────────────────
   A column is ${w}px now rather than 240, because the columns divide the SAFE
   AREA rather than the surface - see SAFE_INSET. That is 30px of name width
   gone at five columns, on the one piece of type on this page that is somebody
   else's and cannot be shortened.

   SO THE PADDING, THE NUMERAL COLUMN AND THE TWO TYPE SIZES EACH GIVE BACK A
   LITTLE, which is together worth more than any one of them: 3px a side of
   padding, 3px of the rank column, 2px of the value's gutter, and two points
   off each of the name and the number. A name that used to fit still fits and
   the row is no more cramped than it was, because everything in it shrank by
   the same proportion the card did. */
.card li {
  display: flex;
  align-items: center;
  height: ${ROW_H}px;
  padding: 0 10px;
  box-sizing: border-box;
}
/* THE ROW RULES ARE INSET SHADOWS AND NOT BORDERS, which is arithmetic rather
   than taste: CARD_H is the header plus five rows to the pixel, and four real
   top borders would push the fifth row past the bottom of a card that cannot
   scroll. An inset shadow paints in the same place and takes no layout.

   IT IS STILL EDGE_PX THICK, BECAUSE IT IS A BORDER IN EVERY SENSE THAT MATTERS
   TO A VIEWER. "Triple the border thickness on everything that has borders" is
   about what the board looks like, and a card whose outline tripled while the
   four rules inside it stayed hairlines is a card that lost its rows. The
   property it is written in is an implementation detail of the arithmetic
   above. */
.card li + li {
  box-shadow: inset 0 ${EDGE_PX}px 0 rgba(255, 255, 255, 0.05);
}
.pos {
  width: 21px;
  flex: 0 0 21px;
  font-family: ${DISPLAY};
  font-size: 21px;
  color: ${PALETTE.muted};
}
.who {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ${BODY};
  font-weight: 600;
  font-size: 18px;
}
/* THE NUMBER IS WHY ANYBODY LOOKED AT THE CARD, so it is set five points
   larger than the name beside it and in the display face rather than the body
   one. The leading row's number is brighter again, in its category's color -
   see the per-category block. */
.val {
  flex: 0 0 auto;
  padding-left: 6px;
  font-family: ${DISPLAY};
  font-size: 25px;
  font-variant-numeric: tabular-nums;
}

/* ── THE VIEWER'S OWN ROW ────────────────────────────────────────────────────
   Owner: "if the player viewing the scoreboard is anywhere on it - highlight
   that row."

   A FILL AND NOTHING ELSE. It used to be a fill PLUS a 4px bar in the
   category's accent down the left edge, and that bar was one of the color
   borders he asked to remove. It is static (a highlight that blinks is a
   highlight that is absent half the time) and it carries the same cue on the
   squad slide.

   THE SLATE UNDERNEATH IS DARKER THAN IT WAS, on his other note about this row:
   "The selected row is way too bright blue, very harsh." What makes the row
   read now is not brightness, it is that the category's own light is laid
   across it - see the per-category block, which paints a gradient over this
   fill that fades out to the right. A row lit by the card it is in is a quieter
   signal than a slab of a color that belongs to nothing on the page.

   THE NUMERAL CHANGES COLOR TOO, and that is a contrast fix rather than a
   flourish. See contrastPairs.

   ═══ AND IT IS THE INVENTORY'S FOCUSED SLOT NOW, WHICH IS WHAT HE ASKED FOR ═══

   Owner, 2026-09-11: "the rows we have now, when the player is in the
   leaderboard it's just highlighted - we should also use the colored+beveled
   corners for that row like the br_ui inventory does when each slot is in
   focus."

   THE THING HE IS POINTING AT IS '.plate.is-active' IN ui-src/src/index.css, and
   it is reproduced here rather than approximated from that sentence. What the
   game actually does to a slot when it is the one in your hands, in the order it
   matters:

     THE CORNERS OPEN. '.plate' carries a clip-path polygon whose top-right and
     bottom-left corners are cut back by '--cut', which is 0 at rest and
     '--cut-max' under '.is-active'. Two corners, diagonally opposite, not four:
     that asymmetry is the whole signature and a chamfer on all four reads as a
     rounded box.

     THE CUT EDGES ARE REDRAWN. Clipping the element removes the BORDER along
     both diagonals as well, so each cut corner would read as an unfinished edge.
     br_ui draws them back with two pseudo-elements carrying a 45deg gradient
     that is transparent, then 1.2px of '--edgec', then transparent. The same
     gradient is below, at the same RATIO to the border rather than at the same
     literal: the owner asked for triple thickness "on everything that has
     borders", and two hairline diagonals left on a surface with three-pixel
     edges is a focused row whose cut corners look unfinished. See EDGE_PX.

     THE EDGE BRIGHTENS. '--edgec: active ? '#ffffff' : hex' - the rarity color
     at rest, white when focused. This board has no rest state to contrast
     against, because a row is either yours or it is not, so the focused row
     takes its CATEGORY's own light instead of white: 'tone().bright', which is
     that accent mixed 42% toward white. That is the "coloured" half of his
     sentence and it is the ONE colored edge anywhere on this page - see the
     per-category block, and the deliberate exception recorded in
     'scoreboard.check.ts'.

     THE FILL LIFTS. The game lifts '--plate-fill' from rgba(32,36,50,0.94) to
     rgba(46,52,70,0.95). This page already did that half: 'PALETTE.you' over the
     card, with the category's light washed across it.

   WHAT IS DELIBERATELY NOT REPRODUCED IS THE GROWTH. '.plate.is-active' also
   does 'translateY(-0.25rem) scale(1.06)', which is right for a slot with air
   around it and wrong for a row in a list: the card's height is its header plus
   five rows TO THE PIXEL and its overflow is hidden, so a row that grew would be
   a row with its own edges clipped off. The shape and the color carry it.

   THE REST STATE IS NO CLIP-PATH AT ALL rather than a square polygon, which is
   the one place this departs from br_ui's structure and it is because nothing
   here is interactive. The game animates 'clip-path' between the two states and
   needs both to exist; this page has no transition to run, so an unfocused row
   pays for no clip at all. */
.card li.you, .card.you {
  --edgec: ${FOCUS_EDGE};
  --cut: var(--cut-max);
  position: relative;
  background: ${PALETTE.you};
  border: ${EDGE_PX}px solid var(--edgec);
  clip-path: polygon(
    0 0,
    calc(100% - var(--cut)) 0,
    100% var(--cut),
    100% 100%,
    var(--cut) 100%,
    0 calc(100% - var(--cut)));
}
.card li.you::after, .card li.you::before,
.card.you::after, .card.you::before {
  content: '';
  position: absolute;
  width: var(--cut);
  height: var(--cut);
  background-image: linear-gradient(45deg,
    rgba(0, 0, 0, 0) calc(50% - ${CHAMFER_HALF}px),
    var(--edgec) calc(50% - ${CHAMFER_HALF}px),
    var(--edgec) calc(50% + ${CHAMFER_HALF}px),
    rgba(0, 0, 0, 0) calc(50% + ${CHAMFER_HALF}px));
}
.card li.you::after, .card.you::after { top: 0; right: 0; }
.card li.you::before, .card.you::before { bottom: 0; left: 0; }
.card li.you .pos { color: ${PALETTE.youMuted}; }
.card li.you {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* ── THE PER-PLAYER VIEW ─────────────────────────────────────────────────── */
/* THE NAME AND THE TILES ARE ONE STACK, CENTERED AS A BLOCK. Laid out
   individually they sit against the top of the panel with a third of the surface
   empty underneath, which is what the first pass did. 120 + 28 + 300 = 448 in a
   688 tall panel, so there is 120 of air above and below. */
.pstack {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: ${CONTENT_HEIGHT}px;
}
/* THE NAME IS ON A SHELF NOW AND IT USED TO FLOAT. A 64px word alone on a black
   field is the same flatness the cards had: nothing behind it, nothing under
   it, no reason for it to be where it is. The shelf is a band of the project's
   own cyan fading out to the right, so the name reads as the masthead of the
   slide - and the cyan rather than a category color because this half of the
   board is about the PLAYER, who does not belong to a category.

   NO WORDS ARE ADDED HERE. It is still their name and nothing else. */
.name {
  box-sizing: border-box;
  height: 120px;
  line-height: 120px;
  padding: 0 26px;
  border-radius: 0;
  font-family: ${DISPLAY};
  font-size: 76px;
  font-weight: 400;
  letter-spacing: 0.01em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background-image: linear-gradient(90deg,
    ${rgba(PALETTE.cyan, 0.26)} 0%,
    ${rgba(PALETTE.cyan, 0.1)} 30%,
    ${rgba(PALETTE.cyan, 0.02)} 56%,
    ${rgba(PALETTE.cyan, 0)} 78%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.tiles {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 300px;
  margin-top: 28px;
}
/* A TILE IS A CARD WITH ONE NUMBER ON IT, so it is built the same way and tinted
   harder: there are no rows competing with the numeral, and the whole tile can
   be the color of the thing it counts. The glow is at the BOTTOM rather than
   the top, so the number reads as standing on light rather than under it. */
.tile {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${w}px;
  height: 300px;
  background-color: ${PALETTE.card};
  background-image:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.015) 46%),
    linear-gradient(178deg,
      ${mix(PALETTE.card, '#ffffff', 0.06)} 0%,
      ${PALETTE.card} 44%,
      ${PALETTE.deep} 100%);
  border: ${EDGE_PX}px solid var(--edgec);
  border-radius: 0;
  overflow: hidden;
  box-shadow:
    0 16px 34px rgba(0, 0, 0, 0.5),
    0 2px 6px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
/* CENTERED IN WHAT IS LEFT OF THE TILE, rather than pinned to the top. Three
   lines against the top of a 300px tile leaves a hole that reads as a missing
   fourth. */
.tbody {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 18px;
}
.tlabel {
  font-family: ${DISPLAY};
  font-size: 21px;
  font-weight: 400;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* THE NUMERAL SCALES WITH THE COLUMN, because it is the one piece of type on
   this page that is wide enough to overflow its own tile. 80px of Anton is about
   40px per digit, so seven digits is 280px and does not fit a 240px tile, let
   alone a 198px one. Tying the size to the width keeps the ratio the same at
   every column count; overflow hidden is still there for the player who
   somehow banks ten million Volts.

   IT IS THE HERO OF THIS SLIDE AND IT IS PAINTED LIKE ONE. The color is a
   bright tint of the category's accent rather than the same white every other
   word on the page is, which is what a display face is FOR. Anton is already
   loaded and was being used as if it were a body font. */
.tval {
  margin-top: 22px;
  font-family: ${DISPLAY};
  font-size: ${Math.round((80 * w) / 240)}px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.trank {
  margin-top: 22px;
  font-family: ${BODY};
  font-weight: 600;
  font-size: 27px;
  color: ${PALETTE.muted};
  font-variant-numeric: tabular-nums;
}

/* ── THE SQUAD VIEW ──────────────────────────────────────────────────────────
   Owner: "Let's also add a slide when in squads where the player will get to see
   the stats of their squad mates!"

   ═══ IT WAS A TABLE AND IT IS FOUR CARDS, ON HIS OWN NOTE ═══

   Owner, 2026-09-11: "the column font colors are just.... too much lol. I prefer
   cards for each of the players please."

   THE OLD SHAPE AND WHY IT LOST. One full-width row per mate under one heading
   row, on the reasoning that a card each "would be four copies of the same five
   labels". The cost of avoiding that repetition was five category-colored
   headings across the top and four blip-colored names down the left, which is
   nine colored strings of text on one slide - and "just coloring the text" is
   the note he has now written three times.

   A CARD PER PERSON IS ALSO THE TRUER SHAPE. This slide's subject is PEOPLE and
   the leaderboard's is categories, and the leaderboard already says what an
   object about one subject looks like on this board: a header band naming it and
   its numbers listed under it. So a squad card is literally the leaderboard's
   own '.card' with the mate's name in the h2 and one row per category - the same
   element, the same border, the same sheen, the same square corners, the same
   entrance. Repeating five labels four times is what a card layout IS, and it is
   what makes four people comparable at a glance.

   THE COLOR MOVED FROM THE TYPE TO THE OBJECT. See squadStyles: the card's fill
   and its name band are the mate's blip color and not one word on it is. */
.squad {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: ${GUTTER}px;
  height: ${CONTENT_HEIGHT}px;
}
/* ONE COLUMN PER MATE, SIZED BY THE SAME ARITHMETIC THE LEADERBOARD USES. The
   game's own maximum squad is four (BR.Config.Match.maxSquadSize) and
   SQUAD_MAX_ROWS guards six, so this divides the safe area the way columnWidth
   divides it for cards - which is the function that exists precisely so a count
   nobody anticipated cannot push a column off a surface that cannot scroll. */
.sqcol { width: ${mw}px; }
/* A MATE'S CARD IS A LEADERBOARD CARD WITH A PERSON ON IT. Everything structural
   comes from '.card' above; these are the three things that are its own.

   ITS HEIGHT IS DERIVED FROM THE CATEGORY COUNT rather than from TOP_N, because
   a squad card lists one row per CATEGORY and a leaderboard card lists TOP_N
   players. Five categories and five ranks happen to be the same number today and
   stopped being so the moment BIGGEST SPENDERS was switched on. See mateCardH.

   IT IS TALLER IN THE HEAD, because the header is somebody's NAME rather than a
   category label, and a name is the card's whole identity on this slide. */
.mate {
  width: ${mw}px;
  height: ${mateCardH}px;
}
/* A NEARLY COLLAPSED LINE BOX, BECAUSE ANTON'S LINE BOX IS NOT ITS INK. The face
   carries a deep descent, so a name centered by its LINE BOX sits visibly high
   in its band: the box is centered and the letters are not. Flex centering with
   a collapsed line box puts the glyphs where the middle is.

   1.2 AND NOT 1, AND THE DIFFERENCE IS A WHOLE CHARACTER. At exactly 1 the line
   box is the type size, 'overflow: hidden' clips at its bottom edge, and every
   glyph that descends below the baseline loses its tail - which on a display
   face is not an aesthetic nicety: an UNDERSCORE is entirely below the baseline,
   and 'Hollowpoint_77' rendered as 'Hollowpoint 77' on the squad slide. Player
   names are full of underscores.

   AND THE NAME IS PALETTE.text, WHICH IS THE WHOLE POINT OF THIS PASS. The blip
   color is on the band behind it and on the card's fill. See squadStyles. */
.mate h2 {
  display: flex;
  align-items: center;
  height: ${MATE_HEAD_H}px;
  line-height: 1.2;
  font-size: ${mateNameSize(mw)}px;
  letter-spacing: 0.01em;
  color: ${PALETTE.text};
}
/* THE STAT ROW. Label left, number right, the same shape as a leaderboard row
   with the rank numeral taken off - there is no ranking on this slide, only five
   or six things one person has done. */
.mate li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: ${mateRowH}px;
  padding: 0 14px;
  box-sizing: border-box;
}
.mate li + li {
  box-shadow: inset 0 ${EDGE_PX}px 0 rgba(255, 255, 255, 0.05);
}
/* NEUTRAL, AND DELIBERATELY NOT THE CATEGORY'S ACCENT. Five accents on each of
   four cards is twenty colored words, which is the thing he threw out with more
   steps. The categories are in a fixed order and read down every card
   identically; what distinguishes one card from another is whose it is. */
.mlabel {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ${DISPLAY};
  font-size: ${mateLabelSize(mw)}px;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: ${PALETTE.label};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mval {
  flex: 0 0 auto;
  padding-left: 8px;
  font-family: ${DISPLAY};
  font-size: ${mateValueSize(mateRowH)}px;
  font-weight: 400;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* THE VIEWER'S OWN CARD LIFTS ITS LABELS TO FULL WHITE, AND THE GATE CHOSE THAT
   RATHER THAN TASTE. 'PALETTE.youMuted' is the brighter grey that exists for
   exactly this surface on the leaderboard, and on a squad card it measured
   between 3.88 and 4.40 against four of the eight blip colors - under the floor,
   on the one card the owner asked to be MORE visible. The fill it sits on is the
   highlight slate with a light saturated color mixed 30% into it, which is the
   lightest surface anywhere on this board; there is no grey that survives it.
   White does, on all eight, and the label/value hierarchy is carried by size and
   position here the way it is on a leaderboard row the viewer owns. */
.mate.you .mlabel { color: ${PALETTE.text}; }

${
  boardScroll > 0
    ? marqueeStyles({
        panel: '#board',
        window: '.cards',
        name: 'marqueeBoard',
        count: boardScroll,
        w,
      })
    : ''
}
${
  tileScroll > 0
    ? marqueeStyles({
        panel: '#player',
        window: '.tiles',
        name: 'marqueeTiles',
        count: tileScroll,
        w,
      })
    : ''
}

/* ── THE COLOR ───────────────────────────────────────────────────────────────
   LAST IN THE SHEET ON PURPOSE. Everything above is the neutral board: the
   shapes, the type, the depth and the layout, all of which are true whatever a
   category is called. These blocks paint it, and they come last so a
   single-class rule like .c-wins .card lands on top of .card without either
   of them having to reach for a specificity trick. */
${categoryStyles(categories)}
${squadStyles(mates)}
${slideStyles(mates)}
`.trim()
}

/**
 * ═══ HOW A SQUAD CARD IS SIZED, AND WHY IT DIVIDES CATEGORIES RATHER THAN
 *     PEOPLE ═══
 *
 * The old helpers here sized a squad ROW, so they divided `CONTENT_HEIGHT` by
 * the number of MATES. A card does the opposite: its width is decided by the
 * mates (one column each, see `columnWidth`) and its HEIGHT by how many stat
 * rows it lists, which is one per category on the slide.
 *
 * THAT DISTINCTION STOPPED BEING ACADEMIC THE DAY BIGGEST SPENDERS WAS SWITCHED
 * ON. Five categories and five leaderboard ranks were the same number for as
 * long as this board has existed, and a squad card sized off `TOP_N` would have
 * been correct right up until the sixth category landed - then rendered a card
 * with room for five rows and six rows in it, inside `overflow: hidden`, with
 * nothing here failing.
 *
 * `ENTRANCE_PX` AT EACH END IS RESERVED, not decorative: every card on this
 * board enters 20px below where it settles, and the squad card is the one that
 * is sized to FILL what it is given. Without this the last 420ms of every squad
 * slide would show the bottom edge and the chamfered corner clipped off - which
 * is visible on a wall and invisible in every still preview of the settled
 * state. The leaderboard gets that for free; this slide has to buy it.
 *
 * THE ROW HEIGHT IS CAPPED AT THE LEADERBOARD'S OWN `ROW_H` so that a squad card
 * and a leaderboard card read as the same object. Below the cap it shrinks, which
 * is what keeps six categories inside the surface.
 */
export const MATE_HEAD_H = 72

export function mateStatRowHeight(stats: number): number {
  if (stats < 1) return 0
  const available = CONTENT_HEIGHT - 2 * ENTRANCE_PX - MATE_HEAD_H - 2 * EDGE_PX
  return Math.min(ROW_H, Math.floor(available / stats))
}

export function mateCardHeight(stats: number): number {
  if (stats < 1) return 0
  return MATE_HEAD_H + stats * mateStatRowHeight(stats) + 2 * EDGE_PX
}

/**
 * The three type sizes on a squad card, derived from what it came out as.
 *
 * THE TWO THAT SCALE WITH WIDTH ARE THE TWO THAT CAN OVERFLOW SIDEWAYS. A name
 * is player-authored and "MOST REVIVES GIVEN" is the owner's own wording, so
 * neither can be shortened - they have to be made to fit, which is the trick
 * `.card h2` and `.tval` already use. The floor is what stops the answer to a
 * six-person squad being type nobody can read from a few meters through a
 * texture; past that they ellipsize, which is the honest failure.
 *
 * THE VALUE SCALES WITH THE ROW because that is the axis it can overflow on: six
 * categories divide the card into rows a fifth shorter than five do, and a
 * numeral sized for the taller row would be taller than the row holding it.
 *
 * 266 IS `columnWidth(4)`, THE GAME'S OWN MAXIMUM SQUAD, which is the size these
 * were judged at rather than an arbitrary divisor.
 */
export function mateNameSize(width: number): number {
  return Math.max(20, Math.min(34, Math.round((34 * width) / 266)))
}

export function mateLabelSize(width: number): number {
  return Math.max(12, Math.min(18, Math.round((18 * width) / 266)))
}

export function mateValueSize(rowHeight: number): number {
  return Math.min(30, Math.round(rowHeight * 0.34))
}

/**
 * The alternation.
 *
 * THE PAGE OWNS IT, WHICH IS THE OWNER'S DECISION STATED TWICE: "I want the page
 * itself to automatically transition between these 2 views." Every layout is
 * already in this document and the client already has a clock, so alternating
 * costs one `className` write every ten to fifteen seconds. The alternative, a
 * push from Lua, would need the game to hold a timer per prop and to reach into
 * a browser it does not otherwise talk to.
 *
 * IT IS A LIST NOW AND IT WAS A BOOLEAN. Two panels toggled; three do not, and a
 * second boolean would have been a state machine written as two flags. The list
 * carries each panel's id beside its own dwell, in the order they are shown, and
 * the script is the same length it was.
 *
 * A DWELL PER PANEL, EMITTED BY NAME, because the owner is going to tune them on
 * the pad and they are not the same reading job. See `lib/scoreboard.ts`.
 *
 * THE TRANSITION IS ADDED TO THE DWELL, NOT TAKEN OUT OF IT. A dwell is time
 * spent still and readable; scheduling the next swap at `dwell` alone would mean
 * that raising `TRANSITION_MS` silently shortened every view. Under `off` the
 * emitted transition is 0, so the timings are exactly what they were before any
 * of this existed.
 *
 * `setTimeout` CHAINED, NOT `setInterval`. Three different dwell times are not
 * an interval, and an interval would hold whichever panel it started on for the
 * wrong one of the durations forever.
 *
 * THE FIRST PAINT IS NOT ANIMATED, and that is deliberate. The DUI is being
 * created at the moment a player walks onto the pad; the fastest possible first
 * frame is the board already assembled. The first swap is therefore scheduled at
 * the leaderboard's own dwell with no transition added, because no transition
 * preceded it.
 *
 * NOT EMITTED AT ALL WHEN THERE IS ONLY ONE PANEL. A player with no career row
 * and no squad gets the leaderboard and nothing else, so there is nothing to
 * alternate with and the document carries no timer, no script and nothing to
 * repaint. The check asserts that too, because a timer swapping to a panel that
 * does not exist would blank the wall every fifteen seconds.
 *
 * ES5 AND NOTHING NEWER. This runs in Chromium 103, which would take a good deal
 * more than this - but the check bans optional chaining and nullish coalescing
 * outright rather than tracking which syntax landed in which release, and a
 * script written in `var` and `function` cannot fail that test by accident.
 */
function swapScript(
  panels: ReadonlyArray<[string, string, number]>,
  motion: MotionLevel,
): string {
  const transition = motion === 'off' ? 0 : TRANSITION_MS
  /**
   * EACH DWELL IS DECLARED UNDER ITS OWN NAME AND THEN REFERENCED, rather than
   * inlined into the list. The values would work either way; the names are what
   * make the served document say WHICH number the owner is looking at when he
   * opens it to tune one, and `scoreboard.check.ts` asserts all three appear.
   */
  const names = panels.map(([, name, dwell]) => `  var ${name} = ${dwell};`).join('\n')
  const order = panels.map(([id, name]) => `['${id}', ${name}]`).join(', ')

  return `
(function () {
  var TRANSITION_MS = ${transition};
${names}
  var order = [${order}];
  var els = [];
  for (var i = 0; i < order.length; i++) {
    var el = document.getElementById(order[i][0]);
    if (!el) return;
    els.push(el);
  }
  var at = 0;
  function swap() {
    var was = at;
    at = (at + 1) % els.length;
    els[was].className = 'panel';
    els[at].className = 'panel on';
    setTimeout(swap, order[at][1] + TRANSITION_MS);
  }
  setTimeout(swap, order[0][1]);
})();
`.trim()
}

/**
 * The columns, wrapped in the element that may or may not be drifting.
 *
 * TWO COPIES WHEN IT DRIFTS, AND THE SECOND ONE IS NOT DECORATION. The track
 * translates left by exactly one copy's width and restarts; at the instant it
 * restarts, copy two is occupying the pixels copy one occupied at the start, so
 * the loop has no seam. One copy would leave the window empty behind the last
 * card and jump.
 *
 * THE DUPLICATE IS INERT. It is the same markup with the same classes, it
 * carries the same escaped player names, and nothing on this page is interactive
 * or keyed on an id, so there is nothing for a second copy to collide with.
 *
 * ONE COPY OTHERWISE, which is a plain centered flex row and is byte for byte
 * what the board has always emitted apart from this wrapper.
 */
function track(columns: string, repeat: number): string {
  return `<div class="track">${columns.repeat(repeat)}</div>`
}

/**
 * THE COLOR IS A CLASS ON THE COLUMN NOW AND IT USED TO BE AN INLINE `style`.
 *
 * A `style="color:#ffc65c"` on the leading numeral was the whole of the card's
 * color, which is the thing the owner threw out. A category paints six surfaces
 * now and inlining six declarations per element would put the same hex in the
 * document twenty times and make the stylesheet unreadable. `c-<key>` on the
 * column carries all of it; `categoryStyles` above is the other half.
 */
function boardMarkup(board: Leaderboard, repeat: number): string {
  const columns = board.categories
    .map((category) => {
      const rows = category.entries
        .map(
          (entry, i) =>
            `<li${entry.you ? ` class="you"` : ''}>` +
            `<span class="pos">${i + 1}</span>` +
            `<span class="who">${esc(entry.name)}</span>` +
            `<span class="val">${esc(entry.value)}</span>` +
            `</li>`,
        )
        .join('')
      return (
        `<div class="col c-${category.key}"><section class="card">` +
        `<h2>${esc(category.label)}</h2>` +
        `<ol>${rows}</ol></section></div>`
      )
    })
    .join('')

  return (
    `<div id="board" class="panel on">` +
    `<h1 class="stitle">${TITLE_BOARD}</h1>` +
    `<div class="cards">${track(columns, repeat)}</div></div>`
  )
}

/**
 * The per-player half.
 *
 * A RANK IS RENDERED ONLY WHEN THERE IS ONE. `rank` is null exactly when the
 * value is zero, and the tile then shows the value with nothing under it rather
 * than a position among people who have all done nothing. The empty space is
 * deliberate and is not filled with a dash, an en rule or a sentence.
 *
 * THE TILES CARRY THE SAME ACCENT AS THE CARDS, on the label, which is the only
 * place an accent appears on a tile now that the bar across the top is gone.
 */
function playerMarkup(player: PlayerPanel, repeat: number): string {
  const tiles = player.stats
    .map(
      (stat) =>
        `<div class="col c-${stat.key}"><div class="tile">` +
        `<div class="tbody">` +
        `<div class="tlabel">${esc(stat.label)}</div>` +
        `<div class="tval">${esc(stat.value)}</div>` +
        `<div class="trank">${stat.rank === null ? '' : `#${stat.rank}`}</div>` +
        `</div></div></div>`,
    )
    .join('')

  return (
    `<div id="player" class="panel">` +
    `<h1 class="stitle">${TITLE_PLAYER}</h1>` +
    `<div class="pstack">` +
    `<div class="name">${esc(player.name)}</div>` +
    `<div class="tiles">${track(tiles, repeat)}</div></div></div>`
  )
}

/**
 * The squad slide, which is one card per person.
 *
 * Owner, 2026-09-11: "I prefer cards for each of the players please."
 *
 * IT IS THE LEADERBOARD'S OWN ELEMENT, DELIBERATELY. `<section class="card">`
 * with an `<h2>` and an `<ol>` is exactly what `boardMarkup` emits, so a squad
 * card inherits the border, the sheen, the square corners, the drop shadow and
 * the entrance without a single rule being repeated - and the two slides read as
 * one board rather than as two features. What differs is what the header names
 * (a person rather than a category) and what the rows carry (a label and a
 * number rather than a rank, a name and a number).
 *
 * THE LABELS REPEAT ON EVERY CARD AND THAT IS THE LAYOUT WORKING. The version
 * this replaces put them once across the top precisely to avoid repeating them,
 * and paid for it with five colored headings and four colored names, which is
 * what the owner threw out.
 *
 * THE VIEWER'S CARD GETS THE SAME FOCUS TREATMENT THE LEADERBOARD ROW GETS:
 * br_ui's chamfered corners and a lit edge, here in their own blip color. A
 * player looking for themselves among four cards is looking for the lit one.
 *
 * NO WORDS EXCEPT THE CATEGORY LABELS, THE NAMES AND THE OWNER'S OWN TITLE.
 * There is still no "YOUR SQUAD", no squad number and no count.
 */
function squadMarkup(squad: SquadPanel): string {
  const cards = squad.mates
    .map((mate, i) => {
      const rows = squad.labels
        .map(
          (l, j) =>
            `<li>` +
            `<span class="mlabel">${esc(l.label)}</span>` +
            `<span class="mval">${esc(mate.values[j] ?? '')}</span>` +
            `</li>`,
        )
        .join('')
      return (
        `<div class="col sqcol${mate.color ? ` sq-${i}` : ''}">` +
        `<section class="card mate${mate.you ? ' you' : ''}">` +
        `<h2>${esc(mate.name)}</h2>` +
        `<ol>${rows}</ol></section></div>`
      )
    })
    .join('')

  return (
    `<div id="squad" class="panel">` +
    `<h1 class="stitle">${TITLE_SQUAD}</h1>` +
    `<div class="squad">${cards}</div></div>`
  )
}

/**
 * The whole document.
 *
 * NO `<title>`, NO CAPTION, NO EMPTY STATE. The only words on this page are the
 * category labels, the three slide titles and the players' own names. The labels
 * and the titles are both the owner's own words in his own capitals; everything
 * else is numerals. That is a house rule and it is also right for the surface: a
 * prop in a warmup area is read in a glance from a few meters away, and every
 * sentence added to it is a sentence somebody has to skip past to reach the
 * number they came for.
 *
 * THE THREE HEADINGS ARE THE ONE EXCEPTION AND HE WROTE THEM HIMSELF. See
 * `TITLES`. There is no `<title>` element even so: a DUI has no tab, no window
 * chrome and nothing that would ever display one.
 *
 * `data-motion` IS ON THE ROOT SO THE SETTING IS VISIBLE FROM OUTSIDE. It is
 * what the measurement harness reads and what somebody looking at the served
 * page can check without guessing which class means what. It is an attribute
 * rather than a word on screen.
 *
 * `phases` IS AN ARGUMENT AND NOT A `Math.random()` INSIDE THIS FUNCTION, which
 * is what keeps the renderer pure: the check renders the same board twice with
 * the same phases and compares the two documents byte for byte, and renders it
 * again with different ones to prove the phases actually reach the CSS. The
 * route draws the real numbers. Omitting it is a still, synchronized background,
 * which is a legitimate thing for a caller to want and is what every check that
 * is not about phases passes.
 */
export function renderScoreboard(input: {
  board: Leaderboard
  player: PlayerPanel | null
  squad?: SquadPanel | null
  motion: MotionLevel
  phases?: readonly number[]
}): string {
  const { board, player, motion } = input
  const squad = input.squad ?? null
  const phases = input.phases ?? []

  /**
   * THE COLUMN COUNT IS THE LEADERBOARD'S, NOT THE CATALOG'S. A category that
   * ranked nothing is dropped before it gets here (see `rankBoard`), so a board
   * showing three cards lays out three columns and fills the surface rather than
   * leaving two column-widths of air on the right. The per-player half always
   * has one tile per ENABLED category, so it can be wider than the leaderboard;
   * the layout takes the larger of the two, because the arithmetic exists to
   * stop a column falling off the edge and the widest panel is the one at risk.
   */
  const boardCards = Math.max(board.categories.length, 1)
  const playerTiles = player?.stats.length ?? 0
  const count = Math.max(boardCards, playerTiles, 1)

  /**
   * ═══ WHETHER THE BOARD DRIFTS, AND WHAT HAPPENS WHEN IT DOES NOT ═══
   *
   * Owner: "I think the screen being 5 wide makes sense and having 6 columns we
   * should have them scroll right to left".
   *
   * THREE CONDITIONS AND ALL OF THEM MATTER:
   *
   *   MORE CARDS THAN SLOTS. At five categories or fewer every card has a slot
   *   of its own, there is nothing to cycle, and a board that drifted anyway
   *   would be motion with no information in it. This is also the answer to "what
   *   if a category goes unavailable again": five in five sit still, exactly as
   *   they do today, with no second layout to have gone stale.
   *
   *   AND `full`. The motion knob is what somebody sets when the pad is
   *   struggling, and a continuously drifting leaderboard is continuous motion by
   *   any reading of that setting. Under `transitions` and `off` the cards fall
   *   back to `columnWidth(count)` - six narrower cards, all visible, nothing
   *   moving - because the alternative at those levels is a sixth card that no
   *   longer exists on the wall. A slower board is a trade; a missing category is
   *   a defect.
   *
   * THE SLOT COUNT IS WHAT DECIDES A CARD'S WIDTH, and the RENDERED count is
   * twice the category count while drifting, because the track carries two copies
   * for the wrap. Those are three different numbers and conflating any two of
   * them puts a card off the edge of a surface that cannot scroll.
   */
  const boardScrolls = motion === 'full' && boardCards > SLOTS
  const tilesScroll = motion === 'full' && playerTiles > SLOTS
  /**
   * THE SLOT COUNT IS SHARED EVEN WHEN ONLY ONE TRACK IS MOVING, because both
   * slides lay their columns out in `.col` and a board whose cards were a
   * different width from its own tiles would stop reading as one board. As soon
   * as either row has more than `SLOTS` in it, every column on the page is a
   * slot wide and the row that fits simply sits still in the middle.
   */
  const slots = boardScrolls || tilesScroll ? SLOTS : count
  const boardRepeat = boardScrolls ? 2 : 1
  const tileRepeat = tilesScroll ? 2 : 1
  const columns = Math.max(
    boardCards * boardRepeat,
    playerTiles * tileRepeat,
    squad?.mates.length ?? 0,
    1,
  )

  /**
   * EVERY CATEGORY THAT IS ON SCREEN ANYWHERE, ONCE.
   *
   * The three panels do not carry the same list: the leaderboard drops a
   * category nothing has been done in, and the per-player half always has one
   * tile per ENABLED category. So the stylesheet is generated from the UNION -
   * a card whose column class had no matching rule would render as the neutral
   * grey the old board was, which is a defect that looks exactly like the thing
   * this pass exists to fix.
   */
  const seen = new Map<string, { key: string; accent: string }>()
  for (const c of board.categories) seen.set(c.key, { key: c.key, accent: c.accent })
  for (const s of player?.stats ?? []) seen.set(s.key, { key: s.key, accent: s.accent })
  for (const l of squad?.labels ?? []) seen.set(l.key, { key: l.key, accent: l.accent })

  /**
   * `full` is the only level that emits the moving layers at all.
   *
   * EVERY ONE OF THEM CARRIES ITS FAMILY'S CLASS AS WELL AS ITS OWN, which is
   * what keeps the promotion budget countable: `will-change` is declared once
   * per family (`.orb`, `.beam`, `.sheet`, `.mote`, and `.pulse` which is a
   * family of one) rather than once per element, so the count of promoted
   * DECLARATIONS stays five while the count of moving layers is eighteen.
   */
  const drift =
    motion === 'full'
      ? `<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>` +
        `<div class="beam bm1"></div><div class="beam bm2"></div>` +
        `<div class="sheet drift"></div><div class="sheet weave"></div>` +
        `<div class="pulse"></div>` +
        Array.from({ length: MOTES }, (_, i) => `<div class="mote mt${i}"></div>`).join('')
      : ''

  /**
   * THE ORDER IS THE ORDER THEY ARE SHOWN IN, and the leaderboard is first
   * because it is the panel that is already on screen at first paint.
   */
  const panels: Array<[string, string, number]> = [
    ['board', 'BOARD_DWELL_MS', BOARD_DWELL_MS],
  ]
  if (player) panels.push(['player', 'PLAYER_DWELL_MS', PLAYER_DWELL_MS])
  if (squad) panels.push(['squad', 'SQUAD_DWELL_MS', SQUAD_DWELL_MS])

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<style>${styles({
      motion,
      phases,
      columns,
      slots,
      boardScroll: boardScrolls ? boardCards : 0,
      tileScroll: tilesScroll ? playerTiles : 0,
      squadStats: squad?.labels.length ?? 0,
      categories: [...seen.values()],
      mates: squad?.mates ?? [],
    })}</style></head>` +
    `<body class="m-${motion}" data-motion="${motion}">` +
    `<div class="wash"></div>` +
    drift +
    `<div class="vig"></div>` +
    boardMarkup(board, boardRepeat) +
    (player ? playerMarkup(player, tileRepeat) : '') +
    (squad ? squadMarkup(squad) : '') +
    (panels.length > 1 ? `<script>${swapScript(panels, motion)}</script>` : '') +
    `</body></html>`
  )
}
