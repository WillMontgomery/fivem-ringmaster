/**
 * The verdict contract, driven end to end: this console's real write path into
 * the game server's real reader.
 *
 * WHAT BREAKS IF NOBODY CHECKS THIS. The game pays a report reward by reading
 * an incident row out of `ringmaster-incidents` and asking `projectVerdict()`
 * whether the case was decided and whether anything happened. This console is
 * the only thing that writes those rows. Rename `resolvedAt`, flatten `verdict`
 * into `verdictAction`, write an ISO string where a number was — nothing
 * crashes, nothing logs, no page changes. `payable` just quietly turns false
 * for every incident forever, and the first symptom is a player asking why they
 * never got their 250 Volts. Silence is the whole failure mode, which is why it
 * needs a gate rather than a code review.
 *
 * WHY THIS DOES NOT REIMPLEMENT EITHER SIDE, and why that is the point. A check
 * that builds the row it expects and asserts a reader likes it proves the check
 * agrees with itself. So:
 *
 *   1. `globalThis.ddb` is stubbed BEFORE src/lib/incidents.ts loads. The
 *      module's Proxy in src/lib/dynamo.ts constructs its client on first use
 *      and stops at `globalForDdb.ddb ??= create()`, so the stub is taken and no
 *      AWS call is ever attempted.
 *   2. The console's ACTUAL `open()` and `resolve()` run — the shipped
 *      functions, not a transcription of them.
 *   3. The `UpdateExpression` / `ConditionExpression` they emit are replayed
 *      onto an in-memory row by the miniature DynamoDB below.
 *   4. That row is handed to the game's ACTUAL `projectVerdict()`, imported from
 *      the gamemode checkout.
 *
 * Both halves are the shipped code. Nothing in this file knows what the row is
 * supposed to look like; it only knows what the two sides have to agree ABOUT.
 *
 * ═══ THE ONE THING THIS FILE CHOOSES, AND THE TRADE-OFF IN IT ═══
 *
 * `projectVerdict` lives in the OTHER repository, and there is no good way to
 * reach across. Three options, all bad in different directions:
 *
 *   · Copy verdict.js here. This is what check-ban-rule.mjs does with the ban
 *     rule, and it says why: bans.ts drags the AWS SDK into a plain node script.
 *     That reason does not apply here — we are already loading incidents.ts and
 *     the SDK with it — and without that excuse a copy is simply a THIRD
 *     representation of the contract, which is the disease this check exists to
 *     treat. Rejected.
 *   · A hardcoded relative path. Breaks the moment either checkout moves, and
 *     breaks in CI, which clones one repo.
 *   · Locate it, and be loud when it is not there. Chosen.
 *
 * WHAT "LOUD" MEANS HERE IS DIFFERENT IN THE TWO PLACES IT RUNS, and that
 * asymmetry is deliberate:
 *
 *   · On a developer's machine with no gamemode checkout, this WARNS in a way
 *     that is hard to miss and exits 0. Hard-failing would mean `npm run verify`
 *     is unrunnable without cloning a second repository, and a check that stops
 *     unrelated work is a check somebody deletes.
 *   · In CI (`$CI`), a missing checkout is a HARD FAILURE. CI is the gate, and a
 *     gate that skips itself is not a gate — it is a green tick that means
 *     nothing. .github/workflows/verify.yml clones the gamemode into
 *     `.gamemode/` and points `BR_GAMEMODE_DIR` at it precisely so this can
 *     never be the quiet path.
 *
 * That workflow file carries a note saying adding a check should not require
 * editing it. This check breaks that rule knowingly: the note assumes every
 * check's inputs are inside this repo, and the entire value of this one is that
 * half of it is not.
 *
 * RUN THROUGH `tsx`, like check-xp-curve.mjs, because it imports a .ts module
 * and Node's own type stripping differs between 20 and 24.
 */

import { existsSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// 1. Find the game server's reader.
// ─────────────────────────────────────────────────────────────────────────────

const READER_SUBPATH = join('js-src', 'br_ddb', 'src', 'verdict.js')

/**
 * `BR_GAMEMODE_DIR` WINS OUTRIGHT AND HAS NO FALLBACK, which is the difference
 * between an override and a hint. Somebody who names a checkout is telling this
 * check which copy of the reader they mean — quietly running against a
 * different one instead would be the check lying about what it verified, in a
 * file whose entire subject is two things quietly disagreeing. A pointer at
 * nothing is a misconfiguration, not an absent checkout, so it fails everywhere
 * rather than warning.
 *
 * Otherwise: the two names the gamemode checkout goes by beside this one — the
 * GitHub repository name, and the working directory name it has locally.
 * Relative paths resolve against the process cwd, which for an npm script is
 * the repo root.
 */
const override = process.env.BR_GAMEMODE_DIR
const candidateDirs = override
  ? [resolvePath(override)]
  : [resolvePath('..', 'fivem-br-gamemode'), resolvePath('..', 'fivem-royale-m9')]

const readerPath = candidateDirs
  .map((dir) => resolvePath(dir, READER_SUBPATH))
  .find((p) => existsSync(p))

if (!readerPath) {
  const tried = candidateDirs.map((d) => `    ${resolvePath(d, READER_SUBPATH)}`).join('\n')

  if (override) {
    console.error('')
    console.error('  verdict contract: BR_GAMEMODE_DIR POINTS AT NOTHING.')
    console.error('')
    console.error(`    BR_GAMEMODE_DIR=${override}`)
    console.error('')
    console.error('  Naming a checkout is an instruction about which copy of the game\'s')
    console.error('  reader to check against, so this does not fall back to a sibling')
    console.error('  directory and does not skip. Expected to find:')
    console.error(tried)
    console.error('')
    console.error('  Unset it to look beside this repo instead.')
    console.error('')
    process.exit(1)
  }

  if (process.env.CI) {
    console.error('')
    console.error('  verdict contract: THE GAME SERVER\'S READER IS MISSING IN CI.')
    console.error('')
    console.error('  This check is the only thing asserting that what this console writes')
    console.error('  is what the game server reads. Skipping it in CI would make the gate')
    console.error('  green without checking anything, so it fails instead.')
    console.error('')
    console.error('  Looked for js-src/br_ddb/src/verdict.js under:')
    console.error(tried)
    console.error('')
    console.error('  .github/workflows/verify.yml should be cloning WillMontgomery/')
    console.error('  fivem-br-gamemode into .gamemode/ and setting BR_GAMEMODE_DIR.')
    console.error('  If that step was removed, restore it rather than removing this.')
    console.error('')
    process.exit(1)
  }

  console.warn('')
  console.warn('  ###########################################################')
  console.warn('  ##  VERDICT CONTRACT NOT CHECKED — no gamemode checkout  ##')
  console.warn('  ###########################################################')
  console.warn('')
  console.warn('  Nothing verified that this console writes what the game reads.')
  console.warn('  If report rewards stop paying, this is the check that would have')
  console.warn('  caught it and did not run.')
  console.warn('')
  console.warn('  Looked for js-src/br_ddb/src/verdict.js under:')
  console.warn(tried)
  console.warn('')
  console.warn('  Clone the gamemode beside this repo, or set BR_GAMEMODE_DIR.')
  console.warn('  CI fails rather than warns — see the header of this file.')
  console.warn('')
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. A DynamoDB small enough to fit in a check.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EVERY UNSUPPORTED CONSTRUCT THROWS RATHER THAN BEING IGNORED, and that is the
 * single most important property of this section. A condition it cannot parse
 * must never evaluate to "true, probably" — an emulator that shrugs is an
 * emulator that passes a check nobody is running. If `resolve()` is ever
 * rewritten into something the parser below does not understand, this check
 * stops with a parse error naming the construct, which is a loud way of saying
 * "somebody changed the write path, come and look".
 */

/** Mirrors the doc client's `removeUndefinedValues: true` and nothing else. */
function marshal(value, path = 'item') {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path}: DynamoDB cannot store ${value}`)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v, i) => marshal(v, `${path}[${i}]`))
  if (t === 'object' && (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      // Dropped, not stored as null — see marshallOptions in src/lib/dynamo.ts.
      if (v === undefined) continue
      out[k] = marshal(v, `${path}.${k}`)
    }
    return out
  }
  // A Date, a Map, a class instance. The doc client would coerce it into
  // something; the contract says these fields are plain data, so say so here
  // instead of quietly modelling a coercion.
  throw new Error(
    `${path}: not plain data (${Object.prototype.toString.call(value)}) — ` +
      'the incident row must be scalars, arrays and plain objects',
  )
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Split on commas that are not inside a function call's parentheses. */
function splitTop(expr) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function attrName(token, names) {
  if (!token.startsWith('#')) return token
  const real = names?.[token]
  if (real === undefined) throw new Error(`unbound expression name ${token}`)
  return real
}

function attrValue(token, values) {
  if (!token.startsWith(':')) {
    throw new Error(`only :placeholders are supported on the right-hand side, got ${token}`)
  }
  if (!(token in (values ?? {}))) throw new Error(`unbound expression value ${token}`)
  return marshal(values[token], token)
}

/**
 * `attribute_exists(x) AND #s = :v`. Nothing else, on purpose — see above.
 * Returns true/false; throws on anything it cannot evaluate honestly.
 */
function conditionHolds(row, expr, names, values) {
  for (const term of expr.split(/\s+AND\s+/i).map((t) => t.trim())) {
    let ok
    const fn = /^(attribute_exists|attribute_not_exists)\(\s*([^)\s]+)\s*\)$/i.exec(term)
    const cmp = /^([#\w.]+)\s*(=|<>)\s*(:[\w]+)$/.exec(term)

    if (fn) {
      const present = attrName(fn[2], names) in row
      ok = fn[1].toLowerCase() === 'attribute_exists' ? present : !present
    } else if (cmp) {
      const eq = same(row[attrName(cmp[1], names)], attrValue(cmp[3], values))
      ok = cmp[2] === '=' ? eq : !eq
    } else {
      throw new Error(`ConditionExpression term not understood: "${term}"`)
    }

    if (!ok) return false
  }
  return true
}

/**
 * Applies a SET-only UpdateExpression to `row` in place.
 * Returns the set of top-level attributes it assigned.
 */
function applyUpdate(row, expr, names, values) {
  const trimmed = expr.trim()
  if (!/^SET\s/i.test(trimmed)) {
    throw new Error(`UpdateExpression does not start with SET: "${trimmed}"`)
  }
  if (/\s(REMOVE|ADD|DELETE)\s/i.test(trimmed)) {
    throw new Error(`UpdateExpression uses a clause this check cannot model: "${trimmed}"`)
  }

  const touched = new Set()
  for (const assignment of splitTop(trimmed.slice(4))) {
    const m = /^([#\w]+)\s*=\s*(.+)$/.exec(assignment)
    if (!m) throw new Error(`assignment not understood: "${assignment}"`)

    const name = attrName(m[1], names)
    const rhs = m[2].trim()

    const append = /^list_append\(\s*([#\w]+)\s*,\s*(:[\w]+)\s*\)$/.exec(rhs)
    if (append) {
      const base = row[attrName(append[1], names)]
      if (!Array.isArray(base)) {
        throw new Error(`list_append onto a non-list attribute ${attrName(append[1], names)}`)
      }
      row[name] = [...base, ...attrValue(append[2], values)]
    } else {
      row[name] = attrValue(rhs, values)
    }
    touched.add(name)
  }
  return touched
}

/** The rows, and a log of everything the console asked the database to do. */
const rows = new Map()
const writes = []

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed')
    this.name = 'ConditionalCheckFailedException'
  }
}

globalThis.ddb = {
  async put(params) {
    const item = marshal(params.Item)
    writes.push({ op: 'put', params, touched: new Set(Object.keys(item)) })
    rows.set(item.incidentId, item)
    return {}
  },

  async update(params) {
    const id = params.Key?.incidentId
    const existing = rows.get(id)
    const row = existing ? structuredClone(existing) : {}

    const record = { op: 'update', params, touched: new Set() }
    writes.push(record)

    if (params.ConditionExpression) {
      const holds = conditionHolds(
        row,
        params.ConditionExpression,
        params.ExpressionAttributeNames,
        params.ExpressionAttributeValues,
      )
      if (!holds) {
        record.refused = true
        throw new ConditionalCheckFailedException()
      }
    }

    record.touched = applyUpdate(
      row,
      params.UpdateExpression,
      params.ExpressionAttributeNames,
      params.ExpressionAttributeValues,
    )
    rows.set(id, row)
    return {}
  },

  async get(params) {
    return { Item: rows.get(params.Key?.incidentId) }
  },

  async scan() {
    return { Items: [...rows.values()] }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Enough environment for src/lib/env.ts to parse, and no more.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NONE OF THIS IS A CREDENTIAL and none of it is reachable — every AWS call is
 * intercepted above. env() validates the whole schema on first touch and
 * `tables.incidents` touches it, so the shape has to be satisfied even though
 * the values are never used for anything.
 *
 * SPELLED `REPLACE_ME_...` BECAUSE THE SECRET SCANNER SAYS SO. check-secrets.mjs
 * flags an AUTH_SECRET or an INGEST_SECRET with a value beside it, and it is
 * right to: this repo is public, and the scanner cannot tell a throwaway in a
 * check from the real thing. Its own advice is to make a placeholder LOOK like
 * one rather than teach the rule an exception, so these do. AUTH_SECRET still
 * has to clear the schema's 32-character minimum, and INGEST_SECRET its 16.
 */
for (const [key, value] of Object.entries({
  DISCORD_CLIENT_ID: 'REPLACE_ME_not_a_real_client_id',
  DISCORD_CLIENT_SECRET: 'REPLACE_ME_not_a_real_client_secret',
  DISCORD_GUILD_ID: 'REPLACE_ME_not_a_real_guild_id',
  DISCORD_ADMIN_ROLE_ID: 'REPLACE_ME_not_a_real_role_id',
  AUTH_SECRET: 'REPLACE_ME_not_a_real_signing_key_for_a_contract_check',
  AUTH_URL: 'http://localhost:3000',
  INGEST_SECRET: 'REPLACE_ME_not_a_real_ingest_value',
  DDB_TABLE_PREFIX: 'contract-check-',
})) {
  process.env[key] ??= value
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Both sides, imported for real.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DYNAMIC, NOT STATIC, and the ordering is the reason. A static `import` is
 * hoisted above every statement in this file, so the stub and the environment
 * above would land after src/lib/incidents.ts had already loaded. Today that
 * happens to be survivable — dynamo.ts builds its client lazily — but relying on
 * a detail of another module's initialisation is exactly the kind of thing that
 * breaks later, silently, in a check whose whole job is to not do that.
 */
const incidents = await import('../src/lib/incidents.ts')
const { projectVerdict } = await import(pathToFileURL(readerPath).href)

// ─────────────────────────────────────────────────────────────────────────────
// 5. The contract.
// ─────────────────────────────────────────────────────────────────────────────

const failures = []
let assertions = 0

function check(label, ok, detail = '') {
  assertions++
  if (!ok) failures.push(detail ? `${label} — ${detail}` : label)
}

function equal(label, got, want) {
  check(label, same(got, want), `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
}

const NOW = 1_700_000_000_000
const DAY = 86_400_000

let seq = 0
function openInput(extra = {}) {
  seq++
  return {
    kind: 'report',
    category: 'cheating',
    subjectLicense: `license:subject-${seq}`,
    subjectName: `Subject ${seq}`,
    reporterLicense: `license:reporter-${seq}`,
    reporterName: `Reporter ${seq}`,
    summary: 'Reported for cheating',
    ...extra,
  }
}

/** Open a case, resolve it with `verdict`, hand the stored row to the game. */
async function roundTrip(verdict) {
  const incident = await incidents.open(openInput())
  const before = writes.length

  const result = await incidents.resolve({
    incidentId: incident.incidentId,
    byLicense: 'license:admin',
    byName: 'An Admin',
    resolution: 'Reviewed the capture.',
    verdict,
  })

  return {
    incident,
    result,
    resolveWrites: writes.slice(before),
    row: rows.get(incident.incidentId),
    get projected() {
      return projectVerdict(rows.get(incident.incidentId))
    },
  }
}

/**
 * The four verdicts the console can write, and what the game must make of each.
 *
 * `payable` IS THE FIELD THE MONEY HANGS ON. Everything else here is context for
 * a failure message; that column is the one whose value is 250 Volts.
 */
const CASES = [
  {
    label: 'temporary ban',
    verdict: { action: 'ban', expiresAt: NOW + 7 * DAY },
    want: { action: 'ban', expiresAt: NOW + 7 * DAY, payable: true, word: 'banned' },
  },
  {
    // Property 8. `expiresAt: null` means permanent, and a permanent ban is the
    // most serious outcome there is — a reader that treats the null as "no
    // expiry recorded, therefore no ban" withholds payment on exactly the
    // reports that most deserve it.
    label: 'permanent ban (expiresAt: null)',
    verdict: { action: 'ban', expiresAt: null },
    want: { action: 'ban', expiresAt: null, payable: true, word: 'banned' },
  },
  {
    label: 'kick',
    verdict: { action: 'kick' },
    want: { action: 'kick', expiresAt: null, payable: true, word: 'kicked' },
  },
  {
    label: 'no action',
    verdict: { action: 'none' },
    want: { action: 'none', expiresAt: null, payable: false, word: null },
  },
]

const ACTIONS = ['ban', 'kick', 'none']

for (const { label, verdict, want } of CASES) {
  const t = await roundTrip(verdict)
  const { row } = t
  const p = t.projected

  check(`${label}: resolve() succeeded`, t.result.ok === true, JSON.stringify(t.result))
  if (!t.result.ok) continue

  // ── Property 6: ONE conditional update carries state and verdict together.
  // Two writes would mean a window in which the incident is resolved and the
  // verdict has not landed, and the game reads `settled` off `state` alone.
  check(
    `${label}: state and verdict cost exactly one write`,
    t.resolveWrites.length === 1,
    `${t.resolveWrites.length} writes: ${t.resolveWrites.map((w) => w.op).join(', ')}`,
  )
  const write = t.resolveWrites[0]
  check(`${label}: it is an update, not a put`, write?.op === 'update', write?.op)
  check(
    `${label}: it is conditional`,
    typeof write?.params?.ConditionExpression === 'string' &&
      write.params.ConditionExpression.length > 0,
  )
  check(`${label}: that one update sets state`, write?.touched?.has('state') === true)
  check(`${label}: that same update sets verdict`, write?.touched?.has('verdict') === true)

  // ── Property 1.
  equal(`${label}: row.state`, row.state, 'resolved')
  equal(`${label}: reader sees state`, p.state, 'resolved')
  equal(`${label}: reader calls it settled`, p.settled, true)
  equal(`${label}: reader found the row`, p.found, true)

  // ── Property 2. An ISO string here reads back as null and the game loses the
  // only timestamp it has for the decision.
  check(
    `${label}: resolvedAt is a number on the row`,
    typeof row.resolvedAt === 'number',
    `${typeof row.resolvedAt} ${JSON.stringify(row.resolvedAt)}`,
  )
  equal(`${label}: reader reads resolvedAt back`, p.resolvedAt, row.resolvedAt)

  // ── Property 3. Nested map, never flattened.
  check(
    `${label}: verdict is a nested map`,
    row.verdict !== null && typeof row.verdict === 'object' && !Array.isArray(row.verdict),
    JSON.stringify(row.verdict),
  )
  const flattened = Object.keys(row).filter((k) => /^verdict.+/.test(k))
  check(
    `${label}: verdict is not flattened onto the row`,
    flattened.length === 0,
    `found ${flattened.join(', ')}`,
  )

  // ── Property 4.
  check(
    `${label}: verdict.action is one of ${ACTIONS.join('/')}`,
    ACTIONS.includes(row.verdict?.action),
    JSON.stringify(row.verdict?.action),
  )
  equal(`${label}: reader reads action`, p.action, want.action)

  // ── Property 5. Present if and only if the action is a ban.
  const carriesExpiry = Object.prototype.hasOwnProperty.call(row.verdict ?? {}, 'expiresAt')
  equal(`${label}: expiresAt present iff action is ban`, carriesExpiry, want.action === 'ban')
  equal(`${label}: reader reads expiresAt`, p.expiresAt, want.expiresAt)

  // ── What the money hangs on, plus the sentence shown to the reporter.
  equal(`${label}: payable`, p.payable, want.payable)
  equal(`${label}: word`, p.word, want.word)

  // The two sides derive "was an action taken" separately. They must land in
  // the same place — the console's own helper against the game's `payable`.
  equal(
    `${label}: actionWasTaken() agrees with the reader's payable`,
    incidents.actionWasTaken(row.verdict),
    p.payable,
  )

  // ── Property 6, second half: it cannot run twice. There is no other write in
  // the module that can reach `verdict`, so this refusal IS the immutability.
  const frozen = structuredClone(row)
  const again = await incidents.resolve({
    incidentId: t.incident.incidentId,
    byLicense: 'license:other-admin',
    byName: 'Another Admin',
    resolution: 'Actually, no.',
    verdict: { action: 'none' },
  })
  equal(`${label}: a second resolve is refused`, again.ok, false)

  // Named attributes rather than two whole rows: when this fails, the useful
  // sentence is "verdict and resolvedAt moved", not four hundred characters of
  // JSON with the difference buried in it.
  const after = rows.get(t.incident.incidentId)
  const moved = [...new Set([...Object.keys(frozen), ...Object.keys(after)])].filter(
    (k) => !same(frozen[k], after[k]),
  )
  check(
    `${label}: the refused resolve left the row untouched`,
    moved.length === 0,
    `these attributes moved: ${moved.join(', ')}`,
  )
}

// ── Property 7. Absent is not 'none'. ────────────────────────────────────────
//
// Two rows carry no verdict and neither may be read as "an admin decided
// nothing": one the system auto-resolved, and one written before the field
// existed. The game must answer "do not know" — `action: null` — which is a
// different answer from `action: 'none'` even though both pay nobody.

const auto = await incidents.open(openInput({ autoResolved: true }))
const autoRow = rows.get(auto.incidentId)

equal('auto-resolved: state', autoRow.state, 'resolved')
check(
  'auto-resolved: the console wrote no verdict rather than {action:"none"}',
  autoRow.verdict === null || autoRow.verdict === undefined,
  JSON.stringify(autoRow.verdict),
)
const autoP = projectVerdict(autoRow)
equal('auto-resolved: reader answers "do not know"', autoP.action, null)
equal('auto-resolved: settled — nothing more is coming', autoP.settled, true)
equal('auto-resolved: not payable', autoP.payable, false)
equal('auto-resolved: no player-facing word', autoP.word, null)

// The distinction itself, stated as a comparison rather than left implicit in
// two separate expectations above.
const noneP = projectVerdict({ state: 'resolved', resolvedAt: NOW, verdict: { action: 'none' } })
check(
  'absent verdict is DISTINGUISHABLE from an explicit "none"',
  autoP.action !== noneP.action,
  `both read as ${JSON.stringify(autoP.action)}`,
)

/**
 * A row from before the field existed. SYNTHESISED, not written — by definition
 * the current console cannot produce one, and there is no backfill. It is the
 * shape sitting in the table today, so the reader has to survive it.
 */
const legacy = structuredClone(autoRow)
delete legacy.verdict
const legacyP = projectVerdict(legacy)
equal('legacy row (no verdict attribute): action', legacyP.action, null)
equal('legacy row: settled', legacyP.settled, true)
equal('legacy row: not payable', legacyP.payable, false)

// ── A case still waiting for a human, and a case that is not there. ──────────

const pending = await incidents.open(openInput())
const pendingRow = rows.get(pending.incidentId)
equal('pending: state', pendingRow.state, 'pending_review')
check(
  'pending: no verdict is invented at open time',
  pendingRow.verdict === null || pendingRow.verdict === undefined,
  JSON.stringify(pendingRow.verdict),
)
const pendingP = projectVerdict(pendingRow)
equal('pending: not settled — the caller keeps waiting', pendingP.settled, false)
equal('pending: not payable', pendingP.payable, false)

const missingP = projectVerdict(null)
equal('missing row: found', missingP.found, false)
equal('missing row: not settled — an absent row is not a decision', missingP.settled, false)
equal('missing row: not payable', missingP.payable, false)

// ─────────────────────────────────────────────────────────────────────────────
// 6. Report.
// ─────────────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error('')
  for (const f of failures) console.error(`  FAIL  ${f}`)
  console.error('')
  console.error(`verdict contract: ${failures.length} of ${assertions} assertions failed.`)
  console.error('')
  console.error('  The console writes incident verdicts and the game server reads them to')
  console.error('  pay report rewards. They no longer agree, which does not crash anything')
  console.error('  and does not log anything — it just stops paying.')
  console.error('')
  console.error('  Console side: src/lib/incidents.ts (IncidentVerdict, resolve, open)')
  console.error(`  Game side:    ${readerPath}`)
  process.exit(1)
}

console.log(
  `verdict contract: ${assertions} assertions across ${CASES.length} verdicts — ` +
    'the console\'s writes survive the game\'s reader',
)
