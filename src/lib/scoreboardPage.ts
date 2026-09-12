import {
  BOARD_DWELL_MS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PLAYER_DWELL_MS,
  SQUAD_DWELL_MS,
  TOP_N,
  TRANSITION_MS,
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
   * THE ONE-PIXEL EDGE, AND IT IS NEUTRAL ON PURPOSE AND FOREVER. Owner: "Don't
   * add the low-effort color borders." The cards are colored now - deeply, in
   * their own gradients - and not one of those colors is allowed to touch a
   * border. `scoreboard.check.ts` reads the CSS property every accent lands in
   * and refuses anything but ink and fill.
   */
  edge: '#2b3446',
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
/** A squad row's neutral top, before its mate's own color is laid over it. */
const MATE_TOP = mix(PALETTE.card, '#ffffff', 0.04)

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
    ['card title', PALETTE.label, PALETTE.card],
    ['entry name', PALETTE.text, PALETTE.card],
    ['entry value', PALETTE.text, PALETTE.card],
    ['rank numeral', PALETTE.muted, PALETTE.card],
    ['player name', PALETTE.text, NAME_BAND],
    ['tile rank', PALETTE.muted, PALETTE.card],
    ['mate name', PALETTE.text, MATE_TOP],
    ['mate value', PALETTE.text, MATE_TOP],
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
   * A squad mate's name is painted in their own blip color, over the strongest
   * point of their row's wash - which is the left end, which is where the name
   * is. That first stop is 0.12 because measuring it at 0.26 put three of the
   * game's eight colors under the floor, and these eight are not ours to
   * adjust: they are what is on the minimap.
   */
  for (const color of squadColors) {
    pairs.push([`mate ${color}`, color, mix(MATE_TOP, color, 0.12)])
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
 * ═══ THE ANIMATED BACKGROUND, EMITTED ONLY UNDER `full` ═══
 *
 * Owner: "Also give us an animated background (be sure it will work on CEF
 * 103)." What follows is that background, and every decision in it is either the
 * CEF 103 constraint or the frame-cost one from the header.
 *
 * FIVE MOVING LAYERS AND NOT ONE MORE. Three soft orbs that wander, a blade of
 * light that sweeps across every half minute, and the striped sheet. Each is
 * its own promoted layer, which is a real GPU texture on the player's machine,
 * so the count is the budget: the five come to roughly twelve megabytes of
 * layer raster, once, against a client already holding a battle royale map.
 *
 * AND THEY ARE LOUD NOW, WHICH IS THE POINT OF THIS PASS. The orbs were drawn
 * at 0.13 to 0.20 alpha over a near-black page and the owner's verdict on the
 * result was that the board looked flat and cheap. They are the page's LIGHT
 * rather than its texture: the cyan reaches 0.42, the gold 0.34, and the static
 * wash underneath them carries real color of its own.
 *
 * ONLY `transform` MOVES. The orbs are radial gradients rasterized ONCE at load
 * and then translated by the compositor; the sheet is a repeating linear
 * gradient rasterized once and translated. Nothing animates a gradient stop, a
 * `background-position`, a `filter` or a size, all of which look identical in a
 * desktop preview and put a full re-raster on Blink's main thread 240 times a
 * second in the game.
 *
 * EVERYTHING HERE IS OLDER THAN CHROME 103 BY YEARS. `@keyframes`, `transform`,
 * `radial-gradient`, `repeating-linear-gradient`, `border-radius`, `opacity`,
 * `will-change` and a negative `animation-delay`. No `color-mix`, no `oklch`, no
 * `:has()`, no container query, no nesting, no view transition.
 *
 * ═══ EACH ORB'S PATH IS A CLOSED LOOP, WHICH IS WHY THERE IS NO JUMP ═══
 *
 * The 100% keyframe is identical to the 0% keyframe on every orb, so the
 * animation restarts exactly where it ended. `ease-in-out` between stops is what
 * turns four corners into a wander rather than four visible direction changes,
 * and the durations are long enough (40 to 70 seconds) that nothing on this wall
 * reads as motion you are meant to watch.
 *
 * THE SHEET'S LOOP IS SEAMLESS BY ARITHMETIC RATHER THAN BY REPETITION. Its
 * stripes repeat every 160px measured along the gradient's own direction. At
 * 120deg that direction is the unit vector (sqrt(3)/2, 1/2), and the translation
 * (-138.564, -80) projects onto it as exactly -160px: one period. Any other pair
 * of numbers gives a jump once per cycle, which is invisible in a preview and
 * obvious to somebody standing in front of a wall for two minutes.
 * `scoreboard.check.ts` recomputes the projection rather than trusting this.
 *
 * 1440x820 IS THE SMALLEST SHEET THAT CAN COVER ITS TRAVEL. 1280 + 139 and
 * 720 + 80, rounded up. A 200% x 200% layer would have been the lazy way to be
 * safe and would have cost about nine megabytes of raster on its own.
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

/** One phase per moving layer: three orbs, the light sweep, then the sheet. */
export const PHASE_COUNT = 5

/**
 * The loop lengths, in seconds, in the same order as the phases.
 *
 * DELIBERATELY NOT MULTIPLES OF EACH OTHER. Five layers on 41, 53, 67, 29 and
 * 20 second loops only return to the same arrangement once every few hours, so
 * the background does not visibly repeat inside one warmup even before the
 * random phase offsets are applied.
 */
const PERIODS = [41, 53, 67, 29, 20] as const

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
  const period = PERIODS[index] ?? 20
  const clamped = Number.isFinite(phase) ? Math.min(Math.max(phase, 0), 1) : 0
  return `-${(clamped * period).toFixed(2)}s`
}

