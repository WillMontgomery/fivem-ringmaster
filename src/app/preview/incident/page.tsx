import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentDetail } from '@/components/IncidentDetail'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import {
  AUTO_CLOSE_RESOLUTION,
  CATEGORY_LABEL,
  KIND_LABEL,
  VERDICT_LABEL,
  type ClosedByBan,
  type Incident,
  type IncidentVerdict,
} from '@/lib/incidents'
import { cn } from '@/lib/utils'

/**
 * The incident page in every verdict state. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS. Reaching any one of these states on a real console costs a
 * Discord login, live AWS credentials, a player who has actually been reported,
 * and — for the states that matter most — that player being in a particular
 * situation at the moment you look. Two of the states cannot be produced on
 * demand at all: a subject who has left the server mid-review, and one who is
 * already banned by the time you open the case. Both change which buttons the
 * page offers, and both were previously unreviewable.
 *
 * AND THE RESOLVED STATES ARE UNREACHABLE TWICE OVER, because resolving is
 * permanent. There is no way to look at what a closed incident says, decide the
 * chip is wrong, and try again — the row is spent. A harness is the only place
 * a verdict can be looked at before it is real.
 *
 * TWO AXES, BECAUSE THEY ARE INDEPENDENT IN LIFE:
 *
 *   ?state=    pending, and the ways a closed case can read — banned-perm,
 *              banned-temp, kicked, none, and `legacy`, which is a row resolved
 *              before the verdict field existed. `legacy` is the one to look at
 *              hardest: it must NOT read as "no action", because nobody
 *              recorded one, and the whole point of the field is that the
 *              console stops guessing which closures involved an action.
 *              `auto-linked` and `auto-on-demand` are the two shapes of a case
 *              closed by a permanent ban issued elsewhere — the first links to
 *              the case the ban came from, the second says "on-demand" because
 *              there is none. Their note is a PLACEHOLDER awaiting the owner's
 *              wording, and this is the only place it can be read.
 *
 *   ?subject=  the two facts that decide which verdicts are offered, in all four
 *              combinations —
 *                here      in the server, not banned: everything available
 *                gone      left mid-review: Kick is off and says why
 *                banned    already banned and not connected: only No action
 *                both      already banned and STILL connected, which happens
 *                          when the kick that follows a ban fails. Ban off,
 *                          Kick on.
 *
 *   ?scope=    with and without the `ban` scope. Without it the Resolve card
 *              does not render at all, and the page has to still be worth
 *              reading — an admin who can see a case but not close it is a real
 *              account, not an error state.
 *
 * THE DIALOGS OPEN AND THE REQUESTS FAIL, exactly as on /preview/profile: they
 * post to real endpoints and there is no session behind them. This harness is
 * for reading the page, not for exercising it.
 *
 * The 404 in production is not decoration — this renders admin chrome with no
 * auth. The check is on NODE_ENV, which Next inlines at build time, so the
 * branch is eliminated from the production bundle.
 */
export default function PreviewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const HOUR = 3_600_000
const BASE = Date.UTC(2026, 7, 15, 20, 0, 0)

/*
 * Transparently synthetic, like every other fixture in this directory: a
 * screenshot of this page must not be mistakable for a real person's record.
 */
const SUBJECT = 'license:preview000000000000000000000000000'
const REPORTER = 'license:preview111111111111111111111111111'
const ADMIN = 'license:previewadmin00000000000000000000000'

/**
 * A player report with a named filer, which is the case that matters most here.
 *
 * THE REPORTER'S NAME IS ON THIS PAGE, and that is why the ban and kick dialogs
 * opened from it carry a warning the profile page's do not: the reason typed
 * into them is shown to the SUBJECT as they are dropped, and "reported by
 * Marla" typed here would hand the offender the name of the person who reported
 * them. The fixture keeps a filer so that warning is reviewable in context
 * rather than in the abstract.
 */
const BASE_INCIDENT: Incident = {
  incidentId: 'aaaaaaaa-0000-4000-8000-000000000001',
  kind: 'report',
  category: 'cheating',
  state: 'pending_review',
  subjectLicense: SUBJECT,
  subjectName: 'Preview Player',
  reporterLicense: REPORTER,
  reporterName: 'Marla',
  openedAt: BASE - 3 * HOUR,
  summary: 'Reported for cheating',
  note: 'shot me through the wall of the pharmacy twice',
  linkedLicense: null,
  captureKeys: [],
  events: [
    {
      at: BASE - 3 * HOUR,
      kind: 'opened',
      byLicense: REPORTER,
      byName: 'Marla',
    },
    {
      at: BASE - 2 * HOUR,
      kind: 'note',
      byLicense: null,
      byName: 'System',
      text: 'Refusals doubled to 8 across 2 matches.',
    },
  ],
  resolvedAt: null,
  resolvedByLicense: null,
  resolvedByName: null,
  resolution: null,
  verdict: null,
}

