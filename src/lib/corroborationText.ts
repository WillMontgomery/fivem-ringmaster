/**
 * ═══ THE CORROBORATION SENTENCE, AND THE ROLL-UP THAT KEEPS IT READABLE ═══
 *
 * The owner, reading a real case: "a recurring offense of the anticheat system
 * turns into tons of lines of corroborations. That shouldn't happen. Just say
 * how many times it fired and across how long (example 'happened 20 times in 10
 * minutes')". His screenshot is twenty consecutive rows thirty seconds apart,
 * every one of them saying the same thing about the same offense with a bigger
 * number in front of it.
 *
 * ═══ WHY THIS IS A RENDER-TIME FOLD AND NOT A DIFFERENT WRITE ═══
 *
 * The rows are already in DynamoDB and the owner does not edit DynamoDB by
 * hand. A write-time roll-up could only repair cases corroborated after it
 * deployed, and it would have to REPLACE the last element of `events` rather
 * than append to it: a GetItem before every write, a lost-update race between
 * two ingest batches on one case, and a deliberate break of the one write shape
 * `check:corroboration` guards. A fold over the merged list needs no stored
 * field, no backfill, and repairs the case that is open on his screen right now.
 *
 * ═══ WHY IT IS HERE AND NOT IN `matchTimeline` ═══
 *
 * `lib/matchTimeline` has no runtime imports at all and that property is
 * load-bearing (its own header, and `matchTimeline.check.ts`'s). The fold needs
 * the fingerprint, the fingerprint belongs beside the builder that produces the
 * sentence it strips, and putting all three here keeps the sentence in ONE
 * module end to end: the ingest route builds it, this folds on it, and neither
 * spells the other's format. The only thing crossing the boundary is a type
 * import, which is erased.
 *
 * NO NEW WORDS ON THE PAGE BEYOND THE ONES THE OWNER WROTE. Every character
 * before the appended clause is the row's existing text; the clause itself is
 * his example sentence with the two numbers filled in.
 */

import type { ConsoleTimelineEvent, TimelineRow } from './matchTimeline'

/**
 * The separator the ingest route has always joined these parts with, and the
 * one the appended clause is joined on. Named once so the builder and the
 * fingerprint cannot disagree about it.
 */
const SEP = ' · '

/**
 * What the console records when the game says the subject is still at it.
 *
 * MOVED OUT OF `api/ingest/route.ts` RATHER THAN COPIED. The fold below groups
 * rows by this sentence with its count clause removed, so a format that lived
 * in the route and a matcher that lived in the renderer would be two spellings
 * of one decision, and the failure mode of them drifting is silent: nothing
 * folds and the page looks exactly as it does today.
 *
 * `Still happening.` IS THE EXISTING FALLBACK and is kept verbatim. It is what
 * the row says when the game sent an envelope with no count, no reason and no
 * severity, which is a shape the wire allows.
 */
