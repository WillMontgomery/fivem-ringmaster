#!/usr/bin/env node
/**
 * Every check file on disk is in the `verify` chain, and every step in the chain
 * names a file that exists (#53).
 *
 *   node scripts/check-verify-inventory.mjs
 *
 * ═══ THE DEFECT: THE GATE IS A HAND-WRITTEN LIST AND NOTHING COUNTS IT ═══
 *
 * `package.json`'s `verify` is one string chaining thirty-odd steps with `&&`.
 * It is the whole gate: `.github/workflows/verify.yml` deliberately collapsed to
 * a single `npm run verify` so that CI and a laptop cannot disagree, which was
 * the right fix and which also made that one string the single point of failure
 * for every check in this repository.
 *
 * Nothing compares the string to the disk. So a new `scripts/check-*.mjs` or
 * `src/lib/*.check.ts` that nobody remembers to wire in never runs, anywhere,
 * and every gate stays green while the property it was written to hold goes
 * unheld. The file is in the repository, it is in the diff, somebody reviewed
 * it, and it executes on no machine.
 *
 * ═══ AND IT IS NOT HYPOTHETICAL: IT HAS BITTEN THREE TIMES ═══
 *
 * Twice the repository wrote it down itself.
 *
 *   `src/lib/discordRole.check.ts` was landed by an agent that did not own
 *   `package.json` in its checkout, so its header says, in capitals, "IT IS NOT
 *   YET IN `verify`, AND THAT IS THE GAP", spells out the two lines somebody
 *   else had to add, and calls a check nothing runs "this repository's signature
 *   failure mode". That is a comment doing a gate's job, and it only worked
 *   because a human read it.
 *
 *   `.github/workflows/verify.yml` records the other direction: `verify` gained
 *   the ban-rule and xp-curve checks while the workflow still listed steps by
 *   hand, "so for a while CI was greener than the repo". Both of those pin a
 *   rule that exists twice, once here and once in Lua, which is exactly the kind
 *   of check that must not quietly stop running.
 *
 * The third was 2026-09-15: `scripts/check-strip-weapon.mjs` was added and had
 * to be hand-wired. It was, so nothing broke. Forgetting that one line would
 * have shipped a gate that never ran, on the first anticheat case this estate
 * ever produced, and nothing anywhere would have said so.
 *
 * All 33 check files were wired on the day this was written. They were wired by
 * vigilance. This makes them wired by a rule.
 *
 * ═══ THERE WAS NOTHING TO EXTEND ═══
 *
 * The only directory walk in this repository that sees `.check.ts` files
 * deliberately looks away from them: `scripts/check-client-graph.mjs` carries
 * `const IGNORED = /\.check\.tsx?$/` and is right to, since check files are
 * plain `tsx` scripts that no bundler ever sees and including them would report
 * every check that reads a fixture with `node:fs`. That file is untouched.
 *
 * ═══ THE SELF-REFERENCE, WHICH IS THE POINT ═══
 *
 * This file is itself a `scripts/check-*.mjs`, so its own first rule requires it
 * to appear in the `verify` chain, and that is what proves the rule holds rather
 * than merely being asserted. Delete `npm run check:inventory` from the chain
 * and the next run of the chain does not notice, because this is no longer in
 * it. Delete it and run this file directly and it reports itself, by name, as a
 * check file that no step invokes. The gate is not exempt from the gate.
 *
 * ═══ WHAT IT DOES NOT PROVE ═══
 *
 * That a wired check checks anything. A file with its assertions commented out
 * is listed here as present and correct. This holds one property and one only:
 * the chain and the disk agree about which files exist.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Anchored to this file rather than to `process.cwd()`, so the answer does not
 * depend on where the chain happened to be invoked from. A check whose result
 * changes with the working directory is a check that can be made to pass.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every path this file prints or compares is repo-relative with forward slashes. */
function rel(full) {
  return relative(ROOT, full).split(sep).join('/')
}

