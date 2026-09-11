/**
 * Contract checks for the feed-age chip (the LIVE / FALLING BEHIND flicker).
 *
 *   npx tsx src/lib/feedHealth.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts`, `scoreboard.check.ts` and the rest
 * of this repository. Wired into `npm run verify` as `check:feedage`.
 *
 * ═══ THE BUG ═══
 *
 * The header chip flickered between `Live` and `Falling behind` on nearly every
 * render. `components/FeedStatus.tsx` computed `now - lastPushAt` where `now`
 * was the BROWSER's `Date.now()` and `lastPushAt` had been stamped on the
 * CONSOLE SERVER's clock (`lib/state.ts`). That subtraction is not an age: it is
 * an age plus the difference between two machines' clocks. The owner's own
 * machine was three to four seconds fast, which put the result directly on the
 * 6000ms `STALE_MS` boundary, and the chip flipped on both sides of it
 * continuously.
 *
 * FIXING HIS CLOCK STOPPED THE SYMPTOM AND THAT IS NOT THE SAME AS FIXING IT. A
 * viewer's clock must never be able to make the console lie about the feed, and
 * the next person whose machine drifts would rediscover this from scratch.
 *
 * ═══ WHAT IS ASSERTED ═══
 *
 *   A. `ageFrom` reports the SERVER's age advanced by a MONOTONIC elapsed time,
 *      so a viewer's clock - fast, slow, or stepped mid-session - cannot move
 *      the verdict at all.
 *   B. A null age survives as null and renders `No data`, rather than being
 *      filled in from a stale seed and eventually reading `Feed lost`.
 *   C. `feedNow` IS STILL PURE. The other fix for a flicker is hysteresis, and
 *      it would have had to live inside `feedNow`, which `GET /api/health`
 *      shares. An endpoint an operator pages on must not answer from a memory of
 *      what it said last time.
 *   D. The component actually uses all of the above. A behavioural check on a
 *      helper proves nothing if the component still does its own arithmetic, so
 *      the source is read for the exact shapes that were wrong.
 *
 * ═══ EVERY ONE OF THESE WAS REVERTED AND RUN ═══
 *
 * Restoring `Date.now() - lastPushAt` in the component fails 2 cases; restoring
 * `?? initialLastPushAt` fails 2; making `ageFrom` report only the elapsed time
 * fails 9; and adding a remembered verdict to `feedNow` fails 3. None of them
 * passed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DEAD_MS, STALE_MS, ageFrom, feedFailed, feedNow, type FeedAnchor } from './feedHealth'

let failed = 0
/** Every case actually executed, loops included, so the gate reports real counts. */
let ran = 0
function fail(label: string, detail: string): void {
  failed++
  console.error(`  FAIL  ${label} - ${detail}`)
}
function expect(label: string, got: unknown, want: unknown): void {
  ran++
  if (got !== want) fail(label, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}
function expectTrue(label: string, got: boolean): void {
  ran++
  if (!got) fail(label, 'was false')
}

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

// ===========================================================================
// A. THE AGE IS THE SERVER'S, ADVANCED MONOTONICALLY
// ===========================================================================

console.log("A. the age is the server's, advanced by a monotonic clock")

/** A poll landed at monotonic reading 1000, saying the feed was 2s behind. */
const anchor: FeedAnchor = { serverAgeMs: 2_000, at: 1_000 }

expect('at the instant it landed, the age is exactly what the server said', ageFrom(anchor, 1_000), 2_000)
expect('a second later it is a second older', ageFrom(anchor, 2_000), 3_000)
expect('ten seconds later, ten seconds older', ageFrom(anchor, 11_000), 12_000)

/**
 * THE READING CANNOT GO BACKWARDS. `performance.now()` is monotonic, so this can
 * only happen if a mark is taken against a different time origin than the
 * anchor. Adding a negative would report the feed as FRESHER than the server
 * said, which is the direction that hides a fault.
 */
expect('a mark from before the anchor adds nothing rather than subtracting', ageFrom(anchor, 0), 2_000)

console.log("\nA. the viewer's clock cannot change the verdict")

/**
 * ═══ THE OWNER'S ACTUAL MACHINE, REPRODUCED ═══
 *
 * Three to four seconds fast, against a feed that is genuinely healthy at five
 * seconds behind. The OLD arithmetic - browser `Date.now()` minus server
 * `lastPushAt` - reads 5000 + the skew and crosses `STALE_MS` at a skew of
 * 1001ms. The new one cannot: the skew is not in it.
 */
{
  const SERVER_AGE = 5_000
  const lastPushAt = 1_000_000_000_000
  const serverNow = lastPushAt + SERVER_AGE

  expect('the feed really is live at five seconds', feedNow(SERVER_AGE), 'live')

  for (const skewMs of [-10_000, -3_500, 0, 3_500, 10_000]) {
    /** What the chip used to compute. Kept here so the defect is legible. */
    const oldReading = serverNow + skewMs - lastPushAt
    /** What it computes now: the server's own age, plus elapsed, with no clock of the viewer's in it. */
    const seeded: FeedAnchor = { serverAgeMs: serverNow - lastPushAt, at: 500 }
    const newReading = ageFrom(seeded, 500)

    expect(`skew ${skewMs}ms: the new reading is the server's age`, newReading, SERVER_AGE)
    expect(`skew ${skewMs}ms: and the verdict is live`, feedNow(newReading), 'live')

    if (skewMs > STALE_MS - SERVER_AGE) {
      expectTrue(
        `skew ${skewMs}ms: the OLD arithmetic would have said otherwise (${oldReading}ms)`,
        feedNow(oldReading) !== 'live',
      )
    }
  }
}

/**
 * AND A CLOCK THAT STEPS MID-SESSION CANNOT EITHER. An NTP correction moves
 * `Date.now()` and does not move `performance.now()`, so between two polls the
 * age climbs by exactly the wall time that passed.
 */
{
  const a: FeedAnchor = { serverAgeMs: 1_000, at: 5_000 }
  const before = ageFrom(a, 5_500)
  const after = ageFrom(a, 6_500)
  expect('one second of elapsed time is one second of age', (after ?? 0) - (before ?? 0), 1_000)
}

// ===========================================================================
// B. NULL IS AN ANSWER AND IS NEVER FILLED IN
// ===========================================================================

console.log('\nB. null survives, because "never pushed to" is not "the feed stopped"')

expect('a null server age stays null however long ago it landed', ageFrom({ serverAgeMs: null, at: 0 }, 900_000), null)
expect('and null renders as offline', feedNow(null), 'offline')
expectTrue('which is a stated failure', feedFailed('offline'))

/**
 * THE DEFECT THIS PINS. `FeedStatus` read `polled?.view.lastPushAt ??
 * initialLastPushAt`, so a poll that legitimately answered null was discarded
 * and the chip kept ageing from the server-rendered seed. Given enough time that
 * reads `Feed lost`, which is a claim that a feed STOPPED, about a console that
 * never had one.
 */
expectTrue('a stale seed aged past DEAD_MS would have said the feed was lost', feedNow(DEAD_MS + 1) === 'dead')
expectTrue('and the honest answer for the same console is offline', feedNow(null) === 'offline')

// ===========================================================================
// C. feedNow IS STILL PURE, WHICH IS THE FIX THAT WAS NOT MADE
// ===========================================================================

console.log('\nC. feedNow is stateless, so /api/health keeps its contract')

/**
 * HYSTERESIS WOULD ALSO HAVE STOPPED THE FLICKER AND IT IS THE WRONG FIX. The
 * reading was WRONG, not noisy. And it would have had to live here, in the
 * function `GET /api/health` calls, which would give an endpoint an operator
 * points a pager at an answer that depends on what it was asked last.
 */
{
  const around = [STALE_MS - 1, STALE_MS + 1, STALE_MS - 1, STALE_MS + 1, STALE_MS - 1]
  const verdicts = around.map((ms) => feedNow(ms))
  expect(
    'the same input gives the same answer whatever preceded it',
    verdicts.join(','),
    'live,stale,live,stale,live',
  )

  const climbing = [0, 1_000, 5_000, 7_000, 40_000].map((ms) => feedNow(ms))
  const falling = [40_000, 7_000, 5_000, 1_000, 0].map((ms) => feedNow(ms))
  expect(
    'and the direction of travel is not remembered',
    climbing.join(','),
    [...falling].reverse().join(','),
  )
}

// ===========================================================================
// D. THE COMPONENT ACTUALLY DOES THIS
// ===========================================================================

console.log('\nD. the chip uses the monotonic clock and the server age')

/**
 * READING THE SOURCE IS THE REPO'S ESTABLISHED SHAPE for a property that cannot
 * be driven offline - `scripts/check-health-route.mjs` does exactly this and
 * says why. A `'use client'` component with `useSyncExternalStore` and two
 * effects is not worth a renderer to assert four lines, but the four lines are
 * the whole fix, so they are pinned.
 */
{
  const src = read('src/components/FeedStatus.tsx')

  expectTrue('it reads the age the server computed', src.includes('polled.view.ageMs'))
  expectTrue('it marks time with performance.now()', src.includes('performance.now()'))
  expectTrue('and it does the arithmetic in the shared helper', src.includes('ageFrom(anchor, mark)'))

  /**
   * ═══ THE TWO SHAPES THAT WERE WRONG, BANNED BY NAME, IN CODE ONLY ═══
   *
   * Both are one careless edit away from coming back, and both fail silently:
   * the page looks correct to whoever wrote it, on whatever machine they wrote
   * it on.
   *
   * THE COMMENTS ARE STRIPPED FIRST AND THAT IS NOT A CONVENIENCE. The component
   * EXPLAINS the defect in prose - it has to, or the next person deletes the fix
   * as an over-complication - and that prose contains the exact expression this
   * bans. Matching the whole file would force the explanation to be written
   * around the check, which is the tail wagging the dog.
   * `scoreboard.check.ts` strips comments for the same reason and says so.
   */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  expectTrue(
    'it never subtracts a server timestamp from a browser clock',
    !/Date\.now\(\)\s*-\s*lastPushAt/.test(code) && !/\bnow\s*-\s*lastPushAt/.test(code),
  )
  expectTrue(
    'and it never fills a null lastPushAt in from the seed',
    !/lastPushAt\s*\?\?\s*initialLastPushAt/.test(code),
  )
  expectTrue(
    'no Date.now() in the component at all, because there is nothing it could be right for',
    !code.includes('Date.now()'),
  )

  /** The props still exist, because the seed has to be a server-minus-server pair. */
  expectTrue('the server-rendered pair is still the seed', src.includes('initialNow - initialLastPushAt'))
}

/**
 * AND NO HYSTERESIS LANDED IN THE SHARED FUNCTION. The source is read for the
 * shapes a stateful `feedNow` would need, because section C above would still
 * pass against a module-level variable that only remembered across a boundary
 * the check happens not to cross.
 */
{
  const src = read('src/lib/feedHealth.ts')
  const body = /export function feedNow[^]*?\n\}/.exec(src)?.[0] ?? ''
  expectTrue('feedNow was found', body.length > 0)
  expectTrue('feedNow holds no state of its own', !/\blet\b|\bvar\b/.test(body))
  expectTrue('and this module still imports nothing', !/^import /m.test(src))
}

console.log()
if (failed > 0) {
  console.error(`check:feedage - ${failed} failing case(s)`)
  console.error(
    'The header chip reports whether the data on screen is arriving. A viewer ' +
      "clock must never be able to change that answer. See src/lib/feedHealth.ts.",
  )
  process.exit(1)
}
console.log(`check:feedage - all ${ran} cases pass`)
