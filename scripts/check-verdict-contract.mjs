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

/**
 * THE AUDIT TABLE IS MODELLED TOO, and it did not used to be.
 *
 * `resolve()` alone touches one table, so the original stub could assume every
 * call was about an incident and key everything on `incidentId`. Closing a
 * player's other cases after a permanent ban goes through `closeWithVerdict`,
 * which writes an `incident.resolve` audit row per closure — and against the old
 * stub every one of those would have been filed under `undefined`, silently
 * overwriting the last. A check cannot drive the real writer if the real writer
 * touches a table the check pretends is not there.
 *
 * KEYED THE WAY THE REAL TABLE IS, `pk` + `ts`, WHICH IS THE POINT. Two audit
 * rows written in the same millisecond are one row in DynamoDB and the first is
 * gone. This Map does exactly that, so `no audit row was overwritten` below is a
 * real assertion about the console's own behaviour rather than a property of a
 * forgiving stub.
 */
const auditRows = new Map()
let auditPuts = 0

/** Reads are counted rather than logged: one assertion needs "it read nothing". */
const reads = { scan: 0 }

/** Which table a call names. Anything else stops the check rather than guessing. */
function tableOf(params) {
  const name = params.TableName ?? ''
  if (name.endsWith('incidents')) return 'incidents'
  if (name.endsWith('audit')) return 'audit'
  throw new Error(`this check does not model the table "${name}"`)
}

function storeFor(table) {
  return table === 'incidents' ? rows : auditRows
}

/** The primary key, as a Map key. Composite for audit, a bare id for incidents. */
function keyFor(table, o) {
  return table === 'incidents' ? o.incidentId : `${o.pk}#${o.ts}`
}

/**
 * A way for one test to be somebody else's bad luck.
 *
 * TWO OF THE FAILURE MODES THIS CHECK HAS TO COVER — an admin resolving a case
 * by hand mid-sweep, and the database refusing one write out of five — cannot be
 * produced by calling the console differently. They are things that happen
 * BETWEEN two of its calls, so the only honest place to stage them is inside the
 * database. Set this to a function and it runs before each update is evaluated;
 * it may mutate a row (a race) or throw (a failure).
 */
let beforeUpdate = null

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed')
    this.name = 'ConditionalCheckFailedException'
  }
}

