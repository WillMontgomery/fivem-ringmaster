/**
 * HOW OLD THE PICTURE IS, RESOLVED TO ONE WORD.
 *
 * ═══ WHY THIS IS A MODULE AND NOT TWO CONSTANTS IN A COMPONENT ═══
 *
 * The thresholds and the word they resolve to lived inside
 * `components/FeedStatus.tsx`, which was right for as long as the header chip
 * was the only thing that asked. `GET /api/health` is the second asker, and it
 * is the one that matters at four in the morning: it has to decide whether a
 * feed age is a fault worth waking somebody for, and a second pair of numbers
 * in the route would be a second opinion about the same fact. Then the chip in
 * the header could say `Feed lost` while the endpoint an operator wired a
 * checker to answered green, and there would be no way to tell from either
 * surface which of them was lying.
 *
 * SO IT IS THE SAME RULE `lib/dispatchHealth` AND `lib/ddbHealth` FOLLOW, for
 * the same stated reason: one classification, in one place, and every surface
 * renders it rather than re-deriving it. The chip, the endpoint, and
 * `check-health-route.mjs` all call the function below.
 *
 * ═══ NOTHING HERE REACHES A SERVER, AND THAT IS LOAD-BEARING ═══
 *
 * No imports at all. `FeedStatus` is a `'use client'` component, so anything
 * this module pulled in would be pulled into the client bundle with it — the
 * property `lib/dispatchHealth` keeps deliberately and for the same reason.
 */

/**
 * WHAT THE FEED IS DOING, IN ONE WORD.
 *
 * `offline` IS NOT `dead` AND THE DIFFERENCE IS THE WHOLE POINT OF HAVING
 * FOUR WORDS. `dead` means the game was pushing to this process and stopped;
 * `offline` means it never pushed at all, which is what a console looks like
 * for the first couple of seconds after a restart AND what it looks like when
 * the game host has been down since before the console came up. `liveView`
 * hands out `null` rather than `0` for exactly this reason, and collapsing the
 * two here would throw the distinction away one layer further down.
 */
export type Feed = 'live' | 'stale' | 'dead' | 'offline'

/**
 * Beyond this the feed is late — the game pushes every 2s by default.
 *
 * IT IS THREE PUSHES, NOT ONE. A single dropped push is normal on a busy tick
 * and colouring the header for it would be the chip crying wolf every few
 * minutes on a perfectly healthy server.
 */
export const STALE_MS = 6_000

/**
 * Beyond this, assume the game server or the link is gone.
 *
 * THIS IS THE NUMBER `/api/health` PAGES ON, so it is worth saying what it is
 * not: it is not a guess at how long an operator will tolerate stale data, it
 * is fifteen missed pushes. Nothing that is merely busy misses fifteen in a
 * row; something that has stopped misses all of them.
 *
 * ═══ AND IT LEAVES THIS PROCESS, WHICH IS WHY IT MAY BE MOVED FREELY ═══
 *
 * `/api/health` PUBLISHES IT AS `feedDeadMs`, beside the `ingestAgeMs` it was
 * used to judge. That is not decoration. The consumer of that payload is in
 * another repository, is not rebuilt when this line changes, and used to hold
 * its own copy of thirty seconds — so moving this constant made the two
 * disagree about the word "dead" with nothing in either of them to say which
 * was right, and both would have looked finished in review. It is the same
 * defect that kept these thresholds in `components/FeedStatus.tsx`, one
 * boundary further out and correspondingly harder to see.
 *
 * SO THIS IS THE ONE PLACE THE NUMBER LIVES, AND MOVING IT IS A ONE-FILE
 * CHANGE. The header chip, the endpoint's verdict and whatever is polling that
 * endpoint all follow it in the same deploy. `scripts/check-health-route.mjs`
 * holds the property that makes that true — that the route publishes THIS
 * binding rather than a literal of its own — instead of pinning the value.
 */
export const DEAD_MS = 30_000

/**
 * The feed, right now, from one age.
 *
 * NULL IS `offline` AND NEVER `live`. `liveView().ageMs` is null when this
 * process has never been pushed to, and the arithmetic that would otherwise
 * happen to a null in a comparison renders "there has never been a feed" as
 * "the feed is perfectly fresh" — the exact inversion the null exists to
 * prevent.
 *
 * ═══ AND A NEGATIVE AGE IS `offline` FOR THE SAME REASON ═══
 *
 * IT IS AN IMPOSSIBLE READING, AND EVERY COMPARISON BELOW QUIETLY CALLED IT THE
 * HEALTHIEST ONE. `liveView` computes `now - receivedAt` from two readings of
 * one clock, so the moment that clock steps BACKWARDS — an NTP correction after
 * drift, a hypervisor time sync, somebody setting the date by hand — the age is
 * negative for the length of the step. A negative number is not greater than
 * `DEAD_MS` and not greater than `STALE_MS`, so it fell through both
 * comparisons to `live` and STAYED there for the whole step, however dead the
 * feed actually was: a green chip in the header, `200 {"ok":true}` from
 * `/api/health`, and a confident `IngestFeedDead 0` published by the collector
 * off the same number.
 *
 * `offline` IS ALREADY THE WORD FOR A NON-READING THAT COUNTS AS A FAULT, which
 * is precisely what this is: the console cannot say how old the picture is, and
 * it must not answer that cheerfully. Clamping to zero was the other option and
 * it is the worse one — it would render an impossible reading as a perfect one,
 * which is the same inversion the paragraph above is about.
 */
