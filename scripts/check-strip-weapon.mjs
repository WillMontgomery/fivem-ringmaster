/**
 * A weapon strip says WHICH WEAPON.
 *
 * ═══ WHAT WENT WRONG, AND WHY EVERY OTHER GATE WAS GREEN ═══
 *
 * The owner, 2026-09-15, on the first real case this estate produced: a player
 * in a firetruck drew 149 weapon strips and an anticheat case, and the case
 * could not say what had been taken out of his hand. "which does not show
 * WEAPON_ or VEHICLE_WEAPON_".
 *
 * Nothing was missing from the row. `br_lib/shared/incident_build.lua` puts the
 * hash on every strip entry and says why in its own words: the number is "the
 * whole content of the finding -- there is no label for a weapon the gamemode
 * has never heard of, so the number the cheat actually used is what an admin
 * gets". `close.js` carries it through `timelineEntry`, the filing path reuses
 * that same function, `weaponPart` reads it, and `mergeTimeline` keeps the row.
 *
 * `IncidentTimeline` dropped it. The renderer built a weapon for `kind ===
 * 'kill'` and nothing else, so every strip row on every case read `Weapon strip`
 * and a timestamp. The hash reached DynamoDB, survived two languages and three
 * writers, and died in the last twelve lines.
 *
 * THAT IS WHY THIS IS A GATE AND NOT A CODE REVIEW. The defect typechecks,
 * lints, renders and screenshots correctly: a timeline with strip rows on it,
 * in the right order, at the right times. It is only wrong in what it leaves
 * out, and the thing it leaves out is the one field that tells a moderator
 * whether they are looking at a cheat or at a bug in our own strip check. The
 * owner spent a live prod test unable to answer that question.
 *
 * AND THE COST OF THE ABSENCE WAS NOT THEORETICAL. The game's `isMountedWeapon`
 * excuses a vehicle's own mounted gun only when `GetCurrentPedVehicleWeapon`
 * names it, and for a firetruck's hose seat it does not -- so the strip fired
 * on a player doing nothing but using a firehose. Reading the hash off the case
 * was the cheap way to learn that. It was not available.
 *
 * ═══ THE FOUR PROPERTIES THIS FILE HOLDS ═══
 *
 *   1. `weaponPart` answers for an entry carrying ONLY a weapon. No label, no
 *      `weaponIssued` -- which is exactly the shape the game sends.
 *   2. AND IT DOES NOT ACCUSE. `unauthorized` stays false on a strip: the red
 *      and its hover card say "damage from one is high-confidence evidence",
 *      and a strip is a weapon taken out of a hand BEFORE it fired anything.
 *   3. THE RENDERER ASKS. The non-kill branch of `IncidentTimeline` reaches
 *      `weaponPart`, rather than printing a label and stopping.
 *   4. AND THE KILL ROW IS UNTOUCHED, so a fix to one row cannot quietly cost
 *      the other its weapon.
 */

const { readFileSync } = await import('node:fs')

const { weaponPart } = await import('../src/lib/matchTimeline.ts')

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
// 1. The library half, driven with the row the game actually sends.
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. weaponPart, on a strip entry as br_ddb writes one')

/**
 * THE ENTRY IS `close.js`'s OUTPUT AND NOT AN INVENTION. `timelineEntry` returns
 * `{ at, kind, weapon }` for a strip and nothing else -- no `weaponLabel`,
 * because the gamemode has no name for a weapon it does not issue, and no
 * `weaponIssued`, because the kind IS the claim. A fixture carrying either
 * would pass this file while the real row failed.
 */
const STRIP = {
  at: 1_700_000_000_000,
  kind: 'weapon_strip',
  weapon: '1338811011',
}

const part = weaponPart(STRIP)

check('a strip entry yields a weapon part at all', part !== null, part)
check(
  'and it is the raw hash, because there is no label to look up',
  part?.raw === '1338811011',
  part?.raw,
)
check(
  'with no article, since nothing was named to put one in front of',
  part?.article === null,
  part?.article,
)
/**
 * RULE 3 OF `weaponPart`, RESTATED WHERE A STRIP CAN BREAK IT. `unauthorized` is
 * `weaponIssued === false` and never a truthiness test, so an ABSENT flag reads
 * as "no claim" rather than as an accusation. On a strip the flag is always
 * absent, so this is the row where `!weaponIssued` would look right and paint
 * every strip red.
 */
check(
  'and it does not accuse: a strip carries no weaponIssued, so no red',
  part?.unauthorized === false,
  part?.unauthorized,
)

const NO_WEAPON = { at: STRIP.at, kind: 'match_start' }
check(
  'a row with no weapon still yields nothing to render',
  weaponPart(NO_WEAPON) === null,
  weaponPart(NO_WEAPON),
)

// ─────────────────────────────────────────────────────────────────────────────
// 2. The renderer half, which is where the hash was actually lost.
// ─────────────────────────────────────────────────────────────────────────────

console.log('2. IncidentTimeline, which is the half that dropped it')

const timeline = readFileSync(
  new URL('../src/components/IncidentTimeline.tsx', import.meta.url),
  'utf8',
)

/**
 * READ FROM THE SOURCE RATHER THAN RENDERED, which is the shape every other
 * component gate in this directory has. There is no DOM in this harness and
 * adding one to assert a single interpolation would be a larger dependency than
 * the property is worth.
 */
check(
  'the renderer imports weaponPart',
  /\bweaponPart\b/.test(timeline) && /from '@\/lib\/matchTimeline'/.test(timeline),
)
check(
  'the non-kill, non-chat branch renders a component rather than a bare label',
  /<Labelled entry=\{entry\} \/>/.test(timeline),
)
check(
  'and that component asks weaponPart for the entry it was given',
  /function Labelled\([\s\S]*?weaponPart\(entry\)/.test(timeline),
)
check(
  'and renders the answer through the same Weapon component a kill uses',
  /function Labelled\([\s\S]*?<Weapon weapon=\{weapon\} \/>/.test(timeline),
)

/**
 * THE KILL ROW IS THE THING THIS CHANGE COULD HAVE COST. It had the weapon all
 * along; a rewrite that routed every row through one component and forgot the
 * "killed X with a Y" sentence would fix a strip and break a kill, and both
 * still typecheck.
 */
check(
  'the kill row still builds its own line and keeps its weapon',
  /function Kill\([\s\S]*?killLine\(entry\)/.test(timeline) &&
    /function Kill\([\s\S]*?<Weapon weapon=\{line\.weapon\} \/>/.test(timeline),
)

// ─────────────────────────────────────────────────────────────────────────────

if (failed) {
  console.error(`\nstrip weapon: ${failed} of ${ran} case(s) failed.`)
  console.error(
    'A weapon strip has to say which weapon. The hash is the whole content of ' +
      'the finding — see br_lib/shared/incident_build.lua, which says so.',
  )
  process.exit(1)
}

console.log(
  `strip weapon: ${ran} cases — the hash the game recorded survives weaponPart ` +
    'and reaches the row an admin reads',
)