globalThis.ddb = {
  async put(params) {
    const table = tableOf(params)
    const item = marshal(params.Item)
    writes.push({ op: 'put', table, params, touched: new Set(Object.keys(item)) })
    if (table === 'audit') auditPuts++
    storeFor(table).set(keyFor(table, item), item)
    return {}
  },

  async update(params) {
    const table = tableOf(params)
    const store = storeFor(table)
    const key = keyFor(table, params.Key ?? {})

    const record = { op: 'update', table, params, touched: new Set() }
    writes.push(record)

    if (beforeUpdate) beforeUpdate({ table, params, key, store })

    const existing = store.get(key)
    const row = existing ? structuredClone(existing) : {}

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
    store.set(key, row)
    return {}
  },

  async get(params) {
    const table = tableOf(params)
    return { Item: storeFor(table).get(keyFor(table, params.Key ?? {})) }
  },

  async scan(params) {
    reads.scan++
    return { Items: [...storeFor(tableOf(params)).values()] }
  },

  /**
   * `pk = :pk`, newest first, capped. What `audit.recent` asks for and nothing
   * else — an unrecognised KeyConditionExpression stops the check rather than
   * quietly answering a question it was not asked.
   */
  async query(params) {
    const table = tableOf(params)
    if (table !== 'audit') {
      throw new Error(`this check only models Query against the audit table`)
    }

    const expr = (params.KeyConditionExpression ?? '').trim()
    const m = /^pk\s*=\s*(:\w+)$/.exec(expr)
    if (!m) {
      throw new Error(`KeyConditionExpression not understood: "${expr}"`)
    }
    const pk = attrValue(m[1], params.ExpressionAttributeValues)

    const items = [...auditRows.values()]
      .filter((r) => r.pk === pk)
      .sort((a, b) => (params.ScanIndexForward === false ? b.ts - a.ts : a.ts - b.ts))
      .slice(0, params.Limit ?? Infinity)

    return { Items: items }
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

/**
 * THE COLLAPSING RULE, IMPORTED FOR REAL TOO, and it belongs in this file rather
 * than a check of its own. A permanent ban now writes an `incident.resolve` row
 * for every other case it closes; whether those rows make one ban read as one
 * ban on a moderator's profile is decided by this pure function, and the rows it
 * has to survive are the ones the section below genuinely produces. Asserting it
 * anywhere else would mean hand-writing the rows, which is how a check ends up
 * agreeing with itself.
 */
const { actionsTakenFrom } = await import('../src/lib/actionsTaken.ts')

/**
 * The audit log, for the one question the sweep made dangerous: whether the ban
 * is still on the profile of the person it banned. `forPlayer` takes the newest
 * fifty rows aimed at a player, and the sweep writes up to fifty rows aimed at
 * that same player a moment later.
 */
const auditLib = await import('../src/lib/audit.ts')

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
// 6. A permanent ban closes the player's other open cases.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE MONEY IS WHY THIS IS IN THIS FILE. Those closures carry a real `ban`
 * verdict — the owner ruled that a reporter who correctly flagged somebody who
 * turned out to warrant a permanent ban gets paid, even though the ban was
 * issued on a different case — and `payable` is decided by the game's reader, in
 * the other repository, out of the row this console writes. Every other property
 * below (only permanent bans, never the originating case, never somebody else's
 * player, one ban still reading as one ban) is a property of a write that is
 * irreversible: verdicts cannot be edited and incidents cannot be reopened, so
 * the first wrong sweep is permanent for every case it touches.
 */

const ADMIN = { license: 'license:admin', name: 'An Admin', discordId: null }

/** Open `n` pending cases about one player, in order. */
async function openFor(license, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(
      await incidents.open(
        openInput({ subjectLicense: license, subjectName: 'Subject' }),
      ),
    )
  }
  return out
}

const sweptRows = (list) => list.map((i) => rows.get(i.incidentId))

/** Every audit row written since the mark, in the order it was written. */
const auditSince = (n) => [...auditRows.values()].slice(n)

/** Swallow `console.error` while a failure is being staged on purpose. */
async function quietly(run) {
  const real = console.error
  const lines = []
  console.error = (...args) => lines.push(args[0])
  try {
    return { value: await run(), lines }
  } finally {
    console.error = real
  }
}

// ── The whole shape, on a ban issued from a case. ────────────────────────────

const PERMA = 'license:perma-subject'
const [origin, ...others] = await openFor(PERMA, 4)

// Somebody else, with a case open at the same moment. Nothing below may touch
// it: these closures cannot be undone, so "the right player" is not a detail.
const BYSTANDER = 'license:bystander-subject'
const [bystander] = await openFor(BYSTANDER, 1)

const auditMark = auditRows.size

// What /api/bans does first: close the case the ban was decided on, with the
// admin's own reason and no provenance — that closure IS the decision.
const originClose = await incidents.closeWithVerdict({
  incident: origin,
  actor: ADMIN,
  resolution: 'Aimbot, confirmed on capture',
  verdict: { action: 'ban', expiresAt: null },
})
check('originating case: closed', originClose.ok === true, JSON.stringify(originClose))

const sweepMark = auditRows.size
const swept = await incidents.closeOthersOnPermanentBan({
  ban: { license: PERMA, expiresAt: null },
  fromIncidentId: origin.incidentId,
  actor: ADMIN,
})

equal('permanent ban: it ran', swept.permanent, true)
equal('permanent ban: found the other three', swept.found, 3)
equal('permanent ban: closed all three', swept.closed, 3)
equal('permanent ban: nothing refused', swept.refused, 0)
equal('permanent ban: nothing failed', swept.failed, 0)
equal('permanent ban: nothing left over', swept.leftOpen, 0)

for (const row of sweptRows(others)) {
  equal('auto-closed: state', row.state, 'resolved')
  equal('auto-closed: verdict action', row.verdict?.action, 'ban')
  equal('auto-closed: permanent', row.verdict?.expiresAt, null)

  // ── The provenance is a SIBLING of the verdict. Inside it, it would be this
  // console adding a key to a map another repository documents the shape of.
  equal(
    'auto-closed: links back to the case the ban came from',
    row.closedByBan?.fromIncidentId,
    origin.incidentId,
  )
  check(
    'auto-closed: provenance is not inside the verdict map',
    !('closedByBan' in row.verdict) && !('fromIncidentId' in row.verdict),
    JSON.stringify(row.verdict),
  )
  const flattened = Object.keys(row).filter((k) => /^verdict.+/.test(k))
  check('auto-closed: verdict still not flattened', flattened.length === 0, flattened.join(', '))

  // ── The note. Not the exact words — those are the owner's to choose — but
  // that one was written, and that it does not carry an incident id into free
  // text somebody could copy out of it.
  check(
    'auto-closed: a resolution was written',
    typeof row.resolution === 'string' && row.resolution.length > 0,
    JSON.stringify(row.resolution),
  )
  check(
    'auto-closed: no incident id in the free text',
    !row.resolution.includes(origin.incidentId) && !row.resolution.includes(row.incidentId),
    row.resolution,
  )

  // ── WHAT THE MONEY HANGS ON, through the game's own reader.
  const p = projectVerdict(row)
  equal('auto-closed: the game calls it settled', p.settled, true)
  equal('auto-closed: the game reads a ban', p.action, 'ban')
  equal('auto-closed: the game reads it as permanent', p.expiresAt, null)
  equal('auto-closed: PAYABLE — the reporter was right', p.payable, true)
  equal('auto-closed: the reporter is told "banned"', p.word, 'banned')
  equal(
    'auto-closed: actionWasTaken agrees with payable',
    incidents.actionWasTaken(row.verdict),
    p.payable,
  )
}

// ── The originating case is closed once, by the admin, and not swept. ────────

const originRow = rows.get(origin.incidentId)
equal('originating case: keeps the admin\'s own words', originRow.resolution, 'Aimbot, confirmed on capture')
check(
  'originating case: carries no auto-closure provenance',
  originRow.closedByBan === undefined,
  JSON.stringify(originRow.closedByBan),
)
equal(
  'originating case: closed exactly once — opened, resolved, and nothing more',
  originRow.events.length,
  2,
)

// ── The other player is untouched. ──────────────────────────────────────────

equal('a different player\'s case is still pending', rows.get(bystander.incidentId).state, 'pending_review')

// ── ONE BAN STILL READS AS ONE BAN. ─────────────────────────────────────────
//
// The profile's "Actions taken" panel groups audit rows by `detail.incidentId`,
// so four closures naming four different incidents cannot be grouped with the
// ban at all — they have to be dropped, the way the enforcement kick is. These
// are the rows the console just wrote, run through the shipped rule.

const sweepAudit = auditSince(sweepMark)
equal('the sweep wrote one audit row per closure', sweepAudit.length, 3)
for (const row of sweepAudit) {
  equal('sweep audit row: action', row.action, 'incident.resolve')
  equal('sweep audit row: outcome', row.outcome, 'ok')
  equal('sweep audit row: says it was the ban being carried out', row.detail?.becauseOf, 'ban.issue')
  equal('sweep audit row: names the case it closed', typeof row.detail?.incidentId, 'string')
  equal('sweep audit row: carries the verdict', row.detail?.verdict, 'ban')
}
equal(
  'nothing the sweep wrote survives as an action in its own right',
  actionsTakenFrom(sweepAudit).length,
  0,
)

/**
 * The `ban.issue` row, in the shape /api/bans writes it — the one row in this
 * section this file authors rather than drives, because the route is a Next
 * handler and cannot be imported into a plain script. Everything it is grouped
 * WITH below is real.
 */
const banIssueRow = {
  ts: NOW,
  action: 'ban.issue',
  outcome: 'ok',
  targetLicense: PERMA,
  targetName: 'Subject',
  reason: 'Aimbot, confirmed on capture',
  detail: { expiresAt: null, permanent: true, incidentId: origin.incidentId },
}

const taken = actionsTakenFrom([banIssueRow, ...auditSince(auditMark)])
equal('one permanent ban plus four closures is ONE action taken', taken.length, 1)
equal('and the action is the ban', taken[0]?.action, 'ban.issue')
equal('linked to the case it was decided on', taken[0]?.incidentId, origin.incidentId)

// ── An audit row per closure, and not one of them overwritten. ───────────────
//
// `pk` + `ts` is the whole primary key, so rows written inside one millisecond
// are one row. Nothing else in this console wrote audit rows in a loop before.

equal('no audit row was overwritten by another', auditRows.size, auditPuts)

// ── A ban with no originating case: "on-demand". ────────────────────────────

const ONDEMAND = 'license:on-demand-subject'
const onDemandCases = await openFor(ONDEMAND, 2)

const onDemand = await incidents.closeOthersOnPermanentBan({
  ban: { license: ONDEMAND, expiresAt: null },
  fromIncidentId: null,
  actor: ADMIN,
})
equal('on-demand ban: closed both', onDemand.closed, 2)
for (const row of sweptRows(onDemandCases)) {
  check(
    'on-demand ban: the provenance is present',
    row.closedByBan !== undefined && row.closedByBan !== null,
    JSON.stringify(row.closedByBan),
  )
  // NULL, NOT ABSENT. "There was no case" is a fact the row states; a missing
  // key would leave the page unable to tell it from a link it failed to store.
  check(
    'on-demand ban: it names no case, explicitly',
    Object.prototype.hasOwnProperty.call(row.closedByBan, 'fromIncidentId') &&
      row.closedByBan.fromIncidentId === null,
    JSON.stringify(row.closedByBan),
  )
  equal('on-demand ban: still payable', projectVerdict(row).payable, true)
}

// ── A TEMPORARY ban does none of this. ──────────────────────────────────────

const TEMP = 'license:temp-subject'
const tempCases = await openFor(TEMP, 2)
const writesBefore = writes.length
const scansBefore = reads.scan

const temp = await incidents.closeOthersOnPermanentBan({
  ban: { license: TEMP, expiresAt: NOW + 7 * DAY },
  fromIncidentId: null,
  actor: ADMIN,
})

equal('temporary ban: not permanent', temp.permanent, false)
equal('temporary ban: found nothing, because it looked at nothing', temp.found, 0)
equal('temporary ban: wrote nothing', writes.length - writesBefore, 0)
equal('temporary ban: did not even read', reads.scan - scansBefore, 0)
for (const row of sweptRows(tempCases)) {
  equal('temporary ban: the case is still waiting for a human', row.state, 'pending_review')
  check('temporary ban: no verdict was invented', row.verdict === null, JSON.stringify(row.verdict))
}

// ── An ALREADY RESOLVED case is not touched. ────────────────────────────────

const MIXED = 'license:mixed-subject'
const [decided, stillOpen] = await openFor(MIXED, 2)
await incidents.closeWithVerdict({
  incident: decided,
  actor: ADMIN,
  resolution: 'Watched two matches from spectate — nothing unusual',
  verdict: { action: 'none' },
})

const mixed = await incidents.closeOthersOnPermanentBan({
  ban: { license: MIXED, expiresAt: null },
  fromIncidentId: null,
  actor: ADMIN,
})
equal('resolved cases are not candidates', mixed.found, 1)
equal('and the open one still closed', mixed.closed, 1)
equal('and nothing was refused, because nothing was attempted twice', mixed.refused, 0)

const decidedRow = rows.get(decided.incidentId)
equal('the earlier verdict stands', decidedRow.verdict?.action, 'none')
check(
  'the earlier closure did not grow provenance it never had',
  decidedRow.closedByBan === undefined,
  JSON.stringify(decidedRow.closedByBan),
)
equal('the earlier closure was not written over', decidedRow.events.length, 2)
equal('the open one closed', rows.get(stillOpen.incidentId).state, 'resolved')

// ── THE RACE: an admin closes one by hand in the same instant. ──────────────

const RACE = 'license:race-subject'
const [r1, r2, r3] = await openFor(RACE, 3)
const raceMark = auditRows.size

beforeUpdate = ({ table, params }) => {
  if (table !== 'incidents' || params.Key?.incidentId !== r2.incidentId) return
  // The other admin's write lands between this sweep reading the queue and
  // writing to this row. Their decision is already in the table.
  const row = rows.get(r2.incidentId)
  row.state = 'resolved'
  row.verdict = { action: 'none' }
  row.resolution = 'Watched a match, looked fine'
}

const raced = await incidents.closeOthersOnPermanentBan({
  ban: { license: RACE, expiresAt: null },
  fromIncidentId: null,
  actor: ADMIN,
})
beforeUpdate = null

equal('race: the other two closed', raced.closed, 2)
equal('race: the contested one was REFUSED, not failed', raced.refused, 1)
equal('race: nothing counted as a database failure', raced.failed, 0)

const racedRow = rows.get(r2.incidentId)
equal('race: the human\'s verdict stands', racedRow.verdict?.action, 'none')
equal('race: and their words stand', racedRow.resolution, 'Watched a match, looked fine')
check(
  'race: the refused write left no provenance behind',
  racedRow.closedByBan === undefined,
  JSON.stringify(racedRow.closedByBan),
)
equal('race: the other two really are closed', rows.get(r1.incidentId).state, 'resolved')
equal('race: and the third', rows.get(r3.incidentId).state, 'resolved')

const raceAudit = auditSince(raceMark)
equal('race: an audit row for every attempt, including the refused one', raceAudit.length, 3)
const refusedAudit = raceAudit.filter((r) => r.outcome === 'failed')
equal('race: the refusal is recorded rather than silent', refusedAudit.length, 1)
equal(
  'race: and it names the case it could not close',
  refusedAudit[0]?.detail?.incidentId,
  r2.incidentId,
)

// ── PARTIAL FAILURE: the third write of five is refused by the database. ────

const PARTIAL = 'license:partial-subject'
const partialCases = await openFor(PARTIAL, 5)
const doomed = partialCases[2]
const partialMark = auditRows.size

beforeUpdate = ({ table, params }) => {
  if (table !== 'incidents' || params.Key?.incidentId !== doomed.incidentId) return
  const e = new Error('Throughput exceeded')
  e.name = 'ProvisionedThroughputExceededException'
  throw e
}

const { value: partial, lines } = await quietly(() =>
  incidents.closeOthersOnPermanentBan({
    ban: { license: PARTIAL, expiresAt: null },
    fromIncidentId: null,
    actor: ADMIN,
  }),
)
beforeUpdate = null

equal('partial failure: it kept going', partial.closed, 4)
equal('partial failure: one failure counted', partial.failed, 1)
equal('partial failure: and it is not reported as a refusal', partial.refused, 0)
check(
  'partial failure: the operator log says so',
  lines.some((l) => typeof l === 'string' && l.includes('resolve failed')),
  JSON.stringify(lines),
)

const doomedRow = rows.get(doomed.incidentId)
equal('partial failure: the case it could not close is untouched', doomedRow.state, 'pending_review')
check(
  'partial failure: and half-written is not a state it can be in',
  doomedRow.verdict === null && doomedRow.closedByBan === undefined,
  JSON.stringify({ verdict: doomedRow.verdict, closedByBan: doomedRow.closedByBan }),
)

const partialAudit = auditSince(partialMark)
equal('partial failure: five attempts, five audit rows', partialAudit.length, 5)
const failedAudit = partialAudit.filter((r) => r.outcome === 'failed')
equal('partial failure: the one that did not land says so', failedAudit.length, 1)
equal(
  'partial failure: naming the case still open',
  failedAudit[0]?.detail?.incidentId,
  doomed.incidentId,
)

// ── VOLUME: a prolific cheater does not become an unbounded write. ──────────

const MANY = 'license:many-subject'
const manyCases = await openFor(MANY, incidents.AUTO_CLOSE_LIMIT + 2)

/**
 * The ban itself, written the way /api/bans writes it — through the real audit
 * writer, BEFORE the sweep, because that order is what the next assertion is
 * about. Everything the sweep writes lands after it and is therefore NEWER.
 */
await auditLib.begin({
  action: 'ban.issue',
  actor: ADMIN,
  targetLicense: MANY,
  targetName: 'Subject',
  reason: 'Aimbot, confirmed on capture',
  detail: { expiresAt: null, permanent: true },
})

const many = await incidents.closeOthersOnPermanentBan({
  ban: { license: MANY, expiresAt: null },
  fromIncidentId: null,
  actor: ADMIN,
})

equal('volume: found them all', many.found, incidents.AUTO_CLOSE_LIMIT + 2)
equal('volume: closed up to the cap', many.closed, incidents.AUTO_CLOSE_LIMIT)
equal('volume: and said what it left', many.leftOpen, 2)
equal(
  'volume: what it left is still in the queue, not lost',
  sweptRows(manyCases).filter((r) => r.state === 'pending_review').length,
  2,
)

/**
 * AND THE BAN IS STILL ON THEIR PROFILE.
 *
 * `audit.forPlayer` reads a bounded window of the log and takes the newest fifty
 * rows aimed at one player. Fifty closures written a moment after the ban are
 * fifty rows NEWER than it, so without a rule they would fill that window
 * exactly and push the `ban.issue` row out of it — leaving "Kicks and bans"
 * empty on the profile of somebody who had just been banned forever. This is the
 * assertion that would have caught that, driven through the real reader.
 */
const window = await auditLib.forPlayer(MANY)
const banRows = window.against.filter((r) => r.action === 'ban.issue')
equal('volume: the ban is still in the profile\'s window', banRows.length, 1)
check(
  'volume: and the closures did not crowd it out',
  window.against.every((r) => r.detail?.becauseOf !== 'ban.issue'),
  `${window.against.length} rows: ${window.against.map((r) => r.action).join(', ')}`,
)

// ── The write itself is still ONE conditional update. ───────────────────────
//
// The whole no-reopen rule is that `state` can only move once, and everything
// that describes a closure moves with it. A bulk close that reached the row in
// two writes would be a window in which a case is closed with a ban verdict and
// no sign of where the ban came from.

const sweepWrites = writes.filter(
  (w) => w.table === 'incidents' && w.op === 'update' && w.touched?.has('closedByBan'),
)
check('auto-closures happened at all', sweepWrites.length > 0, `${sweepWrites.length}`)
for (const w of sweepWrites) {
  check(
    'auto-close write: one update carries state, verdict and provenance',
    w.touched.has('state') && w.touched.has('verdict') && w.touched.has('closedByBan'),
    [...w.touched].join(', '),
  )
  check(
    'auto-close write: still conditional on the case being pending',
    typeof w.params?.ConditionExpression === 'string' &&
      w.params.ConditionExpression.includes(':pending'),
    w.params?.ConditionExpression,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Report.
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
  `verdict contract: ${assertions} assertions across ${CASES.length} verdicts and ` +
    'the permanent-ban sweep — the console\'s writes survive the game\'s reader',
)
