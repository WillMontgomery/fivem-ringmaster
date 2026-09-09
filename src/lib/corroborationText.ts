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
 * ═══ AND ONLY THE ANTICHEAT'S ROWS ARE EVER FOLDED ═══
 *
 * A person's corroboration is a person's evidence and may not be absorbed into
 * somebody else's tally. TWO SEPARATE TESTS KEEP ONE OUT OF A RUN, and each
 * covers rows the other cannot reach. The author is one: the gamemode now puts
 * `reporterLicense` and `reporterName` on both of its human paths and on none
 * of the anticheat's, so a corroboration written after that build deploys names
 * the person who filed it. {@link gradesSeverity} is the other, read off the
 * sentence, and it is the only thing standing over the rows ALREADY in the
 * owner's table: those were stored `byLicense: null, byName: 'System'` for a
 * person exactly as for the machine, he does not hand-edit DynamoDB, and no
 * deploy reaches backwards to credit them. A run also never reaches further
 * than a match can last; see {@link MATCH_REACH_MS}.
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
 * The two labeled clauses, named once so the builder and the matchers below
 * cannot disagree about them.
 *
 * `worst:` IS LOAD-BEARING AND NOT DECORATION. See {@link gradesSeverity}: on a
 * row stored before the gamemode began naming a human reporter, it is the one
 * thing left that says the anticheat wrote it.
 */
const REASON_PREFIX = 'last: '
const SEVERITY_PREFIX = 'worst: '

