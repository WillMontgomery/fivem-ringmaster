import { execFile } from 'node:child_process'

import { env } from './env'

/**
 * The one channel to the game host.
 *
 * SPAWNED WITH argv, NEVER THROUGH A SHELL. execFile does not invoke /bin/sh,
 * so the verb and options are passed as discrete arguments and nothing here is
 * ever string-interpolated into a command line. The far side is a forced
 * command that ignores the requested command except as $SSH_ORIGINAL_COMMAND
 * and switches on a fixed verb set (tools/dispatch.sh in the game repo) — so
 * this is defence in depth on top of a channel that already cannot run
 * anything but the dispatcher.
 *
 * Not configured is a normal state, not an error: with GAME_HOST or
 * GAME_SSH_KEY unset the Host page shows "not configured", the same way the
 * dashboard does before br_ringmaster is pointed at the ingest endpoint.
 */

export type Verb = 'status' | 'telemetry' | 'kick'

export function sshConfigured(): boolean {
  const e = env()
  return Boolean(e.GAME_HOST && e.GAME_SSH_KEY)
}

/**
 * Run one dispatcher verb and return its single JSON line, parsed.
 *
 * Bounded hard: a 6-second wall so a hung link fails the poll rather than
 * stacking timers, and BatchMode so a host-key or auth problem errors
 * immediately instead of blocking on a prompt that no one can answer.
 */
export function runVerb<T>(verb: Verb, ...verbArgs: string[]): Promise<T> {
  const e = env()
  if (!e.GAME_HOST || !e.GAME_SSH_KEY) {
    return Promise.reject(new Error('ssh not configured'))
  }

  /**
   * Arguments are checked HERE as well as on the far side.
   *
   * They are joined into the single command string ssh sends, so anything
   * containing a space would silently become two arguments and shift every
   * later one — a reason landing where a command id belongs. Rejecting the
   * whole call is right: every argument this function is ever given is
   * machine-generated (a license, a base64 blob, a UUID), so a space in one is
   * a bug, and a bug on this path deserves to fail loudly rather than send
   * something subtly wrong to a live server.
   */
  for (const a of verbArgs) {
    if (!/^[A-Za-z0-9+/=:_-]+$/.test(a)) {
      return Promise.reject(new Error(`unsafe ssh argument: ${a.slice(0, 40)}`))
    }
  }

  const args = [
    '-i', e.GAME_SSH_KEY,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    // The game host's key is pinned on first connect and the box is reached
    // only over the private peered link, so accept-new records it once rather
    // than prompting. StrictHostKeyChecking=no would also silence a genuine
    // key change; accept-new does not.
    '-o', 'StrictHostKeyChecking=accept-new',
    `${e.GAME_SSH_USER}@${e.GAME_HOST}`,
    // The forced command reads this from $SSH_ORIGINAL_COMMAND. It is one of a
    // fixed enum; it is never user input.
    // ssh joins everything after the destination into the one string the far
    // side reads as $SSH_ORIGINAL_COMMAND. Passing them as separate argv
    // entries (rather than pre-joining) keeps this call free of any string
    // building of our own.
    verb,
    ...verbArgs,
  ]

  return new Promise<T>((resolve, reject) => {
    execFile('ssh', args, { timeout: 6_000, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(JSON.parse(stdout.trim()) as T)
      } catch {
        reject(new Error(`dispatch returned non-JSON: ${stdout.slice(0, 200)}`))
      }
    })
  })
}

/**
 * Ask the game host to remove a connected player.
 *
 * THE REASON IS BASE64, and that is the security property rather than an
 * encoding preference. On the far side it reaches `tmux send-keys`, which types
 * into a live FXServer console — so a newline in it is a SECOND COMMAND, and
 * "cheating\nquit" would ban somebody and stop the server. Base64 contains no
 * newline, quote, semicolon or space, so nothing an admin typed can be anything
 * but one opaque token until the far side has decoded and re-checked it.
 *
 * ACCEPTED IS NOT DONE. A resolved promise means the keystrokes reached the
 * console, nothing more. Whether a player was actually removed arrives
 * separately as an outcome event carrying `commandId` — which is why the audit
 * row starts as `pending` and why "unacknowledged" is a state the log shows.
 *
 * A LICENSE, NEVER A SERVER ID. Ids recycle within the minute; one read off a
 * console rendered thirty seconds ago would remove whoever inherited the slot.
 */
export async function kickPlayer(
  license: string,
  reason: string,
  commandId: string,
): Promise<{ ok: boolean; accepted?: boolean; error?: string }> {
  const encoded = Buffer.from(reason, 'utf8').toString('base64')
  return runVerb('kick', license, encoded, commandId)
}

export interface HostStatus {
  running: boolean
  pid: number
  uptimeSec: number
  commit: string
  behindMain: number
  hostUptimeSec: number
}

export interface HostTelemetry {
  at: number
  cpuPct: number
  cores: number
  memTotalKb: number
  memAvailKb: number
  memPct: number
  rxBytes: number
  txBytes: number
  diskTotalKb: number
  diskAvailKb: number
}
