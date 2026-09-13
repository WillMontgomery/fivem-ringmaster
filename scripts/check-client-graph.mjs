#!/usr/bin/env node
/**
 * No node builtin may be reachable from a client component.
 *
 *   node scripts/check-client-graph.mjs
 *
 * ============================================================================
 * WHY THIS FILE EXISTS, AND IT IS NOT A HYPOTHETICAL
 * ============================================================================
 *
 * On 2026-09-13 `lib/ingestAuth.ts` imported `node:crypto`. `lib/env.ts` imports
 * it to validate `INGEST_SECRETS` in the one pass that names every bad variable
 * at once; `lib/dynamo.ts` imports `env.ts`; `lib/maintenance.ts` imports
 * `dynamo.ts`; and `HostBoard.tsx` is a client component that imports
 * `maintenance.ts`. So `node:crypto` was in the browser bundle, webpack has no
 * resolution for a `node:` specifier, and `next build` died with
 *
 *     UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
 *
 * naming a module five hops from the component that caused it. `main` was red on
 * the owner's deploy branch a week before a closed beta.
 *
 * `npm run verify` DID NOT CATCH IT BECAUSE IT DOES NOT RUN `next build`. CI
 * does, and CI is the wrong place to find out. Every check in this repo exists
 * because something shipped; this one is no different.
 *
 * ============================================================================
 * WHY `next build` IS NOT IN `npm run verify`, AND IT IS NOT ABOUT THE MINUTE
 * ============================================================================
 *
 * The cost was measured rather than guessed, and it is not the argument: on the
 * owner's box `npm run verify` is 19s, a COLD `next build` is 29s, and this
 * check is under a second. Roughly two and a half times the gate is a real tax
 * on every change in a repo where agents commit in series, but it would be
 * affordable if the check were worth it.
 *
 * THE ARGUMENT IS THAT A LOCAL BUILD IS A WEAKER CHECK THAN THE CI ONE, AND
 * THIS REPO HAS ALREADY BEEN BURNED BY EXACTLY THAT. `.github/workflows/verify.yml`
 * runs `npx next build` as its own step with no environment supplied, because
 * `next build` imports every module to collect page data and anything reading
 * `env()` at module scope would make the build demand a real Discord secret and
 * a real signing key. That step's own comment records a fix being reverted as
 * "unnecessary" on the strength of a local build that passed: Next loads
 * `.env.local` off the disk automatically, so a developer's machine can never
 * ask the question CI asks.
 *
 * Putting `next build` in `verify` would therefore add a green tick that means
 * less than the one beside it, on the exact axis where somebody has already
 * mistaken one for the other. CI keeps the build and remains the authority on
 * whether the app builds at all.
 *
 * WHAT GOES IN THE GATE INSTEAD IS THIS, and it is not a consolation prize for
 * the one class of build failure that has actually bitten: it prints the import
 * chain from the client component to the builtin, which is the one thing
 * webpack's own error does not give you.
 *
 * ============================================================================
 * WHAT IT IS AND IS NOT
 * ============================================================================
 *
 * It is a regex import scan, not a bundler. It deliberately OVER-approximates:
 * `import type` and `export type` are erased and ignored, but a value import
 * whose bindings TypeScript would elide is still followed. An over-approximation
 * can only produce a false ALARM, never a false all-clear, and a false alarm on
 * a gate is fixed by writing `import type`, which is what you wanted anyway.
 *
 * It is also not the `server-only` package, which is the other half. That marker
 * turns importing a server module from the client into a build error AT THE
 * IMPORT SITE. This catches the case where nobody remembered to add it.
 */

import { builtinModules } from 'node:module'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const BUILTINS = new Set(builtinModules)

/** Extensions tried, in the order a bundler would try them. */
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * `.check.ts` files are plain scripts run by `tsx`, never imported by anything
 * the bundler sees. Including them would report every check that reads a fixture
 * off disk with `node:fs`.
 */
const IGNORED = /\.check\.tsx?$/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !IGNORED.test(entry)) out.push(full)
  }
  return out
}

/**
 * Every import specifier in a file, with type-only ones dropped.
 *
 * The `import type` / `export type` forms are erased by TypeScript and never
 * reach webpack, so following them would report chains that do not exist in any
 * bundle. `import { type Foo }` is NOT dropped: the statement still emits unless
 * every binding is a type, and guessing which is a job for a type checker.
 */
