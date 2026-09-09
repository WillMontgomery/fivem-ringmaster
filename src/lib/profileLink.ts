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
 * both parties of every kill, and the byline of a corroboration a person filed.
 * If a link is added to that page and not added here, the breadcrumb silently
 * stops working for it — which fails safe, in the direction of the old
 * behavior, but is still worth knowing.
 *
 * ═══ AND THAT IS EXACTLY WHAT HAPPENED TO THE CORROBORATOR ═══
 *
 * The owner's own in-game report on somebody else's anticheat case is a byline
 * carrying `?from=<case>` to a profile that is not the subject, is not the
 * reporter (an anticheat case has none), is not the linked license, and need
 * never have traded a kill with the subject. Every clause missed him, the
 * parameter was dropped, and the breadcrumb read "back to live players" — the
 * one sentence this module exists to answer. It worked only when he happened to
 * appear in a kill row, which is worse than not working.
 *
 * ONLY A CORROBORATION'S AUTHOR, MATCHING THE MARKUP EXACTLY. The rows that open
 * and close a case draw their author as plain text, so an admin's license on a
 * `resolved` event is not a link this page carries and must not open a
 * breadcrumb — `lib/corroborationText`'s `linksAuthor` is the other half of this
 * pair, and the kind is spelled here rather than imported because this module
 * has no runtime imports and every shape it reads is restated structurally.
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
    events?:
      | ReadonlyArray<{
          kind?: string | null
          byLicense?: string | null
        } | null>
      | null
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

  if (
    (incident.events ?? []).some(
      (e) => e?.kind === 'corroborated' && e?.byLicense === license,
    )
  ) {
    return true
  }

  return (incident.matchTimeline ?? []).some(
    (e) => e?.killerLicense === license || e?.victimLicense === license,
  )
}