export function corroborationText(input: {
  count?: number | null
  reason?: string | null
  severity?: string | null
}): string {
  const parts = [
    typeof input.count === 'number' ? `${input.count} refusals this match` : null,
    input.reason ? `last: ${input.reason}` : null,
    input.severity ? `worst: ${input.severity}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(SEP) : 'Still happening.'
}

/**
 * The leading count clause, which is the ONLY part that differs between two
 * rows of the same run.
 *
 * The game's count is cumulative (543, then 573), so two reports about the same
 * weapon at the same severity arrive as two sentences that differ in one
 * number. Strip that number and they are the same sentence, which is what makes
 * "these are the same recurring offense" a decision this module can prove
 * rather than a guess about adjacency.
 */
const COUNT_CLAUSE = /^\d+ refusals this match(?: · )?/

/** The sentence with its count clause removed. Two rows of a run share this. */
export function corroborationFingerprint(text: string | null | undefined): string {
  return (text ?? '').replace(COUNT_CLAUSE, '')
}

const SECOND = 1_000
const MINUTE = 60_000
const HOUR = 3_600_000

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * How long a run reached back, in the unit a person would say it in.
 *
 * THE UNITS COME FROM THE OWNER'S OWN EXAMPLE AND NOTHING ELSE. "happened 20
 * times in 10 minutes" is twenty rows thirty seconds apart, which is nine and a
 * half minutes, so this rounds rather than truncates. Under a minute it says
 * seconds, past ninety minutes it says hours, and a span of one reads singular.
 *
 * A ZERO SPAN STILL READS AS A DURATION. Two corroborations delivered in one
 * ingest batch share a millisecond, because the route stamps a batch with one
 * clock; `in 0 seconds` would be the page reporting on its own delivery rather
 * than on the match, so the floor is one second.
 */
export function corroborationSpan(ms: number): string {
  const span = Number.isFinite(ms) && ms > 0 ? ms : 0
  const seconds = Math.max(1, Math.round(span / SECOND))
  if (seconds < 60) return plural(seconds, 'second')
  const minutes = Math.round(span / MINUTE)
  if (minutes < 90) return plural(minutes, 'minute')
  return plural(Math.round(span / HOUR), 'hour')
}

/** The owner's sentence, with the two numbers filled in. */
export function corroborationRollup(times: number, spanMs: number): string {
  return `happened ${times} times in ${corroborationSpan(spanMs)}`
}

type ConsoleRow = Extract<TimelineRow, { source: 'console' }>

/**
 * A row that may join a run.
 *
 * THREE TESTS, AND THE MIDDLE ONE IS THE ONE THAT PROTECTS PEOPLE. `byLicense`
 * is null only on the anticheat's own corroborations; a corroboration a person
 * filed carries their license, so it can never be swallowed into a roll-up and
 * lose its name. The kind test keeps admin notes and the case brackets out, and
 * the clock test keeps a row whose `at` is unreadable out of an arithmetic it
 * would turn into NaN.
 */
function foldable(row: TimelineRow): row is ConsoleRow {
  return (
    row.source === 'console' &&
    row.event != null &&
    row.event.kind === 'corroborated' &&
    row.event.byLicense === null &&
    Number.isFinite(row.at)
  )
}

/**
 * The run, as one row.
 *
 * IT KEEPS THE LAST MEMBER'S SENTENCE VERBATIM, because the game's count is
 * cumulative and its reason and severity are the latest and the worst so far.
 * The newest row already subsumes every earlier one, so nothing is summarized
 * and nothing is recomputed: the only new characters on the page are the
 * clause.
 *
 * AND THE LAST MEMBER'S INSTANT, so the offset column points at the most recent
 * occurrence and the span reaches backwards from it. The last member's `index`
 * comes with it, which keeps the component's React key unique.
 */
function collapse(first: ConsoleRow, last: ConsoleRow, times: number): ConsoleRow {
  const clause = corroborationRollup(times, last.at - first.at)
  const said = last.event.text
  const event: ConsoleTimelineEvent = {
    ...last.event,
    text: said ? `${said}${SEP}${clause}` : clause,
  }
  return { ...last, event }
}

/**
 * A run of identical system corroborations, as one row saying how many and how
 * long.
 *
 * SEPARATE FROM `mergeTimeline`, AND DELIBERATELY AFTER IT. That function's
 * documented contract is that nothing is dropped, and it must keep it: it is
 * the only thing that puts the console's list and the game's list in one order,
 * and a merge that also decided what to hide would be two rules in one place.
 * This runs over its output.
 *
 * CONSECUTIVE, WHICH IS STRICTER THAN "ALL OF THEM". A kill, a chat block, an
 * admin note or a human corroboration breaks the run and the fold starts again
 * after it. That fragments a burst with kills interleaved into several small
 * roll-ups, and that is the trade: the alternative is a page whose rows are no
 * longer in the order they happened.
 *
 * A GROUP OF ONE IS RETURNED UNTOUCHED, not rewritten with a clause saying it
 * happened once. One corroboration is the shape the page has always drawn.
 */
export function foldCorroborations(rows: readonly TimelineRow[]): TimelineRow[] {
  const out: TimelineRow[] = []
  let run: ConsoleRow[] = []
  let print = ''

  function flush(): void {
    const first = run[0]
    const last = run[run.length - 1]
    if (first === undefined || last === undefined) return
    out.push(run.length > 1 ? collapse(first, last, run.length) : first)
    run = []
  }

  for (const row of rows) {
    if (foldable(row)) {
      const fingerprint = corroborationFingerprint(row.event.text)
      if (run.length > 0 && fingerprint === print) {
        run.push(row)
        continue
      }
      flush()
      run = [row]
      print = fingerprint
      continue
    }
    flush()
    out.push(row)
  }
  flush()

  return out
}
