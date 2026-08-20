import type { IncidentState, IncidentVerdict, VerdictAction } from './incidents'
import { labelFor } from './labels'

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
 * IT IMPORTS NOTHING THAT REACHES A SERVER, deliberately, the same property
 * `serverPhase` keeps: `lib/incidents` owns the labels but also reaches
 * DynamoDB, so a client component cannot import it. Its only import from there
 * is `import type`, which erases — so this module is safe in a browser bundle,
 * and the label MAP still arrives as a prop from the server the way
 * `categoryLabel` always has. `lib/labels` is pure and has no imports at all.
 *
 * THE LABELS ARE NOT DUPLICATED HERE EITHER. `verdictLabel` is passed in rather
 * than re-declared, so `VERDICT_LABEL` in lib/incidents stays the only place the
 * English for a verdict is written down.
 */

const TONE = {
  pending: 'bg-warn/10 text-warn ring-warn/30',
  /** Something was done to a person. */
  action: 'bg-danger/10 text-danger ring-danger/25',
  /** A decision, or nothing recorded at all. The owner's "white" chip. */
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

/** Was something DONE to the player? The one question the red chip answers. */
function actionTaken(v: IncidentVerdict | null | undefined): boolean {
  return v != null && (v.action === 'ban' || v.action === 'kick')
}

export interface RowChip {
  label: string
  tone: string
}

/**
 * The chips on one incident row.
 *
 * ═══ TWO CHIPS, NOT ONE COMPOUND WORD (owner, playtest) ═══
 *
 * This used to return a single chip whose label was `resolved · banned`, with
 * the whole thing painted red. The owner: "When an incident is resolved, all we
 * need is the white 'resolved' chip. If an action was taken, that should be its
 * own (red) chip and read specifically 'KICKED' or 'BANNED'."
 *
 * WHICH IS ALSO THE MORE HONEST SHAPE, because the two halves are answers to
 * different questions. "Is this case closed" is a fact about the QUEUE — it is
 * why the row is in the Resolved tab — and it is true of every closed incident.
 * "Was somebody banned" is a fact about a PLAYER, it is true of a minority, and
 * folding it into the first one meant the common case wore the loud colour of
 * the rare one for the sake of a `·`.
 *
 * "RESOLVED" ALONE WAS THE ORIGINAL PROBLEM (#28) AND IT STILL IS NOT THE WHOLE
 * ANSWER — but the fix for it is the second chip, not a compound first one. A
 * list of closed incidents still says which ones ended in an action; it just
 * says it in the place an eye can skip.
 *
 * A ROW WITH NO VERDICT GETS NO SECOND CHIP, AND MUST NOT. Anything closed
 * before the field existed, and anything the system auto-resolved, carries
 * nothing — and "no verdict recorded" is a DIFFERENT state from a recorded
 * verdict of `none`. Neither gets a red chip, because neither is an action; the
 * distinction between them is not something a two-chip row can carry, and the
 * incident page's Verdict card is where it is stated in words.
 */
export function incidentChips(
  i: { state: IncidentState; verdict?: IncidentVerdict | null },
  verdictLabel: Record<string, string>,
): RowChip[] {
  if (i.state !== 'resolved') {
    return [{ label: 'pending review', tone: TONE.pending }]
  }

  const chips: RowChip[] = [{ label: 'resolved', tone: TONE.quiet }]

  if (i.verdict && actionTaken(i.verdict)) {
    chips.push({
      label: labelFor(verdictLabel, i.verdict.action),
      tone: TONE.action,
    })
  }

  return chips
}

/**
 * The one line a listed incident is READ as.
 *
 * ═══ WHY THE CONSOLE COMPOSES THIS FOR PLAYER REPORTS ═══
 *
 * The game writes `summary` as `('Reported for %s by %s'):format(ev.category,
 * ev.reporterName)` — `br_lib/shared/incident_build.lua` — so the stored line
 * for a chat report literally reads "Reported for abusive_chat by Xeon". The
 * owner, on seeing it: "it should display as 'Abusive chat'".
 *
 * IT IS REBUILT FROM THE STRUCTURED FIELDS RATHER THAN REWRITTEN AS TEXT. The
 * category is its own attribute on the row and `CATEGORY_LABEL` already owns
 * the English for it; running a substitution over a sentence to find an id
 * inside it would be guessing at a format the other repository is free to
 * change. This is the same thing the profile page has done since #143, and it
 * is now shared rather than a second copy of the decision.
 *
 * THE REPORTER IS DROPPED FROM THE LINE, NOT LOST. Every surface that renders
 * this also renders "reported by X" underneath it, so the game's sentence said
 * the name twice on one row. The console's version says the thing the row's
 * other lines do not.
 *
 * SYSTEM-FILED CASES KEEP THEIR SUMMARY VERBATIM. An anticheat escalation's
 * summary is built from two integers and a prose refusal reason — there is no
 * id in it, and no structured field that could reproduce it. `category` is
 * `system` there, which is not a thing anybody reported anybody FOR.
 */
export function incidentHeadline(
  i: { kind: string; category: string; summary: string },
  categoryLabel: Record<string, string>,
): string {
  if (!filedByAPlayer(i)) return i.summary
  return `Reported for ${labelFor(categoryLabel, i.category)}`
}

/**
 * Did a PERSON file this, about a category they chose?
 *
 * Shared because three surfaces ask it and it is not quite `kind === 'report'`:
 * the `system` category is what an escalation carries, and "Reported for
 * System" is nonsense in any of the three.
 */
export function filedByAPlayer(i: {
  kind: string
  category: string
}): boolean {
  return i.kind === 'report' && i.category !== 'system'
}
