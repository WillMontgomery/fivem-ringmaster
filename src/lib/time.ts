/**
 * Every absolute time this console renders, in one place.
 *
 * THE BUG THIS EXISTS TO KILL: `toLocaleString(undefined, …)` takes both the
 * locale and the timezone from the ambient environment. In a client component
 * that means the browser, which is at least *a* defensible answer. In a SERVER
 * component it means the Node process — and RSC output is serialised once and
 * never re-executed in the browser, so nothing ever corrects it. The audit log
 * was rendering its timestamps in the container's zone with no suffix, so a
 * reader in New York looking at a UTC box read `Aug 16, 02:14` for an action
 * taken at `Aug 15, 22:14` their time. A different calendar day, on the
 * forensic record, presented as if it were local.
 *
 * SO BOTH AMBIENT INPUTS ARE PINNED. The zone comes from the reader's stated
 * preference (see lib/prefs.ts) and the locale is a constant. Pinning only the
 * zone would not be enough: `Aug 16, 02:14` (en-US), `16 Aug, 02:14` (en-GB)
 * and `16. Aug., 02:14` (de-DE) are the same instant rendered three ways, and a
 * server/client disagreement about which one is a hydration mismatch — which
 * React 19 resolves by throwing away the server tree and re-rendering the root.
 *
 * AND EVERY ABSOLUTE TIME CARRIES ITS ZONE. A reader who deliberately picked a
 * zone they are not sitting in — which is the entire point of asking — would
 * otherwise be reading times that are correct and unverifiable.
 */

/**
 * The one locale this console formats in.
 *
 * NOT A PREFERENCE, deliberately. Offering it doubles the settings surface for
 * a single-language admin console, and every locale added is another way for
 * the server and the browser to disagree about the same instant. `en-US`
 * matches what the console already rendered on the machine it was built on, so
 * pinning it changes nothing visible for the people using it today.
 */
export const DISPLAY_LOCALE = 'en-US'

/** The fallback zone, and the house style for "we were never told". */
export const FALLBACK_TIME_ZONE = 'UTC'

/**
 * The widest instant `Intl.DateTimeFormat.format` will accept.
 *
 * Past this it throws `RangeError: Invalid time value` — a SECOND RangeError
 * source, distinct from the invalid-zone one, and the one more likely to fire
 * in practice: it also covers `NaN` and `Infinity`, which is what
 * `new Date(row.ts).getTime()` produces for any DynamoDB row whose `ts` is
 * missing or the wrong type. The audit page maps over a hundred such rows
 * inside a server render, where one throw is a 500 on the whole page.
 */
const MAX_INSTANT_MS = 8.64e15

/** What a caller needs to know to render a time. Satisfied by `Prefs`. */
export interface TimeFormatPrefs {
  timeZone: string
  locale: string
}

export interface FormatInstantOptions {
  /** Include the month and day. Off for things that are obviously recent. */
  withDate?: boolean
  /**
   * Include the year.
   *
   * Off in narrow columns — the audit log and the moderation tables already
   * dropped it before this existed, because "Aug 16, 2026, 02:14 EDT" in a
   * right-aligned column pushes the outcome label off the row and the year is
   * almost never the thing in question.
   */
  withYear?: boolean
  /**
   * Append the zone abbreviation (`EDT`, `UTC`). On by default — see the
   * "correct and unverifiable" note above. Turn it off only where the zone is
   * already stated once for a whole block of times.
   */
  withZone?: boolean
  /**
   * Include seconds.
   *
   * OFF EVERYWHERE EXCEPT THE ARTIFACT CAROUSEL, and it exists because that one
   * surface is unreadable without it. An incident's three timed frames are taken
   * immediately, at +5s and at +10s; at minute resolution all three are labelled
   * with the same string, so stepping through them looks like a control that
   * does not work.
   *
   * A FLAG ON THIS FORMATTER RATHER THAN A SECOND FORMATTER. #34 is explicit
   * that the carousel must reuse `LocalTime` rather than growing a private time
   * path, and a console with two ideas about how a timestamp reads is exactly
   * what that instruction is protecting against. Everywhere else keeps minutes:
   * seconds on an audit row are noise in a column that is already fighting for
   * width.
   */
  withSeconds?: boolean
}

/**
 * Is this a number `Intl` can format?
 *
 * Exported because callers that branch on "no timestamp" want the same answer
 * this module uses, rather than a second slightly-different check.
 */
export function isRenderableInstant(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_INSTANT_MS
}