function specifiersOf(text) {
  const out = []

  // Strip block and line comments so a path named in prose is not an edge.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  // import ... from 'x'  /  export ... from 'x'  /  import 'x'
  const statement =
    /(?:^|[\s;}])(import|export)(\s+type)?\s*(?:([^'"]*?)\s+from\s*)?['"]([^'"]+)['"]/g

  let m
  while ((m = statement.exec(code)) !== null) {
    const [, kind, typeOnly, clause, spec] = m
    if (typeOnly) continue
    // `export 'x'` is not a thing; a bare string after `export` is not an edge.
    if (kind === 'export' && clause === undefined) continue
    out.push(spec)
  }

  // Dynamic import and require, both of which a bundler follows.
  for (const re of [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    while ((m = re.exec(code)) !== null) out.push(m[1])
  }

  return out
}

/** First meaningful line is the directive, exactly as the bundler reads it. */
function isClientEntry(text) {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue
    return t === "'use client'" || t === '"use client"' ||
      t === "'use client';" || t === '"use client";'
  }
  return false
}

/** A local file path, or null when the specifier leaves this repo. */
function resolveLocal(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null

  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext
  for (const ext of EXTS) {
    const idx = join(base, 'index' + ext)
    if (existsSync(idx)) return idx
  }
  return null
}

/**
 * Is this specifier a node builtin?
 *
 * `node:` IS UNAMBIGUOUS AND IS THE CONVENTION THIS REPO USES. A bare name is
 * only a builtin when npm does not also publish a package by that name into this
 * tree, because `buffer`, `process`, `util` and friends are all real packages
 * somebody may legitimately depend on.
 */
function builtinName(spec) {
  if (spec.startsWith('node:')) return spec
  if (!BUILTINS.has(spec)) return null
  if (existsSync(join(ROOT, 'node_modules', spec, 'package.json'))) return null
  return spec
}

const files = walk(SRC)
const specCache = new Map()

function specsFor(file) {
  let s = specCache.get(file)
  if (!s) {
    s = specifiersOf(readFileSync(file, 'utf8'))
    specCache.set(file, s)
  }
  return s
}

const entries = files.filter((f) => isClientEntry(readFileSync(f, 'utf8')))

const rel = (p) => relative(ROOT, p).split(sep).join('/')

/** file -> the shortest chain from a client entry that reaches it. */
const reached = new Map()
const queue = []

for (const entry of entries) {
  reached.set(entry, [entry])
  queue.push(entry)
}

while (queue.length > 0) {
  const file = queue.shift()
  const chain = reached.get(file)
  for (const spec of specsFor(file)) {
    const local = resolveLocal(spec, file)
    if (!local || reached.has(local)) continue
    reached.set(local, [...chain, local])
    queue.push(local)
  }
}

const findings = []
for (const [file, chain] of reached) {
  for (const spec of specsFor(file)) {
    const builtin = builtinName(spec)
    if (builtin) findings.push({ file, spec: builtin, chain })
  }
}

if (findings.length > 0) {
  for (const f of findings) {
    console.error(`\x1b[31mCLIENT GRAPH\x1b[0m ${rel(f.file)} imports \`${f.spec}\``)
    console.error('       reached from a client component by:')
    for (let i = 0; i < f.chain.length; i++) {
      console.error(`         ${i === 0 ? "'use client'  " : '           -> '}${rel(f.chain[i])}`)
    }
    console.error(`           -> ${f.spec}`)
  }
  console.error('')
  console.error(
    `\x1b[31m${findings.length} node builtin(s) reachable from the browser bundle.\x1b[0m`,
  )
  console.error('')
  console.error('`next build` fails on this with UnhandledSchemeError, naming a')
  console.error('module several hops from the component that caused it. Move the')
  console.error('builtin behind a module that carries `import \'server-only\'` and')
  console.error('is imported only by route handlers or server components, or make')
  console.error('the offending edge an `import type` if that is all it ever was.')
  process.exit(1)
}

console.log(
  `\x1b[32mok\x1b[0m   no node builtin reachable from ${entries.length} client ` +
    `components (${reached.size} modules in the browser graph)`,
)
