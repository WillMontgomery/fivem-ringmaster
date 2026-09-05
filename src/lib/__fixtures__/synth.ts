import { snapshotEnvelope, type SnapshotEnvelope } from '@/lib/ingest'
import { isInMatch } from '@/lib/playerState'

/**
 * A bigger, synthetic snapshot for the design harness.
 *
 * KEPT SEPARATE FROM `ingest-snapshot.json` ON PURPOSE. That file is the
 * contract artifact — mirrored byte-identical into the game repo so both
 * halves test against one shape — and it should stay small enough to read in
 * one screen. Padding it out with forty players to make the UI look busy would
 * make the thing two codebases agree on harder to review.
 *
 * So this synthesises instead, and then parses the result through the real
 * `snapshotEnvelope` schema. If the shape drifts, the harness fails exactly
 * where the ingest endpoint would have.
 *
 * DETERMINISTIC. No Math.random: a fixture that differs between two loads
 * makes "did my change do that?" unanswerable, and would defeat the point of
 * comparing two screenshots.
 *
 * PLAYER STATES ARE LOWERCASE HERE BECAUSE THAT IS WHAT THE GAME SENDS, and
 * getting that wrong is what let #17 ship. This file used to say `'ALIVE'`,
 * `'DBNO'`, `'DEAD'`, `'LOBBY'`; `BR.PlayerState` (br_lib/shared/enums.lua) is
 * lowercase and `BR.Roster.ringmaster` copies the field verbatim, so the
 * harness — built precisely so this surface could be looked at before a game
 * host existed — was the one place where the console's uppercase comparisons
 * matched. Every state filter worked here and none of them worked in
 * production. A harness that exercises a spelling the wire cannot produce is
 * worse than no harness, because it is trusted.
 *
 * `ingest-snapshot.json` beside this file is NOT corrected, and must not be: it
 * is the contract artifact, mirrored byte-identical from `tools/fixtures/` in
 * the game repo, and rewriting it here would break the property that both
 * halves test against one shape. Everything in the console folds case
 * (`lib/playerState.ts`), so it renders correctly either way.
 *
 * THE MATCH-LEVEL `state` VALUES BELOW ARE STILL WRONG, and knowingly left so.
 * `BR.MatchState` is `waiting|warmup|bus|playing|ended|cleanup` — there is no
 * `STORM` and no `DROP` — so `MatchCard`'s phase colours miss on a live server
 * for the same reason the player filters did. That is a different field, a
 * different vocabulary (not merely a case fold), and it needs its own decision
 * about which colour `playing` takes. Tracked separately rather than smuggled
 * in here.
 */

const NAMES = [
  'Vex', 'Ordnance', 'kettle', 'Bramble_', 'nightjar', 'Sable', 'Ferro',
  'quietwolf', 'Mox', 'Harrow', 'stitch', 'Vandal', 'lowtide', 'Cinder',
  'Pike', 'aurelia', 'Grist', 'nocturne', 'Halyard', 'Wren', 'Tarn',
  'copperhead', 'Silt', 'Marrow', 'ashfall', 'Corbel', 'Dray', 'kestrel',
]

/** A tiny LCG. Deterministic, seeded, and enough for plausible numbers. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const STATES_IN_MATCH = ['alive', 'alive', 'alive', 'dbno', 'dead'] as const

/**
 * The descent states, which no fixture carried before.
 *
 * A match in `BUS` phase used to give every one of its players the flat state
 * `BUS`, so `freefall` and `glide` appeared nowhere in the harness at all —
 * and the "In the air" filter added for #17 would have had nothing to show.
 * Spread across the bus match so the chip has a non-zero count and the three
 * phase colours can be told apart by eye.
 */
const STATES_IN_AIR = ['bus', 'freefall', 'glide'] as const

