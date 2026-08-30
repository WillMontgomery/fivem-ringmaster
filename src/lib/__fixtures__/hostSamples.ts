import type { hostView } from '@/lib/telemetry'

type View = ReturnType<typeof hostView>
type Sample = View['samples'][number]

/**
 * Host telemetry windows, for the design harness.
 *
 * SYNTHETIC, AND SAYING SO IS THE POINT. Its neighbour `hostConfig.ts` is a
 * recording of a real `configreport` because the shape of that payload is
 * intricate and a hand-written guess at it would be believed while being wrong
 * — the lesson `synth.ts` records from #17. This file is the opposite case:
 * `HostTelemetry` is ten numbers, there is nothing to get subtly wrong about
 * its shape, and what the harness needs is not one real window but SEVERAL
 * SHAPES OF WINDOW that a real box only produces if you wait for them. Nobody
 * is going to restart a game server to photograph the one-sample state.
 *
 * DETERMINISTIC, via a seeded generator rather than `Math.random`. Two reviewers
 * looking at the same harness URL should be looking at the same chart, and a
 * fixture that reshuffles on every reload makes "is that spike new" unanswerable.
 *
 * THE NUMBERS ARE PLAUSIBLE RATHER THAN TIDY, which matters more than it
 * sounds. A chart drawn from a smooth sine wave hides everything charts get
 * wrong — overlapping fills, a legend colliding with a peak, an axis that
 * cannot decide on its ticks. These wander, and the CPU series has a deliberate
 * spike so the tooltip has something worth hovering.
 */

/** Mulberry32. Small, fast, and the same sequence everywhere. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GB = 1024 * 1024 // in KB
const MEM_TOTAL_KB = 16 * GB
const DISK_TOTAL_KB = 200 * GB

/**
 * A window of `count` samples, `stepMs` apart, ending at `endAt`.
 *
 * `endAt` DEFAULTS TO A FIXED INSTANT rather than `Date.now()`. Every offset
 * this console draws is measured from the newest sample, so the absolute value
 * is invisible in the chart — and a fixed one keeps the fixture stable across a
 * server render and the client hydration that follows it.
 */
export function hostSamples({
  count,
  stepMs = 15_000,
  endAt = 1_786_910_000_000,
  seed = 7,
}: {
  count: number
  stepMs?: number
  endAt?: number
  seed?: number
}): Sample[] {
  const rand = seeded(seed)
  const out: Sample[] = []

  let cpu = 28
  let memUsedKb = MEM_TOTAL_KB * 0.42

  for (let i = 0; i < count; i++) {
    const at = endAt - (count - 1 - i) * stepMs

    // A random walk with a pull back towards the middle, so it wanders without
    // escaping to 0 or 100 over a long window.
    cpu += (rand() - 0.5) * 9 + (38 - cpu) * 0.05
    // One deliberate spike, three quarters of the way along.
    const spikeAt = Math.floor(count * 0.75)
    if (i >= spikeAt && i < spikeAt + 3) cpu += 22
    cpu = Math.min(97, Math.max(3, cpu))

    // Memory climbs slowly, the way a server with a slow leak does.
    memUsedKb += MEM_TOTAL_KB * 0.0006 + (rand() - 0.5) * MEM_TOTAL_KB * 0.004
    memUsedKb = Math.min(MEM_TOTAL_KB * 0.88, Math.max(MEM_TOTAL_KB * 0.3, memUsedKb))

    const memAvailKb = MEM_TOTAL_KB - memUsedKb

    // A game server sends considerably more than it receives.
    const rxRate = 40_000 + rand() * 55_000 + (cpu > 70 ? 30_000 : 0)
    const txRate = 260_000 + rand() * 420_000 + (cpu > 70 ? 350_000 : 0)

    out.push({
      at,
      cpuPct: cpu,
      cores: 8,
      memTotalKb: MEM_TOTAL_KB,
      memAvailKb,
      memPct: ((MEM_TOTAL_KB - memAvailKb) / MEM_TOTAL_KB) * 100,
      // Cumulative counters. The console derives rates from consecutive pairs;
      // the rates are carried alongside because that is what the window holds.
      rxBytes: Math.round(rxRate * (i + 1) * (stepMs / 1000)),
      txBytes: Math.round(txRate * (i + 1) * (stepMs / 1000)),
      diskTotalKb: DISK_TOTAL_KB,
      diskAvailKb: DISK_TOTAL_KB * 0.41,
      rxRate,
      txRate,
    })
  }

  /*
   * THE FIRST SAMPLE HAS NO PREDECESSOR AND SO HAS NO RATE, and the fixture
   * reproduces that rather than papering over it. `rateBetween` in lib/telemetry
   * returns zero for the first sample of a window because a rate needs two
   * counter readings — so a real first sample really does show 0 B/s, and a
   * harness that showed it as 300 KB/s would be hiding the one case the empty
   * states below exist to describe.
   */
  if (out[0]) {
    out[0] = { ...out[0], rxRate: 0, txRate: 0 }
  }

  return out
}

