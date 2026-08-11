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

export type Verb = 'status' | 'telemetry'

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
export function runVerb<T>(verb: Verb): Promise<T> {
  const e = env()
  if (!e.GAME_HOST || !e.GAME_SSH_KEY) {
    return Promise.reject(new Error('ssh not configured'))
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
    verb,
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