/** The kind, spelled once. The renderer is grepped for this literal. */
const CORROBORATED = 'corroborated'

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
    input.reason ? `${REASON_PREFIX}${input.reason}` : null,
    input.severity ? `${SEVERITY_PREFIX}${input.severity}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(SEP) : 'Still happening.'
}

/**
 * ═══ WHAT A ROW WITH NO AUTHOR STILL SAYS ABOUT WHO WROTE IT ═══
 *
 * Does this sentence carry a graded severity, which only the anticheat sends.
 *
 * THE PROBLEM THIS SOLVES IS THE ROWS THAT ARE ALREADY STORED. The fold below
 * must never swallow a person's report into somebody else's tally. The obvious
 * test is the author, and on a row written from here on the author is there:
 * the gamemode sends `reporterLicense` on both human paths and on none of the
 * anticheat's. It is not there on anything written before that, because every
 * corroboration reached this console as `byLicense: null, byName: 'System'`, a
 * person's and the anticheat's alike. The owner does not hand-edit DynamoDB, so
 * those rows will never carry an author whatever the gamemode does next, and
 * the author test is blind to every one of them. This test can still read them.
 *
 * SEVERITY IS THE DISCRIMINATOR, AND IT IS STRUCTURAL RATHER THAN A HEURISTIC.
 * Both of the gamemode's human paths omit it deliberately and say why in the
 * source: `br_core/server/players.lua` at the panel report and again at the
 * keypress report, "NO SEVERITY, for the reason BR.IncidentBuild.fromReport
 * gives: a human's category is not a measurement, and grading it here would
 * invent confidence that does not exist." All three anticheat paths in
 * `br_core/server/incident.lua` send one: the refusal doubling forwards
 * `ev.severity`, and the strip and the vehicle handlers both read
 * `BR.ShotTier[...]`. So `worst:` on the row means a machine graded it.
 *
 * IT FAILS TOWARDS NOT FOLDING, WHICH IS THE DIRECTION THAT MATTERS. An
 * anticheat corroboration that somehow arrived without a severity is not folded
 * and renders exactly as it does today, which costs a tidier page. The
 * alternative failure is deleting one player's report from the record, which
 * `br_core/server/incident.lua` calls "destroying evidence rather than tidying
 * it" where it explains why the human paths skip its own throttle.
 *
 * ANCHORED AT THE END, because {@link corroborationText} joins the severity
 * last. A reason that happened to contain the word cannot be mistaken for one.
 */
export function gradesSeverity(text: string | null | undefined): boolean {
  const parts = (text ?? '').split(SEP)
  const last = parts[parts.length - 1] ?? ''
  return last.startsWith(SEVERITY_PREFIX) && last.length > SEVERITY_PREFIX.length
}

/**
 * Whether the byline on a row should be a link to a profile.
 *
 * TRUTHY, NOT `!== null`, AND THE DIFFERENCE IS A 404. `incidents.ts` writes
 * `byLicense: input.actor.license ?? ''` for a signed-in admin with no grants
 * row, which `lib/grants.ts` says is normal and fully privileged. An empty
 * string is not null, so a null test renders `/players/?from=…`, a route that
 * does not exist. This is the same truthy test the case header already makes
 * about its filer.
 *
 * AND ONLY ON A CORROBORATION. The owner asked for his own corroboration to be
 * credited; nothing was asked about the row that opens a case or the row that
 * closes one, and turning those names into links is a change he did not
 * request. Those rows render the name as plain text, exactly as before.
 */
export function linksAuthor(
  event: ConsoleTimelineEvent,
): event is ConsoleTimelineEvent & { byLicense: string } {
  return (
    event.kind === CORROBORATED &&
    typeof event.byLicense === 'string' &&
    event.byLicense !== ''
  )
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
 * half minutes, so this rounds rather than truncates. A span of one reads
 * singular.
 *
 * ═══ THE LADDER STEPS WHERE THE ROUNDING STEPS, AND IT USED NOT TO ═══
 *
 * This tested `minutes < 90` on the ROUNDED minutes and then rounded the raw
 * span into hours, and those two roundings disagreed in the band between them:
 * 89 minutes read "89 minutes" and 89 and a half read "1 hour", a longer span
 * printing a shorter duration, while 90 read "2 hours", a third more than it
 * was. A duration that goes backwards as the run gets longer is worse than an
 * imprecise one, because the page is then evidence of nothing.
 *
 * Each rung now hands over exactly where its own rounding would carry: seconds
 * hand over when they round to sixty, and sixty seconds IS one minute, so the
 * next rung's first reading is "1 minute" and never a smaller number than the
 * last one it replaced. Minutes hand over to hours on the same rule, which is
 * also what makes "1 hour" reachable at all. Under `< 90` it never was, because
 * 90 minutes divided by an hour rounds to 2. Every reading is within half of its
 * own unit of the truth, which is all that rounding to a unit can promise.
 *
 * A ZERO SPAN STILL READS AS A DURATION. Two corroborations can share an
 * instant; `in 0 seconds` would be a claim about the clock rather than about
 * the match, so the floor is one second.
 */
export function corroborationSpan(ms: number): string {
  const span = Number.isFinite(ms) && ms > 0 ? ms : 0
  const seconds = Math.max(1, Math.round(span / SECOND))
  if (seconds < 60) return plural(seconds, 'second')
  const minutes = Math.round(span / MINUTE)
  if (minutes < 60) return plural(minutes, 'minute')
  return plural(Math.round(span / HOUR), 'hour')
}

/** The owner's sentence, with the two numbers filled in. */
export function corroborationRollup(times: number, spanMs: number): string {
  return `happened ${times} times in ${corroborationSpan(spanMs)}`
}

type ConsoleRow = Extract<TimelineRow, { source: 'console' }>

/**
 * The longest a run may reach, and therefore the longest span it can claim.
 *
 * ═══ A CASE IS CORROBORATED ACROSS NIGHTS, AND THE ROW SAYS "THIS MATCH" ═══
 *
 * `br_core/server/players.lua`'s keypress report attaches to
 * `BR.Incident.openFor`, which is NOT match scoped, and its own comment says
 * what that costs: "A day-old case corroborated in tonight's round restarts at
 * 2." Two corroborations days apart with nothing stored between them are
 * consecutive ROWS, and an unbounded fold turned them into one line reading
 * "refusals this match … happened 2 times in 72 hours", a sentence that
 * contradicts itself and presents two nights as one recurring offense.
 *
 * ONE HOUR, WHICH IS THE LONGEST A MATCH CAN BE. The gamemode's own
 * `br_lib/shared/incident_build.lua` sets `MATCH_ENDS_BY_MS = 60 * 60 * 1000`
 * against a round that runs about twenty minutes, and this console already
 * spends the same number for the same reason in `matchTimeline`'s
 * `OFFSET_REACH_MS`, "one hour is three matches". A run that reaches further
 * than a match can is not one recurring offense, whatever the sentences say.
 *
 * IT IS THE WHOLE RUN AND NOT THE GAP BETWEEN NEIGHBORS. Bounding only the gap
 * would still let twenty rows an hour apart each collapse into a row claiming
 * twenty hours, which is the same lie with more steps.
 */
const MATCH_REACH_MS = 60 * 60_000

/**
 * A row that may join a run: an anticheat corroboration with a readable clock.
 *
 * ═══ TWO LOCKS, AND NEITHER OF THEM IS THE SPARE ═══
 *
 * A person's corroboration must never be absorbed into a run.
 * `!row.event.byLicense` and {@link gradesSeverity} each refuse one, they
 * refuse over DIFFERENT rows, and dropping either leaves a set of rows with
 * nothing over them. Do not collapse this to a single test.
 *
 * THE AUTHOR TEST COVERS EVERY ROW WRITTEN FROM HERE ON. The gamemode's
 * `br_core/server/players.lua` now puts `reporterLicense` and `reporterName` on
 * both of its human paths and `br_ringmaster` forwards them; the three
 * anticheat paths in `br_core/server/incident.lua` send neither, on purpose, so
 * that an absent reporter reads as "the system did this" rather than as "we did
 * not look". With that build on the box a credited row is excluded on its own
 * account, and nothing has to be inferred from its sentence.
 *
 * `gradesSeverity` COVERS THE ROWS ALREADY IN DYNAMODB, WHICH NOTHING ELSE CAN.
 * Everything stored before that build was written `byLicense: null,
 * byName: 'System'`, a person's byte for byte the same as the anticheat's. The
 * owner does not hand-edit DynamoDB and no deploy reaches backwards, so those
 * rows will never carry an author and the author test cannot see them at all.
 * The severity is the only mark left on them saying which one wrote it.
 *
 * WHAT AN UNGUARDED ROW ACTUALLY COSTS. The keypress path sends ONE reason for
 * every report it ever makes, `BR.Config.defaultReportCategory()`, so two
 * players reporting the same case fingerprint alike. Take away whichever lock
 * covers those two rows and they fold into one, with one player's report gone
 * from the page. That is the regression against the complaint that started
 * this: his row would not merely lack a name, it could vanish.
 */
function foldable(row: TimelineRow): row is ConsoleRow {
  return (
    row.source === 'console' &&
    row.event != null &&
    row.event.kind === CORROBORATED &&
    !row.event.byLicense &&
    gradesSeverity(row.event.text) &&
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
 *
 * AND A RUN NEVER REACHES FURTHER THAN A MATCH. See {@link MATCH_REACH_MS}: a
 * row too far from the one that opened the run starts a new run instead of
 * joining it, so the collapsed sentence cannot claim a span the thing it is
 * describing could not have had.
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
      const opener = run[0]
      const withinReach =
        opener !== undefined && row.at - opener.at <= MATCH_REACH_MS
      if (withinReach && fingerprint === print) {
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
