/**
 * A corroboration is a corroboration on the timeline, and not an admin's note.
 *
 * ═══ WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT ═══
 *
 * The owner, 2026-08-29: "Seems corroboration doesn't show on the incident
 * timeline in ringmaster."
 *
 * It was showing. Every link in the chain worked: `br_core` raises
 * `br:ringmaster:corroborate`, `br_ringmaster` puts `incident_corroborated` on
 * the outbox, `api/ingest` applies it, `incidents.corroborate` appends to
 * `events`, `mergeTimeline` keeps it and `IncidentTimeline` draws it. The row
 * reached the page. It reached the page saying **"Note"**, because
 * `corroborate()` wrote `kind: 'note'` — the same kind an admin's typed sentence
 * gets, the same label, the same marker. The only thing on the row that hinted
 * where it came from was `byName: 'System'` in the meta line underneath.
 *
 * So the console recorded corroboration and displayed none, and every gate in
 * both repositories was green while it did. THAT is why this file exists rather
 * than a line in a code review:
 *
 *   · The gamemode's `incident notice surface` gate says "corroboration is none
 *     of them" and is about the IN-GAME notice surface — one sender of the
 *     report hint, one emitter of `br:incident:filed`, one caller of
 *     `br:ddb:putIncident`. It has no opinion about this list.
 *   · The gamemode's `timeline entry kinds` gate pins Lua's kinds against
 *     `close.js`, which projects `matchTimeline`. `close.js` says it in its own
 *     words — "NOTHING HERE TOUCHES `events`". Different attribute, different
 *     writer, different grant.
 *   · This console's `check:timeline` had FIXTURES for the bug: rows reading
 *     `{ kind: 'note', byName: 'System', text: '3 refusals' }` are corroborations
 *     modelled as notes, and every assertion about them passed.
 *
 * Three suites agreeing with a defect, none of them wrong about its own subject.
 * The unclaimed ground was the one sentence below.
 *
 * ═══ WHAT IT ASSERTS, AND WHY IT DRIVES THE REAL WRITER ═══
 *
 * The shipped `corroborate()` and `note()` are called for real, against a
 * DynamoDB small enough to fit in a check, and the row they produce is handed to
 * the REAL render helpers — `mergeTimeline`, `labelFor`, `CONSOLE_EVENT_LABEL`,
 * `isCaseBracket`, `isResolution`. Nothing here restates what the row should
 * look like; it only knows what the writer and the renderer have to agree ABOUT.
 *
 * The load-bearing assertion is section 3's first case: the two writers must not
 * produce the same kind. Written the other way round — "corroborate writes
 * 'corroborated'" — it would pass against a renderer that dropped the kind on the
 * floor, which is half the failure it is here to prevent.
 *
 * A PLAIN SCRIPT, matching check-ban-rule.mjs and check-chip-suppression.mjs:
 * this repo has no test framework. Run through `tsx`, like
 * check-verdict-contract.mjs, because it imports .ts modules.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. A DynamoDB small enough to fit in a check.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ONLY WHAT THIS WRITE PATH USES, AND EVERYTHING ELSE THROWS. Both functions
 * under test issue exactly one shape — `SET events = list_append(events, :ev)`
 * guarded by `attribute_exists(incidentId)`. A stub that shrugged at an
 * expression it did not understand would keep passing after somebody rewrote the
 * write, which is the failure this whole file is about.
 */
const rows = new Map()
const calls = []

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed')
    this.name = 'ConditionalCheckFailedException'
  }
}

function applyUpdate(row, expr, values) {
  const m = /^SET\s+(\w+)\s*=\s*list_append\(\s*(\w+)\s*,\s*(:\w+)\s*\)$/.exec(
    expr.trim(),
  )
  if (!m) {
    throw new Error(
      `UpdateExpression not understood: "${expr}". This check models the one ` +
        'shape corroborate() and note() emit; if the write changed, reshape ' +
        'this rather than loosening it.',
    )
  }
  const [, target, base, placeholder] = m
  if (!(placeholder in (values ?? {}))) {
    throw new Error(`unbound expression value ${placeholder}`)
  }
  const existing = row[base]
  if (!Array.isArray(existing)) {
    throw new Error(`list_append onto a non-list attribute "${base}"`)
  }
  row[target] = [...existing, ...values[placeholder]]
}

