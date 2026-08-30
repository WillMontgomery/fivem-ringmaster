import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentDetail } from '@/components/IncidentDetail'
import type { Artifact } from '@/lib/artifacts'
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
import {
  matchRecordFor,
  type MatchFields,
  type MatchTimelineEntry,
} from '@/lib/matchTimeline'
import type { ProfileMatch } from '@/lib/profile'
import { utcIso } from '@/lib/time'
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
 *              `no-close-row` is a closed case whose events do not say so — a
 *              shape nothing produces, kept reviewable because the verdict now
 *              rides on that row. Flip it against `banned-perm`, which is the
 *              same case with its row intact; the two must read alike.
 *
 *   ?subject=  the two facts that decide which verdicts are offered, in all four
 *              combinations —
 *                here      in the server, not banned: everything available
 *                gone      left mid-review: Kick is NOT DRAWN, and nothing marks
 *                          the gap (owner: "the 'kick' button should not be
 *                          displayed if the offender is not actively on the
 *                          server"). Flip against `here` to see it go
 *                banned    already banned and not connected: only No action, and
 *                          a greyed Ban with nothing saying why — the one
 *                          unexplained control the resolve bar has left
 *                both      already banned and STILL connected, which happens
 *                          when the kick that follows a ban fails. Ban off,
 *                          Kick drawn.
 *
 *   ?record=   whether the subject's match history contains the match this was
 *              filed during. `running` and `absent` must render IDENTICALLY —
 *              see the axis itself for why that is the check rather than a
 *              redundancy.
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

/** Three more bodies for the match timeline to be about. */
const REBEL = 'license:preview222222222222222222222222222'
const HALEY = 'license:preview333333333333333333333333333'
const VEX = 'license:preview444444444444444444444444444'

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
  events: [
    {
      at: BASE - 3 * HOUR,
      kind: 'opened',
      byLicense: REPORTER,
      byName: 'Marla',
    },
    /*
      EXACTLY ONE HOUR AFTER FILING, WHICH IS EXACTLY THE REACH `matchOffset`
      DRAWS WITHIN — so this row carries no offset by a single millisecond, and
      that is the rule rather than a bug in the fixture. Worth knowing before
      reading `?match=none`, where it is the only row on the list with a blank
      column. `banned-fast` below is where a row inside the reach can be seen.

      AND IT IS A CORROBORATION, WHICH IT ALWAYS WAS. This row is what
      `incidents.corroborate` writes when the game reports that a subject is
      still at it — the System attribution and the sentence are both its
      output. It carried `kind: 'note'` until 2026-08-29, which is exactly the
      defect the owner reported ("corroboration doesn't show on the incident
      timeline"): it was on the list, wearing an admin's word. Only the kind
      changed here; the text is the ingest route's own.
    */
    {
      at: BASE - 2 * HOUR,
      kind: 'corroborated',
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
  /**
   * WHEN IT WAS CLOSED, and it is a parameter because one case below needs it in
   * seconds rather than hours. Two hours after filing is the ordinary shape and
   * stays the default; `banned-fast` is the case an admin closed while the match
   * was still on the warmup pad, which is the only way to look at the offset the
   * close row carries — past an hour it carries none. See `matchOffset`.
   */
  at: number = BASE - HOUR,
): Incident {
  return {
    ...BASE_INCIDENT,
    state: 'resolved',
    resolvedAt: at,
    resolvedByLicense: ADMIN,
    resolvedByName: 'Preview Admin',
    resolution,
    verdict,
    ...(closedByBan ? { closedByBan } : {}),
    events: [
      ...BASE_INCIDENT.events,
      {
        at,
        kind: 'resolved',
        byLicense: ADMIN,
        byName: 'Preview Admin',
        text: resolution,
      },
    ],
  }
}

/**
 * ═══ THE CASE THAT WAS OPEN FOR SEVENTY-ONE SECONDS ═══
 *
 * THE SHAPE THE OWNER SCREENSHOTTED, and the reason it needs a fixture of its
 * own. An anticheat case is filed on the warmup pad, a system note lands
 * thirty-four seconds later, and an admin bans and closes at `+1:11` — all of it
 * before the match enters play. Put it beside `?match=warmup` or
 * `?match=backfilled` and the whole page sits above `matchStartedAt`, which is
 * exactly where the offset column used to stop.
 *
 * IT IS ALSO THE ONLY PLACE THE CLOSE ROW'S OFFSET CAN BE LOOKED AT. Every other
 * case on this axis closes two hours after filing, which is past the reach
 * `matchOffset` draws within, so their close rows carry no number and never
 * will. This one is the sixty-second answer to "should the close carry one",
 * and the two together are the pair to flip between.
 */
const FAST_NOTE = BASE_INCIDENT.openedAt + 34_000
const FAST_CLOSE = BASE_INCIDENT.openedAt + 71_000

const BANNED_FAST = closed(
  'Railgun on the warmup pad, stripped twice before the bus left',
  { action: 'ban', expiresAt: null },
  undefined,
  FAST_CLOSE,
)

const STATE_CASES = {
  pending: BASE_INCIDENT,

  'banned-fast': {
    ...BANNED_FAST,
    /*
      THE NOTE MOVES WITH THE CLOSE, for the reason `shifted` moves the match:
      `BASE_INCIDENT` puts its system note an hour after filing, which on a case
      closed at `+1:11` would be a note arriving fifty-nine minutes after the
      case was closed. Nothing else about the fixture changes.
    */
    events: BANNED_FAST.events.map((e) =>
      e.kind === 'note' ? { ...e, at: FAST_NOTE } : e,
    ),
  },

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
   * ═══ A CLOSED CASE WHOSE EVENTS DO NOT SAY SO ═══
   *
   * NOTHING PRODUCES THIS SHAPE. `incidents.resolve` appends the closing event
   * in the same conditional update that sets the state, `open` appends one when
   * it opens straight to resolved, and `closed()` above is written as one
   * function precisely so a fixture cannot drift. It cannot be dated either: if
   * a deploy older than the closing-event writer ever closed a case, that row is
   * still in the table and nothing in this console can tell.
   *
   * IT IS HERE FOR THE REASON `auto-linked` AND `auto-on-demand` ARE. Since the
   * verdict folded onto the timeline's closing row (owner, 2026-08-22), a
   * resolved case with no closing row would lose its verdict, its resolution
   * text, its closing time and its closing admin from the page at once —
   * silently, with no gap where they used to be. `withClosure` in
   * `lib/matchTimeline` rebuilds the row from the incident's own closure
   * attributes, and this is the only place that rebuild can be looked at.
   *
   * FLIP IT AGAINST `banned-perm`, WHICH IS THE SAME CASE WITH ITS ROW INTACT.
   * The two must render the same closing row — same words, same chip, same time,
   * same admin. That they do is what says the guard is a guard rather than a
   * second way of drawing a close.
   */
  'no-close-row': {
    ...closed('Aimbot through walls in match 412 — clip in #reports', {
      action: 'ban',
      expiresAt: null,
    }),
    events: BASE_INCIDENT.events,
  },

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

/**
 * ═══ THE MATCH AXIS (#30) ═══
 *
 * The gamemode now writes the match an incident was filed during onto the same
 * row: the brackets, every kill inside them, and a deadline that makes an
 * absent end readable. NONE of it can be produced on a console. Reaching one of
 * these states for real needs a live FiveM server, a match in a particular
 * phase, a player who has actually been reported, and — for two of them — the
 * server to CRASH at the right moment. So this axis is the only place any of it
 * can be looked at.
 *
 * WHY THESE SEVEN:
 *
 *   none        no match attributes at all. THE DEFAULT, because it is what
 *               every incident in the table looks like today and what a report
 *               filed in the lobby will always look like. The page must read
 *               exactly as it did before this feature existed.
 *   ended       the whole thing: start, six kills, end. The ordinary case.
 *   running     no end yet and the deadline has not passed. The `now` for this
 *               case sits INSIDE the match, which is the only way to see it.
 *   unreported  no end and the deadline is hours gone. The server died holding
 *               the write. This is the case that must not read as "running".
 *   dropped     `ended`, plus the buffer overflowed: six kills stored, 47
 *               counted.
 *   warmup      FILED ON THE WARMUP PAD. A creation time, two weapon strips and
 *               no start, no deadline, no end. See below.
 *   backfilled  THE SAME CASE AFTER ITS MATCH RAN AND ENDED. The pair to flip
 *               between; `warmup` and `backfilled` are one row at two moments.
 *
 * `running` AND `unreported` ARE THE PAIR TO FLIP BETWEEN. They differ only in
 * the deadline and the clock — the stored timeline is identical, neither has a
 * `matchEndedAt`, and reading one as the other is the exact mistake
 * `matchEndsBy` exists to make impossible.
 *
 * THE KILLS ARE CHOSEN TO COVER EVERY BRANCH OF THE SENTENCE, and three of them
 * are about `weaponIssued` specifically, because the cost of getting that
 * comparison wrong is telling an admin a player cheated when they fell off a
 * cliff.
 */
const FILED = BASE - 3 * HOUR
const MATCH_START = FILED - 4 * 60_000
const MATCH_CAP = 20 * 60_000
const MIN = 60_000

const MATCH_TIMELINE: MatchTimelineEntry[] = [
  /*
    OUT OF ORDER ON PURPOSE, AND THE MOST IMPORTANT LINE IN THIS FILE.
    DynamoDB's `list_append` does not order, so the stored list genuinely
    arrives shuffled — and a console that renders it in stored order looks
    correct on every fixture somebody wrote in sequence. `match_start` is last
    here and `match_end` is in the middle; if the page shows them anywhere but
    the two ends, `mergeTimeline` is not being called.
  */

  /* An ordinary kill with an issued weapon. `a Marksman Rifle`. */
  {
    at: MATCH_START + 62_000,
    kind: 'kill',
    killerLicense: REBEL,
    killerName: 'Rebel',
    victimLicense: HALEY,
    victimName: 'Haley',
    weapon: 'WEAPON_MARKSMANRIFLE',
    weaponLabel: 'Marksman Rifle',
    weaponIssued: true,
    cause: 'gunshot',
    headshot: false,
  },

  /* The article's other branch, and the headshot chip. `an Assault Rifle`. */
  {
    at: MATCH_START + 167_000,
    kind: 'kill',
    killerLicense: HALEY,
    killerName: 'Haley',
    victimLicense: VEX,
    victimName: 'Vex',
    weapon: 'WEAPON_ASSAULTRIFLE',
    weaponLabel: 'Assault Rifle',
    weaponIssued: true,
    cause: 'gunshot',
    headshot: true,
  },

  { at: MATCH_START + 11 * MIN, kind: 'match_end' },

  /*
    ═══ THE RED ONE ═══ `weaponIssued: false` — the gamemode does not issue a
    railgun and does not recognise this at all. The weapon text turns red and
    carries the hover card. It is the ONLY entry here that may.
  */
  {
    at: MATCH_START + 310_000,
    kind: 'kill',
    killerLicense: REBEL,
    killerName: 'Rebel',
    victimLicense: VEX,
    victimName: 'Vex',
    weapon: 'WEAPON_RAILGUN',
    weaponLabel: 'Railgun',
    weaponIssued: false,
    cause: 'explosion',
    headshot: false,
  },

  /*
    ═══ THE FALSE POSITIVE THIS FEATURE COULD HAVE SHIPPED ═══ An environmental
    death. `weaponIssued` is ABSENT because there is no weapon claim to make,
    and the killer is the victim because that is how the engine reports it. It
    must render as a name and a cause, in ordinary ink. A red "Preview Player
    killed Preview Player with a Fall" would be this console accusing somebody
    of cheating for falling off a roof.
  */
  {
    at: MATCH_START + 453_000,
    kind: 'kill',
    killerLicense: SUBJECT,
    killerName: 'Preview Player',
    victimLicense: SUBJECT,
    victimName: 'Preview Player',
    weapon: 'WEAPON_FALL',
    cause: 'fall',
    headshot: false,
  },

  /*
    ═══ EVERY ROW FILED BEFORE 2026-08-20 ═══ No `weaponIssued` field at all,
    because the game did not write one yet. Absent is not false. This must be
    indistinguishable from the first entry, and `an SMG` is the initialism
    branch of the article rule while it is here.
  */
  {
    at: MATCH_START + 512_000,
    kind: 'kill',
    killerLicense: VEX,
    killerName: 'Vex',
    victimLicense: SUBJECT,
    victimName: 'Preview Player',
    weapon: 'WEAPON_SMG',
    weaponLabel: 'SMG',
    cause: 'gunshot',
    headshot: false,
  },

  /*
    NO `weaponLabel` AND NO KILLER LICENSE — a gamemode build that has not
    shipped a display name for this weapon, and a kill where the shooter's
    license did not make it onto the row. The id renders verbatim with no
    article in front of it, and the name renders as text that links nowhere.
    Both are degradations the console has to survive, not states to fix here.
  */
  {
    at: MATCH_START + 573_000,
    kind: 'kill',
    killerLicense: null,
    killerName: 'Rebel',
    victimLicense: HALEY,
    victimName: 'Haley',
    weapon: 'WEAPON_STONE_HATCHET',
    weaponIssued: true,
    cause: 'melee',
    headshot: false,
  },

  { at: MATCH_START, kind: 'match_start' },
]

/** The last kill is at +9:33, so a `now` inside the match sits after all six. */
const INSIDE_THE_MATCH = MATCH_START + 10 * MIN

/**
 * The number the game gave this match, and the join key to the subject's match
 * history. Every `MatchFields` case below carries it, so the `record` axis has
 * something to join against; `none` deliberately does not, which is what makes
 * the match-record panel disappear entirely rather than render empty.
 */
const MATCH_ID = 412

const ENDED: MatchFields = {
  matchId: MATCH_ID,
  matchStartedAt: MATCH_START,
  matchEndedAt: MATCH_START + 11 * MIN,
  matchEndsBy: MATCH_START + MATCH_CAP,
  matchTimeline: MATCH_TIMELINE,
}

/** No end, and no `match_end` row either — the write never happened. */
const NO_END: MatchFields = {
  matchId: MATCH_ID,
  matchStartedAt: MATCH_START,
  matchEndedAt: null,
  matchEndsBy: MATCH_START + MATCH_CAP,
  matchTimeline: MATCH_TIMELINE.filter((e) => e.kind !== 'match_end'),
}

/**
 * ═══ THE WARMUP PAIR (#35) ═══
 *
 * A match is minted into WARMUP and stamps `startedAt` only on entering play, so
 * a case opened on the pad has a creation time and nothing else — no start, no
 * deadline, no end. The console used to classify that as "filed outside a
 * match", which is false about a row carrying a `matchId`, and there was no way
 * to look at the shape at all: reaching it for real needs a live server, a
 * player granting themselves a weapon in a menu, and somebody opening the case
 * inside the two or three minutes before the bus leaves.
 *
 * AND IT IS THE SHAPE THAT MATTERS MOST, WHICH IS WHY IT IS TWO CASES RATHER
 * THAN ONE. vMenu is a development tool that is not going to production, so
 * there is no benign route to a weapon this gamemode never issued: every strip
 * is a cheat signal, and one on the warmup pad is the earliest signal there is —
 * before the offender has touched a real player.
 *
 * `warmup` AND `backfilled` ARE ONE ROW AT TWO MOMENTS. The game's match-end
 * write fills in `matchStartedAt` and `matchEndsBy` later, so the same case
 * becomes fully contexted on its own. Flip between them and the creation time,
 * the anchor row and both early strips must stay exactly where they were; what
 * arrives is an end, a deadline, and the rows that happened after filing.
 *
 * THERE IS NO `match_start` ROW ON EITHER, and that is not an omission in the
 * fixture. `timelineClose` in the gamemode's `incident_build.lua` appends kills,
 * strips and a `match_end` — never a start — so a warmup case's list is anchored
 * on `match_created` for the rest of its life even after the attribute arrives.
 *
 * ═══ AND THIS PAIR IS WHERE THE OFFSET COLUMN WAS WRONG ═══
 *
 * It used to be drawn only inside `[matchStartedAt, matchEndedAt ?? matchEndsBy]`,
 * so `warmup` had no column at all and `backfilled` had one that began partway
 * down the list: the anchor, both early strips and the case's own opening sat
 * before the start and went blank while everything after it carried a number.
 * That is the page the owner screenshotted. `matchOffset` counts from the
 * opening now and consults no match attribute, so BOTH of these read as one
 * continuous ruler — negative above the opening, positive below it. Flip between
 * them: the column must not change for any row the two share.
 */
const WARMUP_CREATED = FILED - 3 * MIN

/**
 * The two strips the row carries at filing, stored out of order like everything
 * DynamoDB appends.
 *
 * THE SECOND STRIP IS AT THE FILING INSTANT EXACTLY. The gamemode records the
 * strip and then builds the payload, so its `at` equals `openedAt` — which is
 * also why the close write's "strictly after filing" cut excludes it rather than
 * writing it twice. The first was recorded and announced to nobody: one weapon
 * in one hand for one tick is what two inventory mirrors disagreeing looks like,
 * and a second one a second later is not.
 *
 * ONE NAMED ID AND ONE RAW HASH, because both really arrive. The game sends
 * whatever the client had in hand and has NO display name for a weapon it does
 * not issue — `weaponLabel` is deliberately absent on a strip, and inventing one
 * would dress up the finding.
 */
const WARMUP_STRIPS: MatchTimelineEntry[] = [
  { at: FILED, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
  { at: WARMUP_CREATED, kind: 'match_created' },
  { at: FILED - 62_000, kind: 'weapon_strip', weapon: '-1357824103' },
]

const WARMUP: MatchFields = {
  matchId: MATCH_ID,
  matchCreatedAt: WARMUP_CREATED,
  /*
    NULLS RATHER THAN ABSENCES, because that is what the game writes: `br_ddb`'s
    `incident.js` coerces every one of these through `int()`, which answers null
    for a value the payload does not carry. A fixture using absences would be
    exercising a shape the table does not hold.
  */
  matchStartedAt: null,
  matchEndedAt: null,
  matchEndsBy: null,
  matchTimeline: WARMUP_STRIPS,
}

/** The match left the pad two minutes after the case was filed. */
const WARMUP_STARTED = FILED + 2 * MIN

/**
 * And ended five minutes after that, WHICH IS THE SAME INSTANT `?record=found`
 * says the subject's match 412 ended.
 *
 * The two axes are independent and combine freely, so a backfilled case whose
 * timeline ended at one time beside a history row claiming another is a
 * combination the harness can produce and no server can. `matchRecordFor` would
 * still join them — it only asks that the row ended after the match started —
 * so nothing would look wrong, which is the reason to line them up rather than
 * to rely on it.
 */
const WARMUP_ENDED = WARMUP_STARTED + 5 * MIN

const BACKFILLED: MatchFields = {
  ...WARMUP,
  matchStartedAt: WARMUP_STARTED,
  matchEndedAt: WARMUP_ENDED,
  matchEndsBy: WARMUP_STARTED + MATCH_CAP,
  matchTimeline: [
    ...WARMUP_STRIPS,
    /* Still on the pad, and still helping themselves. */
    { at: FILED + 18_000, kind: 'weapon_strip', weapon: 'WEAPON_RAILGUN' },
    /* In play now, and the strip is the same fact it was two minutes ago. */
    { at: WARMUP_STARTED + 47_000, kind: 'weapon_strip', weapon: '-1357824103' },
    /*
      ═══ THE CHAT SCREEN, AND THE ONLY PLAYER-AUTHORED TEXT ON THIS PAGE ═══

      Three of them, because the row has three things worth looking at and one
      of each is the only way to see them:

        · AN ORDINARY ADVERT, which is what this actually catches all day.
        · A LONG UNBROKEN URL, which is the whole reason the text wraps. Nothing
          else on this timeline needs to: a weapon label and a display name are
          short by construction, and this one is chosen by the person it is
          evidence against. Without `break-words` this token runs past the card
          and is clipped, taking the end of the evidence with it — so a fixture
          that only carried short messages would make the bug invisible here.
        · MARKUP AND AN ENTITY, verbatim. It must appear on the page as the
          characters typed — `<b>` visible as text, `&amp;` not collapsed to
          `&` — which is what says React escaped it and that nothing on the
          path unescapes. A fixture of tame strings would let a
          `dangerouslySetInnerHTML` slip in here unnoticed.

      `reason` and `channel` ride along unrendered, exactly as a real row
      carries them: the owner asked for the label and the message and nothing
      else, and they are here so that the day he wants them the shape is already
      right.
    */
    {
      at: WARMUP_STARTED + 61_000,
      kind: 'chat_block',
      text: 'come play on 51.68.204.11:30120, way better loot',
      reason: 'link',
      channel: 'global',
    },
    {
      at: WARMUP_STARTED + 73_000,
      kind: 'chat_block',
      text: 'https://discord.gg/aVeryLongVanityInviteCodeThatDoesNotBreakAnywhere',
      reason: 'invite',
      channel: 'squad',
    },
    {
      at: WARMUP_STARTED + 88_000,
      kind: 'chat_block',
      text: '<b>join us</b> &amp; leave this server',
      reason: 'social',
      channel: 'global',
    },
    {
      at: WARMUP_STARTED + 4 * MIN,
      kind: 'kill',
      killerLicense: SUBJECT,
      killerName: 'Preview Player',
      victimLicense: HALEY,
      victimName: 'Haley',
      weapon: 'WEAPON_CARBINERIFLE',
      weaponLabel: 'Carbine Rifle',
      weaponIssued: true,
      cause: 'gunshot',
      headshot: false,
    },
    { at: WARMUP_ENDED, kind: 'match_end' },
  ],
}

const MATCH_CASES = {
  none: { fields: {}, now: BASE + 5 * MIN },
  ended: { fields: ENDED, now: BASE + 5 * MIN },
  running: { fields: NO_END, now: INSIDE_THE_MATCH },
  unreported: { fields: NO_END, now: BASE + 5 * MIN },
  dropped: {
    fields: { ...ENDED, matchTimelineComplete: false, matchKillsSeen: 47 },
    now: BASE + 5 * MIN,
  },
  /*
    THE CLOCK IS INSIDE THE WARMUP, for the same reason `running`'s is inside its
    match: a case that has not left the pad cannot also have an admin's note on
    it from an hour later. `asOf` trims the rest of the fixture to match.
  */
  warmup: { fields: WARMUP, now: FILED + 90_000 },
  backfilled: { fields: BACKFILLED, now: BASE + 5 * MIN },
} satisfies Record<string, { fields: MatchFields; now: number }>

type MatchKey = keyof typeof MATCH_CASES

/**
 * ═══ THE MATCH-RECORD AXIS ═══
 *
 * "In the incident there should also be a section about what they did that match
 * - like how many kills they got, what position they got, how much loot they
 * got, etc." — the owner, playtest.
 *
 * WHAT IS NOT ON THIS AXIS, BECAUSE IT IS NOT ANYWHERE: loot. Nothing on either
 * row records it, so there is no case to preview and no fixture that could
 * honestly carry one. `IncidentMatchRecord` says what a game-side change would
 * have to write.
 *
 * THREE CASES, AND THE MIDDLE TWO ARE THE POINT:
 *
 *   found    the history has the match. The figures.
 *   running  the history is real and does not have this match yet, because the
 *            match has not ended — the rows are written at match end. THE
 *            COMMONEST STATE ON A PENDING CASE, and the one that must not read
 *            as a player who did nothing.
 *   absent   no history rows at all, which is also what a failed read looks
 *            like from here. Must render IDENTICALLY to `running`; flipping
 *            between the two and seeing nothing change is the check.
 *
 * `?match=none` IS THE FOURTH STATE AND IT IS ON THE OTHER AXIS. That fixture
 * carries no `matchId`, so there is no match to have a record of and the panel
 * does not render at all — which is a different thing from a match whose record
 * could not be found, and the two must not look alike.
 *
 * THE JOIN IS THE REAL ONE. This harness calls `matchRecordFor` rather than
 * picking a fixture per case, so `?record=found` is only "found" if the shipped
 * join actually finds it.
 */
const HISTORY_CASES = {
  found: [
    {
      matchId: MATCH_ID,
      endedAt: MATCH_START + 11 * MIN,
      mode: 'squad',
      placement: 3,
      total: 47,
      kills: 7,
      downs: 2,
      revives: 1,
      damage: 1642,
      survivedMs: 11 * MIN - 47_000,
      xpEarned: 820,
      voltsEarned: 240,
      won: false,
    },
    /*
      THE SAME MATCH NUMBER, FIVE MONTHS EARLIER. The game's match number counts
      up from the server's boot, so this is a shape that really occurs — and it
      is the one that would put a stranger's afternoon on this case if the join
      matched on the number alone. It is in the FIRST case rather than in one of
      its own precisely so the ordinary preview exercises it: if `?record=found`
      ever shows 0 kills and no placement, the join has taken this row.
    */
    {
      matchId: MATCH_ID,
      endedAt: MATCH_START - 150 * 24 * HOUR,
      mode: 'solo',
      placement: 22,
      total: 40,
      kills: 0,
      downs: 0,
      revives: 0,
      damage: 0,
      survivedMs: 2 * MIN,
      xpEarned: 30,
      voltsEarned: 5,
      won: false,
    },
  ],
  running: [
    {
      matchId: MATCH_ID - 1,
      endedAt: MATCH_START - HOUR,
      mode: 'squad',
      placement: 1,
      total: 44,
      kills: 4,
      downs: 1,
      revives: 3,
      damage: 980,
      survivedMs: 18 * MIN,
      xpEarned: 1400,
      voltsEarned: 500,
      won: true,
    },
  ],
  /*
    A SOLO, WHERE DOWNS AND REVIVES CANNOT HAPPEN AT ALL.

    BR.Mode.SOLO carries dbno = false in the gamemode, and combat.lua says it
    in a sentence: "knock a squad player down and all kill a solo". So this is
    not a player who happened to knock nobody -- it is a match where knocking
    was not available. IncidentMatchRecord draws neither figure here.

    WITHOUT THIS CASE THE GATE HAD NOTHING EXERCISING IT. The only other solo
    row in this file is the five-month-old decoy above, which exists to be
    REJECTED by the join, so it never reaches the component at all.
  */
  solo: [
    {
      matchId: MATCH_ID,
      endedAt: MATCH_START + 9 * MIN,
      mode: 'solo',
      placement: 4,
      total: 60,
      kills: 5,
      downs: 0,
      revives: 0,
      damage: 1180,
      survivedMs: 9 * MIN - 20_000,
      xpEarned: 900,
      voltsEarned: 260,
      won: false,
    },
  ],
  absent: [],
} satisfies Record<string, ProfileMatch[]>

type HistoryKey = keyof typeof HISTORY_CASES

/**
 * The case as it stood at `now`, with nothing from the future in it.
 *
 * WHY THIS EXISTS. The `running` case has to be looked at from INSIDE the
 * match, which puts the clock about three hours before the rest of this
 * harness. The `pending` fixture's note arrives an hour after filing and the
 * closed fixtures resolve two hours after that — all of which would then be
 * events that have not happened yet, rendered above a "still in progress" chip.
 * A harness showing an impossible row is worse than a harness missing a case.
 *
 * SO THE AXES STAY INDEPENDENT AND THE CLOCK WINS. Pick any state you like
 * alongside a running match; what you get is that case as far as it had got,
 * which is a real shape. An incident cannot be resolved before it is filed.
 */
function asOf(incident: Incident, now: number): Incident {
  const events = incident.events.filter((e) => e.at <= now)
  if (events.length === incident.events.length && (incident.resolvedAt ?? 0) <= now) {
    return incident
  }

  if ((incident.resolvedAt ?? 0) <= now) return { ...incident, events }

  return {
    ...incident,
    events,
    state: 'pending_review',
    resolvedAt: null,
    resolvedByLicense: null,
    resolvedByName: null,
    resolution: null,
    verdict: null,
    closedByBan: null,
  }
}

/**
 * ═══ THE ARTIFACT AXIS ═══
 *
 * NO REAL ARTIFACT HAS EVER EXISTED. The bucket was created on 2026-08-20 and
 * is empty; producing one frame needs a live FiveM server, a client with
 * `screenshot-basic` running, a reported player who has not disconnected, and
 * S3 — none of which is in this repo's harness. So every shape below is a
 * fixture, and this axis is the only place the carousel can be looked at at all.
 *
 * WHY THESE FIVE:
 *
 *   full   all nine — three timed (immediately, +5s, +10s) then six
 *          corroborations. The ceiling, and the only case where the counter,
 *          both arrows and every dot are exercised at once.
 *   gaps   01, 04, 07. GAPS ARE THE NORMAL CASE, not the degraded one: the
 *          capture runs on the subject's own machine and each frame fails
 *          independently. This must look like a three-frame set, not like a
 *          nine-frame set with holes in it.
 *   one    a single frame. The boundary that deletes the counter and every
 *          control, and the one most likely to be got wrong by a carousel that
 *          assumes it can always step.
 *   none   nothing. Renders as an em-dash under the header and NOTHING ELSE —
 *          no sentence, no icon, no explanation (owner, 2026-08-20: "we don't
 *          need helper text to convey that. it's assumed").
 *   aged   nothing, on a case opened 200 days ago — past the bucket's 180-day
 *          expiry, so its frames are gone rather than never taken.
 *
 * `none` AND `aged` MUST RENDER IDENTICALLY, and that is the point of shipping
 * both. The console does not tell the four causes of an empty set apart, so
 * flipping between these two and seeing nothing change is the check.
 */
const DAY = 24 * HOUR

const ARTIFACT_CASES = {
  full: Array.from({ length: 9 }, (_, i) => ({
    index: i + 1,
    capturedAt:
      BASE -
      3 * HOUR +
      // 01/02/03 at 0s, +5s, +10s; corroborations every 90s after that.
      (i < 3 ? i * 5_000 : 10_000 + (i - 2) * 90_000),
  })),
  gaps: [
    { index: 1, capturedAt: BASE - 3 * HOUR },
    { index: 4, capturedAt: BASE - 3 * HOUR + 47_000 },
    { index: 7, capturedAt: BASE - 3 * HOUR + 214_000 },
  ],
  one: [{ index: 1, capturedAt: BASE - 3 * HOUR }],
  none: [],
  aged: [],
} satisfies Record<string, Artifact[]>

type ArtifactKey = keyof typeof ARTIFACT_CASES

/** Only `aged` moves the clock; every other case sits where the fixture put it. */
const ARTIFACT_AGE_SHIFT: Record<ArtifactKey, number> = {
  full: 0,
  gaps: 0,
  one: 0,
  none: 0,
  aged: -200 * DAY,
}

/**
 * Push a whole case back in time, timeline and all.
 *
 * EVERY TIMESTAMP MOVES BY THE SAME DELTA, because shifting only `openedAt`
 * would produce a case whose opening event happened after the note on it — a
 * shape no real row can have, and the harness's whole job is to avoid showing
 * one.
 */
function shifted(incident: Incident, by: number): Incident {
  if (by === 0) return incident
  const move = (v: number | null | undefined) =>
    typeof v === 'number' ? v + by : v

  return {
    ...incident,
    openedAt: incident.openedAt + by,
    events: incident.events.map((e) => ({ ...e, at: e.at + by })),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt + by : incident.resolvedAt,
    /*
      THE MATCH MOVES WITH IT, for the same reason the events do. `aged` pushes
      a case 200 days back to put it past the artifact bucket's expiry; leaving
      the match where it was would produce an incident opened last spring whose
      match ran this afternoon — a shape no row can have, which is exactly what
      this function exists to prevent.
    */
    matchCreatedAt: move(incident.matchCreatedAt),
    matchStartedAt: move(incident.matchStartedAt),
    matchEndedAt: move(incident.matchEndedAt),
    matchEndsBy: move(incident.matchEndsBy),
    matchTimeline: incident.matchTimeline
      ? incident.matchTimeline.map((e) => ({ ...e, at: e.at + by }))
      : incident.matchTimeline,
  }
}

/**
 * A stand-in for a frame, drawn rather than fetched.
 *
 * TRANSPARENTLY SYNTHETIC, like every other fixture in this directory — a
 * screenshot of this page must not be mistakable for a real player's screen.
 * It is deliberately a flat panel with a number on it and the word PREVIEW, not
 * a plausible game frame.
 *
 * 16:9 BECAUSE THAT IS WHAT `screenshot-basic` RETURNS — the client's own
 * framebuffer. The carousel's aspect box is sized for it and the fit only means
 * anything if the fixture is the same shape as the real thing.
 */
const PREVIEW_FRAMES: Record<number, string> = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [i + 1, previewFrame(i + 1)]),
)

function previewFrame(index: number): string {
  const n = String(index).padStart(2, '0')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">` +
    `<rect width="640" height="360" fill="#1c2333"/>` +
    `<rect x="8" y="8" width="624" height="344" fill="none" stroke="#3d4a63" stroke-width="2" stroke-dasharray="10 8"/>` +
    `<text x="320" y="176" fill="#6f819f" font-family="monospace" font-size="86" text-anchor="middle">${n}</text>` +
    `<text x="320" y="228" fill="#4d5c78" font-family="monospace" font-size="22" text-anchor="middle" letter-spacing="6">PREVIEW</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

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
  const artifacts = pick(sp.artifacts, ARTIFACT_CASES, 'full' as ArtifactKey)
  const match = pick(sp.match, MATCH_CASES, 'none' as MatchKey)
  const record = pick(sp.record, HISTORY_CASES, 'found' as HistoryKey)

  const params = { state, subject, artifacts, match, record }

  /**
   * THE CLOCK IS PART OF THE MATCH CASE, not a constant. Whether a match with
   * no recorded end reads as running or as never-reported is decided by `now`
   * against `matchEndsBy`, so a fixed clock could only ever show one of the
   * two. It is printed below with the other props for the same reason those
   * are: a state you cannot see the input to is a state you are guessing at.
   */
  const now = MATCH_CASES[match].now

  const shift = ARTIFACT_AGE_SHIFT[artifacts]

  const incident = asOf(
    shifted({ ...STATE_CASES[state], ...MATCH_CASES[match].fields }, shift),
    now,
  )

  /**
   * THE HISTORY MOVES WITH THE CASE, for the same reason `shifted` moves the
   * match: `aged` pushes everything 200 days back, and history rows left where
   * they were would be a match that ENDED five months after the incident it was
   * filed during — a shape no row can have, and one the join would correctly
   * refuse, making `?artifacts=aged&record=found` silently show an em dash for
   * the wrong reason.
   */
  const history = HISTORY_CASES[record].map((m) => ({
    ...m,
    endedAt: m.endedAt + shift,
  }))

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
            name="artifacts"
            keys={Object.keys(ARTIFACT_CASES)}
            current={artifacts}
            params={params}
          />
          <Axis
            name="match"
            keys={Object.keys(MATCH_CASES)}
            current={match}
            params={params}
          />
          <Axis
            name="record"
            keys={Object.keys(HISTORY_CASES)}
            current={record}
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
              subjectBanned={String(SUBJECT_CASES[subject].banned)} ·
              now={utcIso(now)}
            </span>
          </p>
        </nav>

        <IncidentDetail
          incident={incident}
          artifacts={ARTIFACT_CASES[artifacts]}
          artifactSrcOverride={PREVIEW_FRAMES}
          /*
            THE REAL JOIN, NOT A FIXTURE PER CASE. `?record=found` is only
            "found" if the shipped `matchRecordFor` finds it — which is what
            makes the two rows numbered 412 in that fixture worth having.
          */
          matchRecord={matchRecordFor(incident, history)}
          subjectOnline={SUBJECT_CASES[subject].online}
          subjectBanned={SUBJECT_CASES[subject].banned}
          now={now}
          categoryLabel={CATEGORY_LABEL}
          kindLabel={KIND_LABEL}
          verdictLabel={VERDICT_LABEL}
        />
      </div>
    </AppShell>
  )
}
