// Tailwind 4 ships its own PostCSS plugin and handles vendor prefixing itself,
// so autoprefixer is gone rather than merely unused.
//
// Note this repo is on Tailwind 4 while the gamemode's NUI is pinned to 3.
// That is not an inconsistency: CEF is Chrome 103 and renders Tailwind 4's
// oklch palette colourless. Ringmaster runs in a real browser and has no such
// limit -- and shadcn/ui's registry emits oklch, so v4 is what it expects.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
