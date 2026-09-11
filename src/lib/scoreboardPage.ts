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
  page: '#0d1017',
  card: '#171c26',
  edge: '#2a3240',
  text: '#f2f5fa',
  label: '#9fb0cc',
  muted: '#7d8ca6',
  /** The highlighted row's fill. See `.you` in the stylesheet. */
  you: '#233049',
  /** The numeral on a highlighted row, which needs more than `muted` gives. */
  youMuted: '#b9c8e2',
} as const

/** Text-on-background pairs the check holds to a contrast floor. */
export const CONTRAST_PAIRS: ReadonlyArray<[string, string, string]> = [
  ['card title', PALETTE.label, PALETTE.card],
  ['entry name', PALETTE.text, PALETTE.card],
  ['entry value', PALETTE.text, PALETTE.card],
  ['rank numeral', PALETTE.muted, PALETTE.card],
  ['player name', PALETTE.text, PALETTE.page],
  ['tile rank', PALETTE.muted, PALETTE.card],
  /**
   * THE HIGHLIGHTED ROW IS A SECOND BACKGROUND AND EVERY TEXT ON IT IS A NEW
   * PAIR. `muted` on `you` measures 3.88:1 and does not pass, which is the
   * whole reason `youMuted` exists; leaving it would have put the one row the
   * owner asked to make MORE visible below the floor the rest of the board
   * meets.
   */
  ['your name', PALETTE.text, PALETTE.you],
  ['your numeral', PALETTE.youMuted, PALETTE.you],
]

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
 * FOUR MOVING LAYERS AND NOT ONE MORE. Three soft orbs that wander, and the
 * striped sheet that was already here. Each is its own promoted layer, which is
 * a real GPU texture on the player's machine, so the count is the budget: the
 * three orbs and the sheet come to roughly nine megabytes of layer raster, once,
 * against a client already holding a battle royale map.
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

/** One phase per moving layer: three orbs, then the sheet. */
export const PHASE_COUNT = 4

/**
 * The loop lengths, in seconds, in the same order as the phases.
 *
 * DELIBERATELY NOT MULTIPLES OF EACH OTHER. Four layers on 41, 53, 67 and 20
 * second loops only return to the same arrangement once every few hours, so the
 * background does not visibly repeat inside one warmup even before the random
 * phase offsets are applied.
 */
const PERIODS = [41, 53, 67, 20] as const

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
  left: -180px;
  top: -220px;
  width: 720px;
  height: 720px;
  background-image: radial-gradient(circle closest-side,
    rgba(124, 196, 255, 0.20) 0%,
    rgba(124, 196, 255, 0.07) 55%,
    rgba(124, 196, 255, 0) 100%);
  animation-name: o1;
  animation-duration: ${PERIODS[0]}s;
  animation-delay: ${d(0)};
}
.o2 {
  left: 760px;
  top: 300px;
  width: 660px;
  height: 660px;
  background-image: radial-gradient(circle closest-side,
    rgba(201, 166, 255, 0.19) 0%,
    rgba(201, 166, 255, 0.06) 55%,
    rgba(201, 166, 255, 0) 100%);
  animation-name: o2;
  animation-duration: ${PERIODS[1]}s;
  animation-delay: ${d(1)};
}
.o3 {
  left: 380px;
  top: -300px;
  width: 560px;
  height: 560px;
  background-image: radial-gradient(circle closest-side,
    rgba(110, 231, 168, 0.13) 0%,
    rgba(110, 231, 168, 0.04) 55%,
    rgba(110, 231, 168, 0) 100%);
  animation-name: o3;
  animation-duration: ${PERIODS[2]}s;
  animation-delay: ${d(2)};
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
  opacity: 0.5;
  background-image: repeating-linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.045) 0px,
    rgba(255, 255, 255, 0.045) 2px,
    rgba(255, 255, 255, 0) 2px,
    rgba(255, 255, 255, 0) 80px,
    rgba(124, 196, 255, 0.05) 80px,
    rgba(124, 196, 255, 0.05) 83px,
    rgba(255, 255, 255, 0) 83px,
    rgba(255, 255, 255, 0) 160px
  );
  will-change: transform;
  animation: drift ${PERIODS[3]}s linear infinite;
  animation-delay: ${d(3)};
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

