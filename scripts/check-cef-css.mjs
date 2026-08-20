/**
 * THE STYLESHEET HAS TWO ENGINES TO SATISFY, AND ONE OF THEM IS EIGHT YEARS OLD.
 *
 * Ringmaster is read in a current browser AND inside the game, where the
 * pause-menu Admin tab frames it in CEF -- Chromium 103. `oklch()` and
 * `oklab()` are Chrome 111. Every colour token in `globals.css` is authored in
 * oklch, so without a downlevel step the entire palette arrives unparseable on
 * the in-game surface.
 *
 * THIS IS A GATE BECAUSE THE FAILURE IS INVISIBLE TO WHOEVER CAUSES IT. A
 * custom property is not validated when it is declared: `--background:
 * oklch(...)` parses in any engine. It fails later, at substitution, when
 * `var(--background)` is resolved into a real property -- the declaration
 * becomes invalid at computed-value time and the property falls back to unset.
 * So nothing errors, no build warns, and a developer looking at Chrome sees a
 * correct console. It broke in play, and it was reported as "a lot of our CSS
 * is mostly a wireframe with no colors".
 *
 * It also does not fail gracefully. Backgrounds go transparent, which means a
 * modal overlay -- `fixed inset-0 z-50` -- is still there, still swallowing
 * every click, and no longer painted. The console reads as frozen rather than
 * as unstyled, which sends whoever reports it looking in entirely the wrong
 * place.
 *
 * ------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT
 * ------------------------------------------------------------------------
 *
 *   1. No `oklch()`/`oklab()` reaches a declaration CEF will parse. Every one
 *      must sit inside an `@supports` that CEF fails, with a plain-sRGB
 *      declaration ahead of it.
 *   2. No fallback paints a background in `currentColor`. This is a specific
 *      shape, not a general worry: Lightning CSS downlevels `color-mix()` by
 *      emitting a computable plain value first, and where it CANNOT compute
 *      one -- a mix against `currentColor` -- it emits `currentColor` itself.
 *      On a rule that also sets `color: inherit`, that is text painted on its
 *      own colour. Unreadable, not merely untinted, and worse than dropping
 *      the declaration entirely.
 *
 *   3. Every tinted chromatic background has a CEF override. An opacity
 *      modifier on a `var()` token cannot be resolved at build time, so the
 *      fallback Tailwind emits is the bare token AT FULL OPACITY.
 *
 *      AN EARLIER VERSION OF THIS COMMENT CALLED THAT "a cosmetic degradation
 *      with no legibility cost" AND DECLINED TO GATE IT. That was written from
 *      reading the CSS and was wrong the moment it met a screenshot. Every chip
 *      here is a 5-20% tint of a status colour beneath text of that SAME
 *      colour: collapse the alpha and the fill becomes exactly the ink, and the
 *      chip renders as a solid lozenge with its label invisible. Six on the
 *      host page alone. The override block at the end of `globals.css` drops
 *      those fills to transparent for CEF, and this asserts the list has not
 *      fallen behind the call sites.
 *
 * NOT ASSERTED: `:has()` (Chrome 105) or container queries (Chrome 105). Both
 * are used here only by shadcn primitives, for padding and margin nudges, and
 * both degrade by a few pixels. Nor alpha on BORDERS and RINGS -- those collapse
 * to a firmer edge, which is the case where "cosmetic" actually holds.
 *
 * This runs the real PostCSS pipeline from `postcss.config.mjs` rather than
 * reading `.next/`, so it needs no build and tests the configuration actually
 * in force. If someone drops the downlevel plugins, this fails on the next
 * `npm run verify` instead of in a screenshot from a playtest.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import postcss from 'postcss'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = resolve(ROOT, 'src/app/globals.css')

/** The engine we are protecting. Named so the number is not folklore. */
const CEF_CHROME = 103

/**
 * Tokens printed on every run. A palette change shows up as different numbers
 * rather than as nothing, the same way `check-contrast.mjs` prints its extremes.
 */
const LANDMARKS = ['--background', '--foreground', '--card', '--border', '--primary']

let failures = 0
function fail(msg) {
  failures++
  console.error(`  FAIL  ${msg}`)
}

/** Does this `@supports` condition gate on a colour space CEF 103 lacks? */
function gatesModernColour(params) {
  return /oklab|oklch|color-mix/i.test(params)
}

