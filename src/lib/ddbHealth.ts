/**
 * TWO FACTS ABOUT br_ddb, AND THEY ARE NOT THE SAME FACT.
 *
 * The owner asked for one indicator ("DynamoDB Status: Connected"). There are
 * two questions underneath it and one indicator cannot answer both:
 *
 *   1. REACHABILITY — can the br_ddb running on the game box talk to DynamoDB
 *      right now? Credentials, route, IAM, region, table names.
 *   2. BUNDLE — is the box running a `br_ddb/dist/server.js` that is the file
 *      its own `dist/fingerprint.json` describes?
 *
 * A PERFECTLY BUILT BUNDLE STILL FAILS TO REACH AWS WHEN THE INSTANCE ROLE IS
 * WRONG, AND A STALE BUNDLE CONNECTS FINE. Folding them into one green light
 * would mean the light is on whenever either half is healthy, or off whenever
 * either half is not — and in both spellings the operator cannot tell which
 * thing to go and fix. They stay two readings, from two transports, all the way
 * to two cards. `scripts/check-ddb-health.mjs` pins that they never cross.
 *
 * ═══ WHAT THE BUNDLE READING MEANS, AND THE THREE THINGS IT DOES NOT ═══
 *
 * `tools/br_ddb_fingerprint.sh` in the game repo records two hashes beside the
 * bundle: `source` (the js-src tree the bundle was recorded against) and
 * `bundle` (the bundle file itself). The box has the bundle and the manifest.
 * IT HAS NO SOURCE TREE AND NO BUILD TOOL, so the only comparison available
 * there is bundle-file-on-disk against the `bundle` hash beside it.
 *
 * So this reading says: THE BUNDLE ON THE BOX IS THE FILE ITS MANIFEST
 * DESCRIBES. It does NOT say:
 *
 *   * that the bundle was rebuilt from the current source. That is the
 *     `source` half, it needs the js-src tree, and it is checked by
 *     `tools/verify.sh` before a commit ever lands — issue #218's actual gate.
 *     It cannot be re-derived on a box that has no source.
 *   * that the bundle is CORRECT. Nothing here or there compiles or reads a
 *     line of it.
 *   * anything about tampering. The manifest sits in the same directory as the
 *     bundle, writable by whoever can write the bundle. This is a MISTAKE
 *     DETECTOR — an interrupted rsync, a hand-patched bundle, a file dropped in
 *     from another build — and it must not be described as a security property
 *     anywhere in this console.
 *
 * ═══ NOTHING HERE REACHES A SERVER ═══
 *
 * No runtime imports at all, the same property `serverPhase` and `incidentChip`
 * keep: the header chip and the banner are client components, and `lib/ssh`
 * touches `node:child_process` at module scope. The two wire shapes below are
 * declared here rather than imported so this file stays loadable in a browser
 * bundle and in `tsx` for the gate.
 */

/** Can the game box's br_ddb talk to DynamoDB? */
export type Reach = 'connected' | 'unreachable' | 'unknown'

/** Is the bundle on the box the file its manifest describes? */
export type BundleState = 'matched' | 'mismatched' | 'unknown'

/**
 * The DynamoDB probe, as the game server reports it.
 *
 * SHAPED AFTER `br:ddb:selftest`, which already exists in the game repo and is
 * what the `brddb` console command prints — a real GetItem against the bans
 * table, so `ok` means credentials, route, region and permission all worked
 * rather than "a socket opened".
 *
 * `at` IS ON THE GAME CLOCK, like every other timestamp the game sends;
 * `realTime(envelope.server, at)` converts it. Callers here are handed the
 * converted value because this module has no envelope to convert against.
 */
export interface DdbProbe {
  ok: boolean
  /** The failure, in the game's own words. Absent when `ok`. */
  error?: string | null
  region?: string | null
  /** Table-name prefix the resource is configured with. */
  prefix?: string | null
  /** Round-trip milliseconds of the probe itself. */
  ms?: number | null
}

/**
 * The bundle manifest as it is on the box, and the bundle as it is on the box.
 *
 * BOTH HALVES ARE OPTIONAL AND THEIR ABSENCES MEAN DIFFERENT THINGS, which is
 * why they are two fields rather than a precomputed boolean. A missing
 * `manifest` is a game build from before `dist/fingerprint.json` existed; a
 * missing `onDisk` is a dispatcher that could not hash the file. Neither is a
 * mismatch, and a boolean computed on the box could not tell us which.
 */
