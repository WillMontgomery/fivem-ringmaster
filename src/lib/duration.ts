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
