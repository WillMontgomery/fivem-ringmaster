import type { VerdictAction } from './incidents'
import type { ProfileActionTaken } from './profile'

/**
 * ONE ROW PER ACTION TAKEN, out of an audit log that deliberately writes more
 * than one row per action.
 *
 * ═══ WHY THE NAIVE LIST IS WRONG ═══
 *
 * The owner asked for "an additional table on the page labelled 'Actions taken'
 * which lists all times they've kicked, banned, or actioned an incident", and
 * then named the trap in the same breath: "they may ban as a verdict of an
 * incident - in which case it shouldn't be counted twice."
 *
 * They are right, and it is not a bug in the log. `/api/bans` with an
 * `incidentId` writes a `ban.issue` row AND then `closeWithVerdict` writes an
 * `incident.resolve` row, both carrying the same `detail.incidentId` — and that
 * pair is deliberate (#28: a ban issued this way IS the same audit action, and
 * the resolve row is what makes "who decided nothing was wrong" comparable
 * across every closure). Filtering either one out of the LOG would break the
 * audit log. Collapsing them for one table on one page does not.
 *
 * THERE IS A SECOND PAIR AND IT IS EASY TO MISS. Banning somebody who is
 * connected also writes a `player.kick` row with `detail.becauseOf: 'ban.issue'`
 * — the ban being carried out, not a second decision. A moderator's record that
 * read "Banned Vance" and "Kicked Vance" one millisecond apart would be counting
 * one act twice in a different costume, so that row folds too.
 *
 * ═══ THE GROUPING RULE, IN FULL ═══
 *
 * 1. Keep only the four actions that are moderation of a PLAYER: `ban.issue`,
 *    `ban.lift`, `player.kick`, `incident.resolve`. `maintenance.*`, `host.*`
 *    and the two `discord.*` rows are dropped — the first two are operating a
 *    server rather than acting on a person, and the `discord.*` rows are the
 *    CONSOLE refusing or logging a write, not an action anybody took.
 *
 * 2. Drop `player.kick` rows whose `detail.becauseOf` is `ban.issue`. The
 *    `ban.issue` row beside them is the act.
 *
 * 3. Group what is left by `detail.incidentId`. Rows with no incident id are
 *    never grouped with anything — they are their own act by definition.
 *
 * 4. In a group, THE ACTION ROW WINS and the `incident.resolve` row is folded
 *    into it, contributing its verdict. In a group that is only an
 *    `incident.resolve`, that row IS the act: closing a case with no action is
 *    something the admin did, and it is the third of the three things the owner
 *    listed.
 *
 * WHAT SURVIVES A SPLIT WINDOW. `audit.forPlayer` reads a bounded slice of the
 * log, so a group can arrive with its `ban.issue` row inside the window and its
 * `incident.resolve` row outside it, or the reverse. Neither produces a double
 * count: rule 4 works on whatever rows are present, and a lone `incident.resolve`
 * renders as a closure carrying its verdict rather than as a second ban.
 *
 * NO RUNTIME IMPORTS, the same property `labels`, `incidentChip` and
 * `serverPhase` keep. Both imports are `import type` and erase, so the preview
 * harness and any future check script can drive the real function without
 * dragging `lib/audit` — which reaches DynamoDB — anywhere near a browser bundle.
 */

/**
 * The audit row's shape, named here rather than imported.
 *
 * STRUCTURAL ON PURPOSE, the same seam `GateDeps` uses in lib/discordRole.ts: it
 * keeps this module free of a runtime import AND it means a fixture can produce
 * genuine audit-shaped rows and run them through the real grouping code, which
 * is what /preview/profile does. `AuditRow` satisfies it.
 */
export interface ActedRow {
  ts: number
  action: string
  outcome: string
  targetLicense?: string | null
  targetName?: string | null
  reason?: string | null
  detail?: Record<string, string | number | boolean | null> | undefined
}

