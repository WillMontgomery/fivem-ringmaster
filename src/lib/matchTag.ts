/**
 * How a match id is written down, on this side of the wire.
 *
 * ═══ THIS IS A PORT, NOT A DESIGN ═══
 *
 * The authority is the gamemode's `br_lib/shared/matchtag.lua`, `BR.MatchTag`,
 * which is `('%07x'):format(id)` and nothing else. Sixty-eight places in the
 * game print a match id through it, including every line in the server console
 * a moderator reads. If this file produced a different string for the same id,
 * moderation would be reading two different names for one match, which is the
 * single outcome both halves of #291 exist to prevent. The owner: "yes
 * Ringmaster should show hex everywhere please."
 *
 * SEVEN CHARACTERS, ZERO PADDED, LOWER CASE, and the padding is the part that is
 * easy to drop. The ids are a fixed-width space (`ID_MIN, ID_MAX = 0x0000001,
 * 0xFFFFFFF` in br_core/server/match.lua), so `000a3f1` and `a3f1` being the
 * same match written two ways is a difference somebody has to hold in their head
 * while reading a console against this page. The gamemode pins that in its own
 * suite as `BR.MatchTag(0xa3f1) == '000a3f1'`, "a short id is padded, never
 * trimmed", and `matchTag.check.ts` pins the same case here.
 *
 * ═══ THE WIDTH WENT FIVE TO SEVEN; THE PARSER DID NOT MOVE ═══
 *
 * This was `('%05x')` over a 20-bit space until the gamemode widened the id to
 * 28 bits. Twenty bits reaches even odds of a collision at roughly 1,200 matches
 * by the birthday bound, and every match now has a permanent URL keyed on its
 * tag, so a collision would be one URL naming two matches.
 *
 * ONLY THE CANONICAL RENDERING MOVED, and `matchFromTag` below still accepts one
 * to eight hex digits. That is load bearing rather than lax: every match already
 * recorded carries a FIVE-character tag, and this console has already handed out
 * `/matches/d93aa` style links. Tightening the parser to exactly seven
 * characters would 404 every link this project has ever produced. A short tag
 * and its padded form are the same integer and select the same match, which
 * `matchTag.check.ts` pins by name.
 *
 * ═══ THE ID IS A NUMBER EVERYWHERE IT IS STORED OR SENT ═══
 *
 * It arrives as a number on the ingest envelope (`lib/ingest.ts`, `matchId:
 * optNull(z.number().int())`) and is stored as a number on every history row
 * (br_ddb's `HISTORY_NUMBERS`). Hex is a DISPLAY form and this module is the
 * only place it is produced — the same one-home rule the Lua file states, for
 * the same reason. The DynamoDB sort key still spells the id in decimal
 * (`match#<endedAt>#<matchId>`); that is an opaque key and it stays decimal.
 *
 * ═══ WHERE THIS DELIBERATELY DIVERGES FROM THE LUA ═══
 *
 * `BR.MatchTag` has NO NIL GUARD, on purpose: every call site it replaced was a
 * `%d` that would have raised on the same input, so the failure mode was
 * unchanged, and a guard "would turn a missing id into a plausible-looking
 * `00000`, which is the id server/loot.lua reserves for the communal warmup
 * pad: a bug that reads as a fact."
 *
 * THAT REASONING SURVIVES THE PORT; RAISING DOES NOT. Throwing here would take
 * down a React render on a page somebody is trying to moderate from, which is
 * how `lib/gameProfile.ts` already argues for projecting field by field rather
 * than casting. So the refusal is a `null` RETURN rather than an exception, and
 * it refuses exactly the values that would otherwise be invented:
 *
 *   · not a finite number, or not an integer — nothing to render
 *   · negative — `%07x` on a negative is not a match id in any build
 *   · ZERO, which is the one worth stating. `0` is excluded from the id space
 *     by `match.lua` ("0 IS EXCLUDED and that is load bearing"), and
 *     `historyRowFor` writes `ctx.matchId or 0` — so a row carrying 0 means the
 *     id was ABSENT, not that the match was called `0000000`. Rendering it would
 *     be this console naming a match after a missing value.
 *
 * Callers render `null` as the house em dash, exactly as `LocalTime` does for an
 * instant it cannot show and `IncidentMatchRecord` for a match with no row.
 */