function driftStyles(phases: readonly number[]): string {
  const d = (i: number): string => delayFor(phases[i] ?? 0, i)

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
  animation-duration: ${PERIODS[0]}s;
  animation-delay: ${d(0)};
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
  animation-duration: ${PERIODS[1]}s;
  animation-delay: ${d(1)};
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
  animation-duration: ${PERIODS[2]}s;
  animation-delay: ${d(2)};
}
/* ── THE SWEEP ───────────────────────────────────────────────────────────────
   A tall soft blade of light that crosses the whole board every ${PERIODS[3]}
   seconds and is off the surface the rest of the time. It is the one layer that
   is meant to be NOTICED rather than felt: the orbs are weather and this is an
   event, which is what keeps a wall somebody stands in front of for a whole
   warmup from being one still picture.

   ITS LOOP DOES NOT NEED TO CLOSE THE WAY AN ORB'S DOES, and that is geometry
   rather than an exemption. An orb wanders inside the frame, so a 100% keyframe
   that is not the 0% one teleports in full view. This one STARTS AND ENDS
   COMPLETELY OUTSIDE the 1280px surface - its right edge is still left of zero
   at 0%, its left edge is already past 1280 at 100% - so the instant it resets
   there is nothing on screen to jump. scoreboard.check.ts recomputes both
   ends against the board width rather than taking that on trust. */
.beam {
  position: absolute;
  top: -320px;
  left: -560px;
  width: 300px;
  height: 1400px;
  background-image: linear-gradient(90deg,
    rgba(190, 235, 255, 0) 0%,
    rgba(190, 235, 255, 0.05) 38%,
    rgba(214, 244, 255, 0.10) 50%,
    rgba(190, 235, 255, 0.05) 62%,
    rgba(190, 235, 255, 0) 100%);
  will-change: transform;
  animation: beam ${PERIODS[3]}s linear infinite;
  animation-delay: ${d(3)};
}
@keyframes beam {
  from { transform: translate3d(0px, 0, 0) rotate(16deg); }
  to   { transform: translate3d(2360px, 0, 0) rotate(16deg); }
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
.drift {
  position: absolute;
  top: 0;
  left: 0;
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
  will-change: transform;
  animation: drift ${PERIODS[4]}s linear infinite;
  animation-delay: ${d(4)};
}
@keyframes drift {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-138.564px, -80px, 0); }
}`
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
function transitionStyles(columns: number): string {
  /**
   * THE STAGGER IS DIVIDED INTO THE BUDGET, NOT ADDED TO IT. Five columns step
   * by 50ms and the last one starts at 200ms, which plus its own 420ms lands
   * exactly on TRANSITION_MS. A sixth column would have pushed the last start to
   * 250ms and the whole swap to 670ms, so `TRANSITION_MS` would have quietly
   * stopped being the honest description of how long the surface is busy. The
   * step is therefore computed from the count: the LAST column always starts at
   * TRANSITION_MS - CARD_MS, whatever the count is.
   */
  const step = columns > 1 ? (TRANSITION_MS - CARD_MS) / (columns - 1) : 0
  const delays = Array.from(
    { length: columns },
    (_, i) =>
      `.col:nth-child(${i + 1}) .card, .col:nth-child(${i + 1}) .tile { transition-delay: ${Math.round(
        i * step,
      )}ms; }`,
  ).join('\n')

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
.card, .tile, .mate {
  opacity: 0;
  transform: translate3d(0, ${ENTRANCE_PX}px, 0);
  transition:
    opacity ${CARD_MS}ms ease,
    transform ${CARD_MS}ms cubic-bezier(0.22, 0.8, 0.28, 1);
}
.panel.on .card, .panel.on .tile, .panel.on .mate {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
${delays}
.mate:nth-child(1) { transition-delay: 0ms; }
.mate:nth-child(2) { transition-delay: 50ms; }
.mate:nth-child(3) { transition-delay: 100ms; }
.mate:nth-child(4) { transition-delay: 150ms; }
.mate:nth-child(5) { transition-delay: 200ms; }
.mate:nth-child(6) { transition-delay: 200ms; }`
}

