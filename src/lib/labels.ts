/**
 * Machine ids, in English. ONE function, because there was none.
 *
 * WHAT THIS FIXES. The owner, reading the incident queue on a live server:
 * "abusive_chat is not a good reason ... it should display as 'Abusive chat'".
 * That id reached the screen through the game's own summary line, which is
 * built as `('Reported for %s by %s'):format(ev.category, ...)` in
 * `br_lib/shared/incident_build.lua` — a raw enum value, interpolated into a
 * sentence and displayed verbatim.
 *
 * IT WAS NOT THE ONLY WAY IN, WHICH IS WHY THIS IS A FUNCTION AND NOT A FIX TO
 * ONE STRING. Every label map in this console is consulted as
 * `MAP[value] ?? value` — the `??` is the hole. It exists for a good reason
 * (a value this build has never heard of must still be visible rather than
 * blank, the same argument `bucketOf` makes about unknown player states), but
 * what it falls back TO was the raw id. There are six such sites; a seventh
 * arrives with the next enum somebody adds to the game.
 *
 * SO THE FALLBACK IS NOW A FORMATTER RATHER THAN THE IDENTITY. `labelFor` is
 * the same lookup with a humanised fallback, so an unmapped value degrades to
 * "Abusive chat" rather than to `abusive_chat`, and a value the console has
 * never heard of is still legible AND still visibly foreign — it just is not
 * shouting its internal spelling at an operator.
 *
 * IT DOES NOT REPLACE THE MAPS. `CATEGORY_LABEL`, `KIND_LABEL`, `VERDICT_LABEL`
 * and `ACTION_LABEL` still own the English for everything this console knows
 * about, because most of those labels are NOT mechanical: `none` reads "No
 * action", `ban.issue` reads "issued a ban", `identifier_reuse` reads "Shared
 * identifier". No amount of underscore-splitting produces those. This is what
 * happens when the map has nothing to say.
 *
 * NO RUNTIME IMPORTS, deliberately — the same property `serverPhase` and
 * `incidentChip` keep. Every consumer of this is a client component, and the
 * modules that own the label maps (`lib/incidents`, `lib/audit`) reach
 * DynamoDB.
 */

/**
 * Split points between words: `_`, `-`, `.`, whitespace, and a camelCase seam.
 *
 * `.` IS IN THE LIST BECAUSE THE AUDIT LOG'S IDS USE IT — `ban.issue`,
 * `maintenance.drain`. Those are all mapped today, so this only ever runs on an
 * action written by a newer console than the one rendering it, which is exactly
 * the case worth degrading well.
 */
const SEAM = /[_\-.\s]+/

/**
 * ONE SENTENCE, NOT TITLE CASE, and the owner's wording is the specification:
 * "it should display as 'Abusive chat'" — not "Abusive Chat". It matches how
 * `CATEGORY_LABEL` already writes every label it owns ("Shared identifier",
 * "Player report", "Something else"), so a humanised fallback sits beside a
 * mapped one without looking like it came from somewhere else.
 *
 * ACRONYMS ARE LEFT ALONE. A token that is already all-caps and longer than one
 * character — `DBNO`, `NUI`, `SSH` — is a word somebody chose to spell that
 * way, and lowercasing it produces "Dbno". Nothing here is clever enough to
 * know which is which, so the rule is mechanical and stated: only tokens that
 * are not already shouting get folded.
 */
function word(token: string): string {
  if (token.length > 1 && token === token.toUpperCase() && /[A-Z]/.test(token)) {
    return token
  }
  return token.toLowerCase()
}

/**
 * An id as prose. `abusive_chat` -> `Abusive chat`.
 *
 * EMPTY IN, EMPTY OUT. A blank id is not "Unknown" or "—": inventing a word for
 * an absent value is the same class of claim this console spends `serverPhase`
 * and `refUpdateFrom` avoiding. The caller decides what nothing looks like.
 */
export function humanLabel(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return ''

  const words = value
    // A camelCase seam becomes a space before the generic splitter runs, so
    // `identifierReuse` and `identifier_reuse` land on the same output.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(SEAM)
    .filter((t) => t !== '')
    .map(word)

  if (words.length === 0) return ''

  const [first = '', ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/**
 * The label a map has for this id, or the humanised id when it has none.
 *
 * THE DROP-IN FOR `MAP[value] ?? value`, which is the shape every call site in
 * this console had. Same lookup, same "unknown values stay visible" behaviour,
 * different fallback.
 */
export function labelFor(
  map: Record<string, string> | undefined,
  raw: string | null | undefined,
): string {
  const value = (raw ?? '').trim()
  if (value === '') return ''
  return map?.[value] ?? humanLabel(value)
}
