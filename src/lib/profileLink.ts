/**
 * Links from an incident to a profile, and the way back.
 *
 * ═══ THE COMPLAINT THIS ANSWERS ═══
 *
 * "Clicking on the player's profile in the incident page takes me to the
 * player's profile page - great! But the breadcrumbs there say 'back to live
 * players' and it should instead take me back to the incident." — the owner,
 * playtest.
 *
 * A PROFILE HAS ONE URL AND SEVERAL WAYS IN, which is the whole difficulty. The
 * live table, the search palette, the audit log, the moderation list and now an
 * incident all reach `/players/<license>`, and the page cannot know which of
 * them sent you. So the origin travels IN THE LINK — one query parameter, put
 * there by the incident page — and everything else keeps the behaviour it has.
 *
 * ═══ THE PARAMETER IS NOT TRUSTED, AND THAT IS WHAT `linksToProfile` IS FOR ═══
 *
 * Anybody can type a URL. `?from=<some other case>` would otherwise hand a
 * moderator a breadcrumb back to an incident they have never seen, about a
 * player they were not looking at — a link that reads like provenance and is
 * not. Nothing here can prove where somebody came from, so the server proves the
 * next best thing, which is the same thing in practice: that the incident named
 * ACTUALLY LINKS TO THIS PROFILE, so it is a page you could have arrived from.
 * A `from` that fails that test is dropped and the breadcrumb goes back to being
 * the ordinary one — never an error, because a stale link in a pasted URL is not
 * the reader's fault.
 *
 * NO RUNTIME IMPORTS, the property `labels`, `serverPhase` and `incidentChip`
 * all keep. Both halves are consumed by client components; the shapes below are
 * restated structurally rather than imported from `lib/incidents`, which reaches
 * DynamoDB, and the whole module is safe in a browser bundle.
 */

/** The query parameter. One spelling, in one place, read by two files. */
export const FROM_INCIDENT = 'from'

/**
 * A player's profile, optionally remembering which incident sent you there.
 *
 * WITHOUT AN INCIDENT IT IS THE PLAIN PATH — byte for byte what every other
 * caller in this console already builds, so nothing that links to a profile
 * from anywhere else changes shape.
 */
export function profileHref(
  license: string,
  fromIncidentId?: string | null,
): string {
  const path = `/players/${encodeURIComponent(license)}`
  if (!fromIncidentId) return path
  return `${path}?${FROM_INCIDENT}=${encodeURIComponent(fromIncidentId)}`
}

/** One incident, at its stable URL. */
export function incidentHref(incidentId: string): string {
  return `/incidents/${encodeURIComponent(incidentId)}`
}

/**
 * The `from` value off a search-params bag, or null.
 *
 * A REPEATED PARAMETER IS NOT A VALUE. Next hands back `string[]` for
 * `?from=a&from=b`, and taking the first would be this console choosing which of
 * two claims to believe. Neither, is the answer.
 */
export function fromIncidentParam(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const raw = params[FROM_INCIDENT]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value === '' ? null : value
}

/**
 * Every profile this incident's page carries a link to.
 *
 * THE LIST IS THE MARKUP'S LIST, and it has to stay that way. The report bar
 * links the subject, the reporter and the linked profile; the timeline links
 * both parties of every kill. If a link is added to that page and not added
 * here, the breadcrumb silently stops working for it — which fails safe, in the
 * direction of the old behaviour, but is still worth knowing.
 *
 * `null` NEVER MATCHES. An incident with no reporter has `reporterLicense:
 * null`, and a caller asking about a player whose license is somehow empty must
 * not be told they are the reporter.
 */
export function linksToProfile(
  incident: {
    subjectLicense?: string | null
    reporterLicense?: string | null
    linkedLicense?: string | null
    matchTimeline?:
      | ReadonlyArray<{
          killerLicense?: string | null
          victimLicense?: string | null
        } | null>
      | null
  },
  license: string,
): boolean {
  if (license === '') return false

  if (
    incident.subjectLicense === license ||
    incident.reporterLicense === license ||
    incident.linkedLicense === license
  ) {
    return true
  }

  return (incident.matchTimeline ?? []).some(
    (e) => e?.killerLicense === license || e?.victimLicense === license,
  )
}
