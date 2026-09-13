/**
 * Contract checks for the ingest envelope — the shapes the game actually sends.
 *
 *   npx tsx src/lib/ingest.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts` and the dozen beside it: this repo
 * has no test framework and adding one to assert a handful of cases would be
 * the larger change. IT IS WIRED INTO `npm run verify` as `check:ingest`; a
 * check nothing runs is this repository's signature failure mode.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS, AND IT IS NOT A HYPOTHETICAL
 * ============================================================================
 *
 * `playerRow.squadId` was `z.number().int()`. The gamemode mints squad ids as
 * `m<match>sq<index>` — a STRING, namespaced by match on purpose so that two
 * concurrent matches cannot conflate anything keyed on a squad
 * (fivem-br-gamemode, server/party.lua:873). So every snapshot containing a
 * squadded player failed validation, `/api/ingest` answered 400, the game
 * counted a failed push, and the console's own feed-age rule eventually
 * declared the feed dead and fired `prod-console-ingest-dead`.
 *
 * IT LOOKED LIKE A STORM BUG FOR MOST OF A DAY. The owner noticed the alarm
 * while using `brstormfreeze`, and the freeze had nothing to do with it: what
 * gave it away was that the alarm kept firing after `brstormfreeze off`, for as
 * long as three clients stayed in a squads match (2026-09-04). `/brring` on the
 * game box is what settled it — `sent` frozen, `failed` climbing, `last status
 * 400` — because those three numbers separate "the game stopped pushing" from
 * "the console is refusing the body", and every theory up to that point had
 * been about the first.
 *
 * WHAT WOULD HAVE CAUGHT IT is a single parse of a snapshot containing a
 * squadded player. There was none, because there were no tests here at all.
 * That is the whole of what this file fixes: it exercises the SHIPPED schema
 * against the shapes the gamemode really puts on the wire, including the ones
 * that only appear once players group up.
 *
 * THE FIXTURES ARE NOT THE POINT AND MUST NOT BECOME IT. `__fixtures__/synth.ts`
 * is written by this estate, so a fixture agreeing with this schema proves only
 * that two files in one repo agree. The cases below are written from the
 * GAMEMODE's side — its field names, its types, its nil-is-absent rule — and
 * that disagreement is the only thing either file can usefully assert.
 */

import { snapshotEnvelope } from './ingest'

let failed = 0

/**
 * COUNTED RATHER THAN ASSERTED IN THE CLOSING LINE.
 *
 * That line said "9 envelope cases pass" as a hardcoded literal, and it had to be
 * edited by hand every time a case was added — which is to say it was a number
 * that could silently stop being true, printed confidently, in a file whose whole
 * purpose is catching exactly that. Adding two cases for the hex squad ids (#291)
 * is what made it wrong; counting is what stops it happening again.
 */
let ran = 0

function check(name: string, body: unknown, shouldPass: boolean): void {
  ran += 1
  const result = snapshotEnvelope.safeParse(body)
  if (result.success === shouldPass) return
  failed += 1
  console.error(`✗ ${name}`)
  if (!result.success) {
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join('.')}: ${issue.message}`)
    }
  } else {
    console.error('    parsed, and should not have')
  }
}

/**
 * A player row as `BR.Roster.ringmaster` builds one.
 *
 * NIL NEVER SURVIVES SERIALISATION, which is why the optional fields are
 * OMITTED here rather than set to null. That is what the wire really looks
 * like, and asserting it is half the reason `optNull` exists.
 */
function player(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    src: 3,
    name: 'Xeon',
    license: 'license:110000100000000',
    state: 'ALIVE',
    hp: 100,
    armour: 0,
    kills: 0,
    downs: 0,
    revives: 0,
    damage: 0,
    posAt: 664_660,
    bucket: 141,
    connectedAt: 12_000,
    ...over,
  }
}

function envelope(players: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    v: 1,
    kind: 'snapshot',
    server: { bootEpoch: '1788569686-3037-7177aee96440', resource: 'br_ringmaster', wallMs: 1, gameMs: 2 },
    snapshot: {
      takenGameMs: 664_660,
      counts: { connected: players.length, inMatch: players.length },
      truncated: false,
      matches: [
        { id: 3, state: 'PLAYING', mode: 'squads', bucket: 141, endsAt: 4_400_000, alive: 3, squadsAlive: 2 },
      ],
      players,
    },
  }
}

// ===========================================================================
// THE CASE THAT WAS BROKEN IN PRODUCTION
// ===========================================================================

check(
  'a squadded player, with the gamemode`s own m<match>sq<index> id',
  envelope([player({ matchId: 3, squadId: 'm3sq1' })]),
  true,
)