/** Walk up the AST to see whether a node sits inside such a gate. */
function insideModernGate(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && p.name === 'supports') {
      // `@supports not (...)` is the OPPOSITE gate -- it runs ON CEF, so a
      // modern colour inside one is exactly the bug, not an exemption.
      if (/^\s*not\b/i.test(p.params)) return false
      if (gatesModernColour(p.params)) return true
    }
  }
  return false
}

const MODERN = /\bokl(ch|ab)\(/i

const source = readFileSync(ENTRY, 'utf8')

const cfg = (await import('../postcss.config.mjs')).default
const plugins = []
for (const [name, opts] of Object.entries(cfg.plugins)) {
  const mod = await import(name)
  const factory = mod.default ?? mod
  plugins.push(factory(opts))
}

console.log(`Building the real stylesheet through postcss.config.mjs (${plugins.length} plugins)...`)
const result = await postcss(plugins).process(source, { from: ENTRY })
const css = result.css
console.log(`  ${css.length.toLocaleString()} bytes of CSS\n`)

const root = postcss.parse(css, { from: ENTRY })

// --- 1. every modern colour is either gated or has a usable fallback ---------

/**
 * TWO FAILURE MODES, AND ONLY ONE OF THEM NEEDS `@supports`.
 *
 * A REGULAR property is validated when it is parsed. `background-color:
 * oklch(...)` is simply dropped by Chrome 103, so an sRGB declaration of the
 * same property AHEAD of it survives and wins -- the ordinary cascade fallback.
 * No `@supports` required. That is what `preserve: true` emits for the three
 * arbitrary oklch background utilities on the login page, and they are fine.
 *
 * A CUSTOM property is not validated when parsed. `--background: oklch(...)`
 * is accepted by every engine, because a custom property's value is an
 * unvalidated token stream. It fails later, at substitution, when
 * `var(--background)` is resolved into a real property -- and by then a sibling
 * cannot help, because the later declaration has already overwritten the
 * earlier one. `@supports` is the only thing that works, which is precisely
 * why `postcss-progressive-custom-properties` exists.
 *
 * The asymmetry below is therefore deliberate. Treating the two alike would
 * either fail the safe blobs or wave through a broken token.
 */
function verdictFor(decl) {
  if (insideModernGate(decl)) return 'gated'
  if (decl.prop.startsWith('--')) return 'UNGATED CUSTOM PROPERTY'
  for (const n of decl.parent?.nodes ?? []) {
    if (n === decl) break
    if (n.type === 'decl' && n.prop === decl.prop && !MODERN.test(n.value)) return 'sibling fallback'
  }
  return 'NO FALLBACK'
}

let modernTotal = 0
const tally = {}
const broken = []
root.walkDecls((decl) => {
  if (!MODERN.test(decl.value)) return
  modernTotal++
  const v = verdictFor(decl)
  tally[v] = (tally[v] ?? 0) + 1
  if (v === v.toUpperCase()) {
    broken.push(`${v}: ${decl.parent?.selector ?? decl.parent?.name ?? '?'} { ${decl.prop} }`)
  }
})

console.log(`Modern-colour declarations found: ${modernTotal}`)
for (const [k, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(4)}  ${k}`)
if (modernTotal === 0) {
  fail('no oklch/oklab at all -- the downlevel plugin is REPLACING rather than preserving. Real browsers just lost the wide-gamut palette; check `preserve: true`.')
} else if (broken.length > 0) {
  fail(`${broken.length} declaration(s) would reach Chrome ${CEF_CHROME} with nothing to fall back to:`)
  for (const b of broken.slice(0, 12)) console.error(`          ${b}`)
} else {
  console.log(`  ok    every one is safe on Chrome ${CEF_CHROME}\n`)
}

// --- 2. no background painted in currentColor, unless overridden -------------

/**
 * `@supports not (...)` is the CEF-only escape hatch: it runs on the engine
 * that fails the feature test and nowhere else. A rule fixed that way is fixed,
 * so collect those selectors and exempt them rather than reporting a bug that
 * has already been dealt with two lines below.
 */
const overridden = new Set()
root.walkAtRules('supports', (at) => {
  if (!/^\s*not\b/i.test(at.params) || !gatesModernColour(at.params)) return
  at.walkRules((r) => {
    for (const n of r.nodes ?? []) {
      if (n.type === 'decl' && /^background(-color)?$/.test(n.prop)) overridden.add(r.selector.trim())
    }
  })
})

const selfPainted = []
root.walkDecls(/^background(-color)?$/, (decl) => {
  if (!/^\s*currentColor\s*$/i.test(decl.value)) return
  if (insideModernGate(decl)) return
  const sel = decl.parent?.selector?.trim() ?? '?'
  if (overridden.has(sel)) return
  selfPainted.push(`${sel} { ${decl.prop}: ${decl.value} }`)
})

if (selfPainted.length > 0) {
  fail(`${selfPainted.length} rule(s) paint a background in currentColor on Chrome ${CEF_CHROME}:`)
  for (const s of selfPainted) console.error(`          ${s}`)
  console.error('        Override it under `@supports not (color: color-mix(in lab, red, red))`.')
} else {
  const n = overridden.size
  console.log(`  ok    no background falls back to currentColor${n ? ` (${n} selector(s) explicitly overridden for CEF)` : ''}\n`)
}


// --- 4. every tinted chromatic background is overridden for CEF --------------

/**
 * The shape being hunted is a background whose CEF fallback is a bare chromatic
 * token, on a utility whose name says it was meant to be a TINT. That is the
 * chip-becomes-a-lozenge bug. Neutral tokens are exempt: `bg-muted/40` reading
 * solid is a slightly firmer grey under `text-muted-foreground`, not a colour
 * painted on itself.
 */
const CHROMATIC = /^(primary|live|warn|danger|info|destructive|accent|chart-[1-5]|squad-[1-8]|phase-[a-z]+)$/

/** Substrings the override block claims to cover. */
const covered = []
root.walkAtRules('supports', (at) => {
  if (!/^\s*not\b/i.test(at.params) || !gatesModernColour(at.params)) return
  at.walkRules((r) => {
    for (const m of r.selector.matchAll(/\[class\*=["']([^"']+)["']\]/g)) covered.push(m[1])
  })
})

/** A Tailwind class selector escapes `/` as `\/`; undo that to compare. */
const unescape = (sel) => sel.replace(/\\(.)/g, '$1')

const uncovered = new Set()
let tinted = 0
root.walkRules((rule) => {
  if (insideModernGate(rule)) return
  const sel = unescape(rule.selector)
  const m = sel.match(/\bbg-([a-z0-9-]+)\/(\d+)\b/)
  if (!m) return
  const [, token, alpha] = m
  if (!CHROMATIC.test(token) || Number(alpha) > 30) return
  const paints = (rule.nodes ?? []).some(
    (n) => n.type === 'decl' && /^background(-color)?$/.test(n.prop) && /var\(--/.test(n.value),
  )
  if (!paints) return
  tinted++
  if (!covered.some((c) => sel.includes(c))) uncovered.add(`bg-${token}/${alpha}`)
})

console.log(`Tinted chromatic backgrounds: ${tinted} rule(s), ${covered.length} override entries`)
if (uncovered.size > 0) {
  fail(`${uncovered.size} tinted utility(ies) collapse to an opaque fill on Chrome ${CEF_CHROME}:`)
  for (const u of [...uncovered].sort()) console.error(`          ${u}`)
  console.error('        Each renders as a solid lozenge with its own label invisible inside it.')
  console.error("        Add it to the override block at the end of src/app/globals.css.")
} else if (tinted === 0) {
  console.log('  ok    none present\n')
} else {
  console.log(`  ok    all ${tinted} drop to transparent for CEF\n`)
}

// --- 3. the landmark tokens each carry an sRGB fallback ----------------------

console.log(`What Chrome ${CEF_CHROME} actually paints:`)
for (const token of LANDMARKS) {
  let plain = null
  root.walkDecls(token, (decl) => {
    if (insideModernGate(decl)) return
    if (/\bokl(ch|ab)\(/i.test(decl.value)) return
    if (plain === null) plain = decl.value
  })
  if (plain === null) fail(`${token} has no sRGB fallback -- it is unset on CEF`)
  else console.log(`  ${token.padEnd(14)} ${plain}`)
}

console.log()
if (failures > 0) {
  console.error(`check:cef FAILED with ${failures} problem(s)`)
  process.exit(1)
}
console.log('check:cef passed')