export function feedNow(ageMs: number | null): Feed {
  if (ageMs === null) return 'offline'
  if (ageMs < 0) return 'offline'
  if (ageMs > DEAD_MS) return 'dead'
  if (ageMs > STALE_MS) return 'stale'
  return 'live'
}

/**
 * ═══ HOW OLD THE PICTURE IS BETWEEN POLLS, WITHOUT TRUSTING THE VIEWER'S CLOCK
 *     ═══
 *
 * THE BUG THIS EXISTS TO DELETE. The header chip used to compute
 * `Date.now() - lastPushAt`, where `Date.now()` is the BROWSER's wall clock and
 * `lastPushAt` was stamped on the CONSOLE SERVER's. Those are two different
 * clocks, so the subtraction is not an age, it is an age plus the difference
 * between two machines. The owner's own machine was three to four seconds fast,
 * which put the reading directly on the 6000ms `STALE_MS` boundary, and the chip
 * flipped between `Live` and `Falling behind` on very nearly every render. Fixing
 * his clock stopped the symptom. It did not fix the code, and a viewer's clock
 * must never be able to make the console lie about the feed.
 *
 * SO THE AGE IS THE SERVER'S, ADVANCED BY A MONOTONIC CLOCK. `/api/state`
 * already computes `view.ageMs` from two readings of ONE clock - its own - and
 * already ships it. The component records that number together with a
 * `performance.now()` reading taken at the moment it arrived, and between polls
 * renders `serverAgeMs + (performance.now() - at)`. Two clocks are still
 * involved and neither is compared to the other: one supplies the ORIGIN and one
 * supplies the ELAPSED.
 *
 * `performance.now()` AND NOT `Date.now()`, AND THAT IS THE WHOLE POINT.
 * `performance.now()` is monotonic and is not moved by an NTP step, a hypervisor
 * time sync, a daylight saving change or somebody setting the date by hand. The
 * same paragraph is already written above about a NEGATIVE age, which is what a
 * backwards wall clock produced on the server side of this same arithmetic; this
 * is the browser side of the same defect.
 *
 * ═══ AND THERE IS DELIBERATELY NO HYSTERESIS ═══
 *
 * A band around the threshold would also have stopped the flicker, and it would
 * have been the wrong fix: the reading was wrong, not noisy. It would also have
 * had to live in `feedNow`, which is a PURE function shared with
 * `GET /api/health` - making it stateful would give the endpoint an operator
 * pages on a memory of what it said last time, which is a different contract
 * from the one `check-health-route.mjs` holds it to.
 *
 * NULL IS CARRIED THROUGH AND NEVER FILLED IN. A poll that legitimately answers
 * "this console has never been pushed to" must reach `feedNow` as null so it
 * renders `No data`. The chip used to write `polled.view.lastPushAt ?? seed`,
 * which threw that answer away and kept ageing from a stale seed until it
 * eventually claimed `Feed lost` - a statement about a feed that had stopped,
 * for a console that never had one.
 */
export interface FeedAnchor {
  /** The age the SERVER computed, or null if it has never been pushed to. */
  serverAgeMs: number | null
  /** A `performance.now()` reading from the moment that age arrived. */
  at: number
}

export function ageFrom(anchor: FeedAnchor, mark: number): number | null {
  if (anchor.serverAgeMs === null) return null
  /**
   * CLAMPED AT ZERO ON THE ELAPSED HALF ONLY. `performance.now()` cannot go
   * backwards, so this can only fire if a reading is taken from a different time
   * origin than the anchor - which is a bug, and adding a negative number to a
   * real age would report the feed as FRESHER than the server said it was.
   * Adding nothing reports it as exactly what the server said, which is the safe
   * direction and is also what the very first render does.
   */
  return anchor.serverAgeMs + Math.max(0, mark - anchor.at)
}

/**
 * IS THIS FEED A STATED FAILURE — the same shape of question `dispatchFaults`
 * and `faults` answer for the other two channels, and answered here so that
 * `lib/healthVerdict` has one list to consult rather than three spellings of
 * "which words are bad".
 *
 * `stale` IS NOT A FAILURE AND THAT IS A DELIBERATE CALL. Six seconds behind is
 * a busy tick or a garbage collection, it clears on its own, and a checker that
 * paged on it would page most nights — which is how an operator learns to
 * silence the one that matters. `dead` and `offline` are both failures: one is
 * a feed that stopped and one is a feed that never started, and neither is
 * something a console can be asked a useful question while in.
 */
export function feedFailed(feed: Feed): boolean {
  return feed === 'dead' || feed === 'offline'
}
