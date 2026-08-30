/**
 * The one thing this console asks itself at boot.
 *
 * ═══ THE WHOLE FILE IS A RUNTIME GATE AND AN IMPORT ═══
 *
 * The check itself is `lib/dispatchStartup` — can this process READ
 * `GAME_SSH_KEY`, and does the `status` verb answer — and the reasoning for
 * every part of it, including everything it deliberately does not do, is there.
 *
 * IT IS IMPORTED FROM INSIDE THE `=== 'nodejs'` BRANCH, AND THAT IS LOAD-BEARING
 * RATHER THAN STYLE. Next compiles this file for BOTH runtimes and this console
 * has a `middleware.ts`, so the edge compilation is real. With the probe inline,
 * the build failed with `UnhandledSchemeError` on `node:fs`, `node:fs/promises`
 * and `node:child_process`: a runtime guard does not help, because the bundler
 * resolves imports whether or not the branch runs.
 *
 * `process.env.NEXT_RUNTIME` IS INLINED PER COMPILATION, so on edge this reads
 * `if ('edge' === 'nodejs')`, folds to `false`, and the import below is
 * eliminated rather than merely skipped. Anything that moves the check back
 * across this boundary breaks `next build` — which `npm run verify` does not
 * run, and did not catch.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startupProbe } = await import('./lib/dispatchStartup')

    /**
     * NOT AWAITED, AND THE `void` IS THE POINT. Awaiting an SSH round trip here
     * puts up to six seconds between systemd starting the unit and the first
     * request being served, on a path whose entire output is a log line.
     * `startupProbe` handles every one of its own failures, so there is no
     * rejection here for anything to be unhandled.
     */
    void startupProbe()
  }
}
