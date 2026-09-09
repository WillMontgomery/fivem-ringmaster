/**
 * Contract checks for the incident-to-profile link and the way back.
 *
 *   npx tsx src/lib/profileLink.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts` and `handoff.check.ts`: this repo
 * has no test framework. IT IS WIRED INTO `npm run verify` as
 * `check:profilelink`; a check nothing runs is this repository's signature
 * failure mode.
 *
 * ═══ WHY IT EXISTS NOW AND NOT BEFORE ═══
 *
 * `linksToProfile` had no cases at all. Its own header says what it is for and
 * what breaks it: "If a link is added to that page and not added here, the
 * breadcrumb silently stops working for it." A link WAS added to that page —
 * the byline of a corroboration a person filed — and it was not added here, so
 * the href carried `?from=<case>` to a page that dropped it and drew "back to
 * live players". The owner's own words are what that parameter exists to
 * answer: "the breadcrumbs there say 'back to live players' and it should
 * instead take me back to the incident."
 *
 * SILENT IS THE WORD THAT MATTERS. Nothing failed, nothing logged, and it even
 * WORKED whenever the corroborator happened to appear in one of the subject's
 * kill rows — intermittent rather than absent, which is the harder bug to see.
 *
 * ═══ AND THE OTHER HALF IS THAT THE TWO LISTS MUST MATCH ═══
 *
 * `linksToProfile` is the reader's half of a pair whose writer's half is
 * `lib/corroborationText`'s `linksAuthor`. A profile the timeline does NOT link
 * must not open a breadcrumb either: an admin's license on the row that closed
 * a case is drawn as plain text, so a `?from=` naming that case is not
 * provenance for that admin's profile.
 */

import { linksAuthor } from './corroborationText'
import {
  FROM_INCIDENT,
  fromIncidentParam,
  linksToProfile,
  profileHref,
} from './profileLink'

let failed = 0
let ran = 0

function check(label: string, ok: boolean, detail?: unknown): void {
  ran++
  if (ok) return
  failed++
  console.error(`  FAIL  ${label}`)
  if (detail !== undefined) {
    console.error(`        got: ${JSON.stringify(detail)}`)
  }
}

const CASE = 'aaaaaaaa-0000-4000-8000-000000000003'
const OWNER = 'license:owner'
const CHEATER = 'license:cheater'

// ---------------------------------------------------------------------------
// 1. The href, and the parameter it carries.
// ---------------------------------------------------------------------------

check(
  'a profile link without a case is the plain path every other caller builds',
  profileHref(OWNER) === '/players/license%3Aowner',
  profileHref(OWNER),
)
check(
  'and with one it carries the case',
  profileHref(OWNER, CASE) === `/players/license%3Aowner?${FROM_INCIDENT}=${CASE}`,
  profileHref(OWNER, CASE),
)
check(
  'the parameter round-trips back off the bag',
  fromIncidentParam({ [FROM_INCIDENT]: CASE }) === CASE,
  fromIncidentParam({ [FROM_INCIDENT]: CASE }),
)

// ---------------------------------------------------------------------------
// 2. THE CORROBORATOR, WHICH EVERY OTHER CLAUSE MISSES.
// ---------------------------------------------------------------------------

/**
 * ANTICHEAT CASE, SO THERE IS NO REPORTER TO MATCH. The owner corroborates it
 * in game against a player he never traded a kill with. He is not the subject,
 * not the reporter, not the linked license, and not a party to any kill — the
 * byline is the ONLY link on that page to his profile.
 */
const anticheatCase = {
  incidentId: CASE,
  subjectLicense: CHEATER,
  reporterLicense: null,
  linkedLicense: null,
  events: [
    { at: 1, kind: 'opened', byLicense: null, byName: 'Anticheat' },
    { at: 2, kind: 'corroborated', byLicense: OWNER, byName: 'Xeon' },
  ],
  matchTimeline: [
    { killerLicense: 'license:someoneelse', victimLicense: CHEATER },
  ],
}

check(
  'the corroborator is somewhere this case links to',
  linksToProfile(anticheatCase, OWNER),
)
check(
  'the subject still is',
  linksToProfile(anticheatCase, CHEATER),
)
check(
  'and a stranger still is not',
  !linksToProfile(anticheatCase, 'license:nobody'),
)

/**
 * THE TWO HALVES OF THE PAIR AGREE, WHICH IS THE ASSERTION THAT SURVIVES A
 * REWORDING OF EITHER. Every author the timeline draws as a link must open a
 * breadcrumb, and every author it draws as plain text must not.
 */
const authors = [
  { at: 1, kind: 'opened', byLicense: 'license:reporter', byName: 'Marla' },
  { at: 2, kind: 'corroborated', byLicense: OWNER, byName: 'Xeon' },
  { at: 3, kind: 'corroborated', byLicense: null, byName: 'System' },
  { at: 4, kind: 'note', byLicense: 'license:admin', byName: 'Preview Admin' },
  { at: 5, kind: 'resolved', byLicense: '', byName: 'Discord Only Admin' },
]
const bare = {
  incidentId: CASE,
  subjectLicense: CHEATER,
  reporterLicense: null,
  linkedLicense: null,
  events: authors,
  matchTimeline: [],
}
for (const event of authors) {
  const license = event.byLicense
  if (license === null || license === '') continue
  check(
    `${event.kind} by ${license}: the timeline's link set and the breadcrumb's agree`,
    linksAuthor(event) === linksToProfile(bare, license),
    { drawn: linksAuthor(event), accepted: linksToProfile(bare, license) },
  )
}

/**
 * AN EMPTY LICENSE IS NOBODY. `incidents.ts` writes `byLicense: ''` for an
 * admin with no grants row, and a caller asking about a player whose license is
 * somehow empty must not be told the case links to them.
 */
check(
  'an empty license matches nothing, whatever the events hold',
  !linksToProfile(bare, ''),
)

/**
 * AND A CASE WITH NO EVENTS AT ALL IS NOT AN ERROR. Every field this reads is
 * optional, because the shapes are restated structurally rather than imported.
 */
check(
  'a case with nothing on it answers false rather than throwing',
  !linksToProfile({}, OWNER) &&
    !linksToProfile({ events: null, matchTimeline: null }, OWNER) &&
    !linksToProfile({ events: [null] }, OWNER),
)

// ---------------------------------------------------------------------------

if (failed) {
  console.error(`\ncheck:profilelink — ${failed} of ${ran} case(s) failed`)
  console.error(
    'The breadcrumb back to an incident is only drawn for a profile that ' +
      'incident actually links to. See src/lib/profileLink.ts.',
  )
  process.exit(1)
}
console.log(
  `check:profilelink — ${ran} cases: the href, the parameter, and the link set ` +
    'the breadcrumb trusts, including the corroborator',
)