/** One leaderboard row, and the header above five of them. */
const ROW_H = 88
const HEAD_H = 55
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
}): string {
  const { motion, phases, columns, squadRows } = input
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
   .wash is a pair of radial gradients painted once and never touched again.
   It is the floor of the palette and costs one raster at load and nothing after
   it. It is emitted at every motion level, because a still gradient is not
   animation and off should still look like something.

   THE MOVING LAYERS ARE IN driftStyles() AND EXIST ONLY UNDER full: three soft
   orbs on closed paths and one striped sheet, each promoted, each animating
   nothing but transform, each started at a random point in its own loop. See
   that function for the arithmetic and the header for what a frame actually
   costs on this surface. */
.wash {
  position: absolute;
  top: 0;
  left: 0;
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
  background-image:
    radial-gradient(760px 460px at 14% -10%,
      rgba(124, 196, 255, 0.17) 0%,
      rgba(124, 196, 255, 0.06) 45%,
      rgba(124, 196, 255, 0) 100%),
    radial-gradient(760px 460px at 88% 110%,
      rgba(201, 166, 255, 0.15) 0%,
      rgba(201, 166, 255, 0.05) 45%,
      rgba(201, 166, 255, 0) 100%);
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
.card {
  box-sizing: border-box;
  width: ${w}px;
  height: ${CARD_H}px;
  background: ${PALETTE.card};
  border: 1px solid ${PALETTE.edge};
  border-radius: 10px;
  overflow: hidden;
}
.card h2 {
  margin: 0;
  padding: 14px 14px 12px;
  font-family: ${DISPLAY};
  font-size: 20px;
  font-weight: 400;
  letter-spacing: 0.045em;
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
  padding: 0 12px;
  box-sizing: border-box;
}
.pos {
  width: 22px;
  flex: 0 0 22px;
  font-family: ${DISPLAY};
  font-size: 19px;
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
.val {
  flex: 0 0 auto;
  padding-left: 8px;
  font-family: ${DISPLAY};
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

/* ── THE VIEWER'S OWN ROW ────────────────────────────────────────────────────
   Owner: "if the player viewing the scoreboard is anywhere on it - highlight
   that row."

   A FILL AND NOTHING ELSE NOW. It used to be a fill PLUS a 4px bar in the
   category's accent down the left edge, and that bar was one of the color
   borders he asked to remove. The fill on its own is still the loudest thing in
   a column of five identical rows, it is static (a highlight that blinks is a
   highlight that is absent half the time), and it carries the same cue on the
   squad slide.

   THE NUMERAL CHANGES COLOR TOO, and that is a contrast fix rather than a
   flourish. See CONTRAST_PAIRS. */
.card li.you, .mate.you {
  background: ${PALETTE.you};
}
.card li.you .pos { color: ${PALETTE.youMuted}; }

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
.name {
  height: 120px;
  line-height: 120px;
  padding: 0 4px;
  font-family: ${DISPLAY};
  font-size: 64px;
  font-weight: 400;
  letter-spacing: 0.01em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
.tile {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${w}px;
  height: 300px;
  background: ${PALETTE.card};
  border: 1px solid ${PALETTE.edge};
  border-radius: 10px;
  overflow: hidden;
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
  font-size: 20px;
  font-weight: 400;
  letter-spacing: 0.045em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* THE NUMERAL SCALES WITH THE COLUMN, because it is the one piece of type on
   this page that is wide enough to overflow its own tile. 74px of Anton is about
   37px per digit, so seven digits is 259px and does not fit a 240px tile, let
   alone a 198px one. Tying the size to the width keeps the ratio the same at
   every column count; overflow hidden is still there for the player who
   somehow banks ten million Volts. */
.tval {
  margin-top: 24px;
  font-family: ${DISPLAY};
  font-size: ${Math.round((74 * w) / 240)}px;
  font-weight: 400;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.trank {
  margin-top: 24px;
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
.mate {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: ${squadRowHeight(squadRows)}px;
  background: ${PALETTE.card};
  border: 1px solid ${PALETTE.edge};
  border-radius: 10px;
  overflow: hidden;
}
.mname {
  flex: 0 0 300px;
  min-width: 0;
  padding: 0 18px;
  box-sizing: border-box;
  font-family: ${DISPLAY};
  font-size: 34px;
  font-weight: 400;
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
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.045em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mval {
  font-family: ${DISPLAY};
  font-size: 34px;
  font-weight: 400;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
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

function boardMarkup(board: Leaderboard): string {
  const columns = board.categories
    .map((category) => {
      const rows = category.entries
        .map(
          (entry, i) =>
            `<li${entry.you ? ` class="you"` : ''}>` +
            `<span class="pos"${i === 0 ? ` style="color:${category.accent}"` : ''}>${
              i + 1
            }</span>` +
            `<span class="who">${esc(entry.name)}</span>` +
            `<span class="val">${esc(entry.value)}</span>` +
            `</li>`,
        )
        .join('')
      return (
        `<div class="col"><section class="card">` +
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
        `<div class="col"><div class="tile">` +
        `<div class="tbody">` +
        `<div class="tlabel" style="color:${stat.accent}">${esc(stat.label)}</div>` +
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
    .map((l) => `<div class="mcell"><div class="mlabel" style="color:${l.accent}">${esc(l.label)}</div></div>`)
    .join('')

  const rows = squad.mates
    .map(
      (mate) =>
        `<div class="mate${mate.you ? ' you' : ''}">` +
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

  /** `full` is the only level that emits the moving layers at all. */
  const drift =
    motion === 'full'
      ? `<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="drift"></div>`
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
    })}</style></head>` +
    `<body class="m-${motion}" data-motion="${motion}">` +
    `<div class="wash"></div>` +
    drift +
    boardMarkup(board) +
    (player ? playerMarkup(player) : '') +
    (squad ? squadMarkup(squad) : '') +
    (panels.length > 1 ? `<script>${swapScript(panels, motion)}</script>` : '') +
    `</body></html>`
  )
}
