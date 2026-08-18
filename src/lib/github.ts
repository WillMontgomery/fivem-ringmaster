/**
 * Links to the game repository, in one place.
 *
 * WHY THIS IS A MODULE AND NOT A STRING IN A COMPONENT. It was a string in a
 * component — `HostBoard` owned the only copy — and the moment a second surface
 * needed to link a commit (the update banner, then the branch picker rows) the
 * choice was to export it or to write the URL out again. Three hand-written
 * copies of an org/repo pair is how one of them ends up pointing at the console
 * repo instead of the game repo, which is a link that works, looks right, and
 * shows the reader the wrong commit.
 *
 * THE GAME REPO, NOT THIS ONE. Every sha this console renders — the deployed
 * commit, a branch tip in the picker, the commit an update would move to — is a
 * commit in `fivem-br-gamemode`. Nothing here ever links to the console's own
 * history, which is why there is no second constant and no parameter for it.
 */

/** The repo every commit this console displays belongs to. */
export const GAME_REPO = 'https://github.com/WillMontgomery/fivem-br-gamemode'

/**
 * A commit, on GitHub.
 *
 * TAKES WHATEVER FORM THE SHA ARRIVED IN. The dispatcher reports the deployed
 * commit twice — `commit` abbreviated for display and `sha` in full — and
 * GitHub resolves either, so callers link the one they are holding rather than
 * carrying the full sha around purely to build a URL.
 */
export function commitUrl(sha: string): string {
  return `${GAME_REPO}/commit/${sha}`
}

/**
 * What changed between two commits, on GitHub.
 *
 * THE THREE-DOT FORM, DELIBERATELY. `a...b` is "what b has that a does not",
 * measured from where they diverged, which is exactly the set of commits a
 * deploy would bring and exactly what the count this replaced was counting.
 * `a..b` — two dots — is a different question that GitHub answers differently
 * on a branch that has moved on both sides, and it is the one somebody writes
 * by accident.
 */
export function compareUrl(fromSha: string, toSha: string): string {
  return `${GAME_REPO}/compare/${fromSha}...${toSha}`
}

/** A sha, cut to the length this console shows. Never for comparison. */
export function shortSha(sha: string): string {
  return sha.slice(0, 8)
}
