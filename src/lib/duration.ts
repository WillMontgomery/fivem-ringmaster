/**
 * Durations, formatted for reading at a glance.
 *
 * Deliberately drops precision as the number grows: nobody reading "how long
 * has this person been on" cares about the seconds after the first hour, and
 * the extra digits cost width in a column that is already narrow.
 */
export function humanDuration(ms: number): string {
  if (ms < 0) return '—'

  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`

  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`

  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`

  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * How long ago an instant was, for a reader who is asking "recently?".
 *
 * A RELATIVE TIME IS THE QUESTION, AN ABSOLUTE ONE IS THE EVIDENCE. Nobody
 * scanning a list of branch tips is asking what o'clock the commit landed; they
 * are asking whether it is from this afternoon or from March. `formatInstant`
 * answers a question that was not asked and costs the width of a date to do it.
 * The absolute instant still has to be REACHABLE — `docs/hover-text.md` — so the
 * two live together at every call site: this on the face of it, the instant in
 * `<time dateTime>` for machines and on hover for people.
 *
 * `now` IS PASSED IN, NEVER READ FROM THE CLOCK HERE. Every caller already has
 * a ticking `now` in state, and a function that read `Date.now()` itself would
 * be a different answer on the server than in the browser one render later —
 * which is a hydration mismatch React 19 repairs by throwing the tree away.
 */
export function ago(ms: number, now: number): string {
  return `${humanDuration(now - ms)} ago`
}

/**
 * How long a player has been connected, from the envelope's clock pair.
 *
 * The snapshot carries `connectedAt` as a GAME-clock reading rather than a
 * duration, which is what lets this be computed against the console's own
 * clock and tick continuously — instead of jumping every two seconds and
 * occasionally going backwards when a push is late.
 */
export function connectedFor(
  server: { wallMs: number; gameMs: number },
  connectedAt: number,
  now: number,
): number {
  const joinedWallMs = server.wallMs + (connectedAt - server.gameMs)
  return Math.max(0, now - joinedWallMs)
}
