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

export type Verb =
  | 'status'
  | 'telemetry'
  | 'configreport'
  | 'kick'
  | 'spectate'
  | 'deploy'
  | 'branches'
  | 'switchref'

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
  /**
   * `.` WAS ADDED FOR BRANCH NAMES and is worth a line, because widening this
   * set is the kind of change that gets made once and never re-examined.
   *
   * Branch names legitimately contain dots — `release/1.4.0` is the obvious
   * one — and without it `switchref` would refuse a perfectly ordinary ref with
   * a message about an unsafe argument, which reads as a bug in the console
   * rather than a rule. What it admits alongside is `..`, and that is checked
   * where it means something: `tools/dispatch.sh` validates the ref as a raw
   * string before git sees it and rejects `..`, `//`, a leading `-` and a
   * trailing `/` (`valid_ref`), and `tools/deploy.sh` repeats the whole check
   * on the pin file's contents. Nothing on this side treats these arguments as
   * a path.
   */
  for (const a of verbArgs) {
    if (!/^[A-Za-z0-9+/=:._-]+$/.test(a)) {
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
    /**
     * known_hosts NEXT TO THE KEY, not in $HOME.
     *
     * The service runs under systemd with ProtectHome, so /home is masked and
     * ssh cannot even stat ~/.ssh — every call printed
     *
     *   Could not stat /home/ubuntu/.ssh: Permission denied
     *   Failed to add the host to the list of known hosts
     *
     * on stderr. Harmless with accept-new (the connection still succeeds), but
     * it lands in the middle of real error messages and made a working channel
     * look broken while we were debugging a genuine failure beside it. Pointing
     * at a directory the service actually owns lets the host key persist, which
     * also means a CHANGED key will be noticed rather than silently re-accepted
     * forever.
     */
    '-o', `UserKnownHostsFile=${e.GAME_SSH_KEY.replace(/\/[^/]*$/, '')}/known_hosts`,
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
      /**
       * A DELIBERATE REFUSAL IS AN ANSWER, NOT A TRANSPORT FAILURE, and the two
       * used to be indistinguishable here.
       *
       * The dispatcher exits non-zero when it refuses something on purpose —
       * `kick` exits 3 on a malformed license, `switchref` exits 3 when the
       * branch has moved since it was chosen — and it prints a JSON line saying
       * so. Rejecting on `err` alone threw that line away and surfaced
       * `Command failed: ssh …` instead, so the most useful message the far
       * side can produce ("feature/x has moved since it was chosen, pick it
       * again") reached the admin as a generic SSH error.
       *
       * So: if the far side managed to say something structured, that is the
       * answer, whatever the exit code. Every caller already branches on `ok`.
       * A non-zero exit with nothing parseable on stdout is a real failure and
       * still rejects, carrying the original error.
       */
      const text = stdout.trim()
      if (text) {
        try {
          return resolve(JSON.parse(text) as T)
        } catch {
          /* fall through — not JSON, so it cannot be a considered answer */
        }
      }
      if (err) return reject(err)
      reject(new Error(`dispatch returned non-JSON: ${stdout.slice(0, 200)}`))
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
 * row starts as `pending` and stays that way if nothing ever comes back. That
 * distinction is still recorded; it is no longer LABELLED (#19), because
 * "unacknowledged" on a row that had almost certainly succeeded cost every
 * reader a pause. Only `failed` is shown now.
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

/**
 * Ask the game host to put an admin's camera on a player (#192).
 *
 *   spectate <admin-license> <target-license> <command-id>
 *
 * THE SAME CHANNEL AS THE KICK, NOT A SECOND ONE. SSH forced command →
 * `tools/dispatch.sh` → `tmux send-keys` → `brspectate` on the FXServer
 * console → `br:core:spectate`. The far side's verb set is pinned by the game
 * repo's `tools/verify.sh` (it greps `dispatch.sh` and fails when the set
 * moves), so this name is a contract rather than a hope.
 *
 * NO BASE64, AND THE ABSENCE IS THE INTERESTING PART. A kick reason is free
 * text an admin typed, so it is encoded to keep a newline in it from becoming a
 * second line on FXServer's stdin. This command carries NO untrusted text at
 * all: two hex licenses and a UUID, every one of them generated by this system.
 * There is nothing to encode, so encoding it would only hide the shape from
 * `runVerb`'s argument check.
 *
 * TWO LICENSES, NEVER SERVER IDS. Ids recycle within the minute, and where a
 * kick against a stale id removes the wrong person, a spectate against one
 * points a camera at somebody nobody was authorised to watch.
 *
 * ACCEPTED IS NOT WATCHING. A resolved promise means the keystrokes reached the
 * console. Whether a session opened comes back separately as an outcome event
 * carrying `commandId` — and so, later and on its own, does the moment it ends,
 * which no console command asks for: the admin closes it from the pause menu,
 * or the target disconnects and it closes itself.
 */
export async function spectatePlayer(
  adminLicense: string,
  targetLicense: string,
  commandId: string,
): Promise<{ ok: boolean; accepted?: boolean; error?: string }> {
  return runVerb('spectate', adminLicense, targetLicense, commandId)
}

export interface HostStatus {
  running: boolean
  pid: number
  uptimeSec: number
  /** Abbreviated, for display. */
  commit: string
  /**
   * The full 40-hex commit. `commit` is abbreviated and cannot be compared to
   * a pinned sha, so anything deciding "did the branch we asked for actually
   * land" needs this one.
   */
  sha?: string
  behindMain: number
  hostUptimeSec: number

  /**
   * The branch the served clone is ACTUALLY on, read off the clone rather than
   * off the pin — a switch that was staged and then cancelled leaves a pin
   * naming a branch the box has never run.
   *
   * OPTIONAL, AND EVERY READER MUST HANDLE ITS ABSENCE AS "NOT MAIN". An older
   * dispatcher does not send it, and a detached HEAD cannot answer it. Being
   * wrong in that direction costs an off-main banner on a box that is fine;
   * being wrong the other way costs an unannounced automatic deploy of main
   * over a parked branch. Use {@link isOnMain}, never a bare comparison.
   */
  deployedRef?: string
  /** What the next deploy will check out. May differ from `deployedRef`. */
  pinnedRef?: string
  /** Display name of whoever staged the pin. Cosmetic; never authorisation. */
  pinnedBy?: string
  /** When the pin was written, epoch ms. */
  pinnedAt?: number
}

/**
 * Is the game host running `main`?
 *
 * WRITTEN IN THE POSITIVE, and that is the whole reason this is a function
 * rather than an inline `!==`. `status.deployedRef !== 'main'` reads as "off
 * main" for `undefined` too, which is right, but the inverse spelling —
 * `deployedRef === undefined || deployedRef === 'main'` — is the one somebody
 * writes by accident when they want the automation gate, and it silently
 * re-enables automatic deploys on every box whose dispatcher is too old to
 * answer. One function, one direction, no way to get the polarity wrong.
 */
export function isOnMain(
  // Takes only the field it reads, so a caller holding a bare ref — the design
  // harness, or a component handed one as a prop — asks the same function the
  // real callers do rather than writing the comparison out again.
  status: Pick<HostStatus, 'deployedRef'> | null | undefined,
): boolean {
  return status?.deployedRef === 'main'
}

/**
 * Has the host told us, in so many words, that it is running something else?
 *
 * NOT `!isOnMain`, AND THE DIFFERENCE IS A DEPLOYMENT ORDER. Three states
 * exist, not two: `main`, some other ref, and *no answer* — a dispatcher that
 * predates branch switching does not send the field at all, and a detached HEAD
 * sends it empty. `isOnMain` folds "no answer" in with "some other ref",
 * because an automatic deploy at a host we cannot interrogate is the failure
 * worth preventing. This folds it in with `main` instead, because it decides
 * what to SHOW, and a console that hides its update badge and blanks its
 * maintenance page against an older game box would look broken while being
 * fine.
 *
 * The one thing neither spelling may do is drive both decisions. Use `isOnMain`
 * for anything that acts on the server; use this for anything a human reads.
 */
export function isParkedOffMain(
  status: Pick<HostStatus, 'deployedRef'> | null | undefined,
): boolean {
  return typeof status?.deployedRef === 'string' && status.deployedRef !== 'main'
}

/** One remote branch, as the dispatcher's `branches` verb reports it. */
export interface HostBranch {
  name: string
  /** 40-hex. Resolved on the box at listing time and pinned from here on. */
  sha: string
  /** Relative to the DEPLOYED sha, not to main. */
  ahead: number
  behind: number
  /** Tip commit date, epoch ms. */
  tipAt: number
  tipAuthor: string
  subject: string
  /** Whether this ref satisfies the dispatch.sh invariant. */
  eligible: boolean
  /** Why not, as a sentence to render verbatim. Empty when eligible. */
  blockedBy: string
}

export interface HostBranches {
  ok: boolean
  /**
   * The box could not refresh its remote refs inside its time budget and
   * answered from what was already on disk. Said out loud in the UI: a branch
   * list quietly a day old is how somebody picks a sha that no longer exists.
   */
  stale: boolean
  deployedSha: string
  deployedRef: string
  branches: HostBranch[]
}

/**
 * Every remote branch the game host can see, newest commit first.
 *
 * NOTHING IS FILTERED OUT HERE OR THERE. Branches that cannot be deployed come
 * back with `eligible: false` and a `blockedBy` sentence, and the UI shows them
 * disabled with the reason. A branch that is simply absent from the list reads
 * as a broken list — the operator knows it exists, cannot see it, and has no
 * way to tell "we refuse this" from "the dropdown is broken".
 */
export function listBranches(): Promise<HostBranches> {
  return runVerb<HostBranches>('branches')
}

/**
 * HAS THE BRANCH THE BOX IS PARKED ON MOVED SINCE IT DEPLOYED?
 *
 * A DIFFERENT NUMBER FROM `behindMain`, AND THE TWO MUST NEVER BE CONFUSED.
 * `status.behindMain` is `HEAD..origin/main` — the distance from reviewed code,
 * which off main is large, permanent, and describes an update nobody is waiting
 * for. This is `HEAD..origin/<the ref HEAD is on>` — the distance from the tip
 * of the branch somebody is actively pushing to, which is exactly the update
 * they ARE waiting for. Anything that renders either one has to name which, or
 * "3 commits behind" means two incompatible things on the same page.
 *
 * IT IS NOT A NEW MEASUREMENT. The `branches` verb already computes it: every
 * row's `ahead`/`behind` is measured against the DEPLOYED SHA rather than
 * against main (see `do_branches` in the game repo's `tools/dispatch.sh`), so
 * the row whose name equals `deployedRef` carries, in `ahead`, the count of
 * commits on that branch's tip that the served clone does not have. This
 * function is the one place that reading is spelled out, so nothing else has to
 * remember that "ahead of what is deployed" and "how far behind the box is" are
 * the same number seen from opposite ends.
 *
 * WHY NOT FROM `status`: the `status` verb reports `HEAD`, `deployedRef` and
 * `behindMain` and nothing about the parked branch's tip, and its background
 * fetch is `git fetch origin main` — main only. So `origin/<branch>` on the
 * served clone is refreshed by a deploy or by this verb, and by nothing else.
 * There is no arithmetic on the `status` payload that produces this number; a
 * dispatcher change would be needed to get it for free. See docs and the note
 * on `telemetry.pollDeployedRef` for the cadence that pays for it instead.
 *
 * NULL IS "WE DO NOT KNOW", NEVER "ZERO". The branch may have been deleted on
 * the remote, HEAD may be detached, the box may not have answered yet. Callers
 * must render nothing in that case rather than claiming the box is current —
 * silence is honest, a confident zero is not.
 */
export interface RefUpdate {
  /** The branch the served clone is on. Never `main`; see below. */
  ref: string
  /** Commits on `origin/<ref>` that the served clone does not have. */
  behind: number
  /** The tip `behind` was measured against, 40-hex. */
  tipSha: string
  /** The deployed commit it was measured from, 40-hex. */
  deployedSha: string
  /**
   * The host's own fetch did not finish inside its budget and it answered from
   * the refs already on disk, so `behind` may undercount. Carried rather than
   * dropped for the same reason the branch picker says it out loud.
   */
  stale: boolean
  /** When the console received this reading, epoch ms. */
  at: number
}

/**
 * Pull {@link RefUpdate} out of a `branches` answer.
 *
 * MAIN IS DELIBERATELY EXCLUDED, even though the arithmetic would work there
 * too. On main `behindMain` is already the answer, it is refreshed on every
 * fifteen-second `status` poll for free, and it is what the badge, the watcher,
 * the Host page and the game-side nudge have always read. A second number
 * measuring the same distance by a different route would eventually disagree
 * with the first — after a `branches` fetch that timed out, say — and there is
 * no version of "two different commit counts for main" that helps anybody.
 */
export function refUpdateFrom(
  b: HostBranches,
  at = Date.now(),
): RefUpdate | null {
  const ref = b.deployedRef
  if (!ref || ref === 'main') return null

  const row = b.branches.find((x) => x.name === ref)
  if (!row) return null

  return {
    ref,
    // `ahead` on this row is "commits this branch has that the deployed sha
    // does not", which is precisely how far the box is behind its own branch.
    behind: row.ahead,
    tipSha: row.sha,
    deployedSha: b.deployedSha,
    stale: b.stale,
    at,
  }
}

/**
 * WHICH COMMIT THE BOX IS ON, AND WHICH ONE A DEPLOY WOULD PUT ON IT.
 *
 * TWO SHAS AND NO COUNT, AND THE ABSENCE OF THE COUNT IS THE WHOLE DESIGN.
 * `refUpdateFrom` above refuses to answer for `main` on the grounds that
 * `behindMain` already measures that distance for free on the fifteen-second
 * `status` poll, and "two different commit counts for main" is a thing no
 * console should ever show. That objection is about a NUMBER. This carries no
 * number, so there is nothing for `behindMain` to disagree with — which is why
 * this one covers main and the parked case identically, from the same answer,
 * with one derivation.
 *
 * IT EXISTS BECAUSE A COUNT IS NOT CHECKABLE AND A SHA IS. "3 commits behind"
 * does not tell an operator whether to deploy; `4f2b9c1d → 9c1e77a4`, both
 * linked, lets them read what actually changed. Replacing the count meant
 * finding the target commit's identity, and `status` does not report it: the
 * dispatcher answers `HEAD`, `deployedRef` and `behindMain` and nothing about
 * the tip it is behind. The `branches` verb already resolves every remote tip,
 * so the sha is a field we were throwing away rather than a new question.
 *
 * `fromSha` IS THE HOST'S OWN `deployedSha`, NOT `status.sha`. They are the
 * same commit whenever both are fresh, but they come from two round trips on
 * two cadences, and pairing a `from` off one with a `to` off the other would
 * eventually render an arrow between two commits that were never adjacent. Both
 * ends come out of the one answer or neither does.
 *
 * NULL IS "WE DO NOT KNOW", exactly as it is above: no ref, no matching row,
 * or a branch the remote no longer has. A caller that cannot tell the operator
 * which two commits are involved must say nothing rather than guess one.
 */
export interface UpdateTarget {
  /** The ref the box is on. `main` INCLUDED, unlike {@link RefUpdate}. */
  ref: string
  /** The commit the served clone is on, 40-hex. */
  fromSha: string
  /** The tip of `ref` that a deploy would move it to, 40-hex. */
  toSha: string
  /**
   * The host answered from refs already on disk. `toSha` may therefore be an
   * OLD tip rather than the current one — carried so a reader is told the
   * arrow's right-hand side is only as fresh as the last successful fetch.
   */
  stale: boolean
  /** When the console received this reading, epoch ms. */
  at: number
}

/** Pull {@link UpdateTarget} out of a `branches` answer. */
export function updateTargetFrom(
  b: HostBranches,
  at = Date.now(),
): UpdateTarget | null {
  const ref = b.deployedRef
  if (!ref) return null

  const row = b.branches.find((x) => x.name === ref)
  if (!row || !b.deployedSha) return null

  return {
    ref,
    fromSha: b.deployedSha,
    toSha: row.sha,
    stale: b.stale,
    at,
  }
}

/**
 * Pin the ref the game host's NEXT deploy will check out. Does not deploy.
 *
 * THE SHA IS THE POINT, not the name. Hours pass between an admin choosing a
 * branch and the last match ending, and anyone with push access can force-push
 * in between. The far side compares this sha against `origin/<ref>` and refuses
 * if they differ, so a moved branch is an error somebody reads rather than a
 * silent deploy of a tip nobody looked at. `deploy.sh` then checks the same
 * thing again before it touches the working tree.
 *
 * THE NAME IS BASE64 for the same reason a kick reason is: it is free text from
 * a Discord profile, it travels in a space-separated command line, and one
 * space in it would shift every argument after it. It is cosmetic on arrival —
 * the box stores it for the console's banner and never reads it to decide
 * anything.
 */
export async function switchRef(
  ref: string,
  sha: string,
  byName: string,
): Promise<{ ok: boolean; pinnedRef?: string; pinnedSha?: string; error?: string }> {
  const encoded = Buffer.from(byName, 'utf8').toString('base64')
  return runVerb('switchref', ref, sha, encoded)
}

/**
 * One engine convar, as `configreport` describes it.
 *
 * THE SOURCE IS NOT DECORATION. "Why is this not what I set" is the question
 * the Live config page exists to answer, and a bare value cannot answer it.
 */
export interface HostConvar {
  name: string
  /**
   * `null` MEANS UNSET, AND IS NOT THE SAME AS `''`. An empty string is a
   * convar somebody set to nothing; null is one nobody has mentioned, so the
   * engine's own built-in default is in effect. The game host deliberately does
   * not guess what that default is — it does not know FXServer's internals, and
   * a confident wrong number is worse than a blank.
   */
  value: string | null
  /** `server.cfg` when the name appears there, `default` when it does not. */
  source: 'server.cfg' | 'default'
  /** Line in server.cfg, so "where is that set" has an answer. 0 when unset. */
  line: number
}

/** One gamemode tuning value, already formatted for display by the game host. */
export interface HostConfigValue {
  /** Display grouping — `Storm phases`, `Payout`, and so on. */
  group: string
  /** The `br_lib/config/*.lua` file it was read out of. */
  file: string
  key: string
  value: string
}

export interface HostConfig {
  ok: boolean
  /** When the host built this report, epoch ms. */
  at: number
  /** Absolute path of the server.cfg that was read. */
  serverCfg: string
  /** Absolute path of the deployed `br_lib` the values were read from. */
  libDir: string
  /** FXServer's start time, epoch ms. 0 when it is not running. */
  startedAt: number
  /** Newest mtime across server.cfg and the config files, epoch ms. */
  configMtime: number
  /**
   * The files have changed since FXServer read them, so the RUNNING server is
   * on older values than this report shows.
   *
   * The one way this report could mislead somebody, said out loud. It cannot be
   * fixed by reading harder: a live convar means `GetConvar`, which means
   * running inside FXServer, and the only channel there is `tmux send-keys` —
   * a write, which would make the verb one of the dangerous ones. Comparing
   * mtimes against the process start needs no such thing.
   */
  staleSinceStart: boolean
  convars: HostConvar[]
  /**
   * The gamemode half. Separately `ok` because it can fail on its own — the
   * host may have no Lua interpreter, or may not have deployed a commit that
   * carries `tools/config_report.lua` — while the convars are still perfectly
   * readable. Half a report beats an error page.
   */
  game: {
    ok: boolean
    loadErrors: string[]
    values: HostConfigValue[]
  }
}

/**
 * What this server is actually configured with.
 *
 * READ-ONLY ON BOTH SIDES. The far side opens files and runs one Lua script
 * over them; it starts nothing, writes nothing, and takes no arguments, so
 * there is nothing here for it to interpret.
 *
 * IT REPORTS AN ALLOWLIST, NEVER A DUMP, and that is the whole design rather
 * than a detail. `server.cfg` holds `sv_licenseKey` and would hold
 * `rcon_password` and `br_ringmaster_ingest_secret` on a fuller box; this
 * renders in a browser and lands in an audit log. The names that come back are
 * written out one by one in `do_configreport` in the game repo's
 * `tools/dispatch.sh`, and its `verify.sh` refuses any that look
 * credential-shaped. Nothing on this side filters, because nothing on this side
 * can be the thing that decides — by the time a value is here it has already
 * been published.
 *
 * NOT POLLED. Same reasoning as `branches`: config changes when somebody edits
 * a file and redeploys, not on a fifteen-second cadence, and every call is an
 * SSH round trip to the game box.
 */
export function readConfig(): Promise<HostConfig> {
  return runVerb<HostConfig>('configreport')
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
