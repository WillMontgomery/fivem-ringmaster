import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentQueue } from '@/components/IncidentQueue'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import {
  CATEGORY_LABEL,
  VERDICT_LABEL,
  type Incident,
  type IncidentCategory,
  type IncidentKind,
  type IncidentVerdict,
} from '@/lib/incidents'

/**
 * The incident QUEUE, in every row shape it can produce. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS, GIVEN /preview/incident ALREADY DOES. That one is the single
 * case page; this is the LIST, and the list is where every judgement about a row
 * gets made — what a closed case wears, whether a chip repeats the line under
 * it, how old a pending report reads. None of it is reviewable on a real console
 * without a Discord login, live AWS credentials, and a queue that happens to
 * contain each shape at the moment you look. Four separate corrections in one
 * playtest round landed on this component and there was nowhere to look at any
 * of them; that is what this fixes.
 *
 * THE ROWS ARE CHOSEN TO BE THE ONES THAT ARGUE:
 *
 *   · a report whose CATEGORY IS A SNAKE_CASE ID — `abusive_chat`, carrying the
 *     game's own summary verbatim ("Reported for abusive_chat by …"). The line
 *     rendered must read "Reported for Abusive chat" and no chip above it may
 *     repeat the category.
 *   · a SYSTEM-FILED case, which has no reporter and category `system`. Its
 *     footer must read "filed by System" and it must not wear a SYSTEM chip.
 *   · every verdict a closed row can carry: banned, kicked, no action, and NO
 *     VERDICT AT ALL. The last is the one to stare at — it must show the bare
 *     white "resolved" chip and NO red one, because nobody recorded a decision
 *     and inventing one is the failure the verdict field exists to end.
 *   · a pending row minutes old and one days old, because the age is rendered
 *     as "12m ago" / "3d ago" and used to be "12m waiting" in amber.
 *
 * TRANSPARENTLY SYNTHETIC, like every other fixture in this directory: a
 * screenshot of this page must not be mistakable for a real player's record.
 *
 * The 404 in production is not decoration — this renders admin chrome with no
 * auth. The check is on NODE_ENV, which Next inlines at build time, so the
 * branch is eliminated from the production bundle.
 */
export default function PreviewIncidentsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}

const MIN = 60_000
const HOUR = 60 * MIN
const BASE = Date.UTC(2026, 7, 15, 20, 0, 0)
const NOW = BASE + 5 * MIN

const SUBJECT = 'license:preview000000000000000000000000000'

let seq = 0

function row(input: {
  kind: IncidentKind
  category: IncidentCategory
  /** Exactly as the game writes it — see `br_lib/shared/incident_build.lua`. */
  summary: string
  age: number
  subjectName: string
  reporterName?: string | null
  verdict?: IncidentVerdict | null
  resolved?: boolean
}): Incident {
  seq += 1
  const at = NOW - input.age
  const resolved = input.resolved ?? false

  return {
    incidentId: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind: input.kind,
    category: input.category,
    state: resolved ? 'resolved' : 'pending_review',
    subjectLicense: `${SUBJECT}${seq}`,
    subjectName: input.subjectName,
    reporterLicense: input.reporterName ? `license:preview-filer-${seq}` : null,
    reporterName: input.reporterName ?? null,
    openedAt: at,
    summary: input.summary,
    note: null,
    linkedLicense: null,
    events: [
      {
        at,
        kind: 'opened',
        byLicense: null,
        byName: input.reporterName ?? 'System',
      },
    ],
    resolvedAt: resolved ? at + 10 * MIN : null,
    resolvedByLicense: null,
    resolvedByName: resolved ? 'Preview Admin' : null,
    resolution: resolved ? 'Reviewed.' : null,
    // A PENDING ROW CARRIES NO VERDICT, EVER — the real write cannot produce
    // one, so neither may the harness.
    verdict: resolved ? (input.verdict ?? null) : null,
  }
}

const PENDING: Incident[] = [
  row({
    kind: 'report',
    category: 'abusive_chat',
    summary: 'Reported for abusive_chat by Vance',
    age: 12 * MIN,
    subjectName: 'Preview Player',
    reporterName: 'Vance',
  }),
  row({
    kind: 'anticheat',
    category: 'system',
    summary: '14 shots refused in 60s -- no weapon issued',
    age: 4 * HOUR,
    subjectName: 'Preview Two',
  }),
  row({
    kind: 'identifier_reuse',
    category: 'system',
    summary: 'Steam id already bound to a different license',
    age: 3 * 24 * HOUR,
    subjectName: 'Preview Three',
  }),
]

const RESOLVED: Incident[] = [
  row({
    kind: 'report',
    category: 'cheating',
    summary: 'Reported for cheating by Odile',
    age: 6 * HOUR,
    subjectName: 'Preview Four',
    reporterName: 'Odile',
    resolved: true,
    verdict: { action: 'ban', expiresAt: null },
  }),
  row({
    kind: 'report',
    category: 'griefing',
    summary: 'Reported for griefing by Odile',
    age: 8 * HOUR,
    subjectName: 'Preview Five',
    reporterName: 'Odile',
    resolved: true,
    verdict: { action: 'kick' },
  }),
  row({
    kind: 'report',
    category: 'teaming',
    summary: 'Reported for teaming by Vance',
    age: 20 * HOUR,
    subjectName: 'Preview Six',
    reporterName: 'Vance',
    resolved: true,
    verdict: { action: 'none' },
  }),
  /*
   * NO VERDICT — the row worth staring at. A closure from before the field
   * existed, or one the system resolved itself. It must show "resolved" alone
   * and must NEVER acquire a red chip: nobody decided anything.
   */
  row({
    kind: 'identifier_reuse',
    category: 'system',
    summary: 'Steam id already bound to a different license',
    age: 30 * HOUR,
    subjectName: 'Preview Seven',
    resolved: true,
    verdict: null,
  }),
]

function Preview() {
  const history = [...RESOLVED, ...PENDING].sort((a, b) => b.openedAt - a.openedAt)

  return (
    <AppShell
      active="/incidents"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: NOW - 1_200, bootEpoch: 'preview', now: NOW }}
    >
      <IncidentQueue
        pending={PENDING}
        history={history}
        now={NOW}
        categoryLabel={CATEGORY_LABEL}
        verdictLabel={VERDICT_LABEL}
      />
    </AppShell>
  )
}