/**
 * A token from a step, in the same frame of reference the disk side reports in.
 *
 * BOTH SIDES GO THROUGH `rel()` BECAUSE THEY ARE COMPARED BY STRING, AND A STEP
 * MAY SPELL A PATH ANY LEGAL WAY. Folding separators alone was not enough:
 * `node ./scripts/check-secrets.mjs` is ordinary npm-script spelling, and with
 * only the separators patched it made this gate announce that
 * `scripts/check-secrets.mjs` is run by nothing, then instruct the maintainer to
 * add a `"check:secrets": "node scripts/check-secrets.mjs"` entry that was
 * already sitting one line above, invoking that exact file. It failed closed, so
 * nothing shipped unguarded, but the diagnosis was wrong and the suggested fix
 * was a no-op, which is a bad thirty minutes for whoever hits it. Backslashes
 * are folded before `resolve()` rather than after, because `resolve()` only
 * treats them as separators on Windows and CI is Linux.
 */
function repoPath(token) {
  return rel(resolve(ROOT, token.split('\\').join('/')))
}

/**
 * The gate cannot run at all. Distinct from a finding, and never reported as one.
 *
 * `advice` exists because not every unrunnable state is an incomplete checkout:
 * a gate that has been narrowed until its two halves disagree is also unable to
 * compare anything, and telling that caller to re-clone would send them looking
 * in the wrong place.
 */