/**
 * ═══ THE COLUMN ARITHMETIC, WHICH IS NOW DERIVED AND WAS A LITERAL ═══
 *
 * 1280 - 2 x 16 padding = 1248, and five 240px cards with four 12px gutters is
 * 1248. It fitted to the pixel, which is why 240 was never a round number chosen
 * by eye: a card one pixel wider wraps the last column onto a second row that has
 * nowhere to go on a surface that cannot scroll.
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
 */
const PANEL_PAD = 16
const GUTTER = 12
export const INNER_WIDTH = BOARD_WIDTH - 2 * PANEL_PAD
export const INNER_HEIGHT = BOARD_HEIGHT - 2 * PANEL_PAD

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
 * 497 IS 55 + 5x88 + 2 AND IT IS EXACT: the header with its dividing border,
 * five rows, and the card's own top and bottom border. It was 501 while the card
 * wore a 4px accent bar; that bar is gone (see THE COLOR, below) and the four
 * pixels went with it rather than being left as a strip of empty card under the
 * fifth row that reads as a missing sixth.
 */
const CARD_H = HEAD_H + TOP_N * ROW_H + 2

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
.c-${key} .card li.you {
  background-image: linear-gradient(90deg,
    ${rgba(accent, 0.3)} 0%,
    ${rgba(accent, 0.11)} 52%,
    ${rgba(accent, 0.02)} 88%,
    ${rgba(accent, 0)} 100%);
}
.c-${key} .tile {
  background-image:
    radial-gradient(300px 230px at 50% 104%,
      ${rgba(accent, 0.32)} 0%,
      ${rgba(accent, 0.08)} 55%,
      ${rgba(accent, 0)} 100%),
    linear-gradient(178deg, ${t.tileTop} 0%, ${t.mid} 52%, ${PALETTE.deep} 100%);
}
.c-${key} .tlabel { color: ${accent}; }
.c-${key} .tval { color: ${t.bright}; }
.c-${key} .mlabel { color: ${accent}; }`
    })
    .join('\n')
}

/**
 * One rule per squad row, in that mate's own blip color.
 *
 * INDEXED BY POSITION ON THE SLIDE AND COLORED BY THE GAME'S INDEX. The class
 * is `sqc-<row>` because a stylesheet needs a selector and the row is what the
 * markup can name; the COLOR in it came from `squadColors`, which derived it
 * the way the game does. The two indexes are deliberately not the same number
 * and must not be confused: the rows are sorted by name and the colors by
 * server id.
 *
 * TWO CLASSES DEEP (`.mate.sqc-0`) SO IT CAN WIN. `.mate.you` sets the
 * `background` shorthand, which zeroes `background-image`; a single-class rule
 * would lose to it on specificity no matter where it sat, and the viewer's own
 * row would be the one row on the slide with no color on it.
 *
 * AND WINNING IS WHY THE HIGHLIGHT IS REPEATED IN HERE. The rule below paints an
 * OPAQUE vertical ramp under the wash, which covers whatever fill it landed on -
 * so the viewer's row was coming out identical to everybody else's, which is the
 * one row that must not. The ramp is therefore built from the highlight's own
 * slate when the mate is the viewer. It is the same cue as the leaderboard's,
 * expressed where it cannot be overwritten.
 */
function squadStyles(
  mates: ReadonlyArray<{ color: string | null; you: boolean }>,
): string {
  return mates
    .map((mate, i) => {
      if (!mate.color) return ''
      const c = mate.color
      const base = mate.you ? PALETTE.you : PALETTE.card
      return `