/**
 * The windows worth being able to look at deliberately. Each is a real state a
 * console reaches, and each has to read correctly rather than merely not crash.
 *
 * NOTES ARE FOR WHOEVER OPENS THE HARNESS, NOT FOR A PAGE. None of this text is
 * rendered anywhere — the preview route labels each state with its key and
 * nothing else, because the owner's standing rule forbids explanatory copy on
 * pages and a design harness is still a page.
 *
 *   full    120 samples, 15s apart — the whole 30-minute window, the most
 *           lib/telemetry ever holds. The processor spike sits three quarters
 *           along, so there is something worth hovering.
 *   sparse  4 samples, 45 seconds. The line occupies the right-hand sliver it
 *           genuinely covers instead of stretching to fill the width.
 *   single  1 sample. Fewer than two points is not a line, so all three charts
 *           show the drawn no-data state.
 *   empty   0 samples. THE CASE THE NO-DATA STATE EXISTS FOR: an area chart
 *           handed an empty series draws a flat line along zero, which reads as
 *           an idle box rather than a silent one.
 *   gappy   6 samples twelve minutes apart. Draws at 30 minutes; switch the
 *           range to 5 minutes and only one reading falls inside it, which
 *           exercises the third no-data path.
 */
export const HOST_WINDOWS: Record<string, Sample[]> = {
  full: hostSamples({ count: 120 }),
  sparse: hostSamples({ count: 4, seed: 12 }),
  single: hostSamples({ count: 1, seed: 3 }),
  empty: [],
  gappy: hostSamples({ count: 6, stepMs: 12 * 60_000, seed: 21 }),
}

/** What the status cards read, and the two commit readings that pair. */
type StatusFixture = Pick<View, 'status' | 'refUpdate'>

/**
 * The readings the STATUS CARDS have to get right, which the sample windows
 * above say nothing about.
 *
 * WHY THIS EXISTS, and it is a defect report rather than a design note. The
 * harness fed `HostCharts` directly and skipped `HostBoard`, on the reasoning
 * that "the charts are what is under review and the status cards above them are
 * not". The cards then shipped wrong twice in a fortnight — a Processor card
 * printing a core count on a live-status row, and a commit chip still reading
 * "update on dev" after the owner had asked for "Update available" — and both
 * were invisible to everyone reviewing them, because reaching that markup meant
 * a real session against a real game box. The second one was corrected in the
 * wrong file for a fortnight and nobody could see that either.
 *
 * THE COMMIT CARD IS THE WHOLE REASON THERE ARE SIX OF THESE. It is the one
 * card with a branch per reading, and its three-way split is deliberately not a
 * boolean: behind, level, and NOT YET KNOWN. Only a positive reading earns the
 * update chip, only a known zero earns the tick, and an unanswered host earns
 * silence — the rule `behindMainNow` and `refBehindNow` enforce, which is
 * unreviewable unless all three can be summoned from a URL.
 *
 *   behind    on main, two commits back. The update chip.
 *   parked    on `dev`, behind its tip. The SAME chip and no branch name — this
 *             is the exact card that read "update on dev".
 *   current   on main, level. The green tick.
 *   unknown   a dispatcher too old to report `behindMain`. Neither chip: a
 *             commit stated as a fact, with no verdict beside it.
 *   down      FXServer stopped. Uptime has nothing to say.
 *   none      no status at all — the cold console, before the first SSH round
 *             trip lands. Every card an em-dash.
 */