/**
 * The actions that are moderation OF A PLAYER, which is what this table is.
 *
 * `ban.lift` IS IN THE LIST although the owner's sentence says "kicked, banned,
 * or actioned an incident". A record of somebody's moderation decisions that
 * showed the bans and hid the ones they reversed would be a worse answer to the
 * question the table is asking than either the full list or no list at all — and
 * an admin lifting their own ban is precisely the thing somebody reading this
 * panel is looking for.
 */
const COUNTED = new Set([
  'ban.issue',
  'ban.lift',
  'player.kick',
  'incident.resolve',
])

/**
 * Which row wins when a group holds more than one.
 *
 * Lower sorts first. An `incident.resolve` is never the survivor while a real
 * action is present in the same group, because the action is what happened and
 * the closure is the bookkeeping around it.
 */
const PRIORITY: Record<string, number> = {
  'ban.issue': 0,
  'player.kick': 1,
  'ban.lift': 2,
  'incident.resolve': 3,
}

function priority(action: string): number {
  return PRIORITY[action] ?? 9
}

/** A `detail` value that is a non-empty string, or null. Everything else lies. */
function str(value: string | number | boolean | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The verdict the incident recorded, if it recorded one this build knows.
 *
 * NARROWED RATHER THAN CAST. `detail.verdict` is whatever the console that wrote
 * the row put there, and a value from a newer build must not be handed to
 * `verdictTone` as though it were one of the three — it would take the quiet
 * colour and read as "nothing happened". Unrecognised means null, which renders
 * no chip at all.
 */
function verdictOf(row: ActedRow): VerdictAction | null {
  const raw = str(row.detail?.verdict)
  return raw === 'ban' || raw === 'kick' || raw === 'none' ? raw : null
}

/**
 * Collapse an actor's audit rows into one row per action they took.
 *
 * Newest first. Takes rows in any order and does not mutate the input.
 */
export function actionsTakenFrom(rows: ActedRow[]): ProfileActionTaken[] {
  const kept = rows.filter(
    (r) =>
      COUNTED.has(r.action) &&
      // Rule 2: the kick that carries out a ban is not a second decision.
      !(r.action === 'player.kick' && str(r.detail?.becauseOf) === 'ban.issue'),
  )

  /**
   * Rule 3. A row with no incident id gets a key nothing else can collide with —
   * its own position — rather than being bundled under a shared "no incident"
   * bucket, which would collapse every unrelated kick into one line.
   */
  const groups = new Map<string, ActedRow[]>()
  kept.forEach((row, i) => {
    const incidentId = str(row.detail?.incidentId)
    const key = incidentId ? `incident:${incidentId}` : `row:${i}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  })

  const out: ProfileActionTaken[] = []

  for (const group of groups.values()) {
    // Rule 4. Sort a copy: the caller's array is not ours to reorder.
    const ordered = [...group].sort(
      (a, b) => priority(a.action) - priority(b.action) || a.ts - b.ts,
    )
    const winner = ordered[0]
    if (!winner) continue

    /*
     * THE VERDICT COMES FROM WHICHEVER ROW CARRIES ONE, which is the
     * `incident.resolve` row — the action rows never have a `verdict` in their
     * detail. Reading it off the group rather than off the winner is what lets a
     * collapsed pair keep the fact that the ban WAS a verdict while still
     * rendering as one row.
     */
    const verdict =
      ordered.map(verdictOf).find((v) => v !== null) ?? null

    /*
     * THE TIMESTAMP IS THE EARLIEST IN THE GROUP, because that is when the admin
     * acted. The `incident.resolve` row is written after the ban row by
     * construction (`closeWithVerdict` runs once the ban exists), so taking the
     * winner's own `ts` would be right today and wrong the moment the order
     * changes; taking the minimum is right either way.
     */
    const at = Math.min(...ordered.map((r) => r.ts))

    out.push({
      at,
      action: winner.action,
      outcome: winner.outcome,
      targetName: winner.targetName ?? null,
      targetLicense: winner.targetLicense ?? null,
      reason: winner.reason ?? null,
      incidentId: str(winner.detail?.incidentId),
      verdict,
    })
  }

  return out.sort((a, b) => b.at - a.at)
}
