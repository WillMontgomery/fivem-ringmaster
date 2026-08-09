import type { Config } from 'tailwindcss'

// Tailwind 3. Note this is a DIFFERENT constraint from the gamemode's NUI,
// which is pinned to 3 because CEF is Chrome 103 and renders Tailwind 4's
// oklch palette colourless. Ringmaster runs in a real browser and has no such
// limit -- 3 is chosen here only for familiarity, and moving to 4 is a normal
// upgrade rather than a blocked one.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