export const HOST_STATUS: Record<string, StatusFixture> = {
  behind: {
    status: {
      running: true,
      pid: 4821,
      uptimeSec: 3 * 3600 + 14 * 60,
      commit: 'a3f9c21',
      sha: 'a3f9c2149e0b7d5c8f31a06b4e29d7c0158af6b3',
      behindMain: 2,
      hostUptimeSec: 26 * 86_400,
      deployedRef: 'main',
    },
    refUpdate: null,
  },

  parked: {
    status: {
      running: true,
      pid: 4821,
      uptimeSec: 47 * 60,
      commit: '7c14e0d',
      sha: '7c14e0d93b6a2f8517cc40e1b9d3a67f2e05c8d4',
      // A LARGE PERMANENT DISTANCE NOBODY IS ACTING ON, and it must not reach
      // the card: off main, `behindMainNow` returns null and `refBehindNow`
      // answers instead. If this number ever renders here, that rule broke.
      behindMain: 63,
      hostUptimeSec: 26 * 86_400,
      deployedRef: 'dev',
    },
    refUpdate: {
      ref: 'dev',
      behind: 4,
      tipSha: 'f0271ab84c9d3e6a5b17820fd94c6e3a1b58a7c2',
      deployedSha: '7c14e0d93b6a2f8517cc40e1b9d3a67f2e05c8d4',
      // A BRANCH THE BOX WOULD ACTUALLY TAKE, which is a separate question from
      // how far behind it is and now travels beside it. The Host page states
      // the reading; the control that acts on it is on /maintenance, and
      // `/preview/maintenance?state=parked-blocked` is where the refusal is
      // rehearsed.
      eligible: true,
      blockedBy: '',
      stale: false,
      at: 1_786_910_000_000,
    },
  },

  current: {
    status: {
      running: true,
      pid: 4821,
      uptimeSec: 11 * 60,
      commit: 'a3f9c21',
      sha: 'a3f9c2149e0b7d5c8f31a06b4e29d7c0158af6b3',
      behindMain: 0,
      hostUptimeSec: 26 * 86_400,
      deployedRef: 'main',
    },
    refUpdate: null,
  },

  unknown: {
    // No `behindMain` and no `deployedRef` — an older `do_status` that answers
    // neither. `behindMain` is required on HostStatus, so an absent one arrives
    // as undefined over the wire and is spelled that way here.
    status: {
      running: true,
      pid: 4821,
      uptimeSec: 9 * 3600,
      commit: 'a3f9c21',
      hostUptimeSec: 26 * 86_400,
    } as StatusFixture['status'],
    refUpdate: null,
  },

  down: {
    status: {
      running: false,
      pid: 0,
      uptimeSec: 0,
      commit: 'a3f9c21',
      sha: 'a3f9c2149e0b7d5c8f31a06b4e29d7c0158af6b3',
      behindMain: 0,
      hostUptimeSec: 26 * 86_400,
      deployedRef: 'main',
    },
    refUpdate: null,
  },

  none: { status: null, refUpdate: null },
}

/** The two br_ddb readings. */
type DdbFixture = Pick<View, 'ddb' | 'bundle'>

/**
 * The br_ddb readings, on an axis of their own.
 *
 * ═══ A THIRD AXIS RATHER THAN MORE `HOST_STATUS` KEYS ═══
 *
 * These are INDEPENDENT of whether FXServer is behind, parked or level, and
 * folding them into that record would have implied a coupling that does not
 * exist — as well as multiplying six status keys by six readings. More
 * importantly it would have made the two br_ddb facts look like one axis with
 * the commit reading, which is the exact confusion the feature is built to
 * avoid.
 *
 * BOTH FACTS ARE ON THIS ONE AXIS, AND THAT IS DELIBERATE TOO: the states worth
 * reviewing are the COMBINATIONS. `both` is the only way to see the two-fault
 * popup and the "br_ddb has two problems" heading, and `half` is the case that
 * proves an unknown sitting next to a stated reading renders as silence rather
 * than borrowing its neighbour's colour.
 *
 *   silent        neither fact told. The default, the cold console, and — until
 *                 the game-side half lands — the ONLY state a real console can
 *                 currently be in. Two em-dashes, no chip, no banner.
 *   healthy       both stated good. Two green readings, chrome silent.
 *   disconnected  br_ddb cannot reach DynamoDB, bundle fine.
 *   stale-bundle  reaches DynamoDB fine, bundle is not the file its manifest
 *                 describes. The case that proves one light cannot do both.
 *   both          two faults at once, which the popup has to enumerate.
 *   half          DynamoDB stated, bundle not told — a dispatcher that predates
 *                 the bundle block. Green beside an em-dash, and NO alarm.
 */
export const HOST_DDB: Record<string, DdbFixture> = {
  silent: { ddb: { reach: 'unknown', probe: null }, bundle: 'unknown' },

  healthy: {
    ddb: {
      reach: 'connected',
      probe: { ok: true, region: 'us-east-1', prefix: 'ringmaster-', ms: 14 },
    },
    bundle: 'matched',
  },

  disconnected: {
    ddb: {
      reach: 'unreachable',
      probe: {
        ok: false,
        // A REAL AWS ERROR STRING, not "something went wrong". The popup renders
        // this verbatim and the whole reason it is carried is that an
        // AccessDenied and a timeout are two different afternoons — a fixture
        // that says neither could not review that.
        error:
          'AccessDeniedException: User: arn:aws:sts::4815162342:assumed-role/fivem-box/i-0ab1 ' +
          'is not authorized to perform: dynamodb:GetItem on resource: ringmaster-bans',
        region: 'us-east-1',
        prefix: 'ringmaster-',
        ms: 231,
      },
    },
    bundle: 'matched',
  },

  'stale-bundle': {
    ddb: {
      reach: 'connected',
      probe: { ok: true, region: 'us-east-1', prefix: 'ringmaster-', ms: 12 },
    },
    bundle: 'mismatched',
  },

  both: {
    ddb: {
      reach: 'unreachable',
      probe: {
        ok: false,
        error: 'TimeoutError: socket hang up after 5000ms',
        region: 'us-east-1',
        prefix: 'ringmaster-',
        ms: 5_003,
      },
    },
    bundle: 'mismatched',
  },

  half: {
    ddb: {
      reach: 'connected',
      probe: { ok: true, region: 'us-east-1', prefix: 'ringmaster-', ms: 17 },
    },
    bundle: 'unknown',
  },
}

