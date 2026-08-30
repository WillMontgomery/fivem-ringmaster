/**
 * ONE QUESTION, ASKED ONCE, AT BOOT: can this process actually use the channel
 * it is configured for?
 *
 * ═══ THE DRIFT THIS EXISTS TO CATCH ═══
 *
 * There are three statements about which user runs this console and they do not
 * agree. `docs/deploy.md` writes the unit with `User=ubuntu`. Production has run
 * as a different user. The private key at `GAME_SSH_KEY` was left mode 600 owned
 * by `ubuntu`. Nothing reconciled them and nothing could: each is true in its own
 * file, and the contradiction only exists at the moment `ssh -i` opens the key.
 *
 * The console booted cleanly, served every page, reported DynamoDB healthy, and
 * was completely unable to reach the game box. It took an hour and two machines
 * to find, and the fix was `chown`. What was missing was not a check — the
 * fifteen-second poll discovers this within fifteen seconds — but a check that
 * said so somewhere an operator looks BEFORE they have a symptom, and in
 * language that names the cause rather than the consequence.
 *
 * ═══ WHAT IT DOES ═══
 *
 *   1. Not configured: one line naming both variables, and stop. This is a
 *      normal state (a development box, a console before the game host is wired
 *      up) and it is reported as information, not as a failure.
 *   2. `fs.access(key, R_OK)` AS THE RUNNING USER. This is the incident, and it
 *      is the one thing here that needs no network and cannot be flaky.
 *      Failing, it prints the uid the process is running under and the mode and
 *      owner of the key — the three numbers whose disagreement IS the bug.
 *   3. One `status` verb. Failing, it prints what ssh said.
 *
 * ═══ WHAT IT DELIBERATELY DOES NOT DO ═══
 *
 * IT DOES NOT REFUSE TO BOOT. "Loud and running beats dead" is the whole
 * disposition of this file and it is the same call the owner made about the
 * br_ddb check ("Let's not refuse connect for DDB, you're right. But it needs to
 * be an obvious issue"). A console that will not start because it cannot reach
 * the game box is a console you cannot use to find out why — and the failure
 * modes here include a game box that is merely rebooting. Every path below
 * returns; nothing throws past `register`, nothing calls `process.exit`, and the
 * outer catch exists so that a bug IN THIS FILE cannot take the service with it.
 *
 * IT DOES NOT BLOCK READINESS. `register` returns immediately and the probe runs
 * behind it. Awaiting an SSH round trip would put up to six seconds between
 * systemd starting the unit and the first request being served, on a path whose
 * entire output is a log line.
 *
 * IT DOES NOT FEED THE UI. The Host card, the chip and the strip read the
 * poller, which is the one source of that reading and refreshes it every fifteen
 * seconds; seeding them from a boot-time probe would put a second, ageing
 * opinion into a surface whose correctness depends on there being exactly one.
 * This writes to the journal and nowhere else.
 *
 * IT DOES NOT RETRY. It is a snapshot of the moment the service started, which
 * is exactly when configuration drift is introduced. The poller is the thing
 * that watches.
 */
export async function register(): Promise<void> {
  /**
   * The Node runtime only. `register` also runs on the edge runtime, where
   * `node:fs` and `child_process` do not exist and where this console has
   * nothing to check.
   */
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  /**
   * NOT AWAITED, AND THE `void` IS THE POINT. See "does not block readiness"
   * above. `startupProbe` handles every one of its own failures, so there is no
   * rejection here for anything to be unhandled.
   */
  void startupProbe()
}

async function startupProbe(): Promise<void> {
  try {
    const { constants } = await import('node:fs')
    const { access, stat } = await import('node:fs/promises')

    /**
     * IMPORTED HERE RATHER THAN AT MODULE SCOPE. `lib/ssh` reaches
     * `node:child_process` and `lib/env` throws on an invalid environment;
     * neither belongs on the import graph of a file Next loads before anything
     * else. Inside the try, a bad environment is a log line rather than a boot
     * failure — which the console already has its own, better message for.
     */
    const { env } = await import('@/lib/env')
    const { runVerb, sshConfigured } = await import('@/lib/ssh')

    if (!sshConfigured()) {
      console.warn(
        '[dispatch] GAME_HOST/GAME_SSH_KEY are not set — host telemetry, the ' +
          'branch list and deploys are off. This is the expected state of a ' +
          'console that has not been pointed at a game box.',
      )
      return
    }

    const key = env().GAME_SSH_KEY as string

    try {
      await access(key, constants.R_OK)
    } catch (e) {
      /**
       * THE THREE NUMBERS, ON ONE LINE, BECAUSE THE FAULT IS THE RELATION
       * BETWEEN THEM. "Permission denied" alone sends somebody to `chmod`; the
       * key was already 600. What was wrong was WHOSE 600 it was, and that is
       * only visible with the running uid printed beside the file's owner.
       *
       * `getuid` IS OPTIONAL IN THE TYPES because it does not exist on Windows.
       * Nothing here may throw, so it is called defensively even though this
       * service only ever runs on Linux.
       */
      console.error(
        `[dispatch] cannot read GAME_SSH_KEY ${key} — ${await ownership(stat, key)}, ` +
          `this process is uid ${process.getuid?.() ?? '?'} gid ${process.getgid?.() ?? '?'}: ${message(e)}`,
      )
      console.error(
        '[dispatch] give that uid the key (chown), then restart the service. ' +
          'docs/deploy.md documents the unit as User=ubuntu; check what it ' +
          'actually runs as with: systemctl show ringmaster -p User',
      )
      return
    }

    try {
      await runVerb('status')
      console.log(`[dispatch] ok — ${key} is readable and the status verb answered`)
    } catch (e) {
      console.error(`[dispatch] status verb failed at startup: ${message(e)}`)
    }
  } catch (e) {
    /**
     * A BUG IN THIS FILE MUST NOT BE ABLE TO STOP THE CONSOLE. This is the only
     * code in the process that runs before anything is served, so an unhandled
     * throw here is a boot loop over a diagnostic.
     */
    console.error('[dispatch] startup check itself failed', e)
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The key's mode and owner, or a note that even `stat` was refused. */
async function ownership(
  stat: (p: string) => Promise<{ mode: number; uid: number; gid: number }>,
  key: string,
): Promise<string> {
  try {
    const s = await stat(key)
    // Low twelve bits, printed the way `chmod` takes them.
    const mode = (s.mode & 0o7777).toString(8).padStart(4, '0')
    return `it is mode ${mode} owned by uid ${s.uid} gid ${s.gid}`
  } catch {
    return 'and it could not be stat-ed either (check the directory above it)'
  }
}