/**
 * Close the fixture the way `incidents.resolve` closes a real row.
 *
 * WRITTEN AS ONE FUNCTION so a resolved fixture cannot drift into a shape the
 * real write never produces — a preview showing a verdict beside a `state` of
 * `pending_review`, or a verdict with no `resolvedAt`, would be reviewing
 * something that cannot exist.
 */
function closed(
  resolution: string,
  verdict: IncidentVerdict | null,
  /** Set only on a case a permanent ban closed. See lib/incidents. */
  closedByBan?: ClosedByBan,
): Incident {
  return {
    ...BASE_INCIDENT,
    state: 'resolved',
    resolvedAt: BASE - HOUR,
    resolvedByLicense: ADMIN,
    resolvedByName: 'Preview Admin',
    resolution,
    verdict,
    ...(closedByBan ? { closedByBan } : {}),
    events: [
      ...BASE_INCIDENT.events,
      {
        at: BASE - HOUR,
        kind: 'resolved',
        byLicense: ADMIN,
        byName: 'Preview Admin',
        text: resolution,
      },
    ],
  }
}

const STATE_CASES = {
  pending: BASE_INCIDENT,

  'banned-perm': closed(
    'Aimbot through walls in match 412 — clip in #reports',
    { action: 'ban', expiresAt: null },
  ),

  /*
   * A ban that expires, so the chip's "— until <date>" branch is reviewable.
   * The permanent one above and this one are the pair to look at together: they
   * are the only two shapes a `ban` verdict has, and the difference between
   * them is `expiresAt: null` meaning permanent — the exact value that means
   * "not applicable" on the other two verdicts, which is why the contract says
   * to read `action` first and never `expiresAt` alone.
   */
  'banned-temp': closed('Repeated griefing — 7 days', {
    action: 'ban',
    expiresAt: BASE + 6 * 24 * HOUR,
  }),

  kicked: closed('Blocking the bus door after two warnings', { action: 'kick' }),

  none: closed('Watched two matches from spectate — nothing unusual', {
    action: 'none',
  }),

  /*
   * THE ROW WITH NO VERDICT, which is the case the whole field exists because of
   * and the one most likely to be got wrong later. It is a real closed incident
   * from before #28; nothing knows what was decided. It must read as "no verdict
   * recorded" and never as "no action" — the second is a claim about a decision,
   * and inventing one here is exactly what the free-text era did.
   *
   * THE TEXT IS LIFTED FROM THE OLD PLACEHOLDER on purpose. A human reading
   * "Banned for 7 days" knows exactly what happened; nothing else does, and no
   * amount of parsing should be allowed to try. That gap between what the row
   * plainly says and what the console may claim to know is the entire argument
   * for the field, standing on one page.
   */
  legacy: closed('Banned for 7 days', null),

  /*
   * ═══ CLOSED BY A PERMANENT BAN ISSUED SOMEWHERE ELSE ═══
   *
   * The owner: "for any permanent bans that take place - all other incidents
   * against the freshly banned player should be resolved … and a note saying
   * why, with a hyperlink to the original incident where they were banned from,
   * if there was one."
   *
   * THESE TWO ARE HERE TO BE READ RATHER THAN TO BE TESTED. The verdict, the
   * link and the counts are all asserted by `check:verdict` against the real
   * writer; what nothing can assert is whether the SENTENCE is the one the owner
   * wants, and that sentence is a placeholder written by the task that built
   * this. It is unreachable on a real console — every one of these rows is
   * created by a ban and can never be re-resolved — so a harness is the only
   * place it can be looked at before it is somebody's permanent record.
   *
   * THE PAIR IS THE POINT. `auto-linked` came from a ban issued as another
   * case's verdict and links to it; `auto-on-demand` came from a ban issued
   * straight off a profile, where there is no case and the page says so in the
   * owner's own words rather than rendering a dead link.
   */
  'auto-linked': closed(
    AUTO_CLOSE_RESOLUTION,
    { action: 'ban', expiresAt: null },
    { fromIncidentId: 'aaaaaaaa-0000-4000-8000-000000000003' },
  ),

  'auto-on-demand': closed(
    AUTO_CLOSE_RESOLUTION,
    { action: 'ban', expiresAt: null },
    { fromIncidentId: null },
  ),

  /*
   * NOBODY FILED THIS. An anticheat escalation has no reporter and its category
   * is `system`, and that combination changes three things on the page that
   * nothing else on this axis reaches: the "Reported by" field reads `System`
   * rather than naming a player, the timeline's opening event is attributed to
   * `System`, and the summary is the game's own sentence rather than a category
   * the console composes.
   *
   * IT IS HERE BECAUSE THE OWNER'S WORDING FOR IT WAS THE CORRECTION ("'filed
   * by the system' sounds cheesy. How about filed by `System`"), and there was
   * no way to look at that state without a live anticheat escalation sitting in
   * a real queue at the moment you happened to open the page.
   */
  system: {
    ...BASE_INCIDENT,
    incidentId: 'aaaaaaaa-0000-4000-8000-000000000002',
    kind: 'anticheat',
    category: 'system',
    reporterLicense: null,
    reporterName: null,
    summary: '14 shots refused in 60s -- no weapon issued',
    note: null,
    events: [
      {
        at: BASE - 3 * HOUR,
        kind: 'opened',
        byLicense: null,
        byName: 'System',
      },
    ],
  },
} satisfies Record<string, Incident>