export function synthSnapshot(): SnapshotEnvelope {
  const r = rng(20260809)
  const gameMs = 4_281_003

  const matches = [
    { id: 41, state: 'STORM', mode: 'squads', bucket: 141, endsAt: 4_400_000, alive: 0, squadsAlive: 0 },
    { id: 42, state: 'BUS', mode: 'squads', bucket: 142, endsAt: null, alive: 0, squadsAlive: 0 },
    { id: 43, state: 'WARMUP', mode: 'solo', bucket: 143, endsAt: null, alive: 0, squadsAlive: 0 },
  ]

  const players: SnapshotEnvelope['snapshot']['players'] = []
  let src = 3

  // Match 41 — mid-storm squads, some wiped, so squad colours and the "wiped"
  // label both have something to show.
  const layout: Array<{ match: number; squads: number[][] }> = [
    { match: 41, squads: [[1, 2, 3], [4, 5], [6, 7, 8, 9], [10, 11]] },
    { match: 42, squads: [[12, 13, 14, 15], [16, 17, 18]] },
    { match: 43, squads: [[19], [20], [21]] },
  ]

  for (const { match, squads } of layout) {
    const m = matches.find((x) => x.id === match)!

    squads.forEach((members, squadIdx) => {
      // THE GAME'S OWN SHAPE, `m<match>sq<index>` (server/party.lua:873).
      // A fixture that mints a bare number is a fixture that cannot reproduce
      // the 400 this file's schema once returned for every squads match.
      const squadId = `m${match}sq${squadIdx + 1}`
      // Deliberately wipe one squad in the storm match.
      const wiped = match === 41 && squadIdx === 1

      members.forEach((_, i) => {
        const state: string = wiped
          ? 'dead'
          : m.state === 'WARMUP'
            ? 'warmup'
            : m.state === 'BUS'
              // Cycled over the running player count rather than over `i`,
              // which restarts per squad and left `glide` unrepresented.
              ? STATES_IN_AIR[players.length % STATES_IN_AIR.length]!
              : STATES_IN_MATCH[Math.floor(r() * STATES_IN_MATCH.length)]!

        const alive = state === 'alive' || state === 'dbno'
        const hp = state === 'dead' ? 0 : state === 'dbno' ? 12 + Math.floor(r() * 20) : 25 + Math.floor(r() * 75)

        players.push({
          src,
          name: NAMES[(src - 3) % NAMES.length]!,
          license: `license:${(110000100000000 + src * 7919).toString()}`,
          matchId: match,
          squadId,
          state,
          hp,
          armour: alive && r() > 0.5 ? Math.floor(r() * 100) : 0,
          kills: Math.floor(r() * 6),
          downs: Math.floor(r() * 2),
          revives: Math.floor(r() * 2),
          damage: Math.floor(r() * 900),
          placement: state === 'dead' ? 8 + i + squadIdx : null,
          pos: { x: -3000 + r() * 6000, y: -3000 + r() * 6000, z: 20 + r() * 200 },
          posAt: gameMs - Math.floor(r() * 900),
          bucket: m.bucket,
          // Spread joins across the last ~40 minutes so the duration column has
          // a real range to sort on.
          connectedAt: gameMs - Math.floor(60_000 + r() * 2_300_000),
        })
        src++
      })
    })

    // Counted with the game's own rule so the harness's match header agrees
    // with the per-squad counts the card derives beside it. `BR.Server.
    // aliveCount` counts `isInMatch`, which includes warmup and the descent
    // states — a fixture that counted only `alive` would have made the fix to
    // MatchCard look like the regression.
    m.alive = players.filter((p) => p.matchId === match && isInMatch(p.state)).length
    m.squadsAlive = new Set(
      players
        .filter((p) => p.matchId === match && isInMatch(p.state))
        .map((p) => p.squadId),
    ).size
  }

  // A handful in the lobby, because "connected but not playing" is a real and
  // frequently-interesting category.
  for (let i = 0; i < 5; i++) {
    players.push({
      src,
      name: NAMES[(src - 3) % NAMES.length]!,
      license: `license:${(110000100000000 + src * 7919).toString()}`,
      matchId: null,
      squadId: null,
      state: 'lobby',
      hp: 100,
      armour: 0,
      kills: 0,
      downs: 0,
      revives: 0,
      damage: 0,
      placement: null,
      pos: { x: 0, y: 0, z: 0 },
      posAt: 0,
      bucket: 0,
      connectedAt: gameMs - Math.floor(20_000 + r() * 600_000),
    })
    src++
  }

  const inMatch = players.filter((p) => p.matchId !== null).length

  // Parsed, not cast. The harness fails where the endpoint would.
  return snapshotEnvelope.parse({
    v: 1,
    kind: 'snapshot',
    server: {
      bootEpoch: '1754784000-4281003-55f0a1b2c3d4',
      resource: 'br_ringmaster',
      wallMs: 1_754_784_000_000,
      gameMs,
    },
    snapshot: {
      takenGameMs: gameMs,
      counts: { connected: players.length, inMatch },
      truncated: false,
      matches,
      players,
    },
  })
}
