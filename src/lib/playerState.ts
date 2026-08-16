import type { PlayerRow } from './ingest'

/**
 * Player state, as the wire actually spells it.
 *
 * THE WIRE IS LOWERCASE AND THIS CONSOLE WAS READING UPPERCASE. `BR.PlayerState`
 * in `br_lib/shared/enums.lua` is a table of lowercase strings — `alive`,
 * `dbno`, `dead`, `lobby`, `warmup`, `bus`, `freefall`, `glide`, `spectating`,
 * `left` — and `BR.Roster.ringmaster` copies the roster entry's field onto the
 * snapshot verbatim. Nothing uppercases it anywhere between the game and here.
 *
 * Every comparison in this console was against `'ALIVE'`, `'DBNO'`, `'DEAD'`,
 * `'LOBBY'`. None of them ever matched a real snapshot, which is why the live
 * table's state filters did nothing (#17) and why every squad on the by-match
 * view rendered as "wiped".
 *
 * IT PASSED REVIEW BECAUSE THE FIXTURE IS UPPERCASE. `__fixtures__/
 * ingest-snapshot.json` and `synth.ts` both say `"ALIVE"`, so the `/preview`
 * harness — the thing built precisely so this surface could be looked at —
 * exercised the one spelling the game never sends. The fixture is the contract
 * artifact, mirrored byte-identical from `tools/fixtures/` in the game repo, so
 * it is not this repo's to quietly rewrite; instead everything here folds case,
 * and both spellings work.
 *
 * ONE PLACE, so the next reader cannot reintroduce a bare `=== 'ALIVE'`.
 */

/** The states the game can send. Lowercase, exactly as `BR.PlayerState` spells them. */
export const PLAYER_STATES = [
  'lobby',
  'warmup',
  'bus',
  'freefall',
  'glide',
  'alive',
  'dbno',
  'dead',
  'spectating',
  'left',
] as const

export type PlayerStateKey = (typeof PLAYER_STATES)[number]

/**
 * Fold a wire value to its canonical form.
 *
 * Case only — no aliasing, no mapping of unknown values onto known ones. A
 * state this console has never heard of comes back unchanged and lowercase, so
 * it is still comparable, still displayable, and still visibly foreign.
 */
export function stateKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * Is this player still in a match?
 *
 * MIRRORS `BR.Server.isInMatch` EXACTLY (br_core/server/main.lua), including
 * the warmup and descent states, because `match.alive` on the wire is counted
 * with that function. A different rule here would make the per-squad count
 * disagree with the match header sitting directly above it, and the game's is
 * the one that is authoritative.
 */
export function isInMatch(raw: string | null | undefined): boolean {
  switch (stateKey(raw)) {
    case 'alive':
    case 'dbno':
    case 'warmup':
    case 'bus':
    case 'freefall':
    case 'glide':
      return true
    default:
      return false
  }
}

/**
 * Which filter chip a player belongs under.
 *
 * FIVE BUCKETS THAT COVER TEN STATES, WITH NO GAP. The table offers fewer
 * chips than the game has states, and the previous set left `bus`, `freefall`,
 * `glide`, `warmup`, `left` and `spectating` matching nothing at all — so even
 * with the case fixed, six of ten states would have been invisible under every
 * chip except All. A filter that silently shows nothing is the bug being fixed,
 * not a smaller version of it.
 *
 * The mapping:
 *   alive      alive, warmup      upright, in a match, not downed
 *   air        bus, freefall, glide   dropping — none of the other four fit
 *   downed     dbno                the label the game calls DBNO
 *   dead       dead, left, spectating  out of the match
 *   lobby      lobby               connected, not in a match
 *
 * ANYTHING UNRECOGNISED FALLS TO `alive`, deliberately. A state added to the
 * game next year must land somewhere a human will see it; making the default
 * "no bucket" is how a player disappears from every chip at once, which is
 * exactly the failure this function exists to prevent. Landing under Alive is
 * wrong-but-visible, and the row still carries its real state in the chip.
 */
export type StateBucket = 'alive' | 'air' | 'downed' | 'dead' | 'lobby'

export function bucketOf(raw: string | null | undefined): StateBucket {
  switch (stateKey(raw)) {
    case 'dbno':
      return 'downed'
    case 'dead':
    case 'left':
    case 'spectating':
      return 'dead'
    case 'lobby':
      return 'lobby'
    case 'bus':
    case 'freefall':
    case 'glide':
      return 'air'
    default:
      // alive, warmup, and anything this build has not heard of.
      return 'alive'
  }
}

/** Convenience for the table, which filters `PlayerRow`s rather than strings. */
export function inBucket(p: Pick<PlayerRow, 'state'>, bucket: StateBucket): boolean {
  return bucketOf(p.state) === bucket
}