type StateKey = keyof typeof STATE_CASES

/**
 * The two server-decided booleans, in all four combinations.
 *
 * BOTH ARE COMPUTED ON THE SERVER on the real page — the live roster answers one
 * and `bans.isActive` answers the other — so the harness passes them the same
 * way rather than deriving them from a fixture the browser could read
 * differently.
 */
const SUBJECT_CASES = {
  here: { online: true, banned: false },
  gone: { online: false, banned: false },
  banned: { online: false, banned: true },
  both: { online: true, banned: true },
} satisfies Record<string, { online: boolean; banned: boolean }>

type SubjectKey = keyof typeof SUBJECT_CASES

const SCOPE_CASES = { resolve: true, readonly: false } satisfies Record<
  string,
  boolean
>

type ScopeKey = keyof typeof SCOPE_CASES

/** One row of preview toggles. Keeps the other axes where they are. */
function Axis({
  name,
  keys,
  current,
  params,
}: {
  name: string
  keys: readonly string[]
  current: string
  params: Record<string, string>
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
        {name}
      </span>
      {keys.map((k) => (
        <a
          key={k}
          href={`/preview/incident?${new URLSearchParams({ ...params, [name]: k })}`}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
            k === current
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {k}
        </a>
      ))}
    </div>
  )
}

function pick<T extends string>(
  raw: string | string[] | undefined,
  options: Record<T, unknown>,
  fallback: T,
): T {
  return typeof raw === 'string' && raw in options ? (raw as T) : fallback
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const state = pick(sp.state, STATE_CASES, 'pending' as StateKey)
  const subject = pick(sp.subject, SUBJECT_CASES, 'here' as SubjectKey)
  const scope = pick(sp.scope, SCOPE_CASES, 'resolve' as ScopeKey)

  const params = { state, subject, scope }
  const now = BASE + 5 * 60_000

  return (
    <AppShell
      active="/incidents"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: now - 1_200, bootEpoch: 'preview', now }}
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <nav className="space-y-1.5 rounded-lg border border-border bg-card/60 p-2">
          <Axis
            name="state"
            keys={Object.keys(STATE_CASES)}
            current={state}
            params={params}
          />
          <Axis
            name="subject"
            keys={Object.keys(SUBJECT_CASES)}
            current={subject}
            params={params}
          />
          <Axis
            name="scope"
            keys={Object.keys(SCOPE_CASES)}
            current={scope}
            params={params}
          />
          {/*
            The two booleans printed as values rather than inferred from which
            buttons happen to be grey. A disabled button and a missing sentence
            look identical from across the room; these do not.
          */}
          <p className="pt-1 text-xs text-muted-foreground">
            <span className="mr-2 inline-block w-20 uppercase tracking-wider">
              props
            </span>
            <span className="font-mono">
              subjectOnline={String(SUBJECT_CASES[subject].online)} ·
              subjectBanned={String(SUBJECT_CASES[subject].banned)} · canResolve=
              {String(SCOPE_CASES[scope])}
            </span>
          </p>
        </nav>

        <IncidentDetail
          incident={STATE_CASES[state]}
          canResolve={SCOPE_CASES[scope]}
          subjectOnline={SUBJECT_CASES[subject].online}
          subjectBanned={SUBJECT_CASES[subject].banned}
          categoryLabel={CATEGORY_LABEL}
          kindLabel={KIND_LABEL}
          verdictLabel={VERDICT_LABEL}
        />
      </div>
    </AppShell>
  )
}