/**
 * ═══ A FOURTH AXIS: THE SSH CHANNEL, WHICH NOTHING COULD REVIEW ═══
 *
 * The Host page spent an hour of a real outage rendering em-dashes and the
 * words "last update failed" while `/api/host` carried the cause in its body,
 * and NOBODY HAD EVER SEEN THAT SHAPE. There was no way to: reaching it means a
 * console whose private key is genuinely unreadable, or a game box that is
 * genuinely unreachable. Every argument `HOST_STATUS` makes for existing — the
 * states that matter are the ones you cannot summon — applies here twice over,
 * because this is the state in which the page is at its least useful and its
 * least looked at.
 *
 * ITS OWN AXIS AND NOT MORE `HOST_DDB` KEYS, for the reason that record gives
 * for not being folded into `HOST_STATUS`: these are independent facts on a
 * different transport. br_ddb reaches AWS from the GAME box; this is the
 * console's own route TO that box. The combination worth reviewing is
 * `?ddb=healthy&dispatch=key-unreadable` — a green DynamoDB card beside a red
 * channel — because that is precisely the pair that misled two people for an
 * hour, and it is only reviewable if the two axes are separate.
 *
 * THE ERROR TEXT IS THE INCIDENT'S OWN, VERBATIM IN SHAPE. `key-unreadable`
 * carries `execFile`'s `Command failed:` framing, then ssh's `Load key` line,
 * then the publickey refusal that FOLLOWED FROM IT — which is the string the
 * card's one line and `machineSaid` have to get right. A fixture that said
 * "ssh failed" could not review either.
 *
 *   ok              the channel works. One green word, no chip, no strip.
 *   unknown         the poll timer has not run. An em-dash — the cold console.
 *   unconfigured    GAME_HOST/GAME_SSH_KEY unset. NOTE: on `/host` this is the
 *                   whole-page "not configured yet" panel instead; this key is
 *                   how the card's own fallback stays reviewable.
 *   key-unreadable  THE INCIDENT. The key on this box cannot be loaded.
 *   unreachable     no session opened at all.
 *   rejected        the game box answered and refused the key. The state that
 *                   proves the classifier reads the CAUSE and not the loudest
 *                   line — its text is the second half of key-unreadable's.
 *   verb-failed     logged in, and the dispatcher did not answer usefully.
 */
export interface DispatchFixture {
  dispatch: View['dispatch']
  lastError: string | null
}

export const HOST_DISPATCH: Record<string, DispatchFixture> = {
  ok: { dispatch: 'ok', lastError: null },

  unknown: { dispatch: 'unknown', lastError: null },

  unconfigured: { dispatch: 'unconfigured', lastError: null },

  'key-unreadable': {
    dispatch: 'key-unreadable',
    lastError:
      'Command failed: ssh -i /opt/ringmaster-secrets/dispatch -o BatchMode=yes ' +
      '-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ' +
      '-o UserKnownHostsFile=/opt/ringmaster-secrets/known_hosts ' +
      'ubuntu@10.1.148.227 status\n' +
      'Load key "/opt/ringmaster-secrets/dispatch": Permission denied\n' +
      'ubuntu@10.1.148.227: Permission denied (publickey,password).',
  },

  unreachable: {
    dispatch: 'unreachable',
    lastError:
      'Command failed: ssh -i /opt/ringmaster-secrets/dispatch -o BatchMode=yes ' +
      '-o ConnectTimeout=5 ubuntu@10.1.148.227 status\n' +
      'ssh: connect to host 10.1.148.227 port 22: Connection timed out',
  },

  rejected: {
    dispatch: 'rejected',
    lastError:
      'Command failed: ssh -i /opt/ringmaster-secrets/dispatch -o BatchMode=yes ' +
      '-o ConnectTimeout=5 ubuntu@10.1.148.227 status\n' +
      'ubuntu@10.1.148.227: Permission denied (publickey,password).',
  },

  'verb-failed': {
    dispatch: 'verb-failed',
    lastError:
      'dispatch returned non-JSON: /opt/fivem/tools/dispatch.sh: line 84: ' +
      'tmux: command not found',
  },
}