/**
 * The upper bound of the id space, for documentation rather than enforcement.
 *
 * NOT A CEILING THIS REJECTS, and that is deliberate. Every match played before
 * #291 carries an id from the old pure increment — 412, say, which renders
 * `000019c` and is a real match somebody may be moderating. An id above the
 * range cannot be minted by the current game but would still be a real row if
 * one existed, and `%07x` widens rather than truncates, so it is rendered rather
 * than blanked. Blanking a real id would be the worse failure of the two.
 *
 * AND IT IS NOT THE PARSER'S BOUND EITHER. `matchFromTag` accepts up to eight
 * hex digits and is not tightened to this value, so a tag minted under the old
 * 20-bit space still resolves. See the header.
 */
export const MATCH_ID_MAX = 0xfffffff

/** Where the tag stops being padding and starts being the id. */
const TAG_WIDTH = 7

/**
 * The way a match id is written down: seven lower-case hex characters.
 *
 * Null when the value is not an id — see the header. Never `0000000`.
 */
export function matchTag(id: number | null | undefined): string | null {
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  // Zero and below are not ids. See the header: `0` is "absent", not a name.
  if (id <= 0) return null
  return id.toString(16).padStart(TAG_WIDTH, '0')
}

/**
 * Read a match id back off something a person typed or a URL carried.
 *
 * BASE 16, BECAUSE THE PRINTED FORM IS THE ONLY FORM THERE IS. This mirrors
 * `BR.MatchFromTag`, which exists for the same reason on the game side
 * (`/brloot a3f1` is somebody copying what the log just printed): parsing the
 * tag as decimal would silently answer about a DIFFERENT match for any tag made
 * only of digits, and about no match at all for the other fifteen sixteenths.
 *
 * STRICTER THAN `parseInt`, which is the whole point of not using it. `parseInt`
 * reads `'0a3f1 and then some'` as `0xa3f1` and `'0x1f'` as `0`; a URL segment
 * is untrusted input and a lenient parse here would resolve a typo to a real
 * match. Only hex digits, and only a value inside the space `matchTag` will
 * render back.
 *
 * ROUND TRIPS WITH `matchTag` BY CONSTRUCTION, and the check file pins it in
 * both directions: `matchFromTag(matchTag(n)) === n` for every n that has a tag.
 *
 * ═══ ONE TO EIGHT DIGITS, AND DO NOT NARROW IT TO SEVEN ═══
 *
 * THIS IS THE HALF THAT MUST NOT MOVE when the canonical width does. The width
 * went five to seven with the 28-bit id, but every match already recorded has a
 * FIVE-character tag and this console has already handed out `/matches/d93aa`
 * style links, into Discord and into people's address bars. A parser that
 * demanded exactly seven characters would 404 every one of them, which is the
 * one failure worse than a wrong width: the wrong width is legible, a 404 says
 * the match never existed.
 *
 * So a tag is any run of one to eight hex digits, and `d93aa` and `00d93aa` are
 * the same integer and therefore the same match. Eight is the ceiling because
 * `matchTag` widens rather than truncating above the space, so an eight-digit
 * string is still something this module could have produced; nine is not, and a
 * bound keeps `Number` well inside exact integers.
 */
export function matchFromTag(s: string | null | undefined): number | null {
  if (typeof s !== 'string') return null
  const raw = s.trim().toLowerCase()
  // No sign, no `0x`, no whitespace inside, no trailing anything. A bare run of
  // hex digits or nothing.
  if (!/^[0-9a-f]+$/u.test(raw)) return null
  // A tag longer than the space could ever need is not a short id with padding,
  // it is a different string. Bounded so `Number` cannot go imprecise.
  if (raw.length > 8) return null
  const n = Number.parseInt(raw, 16)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

/**
 * One match, at its stable URL.
 *
 * THE SAME SHAPE `profileHref` USES — a bare path, `encodeURIComponent` on the
 * segment, no query — because #51 asks for it in those words: "Match the href
 * pattern the console already uses for profile links rather than inventing a
 * style."
 *
 * KEYED ON THE TAG RATHER THAN THE NUMBER, so the URL in somebody's address bar
 * is the same seven characters the game console printed. A decimal route would
 * reintroduce the two-names-for-one-match problem in the one place it is most
 * copied and pasted.
 *
 * THE HREF THIS MINTS IS THE CANONICAL ONE, seven characters wide, but it is not
 * the only one the route answers: the five-character links already in the wild
 * resolve to the same match because `matchFromTag` never narrowed. See there.
 *
 * NULL WHEN THERE IS NO TAG, so a caller cannot accidentally link to
 * `/matches/null`. Every call site has to decide what an absent id looks like,
 * which is the same discipline `matchTag` imposes.
 */
export function matchHref(id: number | null | undefined): string | null {
  const tag = matchTag(id)
  if (tag === null) return null
  return `/matches/${encodeURIComponent(tag)}`
}