export interface BundleReading {
  /** What `dist/fingerprint.json` records, verbatim. */
  manifest?: {
    scheme?: string | null
    source?: string | null
    /** sha256 the manifest claims for the bundle. */
    bundle?: string | null
    bundleBytes?: number | null
    files?: number | null
  } | null
  /** sha256 of `dist/server.js` as it is on the box right now. */
  onDisk?: string | null
}

/**
 * HOW OLD A PROBE MAY BE AND STILL BE CALLED "RIGHT NOW".
 *
 * The game does not round-trip to DynamoDB on every push — it caches its last
 * selftest and resends the verdict — so this ceiling is about the PROBE's age,
 * not the feed's. Five minutes is chosen from both ends: long enough that a
 * probe cadence of a minute never flaps to "unknown" on one skipped beat, short
 * enough that a verdict from a previous era of the box's life is never reported
 * as the current one.
 *
 * IT EXPIRES `ok` AND `!ok` ALIKE, and the symmetry is deliberate. Letting a
 * stale FAILURE keep sounding would be an alarm nothing can clear except a
 * fresh success, which is the "a flag was set" failure this whole feature is
 * written against. It is safe precisely because a live feed refreshes this
 * value continuously: a probe that has aged out while the game is still pushing
 * means the game stopped probing, and "we are not being told" is the honest
 * reading of that.
 */
export const PROBE_MAX_AGE_MS = 5 * 60_000

/**
 * FACT ONE. Reachability, from the ingest snapshot.
 *
 * NULL/UNDEFINED IS `unknown`, NEVER `unreachable`, at every one of the four
 * doors it can arrive through: a console that has not been pushed to yet, a
 * game build that predates the block, a br_ddb that never started, and a probe
 * that has aged out. A false red here is worse than no red at all, because it
 * teaches the owner to ignore the real one.
 */
export function reachNow(
  probe: DdbProbe | null | undefined,
  /** When the probe ran, as a real timestamp. Null = the game did not say. */
  probeAtMs: number | null | undefined,
  now: number,
): Reach {
  if (!probe) return 'unknown'
  if (typeof probeAtMs !== 'number') return 'unknown'
  if (now - probeAtMs > PROBE_MAX_AGE_MS) return 'unknown'
  return probe.ok ? 'connected' : 'unreachable'
}

/**
 * FACT TWO. Bundle against its own manifest, from the `status` verb.
 *
 * ONE HASH COMPARISON AND NO INFERENCE AROUND IT. Every way of not having both
 * hashes is `unknown` — and in particular a manifest whose `bundle` field is
 * absent is unknown rather than mismatched, because the first version of
 * `fingerprint.json` could legitimately have recorded only `source`.
 *
 * The comparison is case-insensitive on the hex because `sha256sum`, `shasum`
 * and `openssl dgst` are three tools that have historically disagreed about
 * case, and a mismatch reported over letter case would be a false critical.
 */
export function bundleNow(reading: BundleReading | null | undefined): BundleState {
  const claimed = reading?.manifest?.bundle
  const actual = reading?.onDisk
  if (typeof claimed !== 'string' || claimed === '') return 'unknown'
  if (typeof actual !== 'string' || actual === '') return 'unknown'
  return claimed.toLowerCase() === actual.toLowerCase() ? 'matched' : 'mismatched'
}

/** What a card says. The healthy words are the owner's own. */
export const REACH_LABEL: Record<Reach, string> = {
  connected: 'Connected',
  unreachable: 'Disconnected',
  unknown: '—',
}

export const BUNDLE_LABEL: Record<BundleState, string> = {
  matched: 'Matches',
  mismatched: 'Mismatch',
  unknown: '—',
}

/**
 * One thing that is wrong, and what to do about it.
 *
 * `steps` IS THE ONE PLACE IN THIS CONSOLE PROSE IS ALLOWED, and only because
 * the owner asked for it by name: "a popup on click that describes exactly what
 * went wrong and how to fix it". It says what broke and the steps to fix it and
 * stops there — no background, no caveats, no explanation of what the check
 * means. That reasoning lives in comments, where it does not cost a reader
 * anything.
 */
