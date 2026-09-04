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