function broken(reason, advice) {
  console.error(`verify inventory: ${reason}`)
  console.error(
    advice ??
      'This check could not compare anything, which is the state it exists to ' +
        'refuse. Run it from a complete checkout of the repository.',
  )
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. What the chain runs.
// ─────────────────────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

const verify = scripts.verify
if (typeof verify !== 'string' || verify.trim() === '') {
  broken('package.json has no `verify` script, so there is no chain to check.')
}

/** `npm run foo`, tolerating extra spacing and trailing npm flags. */
const NPM_RUN = /^npm\s+run\s+(\S+)/

/**
 * ONE LIST OF EXTENSIONS, BECAUSE THIS FILE BUILDS TWO LISTS OF CHECK FILES AND
 * COMPARES THEM BY STRING. A gate whose halves disagree about what a check file
 * is has a hole exactly the width of the disagreement, and these two did
 * disagree: the chain side accepted every extension below while the disk side
 * read only `.mjs`. Three unwired files planted at once, as
 * `scripts/probe/check-hidden.mjs`, `scripts/check-hidden-ts.ts` and
 * `scripts/check-hidden-cjs.cjs`, drew `35 check files, all wired` and exited 0,
 * which is the precise failure this file was written to make impossible.
 *
 * A TypeScript check under `scripts/` is the next case and not a hypothetical:
 * `check:xpcurve`, `check:contrast`, `check:chips` and `check:corroboration`
 * already run `scripts/*.mjs` files through `tsx`, so this repository is writing
 * TypeScript-ish checks in `scripts/` today and only the extension is holding
 * the line.
 */
const RUNNABLE_EXT = 'mjs|cjs|js|jsx|ts|tsx'

/**
 * A token that names something to execute. Extension-based on purpose: a step
 * runs `tsx src/lib/x.check.ts` or `node scripts/x.mjs`, and the runner, its
 * flags and its environment are not files this cares about.
 */
const RUNS_A_FILE = new RegExp(`\\.(${RUNNABLE_EXT})$`)

/** What a check file is called, on each side of the tree. */
const SCRIPT_CHECK = new RegExp(`^check-.+\\.(${RUNNABLE_EXT})$`)
const SRC_CHECK = /\.check\.tsx?$/

/**
 * ═══ THE GATE CHECKS ITSELF BEFORE IT CHECKS THE TREE ═══
 *
 * Both defects below were SILENT, and neither can be caught by the real tree:
 * there is no `scripts/check-*.ts` and no step spelled `./scripts/...` today, so
 * narrowing either rule back would pass unnoticed exactly as it did the first
 * time. The tree is the wrong witness for a rule the tree does not yet exercise,
 * so name the shapes directly and let a narrowing be a red gate.
 */
for (const ext of RUNNABLE_EXT.split('|')) {
  if (SCRIPT_CHECK.test(`check-probe.${ext}`)) continue
  broken(
    `a step may run check-probe.${ext} but the disk side would not count it as ` +
      'a check file, so the two halves disagree and an unwired check can hide ' +
      'in the gap.',
    'Both halves read RUNNABLE_EXT on purpose. A pattern here was narrowed ' +
      'past it, and widening it back is the fix.',
  )
}

for (const [spelling, want] of [
  ['scripts/check-probe.mjs', 'scripts/check-probe.mjs'],
  ['./scripts/check-probe.mjs', 'scripts/check-probe.mjs'],
  ['scripts\\check-probe.mjs', 'scripts/check-probe.mjs'],
  ['src/lib/../lib/probe.check.ts', 'src/lib/probe.check.ts'],
]) {
  const got = repoPath(spelling)
  if (got === want) continue
  broken(
    `a step naming \`${spelling}\` resolves to \`${got}\` and not \`${want}\`, ` +
      'so the chain side and the disk side are in different frames of reference ' +
      'and this gate would blame a file that is wired.',
    'Every path compared here goes through repoPath() or rel(). Restore that.',
  )
}

const problems = []
const invoked = new Map()
const bare = []

/**
 * Resolve one command string to the files it runs, following `npm run` into the
 * `scripts` block.
 *
 * IT RECURSES BECAUSE A SCRIPT ENTRY MAY ITSELF BE A CHAIN. `build` already is
 * (`npm run check:secrets && next build`), so assuming one step is one command
 * would be an assumption this repository has already broken once. `trail` is the
 * cycle guard: a script that runs itself would otherwise hang the gate, and a
 * gate that hangs is worse than one that fails.
 */
function collect(command, via, trail) {
  for (const part of command.split('&&').map((s) => s.trim()).filter(Boolean)) {
    const run = NPM_RUN.exec(part)
    if (run) {
      const name = run[1]
      if (trail.includes(name)) {
        problems.push({
          kind: 'cycle',
          detail: `\`${trail.join(' -> ')} -> ${name}\` runs itself.`,
        })
        continue
      }
      const body = scripts[name]
      if (typeof body !== 'string') {
        problems.push({
          kind: 'missing-script',
          detail:
            `\`${part}\` names a script \`${name}\` that package.json does not ` +
            'define, so the chain stops there.',
        })
        continue
      }
      collect(body, name, [...trail, name])
      continue
    }

    const files = part
      .split(/\s+/)
      .filter((token) => token !== '' && !token.startsWith('-'))
      .filter((token) => RUNS_A_FILE.test(token))

    if (files.length === 0) {
      // `tsc --noEmit` and `next lint` name no file, and are legitimate steps.
      bare.push(part)
      continue
    }
    for (const file of files) {
      const key = repoPath(file)
      if (!invoked.has(key)) invoked.set(key, { via, step: part })
    }
  }
}

collect(verify, 'verify', ['verify'])

if (invoked.size === 0) {
  broken(
    `the \`verify\` chain resolved to 0 files (${bare.length} step(s) named none).`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. What is on disk.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WALKED RATHER THAN GLOBBED AS `src/lib/*.check.ts` OR READ FLAT AS `scripts/`,
 * which are the shapes of today's tree and not rules. Every check currently sits
 * directly in `src/lib/` or directly in `scripts/`, but a subdirectory is
 * precisely where an unwired one would hide, and a gate whose blind spot is "one
 * level down" is a gate with a blind spot. `.tsx` is included on the `src/` side
 * for the same reason: a component check would be one.
 *
 * ONE WALKER SERVES BOTH HALVES BECAUSE THEY WERE ONCE TWO AND DRIFTED. `src/`
 * was widened to this walk and `scripts/` was left reading one directory deep,
 * so `scripts/probe/check-hidden.mjs` was invisible to the inventory while
 * `src/lib/probe/hidden.check.ts` was caught. Two walkers is two chances to
 * narrow one of them, and the narrowing is silent in exactly the half nobody
 * looked at.
 */
function walk(dir, matches, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, matches, out)
    else if (matches.test(entry.name)) out.push(rel(full))
  }
  return out
}

if (!existsSync(join(ROOT, 'scripts'))) broken('there is no scripts/ directory here.')
if (!existsSync(join(ROOT, 'src'))) broken('there is no src/ directory here.')

const fromScripts = walk(join(ROOT, 'scripts'), SCRIPT_CHECK)
const fromSrc = walk(join(ROOT, 'src'), SRC_CHECK)

/**
 * GUARDED ONE HALF AT A TIME, NOT ON THE UNION. A single `onDisk.length === 0`
 * only fires when BOTH halves come back empty, so an empty `scripts/` hiding
 * behind a healthy `src/` passed: the gate printed a confident `16 check files,
 * all wired`, exited 0, and had silently stopped inventorying nineteen files.
 * That is reachable without anybody editing this file, since `scripts/` still
 * exists and satisfies the guard above. The printed count is the only signal
 * that anything changed, and nobody reads a passing line.
 *
 * It is also what makes the walk above provable. No `.check.ts` sits directly in
 * `src/`, so a walker that stopped recursing would return nothing here and turn
 * this gate red, rather than quietly reporting on half a tree.
 */
if (fromScripts.length === 0) {
  broken(
    'found 0 check files under scripts/, which cannot be true in this ' +
      'repository and means the search is wrong rather than the tree.',
  )
}

if (fromSrc.length === 0) {
  broken(
    'found 0 check files under src/, which cannot be true in this repository ' +
      'and means the search is wrong rather than the tree.',
  )
}

const onDisk = [...fromScripts, ...fromSrc].sort()

// ─────────────────────────────────────────────────────────────────────────────
// 3. Both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** `scripts/check-strip-weapon.mjs` -> `check:stripweapon`, the house style. */
function suggestedName(file) {
  const base = file.split('/').pop() ?? file
  const stem = base
    .replace(/^check-/, '')
    .replace(/\.check\.tsx?$/, '')
    // The shared list, not `.mjs` alone: the disk side now reports every
    // extension a step can run, and a hard-coded `.mjs` here would spell the
    // suggested script name `check:hiddentsts` for `scripts/check-hidden-ts.ts`.
    .replace(RUNS_A_FILE, '')
  return `check:${stem.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`
}

for (const file of onDisk) {
  if (invoked.has(file)) continue
  const name = suggestedName(file)
  const runner = file.endsWith('.mjs') ? 'node' : 'tsx'
  problems.push({
    kind: 'unwired',
    detail:
      `${file} is a check file that no step in \`verify\` runs, so it runs on ` +
      'no machine.',
    fix: [
      `add  "${name}": "${runner} ${file}"  to package.json's scripts`,
      `then append  && npm run ${name}  to the verify chain`,
      runner === 'node' ? 'use tsx instead of node if it imports TypeScript' : null,
    ].filter(Boolean),
  })
}

for (const [file, { via, step }] of invoked) {
  if (existsSync(join(ROOT, file))) continue
  problems.push({
    kind: 'gone',
    detail: `\`${via}\` runs \`${step}\`, and ${file} is not there.`,
    fix: [
      'restore the file, or delete both the step from the verify chain and the',
      `"${via}" entry from package.json's scripts`,
    ],
  })
}

// ─────────────────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error(`verify inventory: ${problems.length} problem(s).\n`)
  for (const problem of problems) {
    console.error(`  ${problem.detail}`)
    for (const line of problem.fix ?? []) console.error(`      ${line}`)
    console.error('')
  }
  console.error(
    'The verify chain is hand-written and is the entire gate, on a laptop and ' +
      'in CI. A check nobody wires in never runs and nothing goes red. See ' +
      'issue #53.',
  )
  process.exit(1)
}

console.log(
  `verify inventory: ${onDisk.length} check files, all wired; ` +
    `${invoked.size} file(s) named by the chain, all present ` +
    `(${bare.length} step(s) run no file of ours)`,
)
