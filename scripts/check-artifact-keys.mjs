/**
 * The artifact key contract: the console derives exactly the keys the game wrote.
 *
 * ═══ WHAT BREAKS IF NOBODY CHECKS THIS ═══
 *
 * There is no list. The game cannot append to an incident row after filing it
 * — its grant is `PutItem` conditional on the id being absent — and this console
 * holds `s3:GetObject` with deliberately no `ListBucket`, so it can neither be
 * told which frames a case has nor ask the bucket. It finds them by BUILDING
 * THE NINE KEYS ITSELF and keeping the ones that answer.
 *
 * That makes the key format a cross-repo contract with no wire protocol behind
 * it and nothing that would ever raise its voice. Change the extension to
 * `.png`, drop the zero-padding, move the prefix, raise the cap on one side —
 * nothing crashes, nothing logs, no test fails. Every probe returns 403
 * (which is what a missing object looks like without ListBucket, see
 * `lib/artifactStore`), every incident shows an empty carousel, and an empty
 * carousel is DOCUMENTED AS NORMAL. The feature would be silently dead and the
 * page would look exactly as designed. That is the whole reason this is a gate
 * and not a code review.
 *
 * ═══ HOW IT CHECKS ═══
 *
 * Both sides for real, neither reimplemented here:
 *
 *   · the game's `artifactNames()` and `ARTIFACT_MAX_INDEX`, imported from the
 *     gamemode checkout — the same function `br_ddb` calls to build the key it
 *     uploads under;
 *   · this console's `artifactKey()` and `ARTIFACT_MAX_INDEX`, imported from
 *     `src/lib/artifacts.ts` — the same function the probe and the image route
 *     call.
 *
 * Nothing in this file knows what a key is supposed to look like. It only knows
 * the two sides have to produce the same string.
 *
 * ═══ LOCATING THE GAMEMODE ═══
 *
 * Identical policy to `check-verdict-contract.mjs`, deliberately, because
 * having two cross-repo checks disagree about where the other repo is would be
 * its own bug: `BR_GAMEMODE_DIR` wins outright with no fallback, CI hard-fails
 * without a checkout, and a developer's machine warns loudly and exits 0.
 * `.github/workflows/verify.yml` already sets `BR_GAMEMODE_DIR` on the whole
 * `npm run verify` step, so this check needed no change there.
 *
 * RUN THROUGH `tsx`, because it imports a .ts module.
 */

import { existsSync } from 'node:fs'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ARTIFACT_INDEXES,
  ARTIFACT_MAX_INDEX,
  ARTIFACT_PREFIX,
  artifactKey,
} from '../src/lib/artifacts.ts'

const WRITER_SUBPATH = join('js-src', 'br_ddb', 'src', 'artifacts.js')

const override = process.env.BR_GAMEMODE_DIR
const candidateDirs = override
  ? [resolvePath(override)]
  : [resolvePath('..', 'fivem-br-gamemode'), resolvePath('..', 'fivem-royale-m9')]

const writerPath = candidateDirs
  .map((dir) => resolvePath(dir, WRITER_SUBPATH))
  .find((p) => existsSync(p))

if (!writerPath) {
  const tried = candidateDirs
    .map((d) => `    ${resolvePath(d, WRITER_SUBPATH)}`)
    .join('\n')

  if (override) {
    console.error('')
    console.error('  artifact keys: BR_GAMEMODE_DIR POINTS AT NOTHING.')
    console.error('')
    console.error(`    BR_GAMEMODE_DIR=${override}`)
    console.error('')
    console.error('  Naming a checkout is an instruction about which copy of the game\'s')
    console.error('  writer to check against, so this does not fall back to a sibling')
    console.error('  directory and does not skip. Expected to find:')
    console.error(tried)
    console.error('')
    process.exit(1)
  }

  if (process.env.CI) {
    console.error('')
    console.error('  artifact keys: THE GAME SERVER\'S WRITER IS MISSING IN CI.')
    console.error('')
    console.error('  This check is the only thing asserting that the keys this console')
    console.error('  probes are the keys the game uploaded under. Skipping it in CI')
    console.error('  would make the gate green without checking anything.')
    console.error('')
    console.error('  Looked for js-src/br_ddb/src/artifacts.js under:')
    console.error(tried)
    console.error('')
    console.error('  .github/workflows/verify.yml should be cloning WillMontgomery/')
    console.error('  fivem-br-gamemode into .gamemode/ and setting BR_GAMEMODE_DIR.')
    console.error('')
    process.exit(1)
  }

  console.warn('')
  console.warn('  #########################################################')
  console.warn('  ##  ARTIFACT KEYS NOT CHECKED — no gamemode checkout   ##')
  console.warn('  #########################################################')
  console.warn('')
  console.warn('  Nothing verified that this console probes the keys the game wrote.')
  console.warn('  If every incident shows an empty carousel forever, this is the check')
  console.warn('  that would have caught it and did not run.')
  console.warn('')
  console.warn('  Looked for js-src/br_ddb/src/artifacts.js under:')
  console.warn(tried)
  console.warn('')
  console.warn('  Clone the gamemode beside this repo, or set BR_GAMEMODE_DIR.')
  console.warn('  CI fails rather than warns — see the header of this file.')
  console.warn('')
  process.exit(0)
}

const game = await import(pathToFileURL(writerPath).href)

// ─────────────────────────────────────────────────────────────────────────────
// Assertions.
// ─────────────────────────────────────────────────────────────────────────────

let assertions = 0
const failures = []

