// ESLint, so that `npm run lint` is a command rather than a prompt.
//
// THIS FILE EXISTS BECAUSE `next lint` WITHOUT A CONFIG IS INTERACTIVE. With no
// config present it asks "How would you like to configure ESLint?" and waits --
// which never completes in CI, in a hook, or under an agent, so the script was
// effectively unrunnable rather than merely unused. A config that lints nothing
// would still be better than that; this one lints properly.
//
// FLAT CONFIG, VIA FlatCompat. ESLint 9 reads eslint.config.mjs, and
// eslint-config-next still ships the older shareable-config shape, so the
// bridge is the supported way to use one from the other. When
// eslint-config-next publishes a native flat config this file collapses to an
// import of it.
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

export default [
  {
    // Built output, dependencies and the gate scripts' own fixtures. Linting a
    // build artefact reports on code nobody wrote.
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]