/**
 * Formatters are cached, and the cache is the point rather than a micro
 * optimisation: the audit page builds one per row, a hundred rows at a time,
 * and constructing an `Intl.DateTimeFormat` pulls a fresh ICU pattern each
 * time. The key covers everything that changes the output.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(
  locale: string,
  timeZone: string,
  withDate: boolean,
  withYear: boolean,
  withZone: boolean,
  withSeconds: boolean,
): Intl.DateTimeFormat {
  /**
   * EVERY ARGUMENT THAT CHANGES THE OUTPUT IS IN THE KEY. Adding an option and
   * forgetting this line is the silent bug: the first caller through would seed
   * the cache and every later caller would get somebody else's formatter.
   */
  const key = `${locale}|${timeZone}|${withDate ? 1 : 0}|${withYear ? 1 : 0}|${withZone ? 1 : 0}|${withSeconds ? 1 : 0}`
  const hit = formatters.get(key)
  if (hit) return hit

  const opts: Intl.DateTimeFormatOptions = {
    timeZone,
    year: withDate && withYear ? 'numeric' : undefined,
    month: withDate ? 'short' : undefined,
    day: withDate ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
    timeZoneName: withZone ? 'short' : undefined,
  }

  let f: Intl.DateTimeFormat
  try {
    f = new Intl.DateTimeFormat(locale, opts)
  } catch {
    /**
     * BELT, NOT BRACES. `lib/prefs.ts` validates the zone before it ever
     * reaches here, so this branch should be unreachable — but "should be
     * unreachable" is exactly the reasoning that puts an uncaught `RangeError`
     * from a user-editable cookie inside a server render. Falling back costs
     * one wrong-but-labelled zone; throwing costs the page.
     */
    f = new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...opts, timeZone: FALLBACK_TIME_ZONE })
  }

  formatters.set(key, f)
  return f
}

/**
 * An instant, in the reader's zone, with the zone named.
 *
 * Returns an em dash rather than throwing for anything unrenderable. A missing
 * timestamp is a data problem worth showing as a gap in one cell; it is not
 * worth a 500 on a page whose job is to be readable when things are going
 * wrong.
 */
export function formatInstant(
  ms: number | null | undefined,
  prefs: TimeFormatPrefs,
  {
    withDate = true,
    withYear = true,
    withZone = true,
    withSeconds = false,
  }: FormatInstantOptions = {},
): string {
  if (!isRenderableInstant(ms)) return '—'

  try {
    return formatterFor(
      prefs.locale,
      prefs.timeZone,
      withDate,
      withYear,
      withZone,
      withSeconds,
    ).format(ms)
  } catch {
    return '—'
  }
}

/**
 * The UTC rendering, for a reader's eyes.
 *
 * THIS USED TO SAY "for `title=` attributes", and it used to claim that EVERY
 * DISPLAYED TIME KEEPS ONE. Neither is true any more, and the second had
 * quietly stopped being true long before the sentence was deleted. See
 * `docs/hover-text.md`: the native `title` attribute is banned on DOM elements,
 * because a fact parked there cannot be selected, focused, or read aloud, and
 * never appears at all on a touch device.
 *
 * SO THE UTC IS EITHER VISIBLE OR IT IS NOT THERE. `LocalTime`'s `utc` prop
 * renders this string as muted text beside the local one, and it is turned on
 * at the surfaces where somebody is genuinely lining a console row up against a
 * game-server log line — the audit log and an incident's event timeline. This
 * is deliberately NOT a machine-readable format; it is padded and suffixed for
 * reading. For the machine-readable one, see `machineInstant`.
 */
export function utcIso(ms: number | null | undefined): string {
  if (!isRenderableInstant(ms)) return 'unknown'
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

/**
 * The instant as `<time dateTime>` requires it, or `undefined`.
 *
 * NOT `utcIso`, AND THE DIFFERENCE IS A SILENT BUG. `utcIso` returns
 * `"2026-08-16 14:32 UTC"` — a space instead of the `T`, no seconds, and a
 * trailing word. That is a pleasant thing to read and an invalid HTML datetime,
 * which a browser does not complain about; it simply parses nothing and the
 * attribute conveys nothing to anything that reads it. Feeding the display
 * string to the machine-readable slot is the obvious move and it is wrong.
 *
 * RETURNS `undefined`, NOT A PLACEHOLDER, for anything unrenderable, so that
 * `<time dateTime={machineInstant(ms)}>` omits the attribute entirely rather
 * than asserting a bogus one. An absent `dateTime` on a `<time>` element is
 * legal — the element then just means "this text is a time".
 */
export function machineInstant(ms: number | null | undefined): string | undefined {
  if (!isRenderableInstant(ms)) return undefined
  return new Date(ms).toISOString()
}

/**
 * A number with thousands separators, in the pinned locale.
 *
 * The bare `.toLocaleString()` calls this replaces were an unsuppressed
 * hydration mismatch waiting for its first non-US reader: a server rendering
 * `1,234` against a de-DE browser rendering `1.234` is a text mismatch React
 * reports and repairs by re-rendering the root.
 */
export function formatCount(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString(DISPLAY_LOCALE)
}
