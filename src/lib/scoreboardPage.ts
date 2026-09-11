import {
  BOARD_DWELL_MS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PLAYER_DWELL_MS,
  TRANSITION_MS,
  type Leaderboard,
  type PlayerPanel,
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
 * ═══ THE MOTION, WHICH THE OWNER ASKED FOR AND WHICH IS NOT FREE ═══
 *
 * Owner: "what the agent built is very visually boring. We need something with
 * some pizzazz! Some animated background and transitions and colors." He was
 * told what continuous animation costs on this surface and asked for it anyway.
 * So it is built, it is built as cheaply as the effect allows, and the price is
 * written down here rather than discovered later.
 *
 * WHAT A REPAINT ACTUALLY COSTS HERE, from the platform rather than from
 * intuition. CEF calls its paint handler ONLY when the page changes, at up to
 * `windowless_frame_rate`, which defaults to 30 and maxes at 60. FiveM takes the
 * accelerated offscreen path and shares a D3D11 texture; `nui-core` has
 * dirty-rect checking and `CopySubresourceRegion` DISABLED, so every repaint
 * moves the WHOLE 1280x720 surface. Three consequences, all of which shape the
 * code below:
 *
 *   1. A STILL PAGE COSTS NOTHING. Not "little": the handler is not called at
 *      all. Everything that can be still is still.
 *   2. THE SIZE OF THE MOVING ELEMENT DOES NOT MATTER. A drifting 20px dot and
 *      a drifting full-screen layer cost the same texture traffic. Restraint
 *      buys nothing on that axis, so it is not spent there.
 *   3. WHAT DOES MATTER IS TIME AND PER-FRAME WORK. So the transition is
 *      BOUNDED (`TRANSITION_MS`, then the surface is still again) and every
 *      animated property is `transform` or `opacity`, which Chromium runs on
 *      the compositor without re-rastering. Nothing animates `box-shadow`,
 *      `filter`, `backdrop-filter`, a gradient's stops, or any property that
 *      moves layout.
 *
 * SO THERE IS A KNOB, AND IT IS READ BY THE PAGE. `SCOREBOARD_MOTION` is one of
 * `full`, `transitions` or `off`, and it lands on the `<body>` class:
 *
 *   full         the view transition, plus a continuous background drift. The
 *                drift is the only thing on this page that repaints forever, and
 *                it is the whole of the "animated background" bill.
 *   transitions  the view transition and nothing else. The surface is STILL
 *                between swaps, so the cost is TRANSITION_MS of frames once
 *                every ten to fifteen seconds and nothing in between.
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
 * The drifting background layer, emitted ONLY under `full`.
 *
 * ═══ THIS FUNCTION IS THE WHOLE OF THE "ANIMATED BACKGROUND" BILL ═══
 *
 * Everything else on this page settles. This does not: it is a linear, infinite
 * animation, so for as long as the prop exists CEF is producing frames and FiveM
 * is copying a 1280x720 texture at up to thirty per second, on every machine in
 * the warmup pad. That is the cost the owner was told about and chose. It is one
 * function so that turning it off is one condition rather than a hunt.
 *
 * A STRIPED LAYER, TRANSLATED, NOT A GRADIENT BEING REDRAWN. The gradient is
 * rasterized once into its own layer and the animation only moves that layer.
 * Animating `background-position` instead would repaint the layer on every frame
 * and would look identical in a preview.
 *
 * `will-change: transform` IS NOT DECORATION. It is what promotes the layer and
 * keeps the raster from being redone at each new position.
 *
 * THE LOOP HAS NO SEAM, AND THAT IS ARITHMETIC. The stripes repeat every 160px
 * measured along the gradient's own direction. At 120deg that direction is the
 * unit vector (sqrt(3)/2, 1/2), and the translation (-138.564, -80) projects onto
 * it as exactly -160px: one period. Any other pair of numbers gives a jump once
 * per cycle, which is invisible in a preview and obvious to somebody standing in
 * front of a wall for two minutes. `scoreboard.check.ts` recomputes the
 * projection rather than trusting this paragraph.
 *
 * 1440x820 IS THE SMALLEST LAYER THAT CAN COVER THE TRAVEL. 1280 + 139 and
 * 720 + 80, rounded up. A 200% x 200% layer would have been the lazy way to be
 * safe and would have cost about nine megabytes of raster in the renderer
 * process instead of four and a half.
 */
function driftStyles(): string {
  return `
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
  animation: drift 20s linear infinite;
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
 * THE STAGGER FITS INSIDE THE BUDGET RATHER THAN EXTENDING IT. The last column
 * starts 200ms in and runs for 420ms, which lands exactly on TRANSITION_MS. That
 * is what keeps one constant the honest description of how long the surface is
 * busy.
 */
function transitionStyles(): string {
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
.card, .tile {
  opacity: 0;
  transform: translate3d(0, 20px, 0);
  transition:
    opacity 420ms ease,
    transform 420ms cubic-bezier(0.22, 0.8, 0.28, 1);
}
.panel.on .card, .panel.on .tile {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
.col:nth-child(1) .card, .col:nth-child(1) .tile { transition-delay: 0ms; }
.col:nth-child(2) .card, .col:nth-child(2) .tile { transition-delay: 50ms; }
.col:nth-child(3) .card, .col:nth-child(3) .tile { transition-delay: 100ms; }
.col:nth-child(4) .card, .col:nth-child(4) .tile { transition-delay: 150ms; }
.col:nth-child(5) .card, .col:nth-child(5) .tile { transition-delay: 200ms; }`
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
 * ═══ THE LAYOUT IS FIVE COLUMNS AND THE ARITHMETIC IS EXACT ═══
 *
 * 1280 - 2 x 16 padding = 1248, and 5 x 240 + 4 x 12 = 1248. It fits to the
 * pixel, which is why the card width is not a round number chosen by eye: a card
 * one pixel wider wraps the fifth column onto a second row that has nowhere to
 * go on a surface that cannot scroll.
 *
 * FIVE COLUMNS ONLY WORK BECAUSE THE LABELS ARE SET IN ANTON, which is
 * condensed: "MOST REVIVES GIVEN" measures about 150px at 19px in Anton and
 * about 215px in Barlow. The type choice and the column count are the same
 * decision.
 */
function styles(motion: MotionLevel): string {
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
   TWO LAYERS, AND ONLY ONE OF THEM EVER MOVES.

   .wash is a pair of radial gradients painted once and never touched again.
   It is where most of the color on this page comes from and it costs one raster
   at load and nothing after it.

   .drift is the moving half and exists only under full. It is a striped
   layer larger than the surface, translated along the stripes' own normal by
   EXACTLY ONE PERIOD so the loop has no seam: the gradient runs at 120deg, whose
   unit vector is (sqrt(3)/2, 1/2), and translating by (-138.564px, -80px)
   projects onto that vector as exactly -160px, which is the period. Any other
   pair of numbers produces a jump every cycle that nobody can see in a preview
   and everybody sees on a wall.

   will-change: transform IS NOT DECORATION HERE. It is what keeps the layer
   rasterized once and the animation on the compositor. Without it Chromium is
   free to re-raster a 1440x820 gradient on every frame, which is the expensive
   failure this whole file is arranged to avoid. */
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
${motion === 'full' ? driftStyles() : ''}

/* ── THE TWO VIEWS ───────────────────────────────────────────────────────────
   BOTH PANELS ARE IN THE DOCUMENT AND ONE IS HIDDEN. visibility rather than
   display because the hidden one has to be able to fade IN, and display is
   not animatable; visibility is, discretely, which is exactly what is wanted:
   the entering panel becomes visible at once and the leaving one goes hidden at
   the END of its fade, so the surface is never composing two visible full-size
   layers for longer than the transition.

   THE HIDDEN PANEL COSTS NOTHING WHILE IT IS HIDDEN. visibility: hidden keeps
   it out of the raster, and with no animation running there are no frames at
   all. */
.panel {
  position: absolute;
  top: 0;
  left: 0;
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
  box-sizing: border-box;
  padding: 16px;
  opacity: 0;
  visibility: hidden;
}
.panel.on {
  opacity: 1;
  visibility: visible;
}

${motion === 'off' ? '' : transitionStyles()}

/* ── THE LEADERBOARD ─────────────────────────────────────────────────────── */
.cards {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 100%;
}
.col { width: 240px; }
/**
 * 501 IS 4 + 55 + 5x88 + 2 AND IT IS EXACT. The accent rule, the header with its
 * dividing border, five rows, and the card's own top and bottom border. A round
 * number here leaves a strip of empty card under the fifth row that reads as a
 * missing sixth.
 */
.card {
  box-sizing: border-box;
  width: 240px;
  height: 501px;
  background: ${PALETTE.card};
  border: 1px solid ${PALETTE.edge};
  border-radius: 10px;
  overflow: hidden;
}
/* The accent bar. Four pixels of the category's own color, painted once, and the
   cheapest way to make five cards read as five things. */
.rule { height: 4px; }
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
  height: 88px;
  padding: 0 10px;
  border-left: 4px solid rgba(0, 0, 0, 0);
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

   A FILL AND A BAR, BOTH STATIC. No glow, no pulse, no animation: the row has to
   be findable in a glance from several meters away and a highlight that blinks
   is a highlight that is absent half the time. The bar is drawn in the card's
   own accent so the cue belongs to the card it is in.

   THE NUMERAL CHANGES COLOR TOO, and that is a contrast fix rather than a
   flourish. See CONTRAST_PAIRS. */
.card li.you {
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
  gap: 12px;
  width: 100%;
  height: 300px;
  margin-top: 28px;
}
.tile {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 240px;
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
.tval {
  margin-top: 24px;
  font-family: ${DISPLAY};
  font-size: 74px;
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
`.trim()
}

/**
 * The alternation.
 *
 * THE PAGE OWNS IT, WHICH IS THE OWNER'S DECISION STATED TWICE: "I want the page
 * itself to automatically transition between these 2 views." Both layouts are
 * already in this document and the client already has a clock, so alternating
 * costs one `className` write every ten to fifteen seconds. The alternative, a
 * push from Lua, would need the game to hold a timer per prop and to reach into
 * a browser it does not otherwise talk to.
 *
 * TWO SEPARATE CONSTANTS, EMITTED BY NAME, because the owner is going to tune
 * them on the pad and they are not the same reading job. See `lib/scoreboard.ts`.
 *
 * THE TRANSITION IS ADDED TO THE DWELL, NOT TAKEN OUT OF IT. A dwell is time
 * spent still and readable; scheduling the next swap at `dwell` alone would mean
 * that raising `TRANSITION_MS` silently shortened both views. Under `off` the
 * emitted transition is 0, so the timings are exactly what they were before any
 * of this existed.
 *
 * `setTimeout` CHAINED, NOT `setInterval`. Two different dwell times are not an
 * interval, and an interval would hold whichever panel it started on for the
 * wrong one of the two durations forever.
 *
 * THE FIRST PAINT IS NOT ANIMATED, and that is deliberate. The DUI is being
 * created at the moment a player walks onto the pad; the fastest possible first
 * frame is the board already assembled. The first swap is therefore scheduled at
 * `BOARD_DWELL_MS` with no transition added, because no transition preceded it.
 *
 * NOT EMITTED AT ALL WHEN THERE IS NO SECOND PANEL. A player with no career row
 * gets the leaderboard and nothing else, so there is nothing to alternate with
 * and the document carries no timer, no script and nothing to repaint. The check
 * asserts that too, because a timer swapping to a panel that does not exist would
 * blank the wall every fifteen seconds.
 */
function swapScript(motion: MotionLevel): string {
  const transition = motion === 'off' ? 0 : TRANSITION_MS
  return `
(function () {
  var PLAYER_DWELL_MS = ${PLAYER_DWELL_MS};
  var BOARD_DWELL_MS = ${BOARD_DWELL_MS};
  var TRANSITION_MS = ${transition};
  var board = document.getElementById('board');
  var player = document.getElementById('player');
  if (!board || !player) return;
  var onPlayer = false;
  function swap() {
    onPlayer = !onPlayer;
    board.className = onPlayer ? 'panel' : 'panel on';
    player.className = onPlayer ? 'panel on' : 'panel';
    setTimeout(swap, (onPlayer ? PLAYER_DWELL_MS : BOARD_DWELL_MS) + TRANSITION_MS);
  }
  setTimeout(swap, BOARD_DWELL_MS);
})();
`.trim()
}

function boardMarkup(board: Leaderboard): string {
  const columns = board.categories
    .map((category) => {
      const rows = category.entries
        .map(
          (entry, i) =>
            `<li class="${entry.you ? 'you' : ''}"` +
            (entry.you ? ` style="border-left-color:${category.accent}"` : '') +
            `>` +
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
        `<div class="rule" style="background:${category.accent}"></div>` +
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
 * THE TILES CARRY THE SAME ACCENT AS THE CARDS, on the label rather than as a
 * bar, so the two views read as the same board seen twice.
 */
function playerMarkup(player: PlayerPanel): string {
  const tiles = player.stats
    .map(
      (stat) =>
        `<div class="col"><div class="tile">` +
        `<div class="rule" style="background:${stat.accent}"></div>` +
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
 * The whole document.
 *
 * NO `<title>`, NO HEADING, NO CAPTION, NO EMPTY STATE. The only words on this
 * page are the five category labels, which are the owner's own words in his own
 * capitals, and the player's own name. Everything else is numerals. That is a
 * house rule and it is also right for the surface: a prop in a warmup area is
 * read in a glance from a few meters away, and every sentence added to it is a
 * sentence somebody has to skip past to reach the number they came for.
 *
 * `data-motion` IS ON THE ROOT SO THE SETTING IS VISIBLE FROM OUTSIDE. It is
 * what the measurement harness reads and what somebody looking at the served
 * page can check without guessing which class means what. It is an attribute
 * rather than a word on screen.
 */
export function renderScoreboard(input: {
  board: Leaderboard
  player: PlayerPanel | null
  motion: MotionLevel
}): string {
  const { board, player, motion } = input

  /** `full` is the only level that emits the drifting layer at all. */
  const drift = motion === 'full' ? `<div class="drift"></div>` : ''

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<style>${styles(motion)}</style></head>` +
    `<body class="m-${motion}" data-motion="${motion}">` +
    `<div class="wash"></div>` +
    drift +
    boardMarkup(board) +
    (player ? playerMarkup(player) : '') +
    (player ? `<script>${swapScript(motion)}</script>` : '') +
    `</body></html>`
  )
}
