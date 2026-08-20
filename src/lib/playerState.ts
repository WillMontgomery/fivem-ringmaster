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
 * THE FIVE-BUCKET CLASSIFIER IS GONE, and this note is here so it is not
 * rebuilt by reflex.
 *
 * `StateBucket`, `bucketOf` and `inBucket` existed for one caller: the live
 * table's six state chips. The owner cut those to three — "all/in-match/lobby"
 * — and the surviving split is `p.matchId`, which is the game's own answer and
 * the one `counts.inMatch` and `ServerStrip` already agree with. That left the
 * classifier with no readers at all, and `inBucket` had never had one.
 *
 * Two things it knew that are still true elsewhere: the wire is lowercase
 * (`stateKey` above still folds it), and an unrecognised state must stay
 * visible rather than vanish (`PlayerRow`'s `StateChip` still does that, via
 * `humanLabel`). Nothing was lost with the deletion except the mapping itself.
 *
 * If a future chip really does need to group states again, the reasoning lives
 * in git — and `PlayerTable`'s `FILTERS` comment records why `matchId` beat it.
 */