globalThis.ddb = {
  async update(params) {
    calls.push(params)
    const key = params.Key?.incidentId
    const row = rows.get(key)

    // `attribute_exists(incidentId)` — the only condition either function sends.
    if (params.ConditionExpression) {
      if (params.ConditionExpression.trim() !== 'attribute_exists(incidentId)') {
        throw new Error(
          `ConditionExpression not understood: "${params.ConditionExpression}"`,
        )
      }
      if (!row) throw new ConditionalCheckFailedException()
    }

    applyUpdate(row, params.UpdateExpression, params.ExpressionAttributeValues)
    return {}
  },
  async put() {
    throw new Error('this check does not model put()')
  },
  async get() {
    throw new Error('this check does not model get()')
  },
  async scan() {
    throw new Error('this check does not model scan()')
  },
  async query() {
    throw new Error('this check does not model query()')
  },
}

/**
 * The env schema, satisfied and nothing more. Same values and same reasoning as
 * check-verdict-contract.mjs: `tables.incidents` is a getter over `env()`, so
 * importing the module at all requires these to parse. AUTH_SECRET must clear 32
 * characters and INGEST_SECRET 16.
 */
for (const [key, value] of Object.entries({
  DISCORD_CLIENT_ID: 'REPLACE_ME_not_a_real_client_id',
  DISCORD_CLIENT_SECRET: 'REPLACE_ME_not_a_real_client_secret',
  DISCORD_GUILD_ID: 'REPLACE_ME_not_a_real_guild_id',
  DISCORD_ADMIN_ROLE_ID: 'REPLACE_ME_not_a_real_role_id',
  AUTH_SECRET: 'REPLACE_ME_not_a_real_signing_key_for_a_contract_check',
  AUTH_URL: 'http://localhost:3000',
  INGEST_SECRET: 'REPLACE_ME_not_a_real_ingest_value',
  DDB_TABLE_PREFIX: 'corroboration-check-',
})) {
  process.env[key] ??= value
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Both halves, imported for real.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DYNAMIC, NOT STATIC. A static import is hoisted above the stub and the
 * environment above, and this check would then be asserting against a module
 * that had already built a real AWS client. Same reasoning as
 * check-verdict-contract.mjs states at greater length.
 */
const incidents = await import('../src/lib/incidents.ts')
const {
  CONSOLE_EVENT_LABEL,
  isCaseBracket,
  isResolution,
  mergeTimeline,
} = await import('../src/lib/matchTimeline.ts')
const { labelFor } = await import('../src/lib/labels.ts')

let failed = 0
let ran = 0

function check(label, ok, detail) {
  ran++
  if (ok) return
  failed++
  console.error(`  FAIL  ${label}`)
  if (detail !== undefined) {
    console.error(`        got: ${JSON.stringify(detail)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The two writers, driven for real.
// ─────────────────────────────────────────────────────────────────────────────

const CASE = 'incident-under-test'
const OPENED = 1_700_000_000_000
const MIN = 60_000

/**
 * THE ROW AS THE GAME WRITES IT, not as this file would like it. `br_ddb`'s
 * `incident.js` puts a single `opened` event on every new case, and that list is
 * what `list_append` appends onto — a check that started from `events: []` would
 * not notice a write that needs `if_not_exists`.
 */
rows.set(CASE, {
  incidentId: CASE,
  state: 'pending_review',
  openedAt: OPENED,
  events: [
    { at: OPENED, kind: 'opened', byLicense: 'license:reporter', byName: 'Marla' },
  ],
})

const wroteCorroboration = await incidents.corroborate({
  incidentId: CASE,
  at: OPENED + MIN,
  text: '8 refusals this match · last: TOO_FAR · worst: high',
})

const wroteNote = await incidents.note({
  incidentId: CASE,
  byLicense: 'license:admin',
  byName: 'Preview Admin',
  text: 'Watched two matches from spectate.',
})

check('corroborate() reported success', wroteCorroboration === true, wroteCorroboration)
check('note() reported success', wroteNote === true, wroteNote)

const stored = rows.get(CASE).events
check('both writes landed on the row', stored.length === 3, stored.length)

const corroboration = stored[1]
const adminNote = stored[2]

/**
 * ═══ THE ONE THAT MATTERS ═══
 *
 * Two different things that happened to a case must not arrive on the timeline
 * as the same kind. Stated as a DIFFERENCE rather than as a literal on purpose:
 * pinning the string `'corroborated'` would still pass if the renderer threw the
 * kind away, and pinning only the renderer would still pass if both writers
 * agreed on one kind. The pair is the contract.
 */
check(
  'a corroboration and an admin note are not the same kind',
  corroboration.kind !== adminNote.kind,
  { corroboration: corroboration.kind, note: adminNote.kind },
)

check(
  'the admin note is still a note',
  adminNote.kind === 'note',
  adminNote.kind,
)

/**
 * WHO WROTE IT IS NOT WHAT DISTINGUISHES IT, and this is the assertion that says
 * so. `byName: 'System'` was the ONLY thing separating a corroboration from a
 * note on the old page, and it is not a distinction a reader can be asked to
 * make — the console writes `System` on several things. The kind carries the
 * fact now; this check fails if somebody removes the kind and leans on the name
 * again.
 */
check(
  'the corroboration is attributed to the system, and that is not the only signal',
  corroboration.byName === 'System' &&
    corroboration.byLicense === null &&
    corroboration.kind !== 'note',
  { byName: corroboration.byName, kind: corroboration.kind },
)

check(
  'the corroboration keeps the text the ingest route built',
  corroboration.text === '8 refusals this match · last: TOO_FAR · worst: high',
  corroboration.text,
)

check(
  'the corroboration keeps the instant it was given, not a fresh clock',
  corroboration.at === OPENED + MIN,
  corroboration.at,
)

// ─────────────────────────────────────────────────────────────────────────────
// 4. And the renderer, also for real.
// ─────────────────────────────────────────────────────────────────────────────

const merged = mergeTimeline(rows.get(CASE).events, [])

check(
  'nothing was dropped on the way to the list',
  merged.length === 3,
  merged.map((r) => r.event?.kind),
)

const rendered = merged.map((r) => labelFor(CONSOLE_EVENT_LABEL, r.event.kind))

/**
 * THE WHOLE POINT, AS A STRING AN ADMIN WOULD READ. The corroboration row and
 * the note row must not print the same word. `labelFor` humanises a kind no map
 * names, so this passes with no entry added to `CONSOLE_EVENT_LABEL` — the word
 * is derived, not authored.
 */
check(
  'the corroboration and the note do not print the same word',
  rendered[1] !== rendered[2],
  rendered,
)

check(
  'the corroboration prints something rather than nothing',
  typeof rendered[1] === 'string' && rendered[1].trim() !== '',
  rendered[1],
)

/**
 * IT IS NOT AN EDGE OF THE CASE AND IT DID NOT DECIDE ANYTHING. Both predicates
 * answer false for a kind they do not recognise, which is the behaviour that
 * makes widening the set free — but "it happens to be false today" and "it is
 * checked" are different things, and a corroboration wearing a red dot or a
 * verdict chip would be the console claiming the case was opened or closed by
 * the cheater carrying on.
 */
check(
  'a corroboration is not a bracket of the case',
  !isCaseBracket(corroboration),
)
check(
  'a corroboration did not close the case',
  !isResolution(corroboration),
)

/** And the rows that ARE the ends of the case still are. */
check(
  'the opening is still a bracket',
  isCaseBracket(stored[0]) && !isResolution(stored[0]),
)

// ─────────────────────────────────────────────────────────────────────────────
// 5. History is not rewritten, and a missing case is not an error.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ROWS WRITTEN BEFORE THIS CHANGE STAY `note` AND MUST STILL RENDER. There is no
 * backfill: telling an old corroboration from an admin's note would mean
 * guessing from `byName`, which is the guess this change exists to stop anybody
 * needing to make. What is asserted is only that the old shape is not broken by
 * the new one.
 */
const legacy = { at: OPENED + 30_000, kind: 'note', byLicense: null, byName: 'System', text: '3 refusals' }
check(
  'a corroboration stored under the old kind still renders as a note',
  labelFor(CONSOLE_EVENT_LABEL, legacy.kind) === CONSOLE_EVENT_LABEL.note &&
    !isCaseBracket(legacy) &&
    !isResolution(legacy),
  labelFor(CONSOLE_EVENT_LABEL, legacy.kind),
)

/**
 * THE DOORBELL BEATING THE WRITE IS NOT A FAILURE. A corroboration for a case
 * that does not exist means the event arrived before the game's PutItem landed,
 * or that PutItem failed. The corroboration is redundant by definition — that is
 * why it rides the lossy channel — so it returns false and writes nothing.
 */
const orphan = await incidents.corroborate({
  incidentId: 'no-such-case',
  at: OPENED + 2 * MIN,
  text: 'still happening',
})
check('a corroboration for an unknown case is refused, not thrown', orphan === false, orphan)
check('and it left no row behind', rows.has('no-such-case') === false)

/**
 * THE WRITE IS STILL AN APPEND ONTO THE CONSOLE'S OWN ATTRIBUTE. The game's
 * DynamoDB grant is an attribute allowlist that does not include `events`, and
 * this console's half of that contract is that it only ever appends. A write
 * that started assigning `events` outright, or touching `state`/`verdict`, would
 * be a different agreement between the two repositories.
 */
for (const params of calls) {
  check(
    `every write is a guarded append onto events (${params.UpdateExpression})`,
    params.UpdateExpression.trim() === 'SET events = list_append(events, :ev)' &&
      params.ConditionExpression.trim() === 'attribute_exists(incidentId)',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. The wire still lands here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE END OF THE CHAIN THIS FILE CANNOT DRIVE. `api/ingest/route.ts` is a Next
 * route handler; importing it drags the framework in for one branch. What
 * matters is only that the game's event kind still reaches this function, so it
 * is read as source — the same technique `check:timeline` uses on
 * `IncidentTimeline.tsx`, and for the same reason: the alternative is asserting
 * nothing about it at all.
 *
 * It failed once already, in the other direction — the route did not exist and
 * `incident_corroborated` reached nothing. Its own comment says so: "THESE HAD
 * NO CONSUMER AT ALL."
 */
const { readFileSync } = await import('node:fs')
const routeSource = readFileSync(
  new URL('../src/app/api/ingest/route.ts', import.meta.url),
  'utf8',
)

/**
 * COMMENTS ARE STRIPPED FIRST, AND THIS FILE LEARNED THAT THE HARD WAY. The
 * first version of these two greps ran against the raw source and PASSED a
 * mutation that renamed the branch to `incident_seen` — because the route's own
 * comment block names `incident_corroborated` twice while explaining that it
 * once had no consumer. The check was matching the prose that describes the
 * wire rather than the wire.
 *
 * `check:timeline` strips block comments for exactly this reason before asking
 * whether `IncidentTimeline.tsx` spells the owner's words itself. Line comments
 * go too, because the branch this is about sits under one.
 */
const route = routeSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

check(
  "the ingest route still keys on the game's `incident_corroborated`",
  /['"]incident_corroborated['"]/.test(route),
)
check(
  'and still hands it to incidents.corroborate',
  /incidents\.corroborate\(/.test(route),
)

// ─────────────────────────────────────────────────────────────────────────────

if (failed) {
  console.error(`\ncorroboration: ${failed} of ${ran} case(s) failed.`)
  console.error(
    'A corroboration must reach the incident timeline as its own kind — not as ' +
      "an admin's note wearing `byName: 'System'`. See src/lib/incidents.ts.",
  )
  process.exit(1)
}

console.log(
  `corroboration: ${ran} cases — the write path is driven for real, the row it ` +
    'produces is rendered by the real helpers, and a corroboration is not a note',
)
