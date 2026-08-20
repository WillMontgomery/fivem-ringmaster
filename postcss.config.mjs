// Tailwind 4 ships its own PostCSS plugin and handles vendor prefixing itself,
// so autoprefixer is gone rather than merely unused.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE DOWNLEVELS COLOUR, AND WHY THAT REVERSED A PREVIOUS DECISION
// ---------------------------------------------------------------------------
//
// An earlier version of this comment said the gamemode's NUI is pinned to
// Tailwind 3 "because CEF is Chrome 103 and renders oklch colourless", and then
// concluded: "Ringmaster runs in a real browser and has no such limit."
//
// THAT SECOND SENTENCE STOPPED BEING TRUE the moment the console got a pause-menu
// Admin tab. Ringmaster is now framed inside CEF, so CEF's limits are ours too.
//
// The owner reported it as "a lot of our CSS is mostly a wireframe with no
// colors", and that is precisely what a Chrome 103 engine does with this
// stylesheet. `oklch()` is Chrome 111. A custom property is not validated when
// it is DECLARED -- `--background: oklch(...)` parses fine anywhere -- it fails
// at substitution, when `var(--background)` is resolved into a real property.
// The declaration then becomes invalid at computed-value time and the property
// falls back to unset. So every background went transparent, every border fell
// back to currentColor, and the page reads as a wireframe.
//
// Two consequences that looked like separate bugs and were not:
//
//   · Panels stacked visibly through one another, because a dialog's own
//     `bg-background` was transparent along with everything else.
//   · The console appeared FROZEN. A modal overlay is `fixed inset-0 z-50`; it
//     was invisible but still present, so it swallowed every click on the page
//     underneath it. Nothing was broken about input -- there was an unpainted
//     sheet of glass over it.
//
// THE FIX IS BUILD-SIDE ON PURPOSE. `globals.css` stays authored in oklch --
// that is what shadcn's registry emits, and hand-converting 115 tokens would
// introduce drift on every one of them for no gain. These two plugins emit an
// sRGB fallback ahead of each modern declaration and re-state the original
// inside `@supports (color: oklch(0 0 0))`, so a real browser is bit-for-bit
// unchanged and CEF gets a colour it can parse. Tailwind already uses exactly
// this shape for its own `color-mix()` opacity modifiers.
//
// `preserve: true` is what makes that true -- without it the modern value would
// be REPLACED rather than supplemented, and every browser would drop to sRGB.
//
// Ordering is not incidental: progressive-custom-properties must run AFTER the
// plugin whose fallbacks it groups, or it has nothing to group.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    '@csstools/postcss-oklab-function': { preserve: true, subFeatures: { displayP3: false } },
    '@csstools/postcss-progressive-custom-properties': {},
  },
}