.mate.sqc-${i} {
  background-image:
    linear-gradient(90deg,
      ${rgba(c, 0.12)} 0%,
      ${rgba(c, 0.07)} 30%,
      ${rgba(c, 0.03)} 58%,
      ${rgba(c, 0)} 80%),
    linear-gradient(176deg,
      ${mix(base, '#ffffff', 0.055)} 0%,
      ${base} 50%,
      ${mix(base, PALETTE.deep, mate.you ? 0.45 : 1)} 100%);
}
.mate.sqc-${i} .mname { color: ${c}; }`
    })
    .join('\n')
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
  columns: number
  squadRows: number
  /** Every category on screen, deduplicated, in catalog order. */
  categories: ReadonlyArray<{ key: string; accent: string }>
  /** The squad rows, in the order they are rendered. See `squadStyles`. */
  mates: ReadonlyArray<{ color: string | null; you: boolean }>
}): string {
  const { motion, phases, columns, squadRows, categories, mates } = input
  const w = columnWidth(columns)

  return `
${faces()}
html, body {
  margin: 0;
  padding: 0;
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
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
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
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
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
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
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
  box-sizing: border-box;
  padding: ${PANEL_PAD}px;
  opacity: 0;
  visibility: hidden;
}
.panel.on {
  opacity: 1;
  visibility: visible;
}

${motion === 'off' ? '' : transitionStyles(columns)}