function check(what, ok, saw) {
  assertions += 1
  if (!ok) failures.push(`${what}${saw === undefined ? '' : `  (saw: ${saw})`}`)
}

function equal(what, actual, expected) {
  check(what, Object.is(actual, expected), `${actual} != ${expected}`)
}

/**
 * THE CAP IS THE NAMESPACE. If the game ever writes a 10th frame and this
 * console still probes nine, the tenth is unreachable and nothing says so.
 */
equal(
  'the cap is the same number on both sides',
  ARTIFACT_MAX_INDEX,
  game.ARTIFACT_MAX_INDEX,
)
equal('the prefix is the same string', ARTIFACT_PREFIX, game.ARTIFACT_PREFIX)

/**
 * A REAL v4 UUID, because both sides check the shape and a fixture like
 * "incident-1" would be refused by both for the same reason and prove nothing.
 */
const ID = '0f9c1e2a-3b4c-4d5e-8f60-112233445566'

check(
  'the console enumerates exactly 1..max',
  ARTIFACT_INDEXES.length === ARTIFACT_MAX_INDEX &&
    ARTIFACT_INDEXES.every((n, i) => n === i + 1),
  ARTIFACT_INDEXES.join(','),
)

for (const index of ARTIFACT_INDEXES) {
  const theirs = game.artifactNames(ID, index, 'webp')
  check(
    `game builds a key for index ${index}`,
    !theirs.error,
    theirs.error,
  )
  equal(
    `index ${index}: the console derives the key the game wrote`,
    artifactKey(ID, index),
    theirs.key,
  )
}

/**
 * THE REFUSALS MATTER AS MUCH AS THE MATCHES. `artifactKey` is reached from a
 * query string, and a key is a path — anything it accepts, the image route will
 * sign a URL for. These are the inputs that must never produce one.
 */
const rejected = [
  ['index 0', ID, 0],
  ['index above the cap', ID, ARTIFACT_MAX_INDEX + 1],
  ['a fractional index', ID, 1.5],
  ['a NaN index', ID, Number.NaN],
  ['a non-v4 uuid', '0f9c1e2a-3b4c-1d5e-8f60-112233445566', 1],
  ['a path traversal', '../../etc/passwd', 1],
  ['a key fragment with a slash', `${ID}/../${ID}`, 1],
  ['an empty id', '', 1],
  ['an uppercased uuid', ID.toUpperCase(), 1],
]

for (const [what, id, index] of rejected) {
  check(`refused: ${what}`, artifactKey(id, index) === null, artifactKey(id, index))
  // The game refuses the same inputs, and a divergence here means one side
  // would accept something the other never produces.
  check(
    `game also refuses: ${what}`,
    Boolean(game.artifactNames(id, index, 'webp').error),
    JSON.stringify(game.artifactNames(id, index, 'webp')),
  )
}

/**
 * ═══ THE CONSOLE NEVER LISTS THE BUCKET ═══
 *
 * `RingmasterAppRole` holds `s3:GetObject` and no `ListBucket` so that this
 * console can never enumerate other players' screenshots — a design property,
 * not an accident of what has been written so far. A `ListObjectsV2Command`
 * added later would fail at runtime with AccessDenied on a page nobody tests
 * against real AWS, so the grep is here instead.
 */
const sources = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(p)
  }
})('src')

/**
 * THE SDK'S CLASS NAMES, NOT THE IAM ACTION NAMES. Matching a bare `ListBucket`
 * would fire on every comment explaining that this console deliberately does not
 * have that grant — including the two that make the design legible. Every S3
 * command class ends in `Command`, and prose does not.
 */
const listers = sources.filter((p) =>
  /List(Objects|ObjectsV2|Buckets|ObjectVersions|Parts)Command\b/.test(
    readFileSync(p, 'utf8'),
  ),
)
check(
  'nothing under src/ lists the bucket',
  listers.length === 0,
  listers.join(', '),
)

/**
 * ═══ THE S3 SDK STAYS OUT OF THE BROWSER ═══
 *
 * `lib/artifactStore` imports `@aws-sdk/client-s3`. A `'use client'` file that
 * imported it would ship the SDK to the browser — several hundred kilobytes to
 * draw a carousel — and nothing would fail; the page would just get heavier.
 * Components get the probe's RESULT as a prop, never the probe.
 */
const clientImporters = sources
  .filter((p) => p.includes(join('src', 'components')))
  .filter((p) => /from ['"]@\/lib\/artifactStore['"]/.test(readFileSync(p, 'utf8')))
check(
  'no component imports the S3 half',
  clientImporters.length === 0,
  clientImporters.join(', '),
)

// ─────────────────────────────────────────────────────────────────────────────
// Report.
// ─────────────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error('')
  for (const f of failures) console.error(`  FAIL  ${f}`)
  console.error('')
  console.error(`artifact keys: ${failures.length} of ${assertions} assertions failed.`)
  console.error('')
  console.error('  The game uploads a frame to a key it builds; this console finds that')
  console.error('  frame by building the same key. They no longer agree, which does not')
  console.error('  crash anything and does not log anything — every incident just shows')
  console.error('  an empty carousel, and empty is documented as normal.')
  console.error('')
  console.error('  Console side: src/lib/artifacts.ts (artifactKey, ARTIFACT_MAX_INDEX)')
  console.error(`  Game side:    ${writerPath}`)
  process.exit(1)
}

console.log(
  `artifact keys: ${assertions} assertions across ${ARTIFACT_MAX_INDEX} indexes ` +
    `and ${rejected.length} refusals — the console probes what the game wrote`,
)