export interface Fault {
  /**
   * Stable id, so a surface can key on it without matching on English.
   *
   * THE `dispatch-*` IDS ARE NOT br_ddb's, AND THEY ARE HERE ON PURPOSE. The
   * SSH channel health added in `lib/dispatchHealth` is a different subsystem
   * with a different transport, but it is the SAME KIND of statement and it
   * earns the same four surfaces the owner asked for here — a card, a chip, a
   * strip and a popup that ends when the fault does. Copying this interface
   * into that module would have given the console two fault contracts, two
   * dialogs and two ways for "undismissable" to be re-litigated. It imports
   * this type instead, so `components/DdbHealth.tsx` renders both and
   * `check-ddb-health.mjs`'s sweep for dismissal machinery covers both.
   */
  id:
    | 'ddb-unreachable'
    | 'bundle-mismatch'
    | 'dispatch-key-unreadable'
    | 'dispatch-unreachable'
    | 'dispatch-rejected'
    | 'dispatch-verb-failed'
  title: string
  /** What went wrong. */
  detail: string
  /** In order. Numbered by the renderer. */
  steps: string[]
}

/**
 * EVERYTHING THAT IS WRONG RIGHT NOW — a pure function of the two current
 * readings, and of nothing else.
 *
 * ═══ THIS SIGNATURE IS THE UNDISMISSABLE REQUIREMENT ═══
 *
 * The owner: the alert "cannot be dismissed until the problem is fixed". The
 * way that is usually built is a dismissed-flag with a re-arm rule, and the way
 * it usually fails is that the flag outlives the fault, or the re-arm never
 * fires and a fixed problem stays on screen until somebody reloads.
 *
 * SO THERE IS NO FLAG. There is no `dismissed` parameter, no state, no storage
 * key and no timestamp: this takes two readings and returns what is currently
 * broken. Every surface renders `faults(...)` directly, so "undismissable"
 * falls out of there being nothing to dismiss, recovery clears the alert on the
 * next poll because the reading changed, and a regression brings it straight
 * back for the same reason. `scripts/check-ddb-health.mjs` asserts that adding
 * an argument to this function cannot re-introduce the flag.
 *
 * UNKNOWN CONTRIBUTES NOTHING. Only a stated failure is a fault.
 */
export function faults(reach: Reach, bundle: BundleState): Fault[] {
  const out: Fault[] = []

  if (reach === 'unreachable') {
    out.push({
      id: 'ddb-unreachable',
      title: 'br_ddb cannot reach DynamoDB',
      detail:
        'The game server probed DynamoDB and the call failed. Bans are not ' +
        'being checked at connect, and match results are not being saved.',
      /**
       * THE THREE CAUSES ARE THE GAME REPO'S OWN, VERBATIM IN SUBSTANCE — they
       * are what `brddb` prints in br_ddb/server/debug.lua, in the order it
       * says is worth checking. Rewriting them here would be a second copy of
       * an operational answer that the people who hit this will also read on
       * the FXServer console, and the two would drift.
       */
      steps: [
        'Check the instance role has GetItem on the ringmaster-bans table.',
        'Check there is a route from the game box to DynamoDB — the VPC endpoint or the NAT.',
        'Check the region: set br_ddb_region in server.cfg.',
        'Run brddb on the FXServer console to re-probe once a cause is ruled out.',
      ],
    })
  }

  if (bundle === 'mismatched') {
    out.push({
      id: 'bundle-mismatch',
      title: 'br_ddb bundle does not match its manifest',
      detail:
        'dist/server.js on the game box is not the file dist/fingerprint.json ' +
        'beside it describes.',
      /**
       * REDEPLOY FIRST because the overwhelmingly likely cause is an rsync that
       * did not finish, and a deploy rewrites both files together. The rebuild
       * is second because it is the answer to the rarer case and it is the step
       * people skip: re-recording the manifest without rebuilding makes this
       * card go green over the same wrong bundle.
       */
      steps: [
        'Deploy from Maintenance — the sync replaces the bundle and its manifest together.',
        'If it comes back: in js-src/br_ddb run npm run build, then tools/br_ddb_fingerprint.sh, and commit both.',
        'Do not re-record the manifest without rebuilding first.',
      ],
    })
  }

  return out
}