/* ── THE LEADERBOARD ─────────────────────────────────────────────────────── */
.cards {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: ${GUTTER}px;
  width: 100%;
  height: 100%;
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
     page has a light: the wash and the orbs behind it.

     A NEUTRAL HAIRLINE AROUND IT. Still PALETTE.edge, still grey, still not
     the category's color. The card is colored by its FILL. */
.card {
  box-sizing: border-box;
  width: ${w}px;
  height: ${CARD_H}px;
  background-color: ${PALETTE.card};
  background-image: linear-gradient(176deg,
    ${mix(PALETTE.card, '#ffffff', 0.06)} 0%,
    ${PALETTE.card} 42%,
    ${PALETTE.deep} 100%);
  border: 1px solid ${PALETTE.edge};
  border-radius: 12px;
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
  padding: 0 14px;
  line-height: ${HEAD_H - 1}px;
  font-family: ${DISPLAY};
  font-size: 21px;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: ${PALETTE.label};
  border-bottom: 1px solid ${PALETTE.edge};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.card li {
  display: flex;
  align-items: center;
  height: ${ROW_H}px;
  padding: 0 13px;
  box-sizing: border-box;
}
/* THE ROW RULES ARE INSET SHADOWS AND NOT BORDERS, which is arithmetic rather
   than taste: CARD_H is the header plus five rows to the pixel, and four 1px
   top borders would push the fifth row four pixels past the bottom of a card
   that cannot scroll. An inset shadow paints in the same place and takes no
   layout. */
.card li + li {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.pos {
  width: 24px;
  flex: 0 0 24px;
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
  font-size: 20px;
}
/* THE NUMBER IS WHY ANYBODY LOOKED AT THE CARD, so it is set five points
   larger than the name beside it and in the display face rather than the body
   one. The leading row's number is brighter again, in its category's color -
   see the per-category block. */
.val {
  flex: 0 0 auto;
  padding-left: 8px;
  font-family: ${DISPLAY};
  font-size: 27px;
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
   flourish. See contrastPairs. */
.card li.you, .mate.you {
  background: ${PALETTE.you};
}
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
  height: 100%;
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
  border-radius: 16px;
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
  gap: ${GUTTER}px;
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
  background-image: linear-gradient(178deg,
    ${mix(PALETTE.card, '#ffffff', 0.06)} 0%,
    ${PALETTE.card} 44%,
    ${PALETTE.deep} 100%);
  border: 1px solid ${PALETTE.edge};
  border-radius: 12px;
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

   ONE ROW PER MATE AND ONE HEADING ROW ABOVE THEM, rather than one card per
   mate. A card each would be four copies of the same five labels; a table is
   four names and their numbers under one set of headings, which is what somebody
   standing on a pad comparing themselves to three team mates is actually
   reading.

   THE ROW HEIGHT IS COMPUTED AND CAPPED. A squad of two in a 688px panel would
   otherwise give two 300px slabs; the cap keeps a pair looking like a pair. The
   floor is the arithmetic: at the game's maximum squad of four there is
   ${squadRows} of them here and they fit with the gutters. */
.squad {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
}
.shead {
  display: flex;
  align-items: center;
  height: ${SQUAD_HEAD_H}px;
  margin-bottom: ${GUTTER}px;
}
.smates {
  display: flex;
  flex-direction: column;
  gap: ${GUTTER}px;
}
/* A MATE'S ROW IS PAINTED IN THE COLOUR THEIR BLIP IS, which is the one place
   on this board where the color is not a decision this console made. See
   squadColors in lib/scoreboard.ts: it reproduces BR.Party.memberIndex
   from the server ids in the live snapshot, so the row for the player whose
   marker is orange is orange. The tint is a left-to-right wash that fades out
   before the numbers, so it identifies the row without sitting under the
   figures.

   THE NEUTRAL BELOW IS THE FALLBACK AND IT IS A REAL ONE. When the ordering
   cannot be reproduced - one mate's server id missing from the snapshot - every
   row renders in this grey rather than in colors that might be one seat out.
   Four wrong colors is worse than none: the whole claim of the slide is that
   these are the people beside you. */
.mate {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: ${squadRowHeight(squadRows)}px;
  background-color: ${PALETTE.card};
  background-image: linear-gradient(176deg,
    ${mix(PALETTE.card, '#ffffff', 0.055)} 0%,
    ${PALETTE.card} 50%,
    ${PALETTE.deep} 100%);
  border: 1px solid ${PALETTE.edge};
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 10px 22px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
/* A COLLAPSED LINE BOX, BECAUSE ANTON'S LINE BOX IS NOT ITS INK. The face carries a
   deep descent, so a name in a row centered by align-items sits visibly high
   in it: the box is centered and the letters are not. Collapsing the line box to
   the type size puts the glyphs where the row's middle is. */
.mname {
  flex: 0 0 320px;
  min-width: 0;
  padding: 0 22px;
  box-sizing: border-box;
  font-family: ${DISPLAY};
  font-size: 38px;
  line-height: 1;
  font-weight: 400;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mcells {
  flex: 1 1 auto;
  display: flex;
  min-width: 0;
}
.mcell {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 6px;
  box-sizing: border-box;
  text-align: center;
  overflow: hidden;
}
.mlabel {
  font-family: ${DISPLAY};
  font-size: 17px;
  font-weight: 400;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mval {
  font-family: ${DISPLAY};
  font-size: 40px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.mate.you {
  box-shadow:
    0 10px 22px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

/* ── THE COLOR ───────────────────────────────────────────────────────────────
   LAST IN THE SHEET ON PURPOSE. Everything above is the neutral board: the
   shapes, the type, the depth and the layout, all of which are true whatever a
   category is called. These two blocks paint it, and they come last so a
   single-class rule like .c-wins .card lands on top of .card without either
   of them having to reach for a specificity trick. */
${categoryStyles(categories)}
${squadStyles(mates)}
`.trim()
}

/**
 * How tall one squad row is, for a squad of this size.
 *
 * CAPPED AT 168 AND OTHERWISE DIVIDED INTO WHAT IS LEFT. The panel is 688 tall,
 * the heading row and its gutter take 52, the entrance travel reserves
 * `ENTRANCE_PX` at each end, and the rest is shared by the rows and their
 * gutters. A squad of two divides to nearly 300 each, which would be two slabs
 * rather than two rows, so the cap holds them to the height a four is.
 */
export const SQUAD_HEAD_H = 40

export function squadRowHeight(rows: number): number {
  if (rows < 1) return 0
  const available = INNER_HEIGHT - SQUAD_HEAD_H - GUTTER - 2 * ENTRANCE_PX
  return Math.min(168, Math.floor((available - (rows - 1) * GUTTER) / rows))
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
 * THE COLOR IS A CLASS ON THE COLUMN NOW AND IT USED TO BE AN INLINE `style`.
 *
 * A `style="color:#ffc65c"` on the leading numeral was the whole of the card's
 * color, which is the thing the owner threw out. A category paints six surfaces
 * now and inlining six declarations per element would put the same hex in the
 * document twenty times and make the stylesheet unreadable. `c-<key>` on the
 * column carries all of it; `categoryStyles` above is the other half.
 */
function boardMarkup(board: Leaderboard): string {
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

  return `<div id="board" class="panel on"><div class="cards">${columns}</div></div>`
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
function playerMarkup(player: PlayerPanel): string {
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
    `<div id="player" class="panel"><div class="pstack">` +
    `<div class="name">${esc(player.name)}</div>` +
    `<div class="tiles">${tiles}</div></div></div>`
  )
}

/**
 * The squad slide.
 *
 * ONE HEADING ROW AND ONE ROW PER MATE. The headings are the tile labels, in the
 * catalog's order, in each category's own accent - the same words and the same
 * colors the per-player slide uses, so the two read as one board rather than as
 * two features.
 *
 * THE VIEWER'S ROW GETS THE SAME HIGHLIGHT IT GETS ON THE LEADERBOARD, which is
 * the fill and nothing else. There is deliberately no second cue: a player
 * looking for themselves among four rows is looking for the lit one.
 *
 * NO WORDS EXCEPT THE HEADINGS AND THE NAMES. No title, no "YOUR SQUAD", no
 * squad number. The slide's whole claim is made by who is on it.
 */
function squadMarkup(squad: SquadPanel): string {
  const headings = squad.labels
    .map(
      (l) =>
        `<div class="mcell c-${l.key}"><div class="mlabel">${esc(l.label)}</div></div>`,
    )
    .join('')

  const rows = squad.mates
    .map(
      (mate, i) =>
        `<div class="mate${mate.you ? ' you' : ''}${mate.color ? ` sqc-${i}` : ''}">` +
        `<div class="mname">${esc(mate.name)}</div>` +
        `<div class="mcells">` +
        mate.values.map((v) => `<div class="mcell"><div class="mval">${esc(v)}</div></div>`).join('') +
        `</div></div>`,
    )
    .join('')

  return (
    `<div id="squad" class="panel"><div class="squad">` +
    `<div class="shead"><div class="mname"></div><div class="mcells">${headings}</div></div>` +
    `<div class="smates">${rows}</div>` +
    `</div></div>`
  )
}

/**
 * The whole document.
 *
 * NO `<title>`, NO HEADING, NO CAPTION, NO EMPTY STATE. The only words on this
 * page are the category labels, which are the owner's own words in his own
 * capitals, and the players' own names. Everything else is numerals. That is a
 * house rule and it is also right for the surface: a prop in a warmup area is
 * read in a glance from a few meters away, and every sentence added to it is a
 * sentence somebody has to skip past to reach the number they came for.
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
  const columns = Math.max(board.categories.length, player?.stats.length ?? 0, 1)

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

  /** `full` is the only level that emits the moving layers at all. */
  const drift =
    motion === 'full'
      ? `<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>` +
        `<div class="beam"></div><div class="drift"></div>`
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
      squadRows: squad?.mates.length ?? 0,
      categories: [...seen.values()],
      mates: squad?.mates ?? [],
    })}</style></head>` +
    `<body class="m-${motion}" data-motion="${motion}">` +
    `<div class="wash"></div>` +
    drift +
    `<div class="vig"></div>` +
    boardMarkup(board) +
    (player ? playerMarkup(player) : '') +
    (squad ? squadMarkup(squad) : '') +
    (panels.length > 1 ? `<script>${swapScript(panels, motion)}</script>` : '') +
    `</body></html>`
  )
}