check(
  'three clients across two squads, which is the owner`s playtest setup',
  envelope([
    player({ src: 3, matchId: 3, squadId: 'm3sq1' }),
    player({ src: 4, name: 'Ronin', matchId: 3, squadId: 'm3sq1' }),
    player({ src: 5, name: 'Vale', matchId: 3, squadId: 'm3sq2' }),
  ]),
  true,
)

check(
  'a two-digit squad index, because the format is not one character',
  envelope([player({ matchId: 3, squadId: 'm3sq12' })]),
  true,
)

check(
  'a squad id from a high match number, which is where namespacing earns its keep',
  envelope([player({ matchId: 412, squadId: 'm412sq2' })]),
  true,
)

/**
 * ═══ THE SHAPE THE GAME MINTS TODAY, WHICH IS NOT THE ONE ABOVE (#291) ═══
 *
 * `party.lua` mints `('m%ssq%d'):format(BR.MatchTag(m.id), i)` now, so the match
 * half of a squad id is HEX and a real one looks like `m00d93aasq1`. Every
 * fixture in this file predates that and spells the match half in decimal. They
 * still parse, because the schema is `z.string()`, but they describe a wire the
 * game no longer speaks.
 *
 * AND THE HEX HALF GOT TWO CHARACTERS LONGER when the id space went 20 bits to
 * 28: `BR.MatchTag` is `('%07x')` now, so the squad ids on the wire went from
 * `md93aasq1` to `m00d93aasq1`. BOTH SHAPES ARE PINNED BELOW. The five-character
 * one is not a stale fixture: it is written into every history row already
 * recorded, and nothing backfills those either.
 *
 * IT IS PINNED HERE BECAUSE THE LAST TIME THIS FIELD'S SHAPE MOVED IT TOOK THE
 * INGEST ENDPOINT DOWN. The schema said `z.number().int()`, the game sent
 * `m3sq1`, the route answered 400 for every squads match, and the feed aged out —
 * 2026-09-04. A schema tightened toward "the match half is digits" would do it
 * again, and this case is what would stop it.
 *
 * THE DECIMAL CASES ABOVE ARE DELIBERATELY KEPT. They are the shape every squad
 * id already written to a history row still has, and nothing backfills them.
 */
check(
  'the hex-tagged squad id the game minted at the old five-character width',
  envelope([player({ matchId: 0xd93aa, squadId: 'md93aasq1' })]),
  true,
)

check(
  'the seven-character squad id the game mints since the id went 28 bits',
  envelope([player({ matchId: 0xd93aa, squadId: 'm00d93aasq1' })]),
  true,
)

check(
  'a full-width 28-bit id and its squad id',
  envelope([player({ matchId: 0xa70bf9c, squadId: 'ma70bf9csq3' })]),
  true,
)

check(
  'a hex tag whose characters are all letters, which a digits-only rule would refuse',
  envelope([player({ matchId: 0xfffff, squadId: 'mfffffsq12' })]),
  true,
)

// A NUMBER IS NOT A SQUAD ID, and pinning the refusal is what stops somebody
// "restoring" the old type to make a stale fixture parse.
check('a numeric squad id is refused', envelope([player({ matchId: 3, squadId: 7 })]), false)

// ===========================================================================
// THE SHAPES THAT ALWAYS WORKED, so the fix cannot have narrowed them
// ===========================================================================

check('a lobby player, with no match, squad or position at all', envelope([player()]), true)

check(
  'an explicit null where the game did send one',
  envelope([player({ matchId: null, squadId: null, license: null, placement: null, pos: null })]),
  true,
)

check(
  'a solo player, who has a match and no squad',
  envelope([player({ matchId: 3, pos: { x: 1.5, y: -2.5, z: 30.25 } })]),
  true,
)

check(
  'an eliminated player carrying a placement',
  envelope([player({ matchId: 3, squadId: 'm3sq2', state: 'OUT', placement: 4, hp: 0 })]),
  true,
)

// ===========================================================================

if (failed) {
  console.error(`\ncheck:ingest — ${failed} failing case(s)`)
  console.error(
    'The envelope must accept what the gamemode actually sends. A squad id is ' +
      '`m<match>sq<index>` and it is a string — see src/lib/ingest.ts.',
  )
  process.exit(1)
}
console.log(`check:ingest — ${ran} envelope cases pass, including squadded rosters`)
