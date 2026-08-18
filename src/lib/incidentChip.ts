import type { IncidentState, IncidentVerdict, VerdictAction } from './incidents'

/**
 * How an incident's outcome is said on a row, in one place (#28).
 *
 * THREE SURFACES RENDER THIS AND THERE IS ONE OF IT. The incident queue's rows,
 * the profile's incident rows and the incident page's verdict card all have to
 * agree about which word a closed case gets and what colour it is — and the way
 * that goes wrong is not a crash. It is one list quietly reading "resolved"
 * where another reads "resolved · banned" about the same row, and nobody
 * noticing which is telling the truth.
 *
 * IT IMPORTS NOTHING AT RUNTIME, deliberately, the same property `serverPhase`
 * keeps: `lib/incidents` owns the labels but also reaches DynamoDB, so a client
 * component cannot import it. The only import here is `import type`, which
 * erases — so this module is safe in a browser bundle, and the label MAP still
 * arrives as a prop from the server the way `categoryLabel` always has.
 *
 * THE LABELS ARE NOT DUPLICATED HERE EITHER. `verdictLabel` is passed in rather
 * than re-declared, so `VERDICT_LABEL` in lib/incidents stays the only place the
 * English for a verdict is written down.
 */

const TONE = {
  pending: 'bg-warn/10 text-warn ring-warn/30',
  /** Something was done to a person. */
  action: 'bg-danger/10 text-danger ring-danger/25',
  /** A decision, or nothing recorded at all. */
  quiet: 'bg-muted/40 text-muted-foreground ring-border',
} as const

/**
 * The colour a verdict wears.
 *
 * "NO ACTION" IS NOT STYLED AS A FAILURE, and neither is a missing verdict. An
 * admin who looked at a report and concluded there was nothing in it did the job
 * correctly; a console that marks that outcome out in red or greys it into the
 * background teaches people to ban rather than decide (#28). Only `ban` and
 * `kick` — things that actually happened to somebody — take the loud colour.
 */
export function verdictTone(action: VerdictAction | null | undefined): string {
  return action === 'ban' || action === 'kick' ? TONE.action : TONE.quiet
}

/**
 * The chip on one incident row: its state, narrowed by its verdict.
 *
 * "RESOLVED" ALONE WAS THE WHOLE PROBLEM (#28). One word covered "this player
 * was banned" and "I watched a match and they were fine", so a list of closed
 * incidents was a list of things that had stopped rather than a record of what
 * was decided.
 *
 * A ROW WITH NO VERDICT KEEPS THE BARE WORD, AND MUST. Anything closed before
 * the field existed, and anything the system auto-resolved, carries nothing.
 * Narrowing those to "no action" would put a decision in the mouth of somebody
 * who never made one — which is the exact failure the verdict exists to end, so
 * the word narrows only when there is something to narrow it to.
 */
export function incidentChip(
  i: { state: IncidentState; verdict?: IncidentVerdict | null },
  verdictLabel: Record<string, string>,
): { label: string; tone: string } {
  if (i.state !== 'resolved') {
    return { label: 'pending review', tone: TONE.pending }
  }

  if (!i.verdict) return { label: 'resolved', tone: TONE.quiet }

  const word = (
    verdictLabel[i.verdict.action] ?? i.verdict.action
  ).toLowerCase()

  return { label: `resolved · ${word}`, tone: verdictTone(i.verdict.action) }
}
