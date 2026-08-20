import type { hostView } from '@/lib/telemetry'

type Sample = ReturnType<typeof hostView>['samples'][number]

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
