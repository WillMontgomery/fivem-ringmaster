/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * THE CLIENT ROUTER CACHE MUST NOT HOLD OPERATIONAL DATA.
   *
   * `export const dynamic = 'force-dynamic'` governs the SERVER: it stops the
   * page being prerendered or cached at the edge. It says nothing about the
   * cache the App Router keeps in the browser — so navigating away from a
   * profile and back re-showed the payload from that in-memory cache, and the
   * page looked frozen even though every source behind it had moved.
   *
   * The symptom was exactly as reported: going back to the player list and
   * clicking the same profile again showed stale data until a hard reload.
   *
   * Zero on both is right for this application specifically. Every page here
   * renders live moderation state, and a stale one is not a performance win —
   * it is a moderator acting on a player who left ten minutes ago.
   */
  experimental: {
    staleTimes: { dynamic: 0, static: 0 },
  },
  /**
   * THE FRAME RULE — #23, AND IT IS THE WEAKEST THING IN THIS FILE.
   *
   * `X-Frame-Options: DENY` IS GONE. It had to go: the pause-menu console is a
   * NUI iframe, and DENY is unconditional — there is no origin it can be told
   * to permit. `frame-ancestors` replaces it because it is the directive that
   * takes a list, and it also SUPERSEDES `X-Frame-Options` where both are sent,
   * so leaving DENY in place beside it would be a header whose only effect is
   * to confuse whoever reads it next.
   *
   * ------------------------------------------------------------------------
   * WHY `https:` — A SCHEME, NOT A HOST — AND WHAT IT COSTS
   * ------------------------------------------------------------------------
   *
   * The NUI parent is `https://cfx-nui-<resource>`, and that origin CANNOT BE
   * WRITTEN AS A CSP SOURCE. Two independent reasons, both checked against the
   * CSP Level 3 grammar rather than assumed:
   *
   *   · `host-part = "*" / [ "*." ] 1*host-char *( "." 1*host-char )`. A
   *     wildcard is a whole leftmost LABEL or nothing. `https://cfx-nui-*` is
   *     not a source expression; there is no syntax for a prefix inside a
   *     label, and the resource name is the part that varies.
   *   · `host-char = ALPHA / DIGIT / "-"`. Underscore is not in it. FiveM
   *     resource names routinely contain one (`br_ringmaster`), so even a
   *     hard-coded host would be an invalid expression the parser discards —
   *     which fails CLOSED, as a console nobody can open in-game.
   *
   * And the resource name is deliberately not known here at all:
   * `components/FrameHandoffSignal.tsx` refuses to hard-code it for the same
   * reason, because it belongs to the game repository.
   *
   * SO THIS PERMITS ANY HTTPS PAGE ON THE INTERNET TO FRAME THE CONSOLE. That
   * is the honest description and it should not be softened. It is not a
   * missing narrowing anybody can add later from this repo — citizenfx/fivem#942
   * has been open since 2021 asking for the framing headers to be handled at
   * the NUI end, and until something changes there, "as narrow as actually
   * works" and "any HTTPS origin" are the same value.
   *
   * `nui:` IS THE SECOND ANCESTOR AND IS NOT OPTIONAL. `frame-ancestors` checks
   * EVERY frame in the chain, not just the immediate parent, and above the
   * resource page sits CEF's own `nui://game/ui/root.html`. A policy naming
   * only the https origin refuses on the grandparent. A scheme-source is the
   * only way to name it — `nui://game` has no registrable host to pin.
   *
   * ------------------------------------------------------------------------
   * WHAT STANDS BEHIND IT, SINCE THIS DIRECTIVE STOPS ALMOST NOTHING
   * ------------------------------------------------------------------------
   *
   * NOT the cross-origin check in `src/middleware.ts`. A framed console is
   * still the console: its own requests are genuinely same-origin and pass,
   * and they would pass for a stolen click too. That check closes CSRF. This
   * is clickjacking, and the two do not substitute for each other.
   *
   * What stands behind it is that the destructive actions mostly cannot be
   * driven by a click alone — a ban needs fifteen typed characters and a
   * confirm, a kick five, an incident resolution fifteen, and force, cancel and
   * branch-switch-away-from-main are multi-step confirms. Clickjacking steals a
   * click, not a typed paragraph.
   *
   * THAT ARGUMENT HAS THREE KNOWN HOLES. An earlier version of this comment
   * claimed two and asserted "maintenance, deploy and branch-switch are
   * multi-step confirms", which was FALSE — a sweep on 2026-08-20 found a third
   * and the false clause is corrected here. A security rationale that overstates
   * its own coverage is worse than one that admits a gap, because the next
   * person reads it instead of the code:
   *
   *   1. `components/ModerationBoard.tsx` lifts a ban on one click. FIXED in
   *      9a4e9c5 — though note that file has ZERO CALLERS and was never
   *      reachable, so it was never the live exposure this comment implied.
   *   2. `components/MaintenancePanel.tsx` "Revert to main" — one click, an
   *      immediate drain. Deliberate: it is the escape hatch when a dev branch
   *      is broken, and recovery must be cheaper than the mistake. Reaffirmed by
   *      the owner on 2026-08-20.
   *   3. `components/MaintenancePanel.tsx:1597` "Schedule update" — one click,
   *      and `drainIn` defaults to '0', so the default is an immediate drain and
   *      a deploy when empty. **This is the one that is reachable today.** The
   *      owner was shown it and confirmed on 2026-08-20 that it stays
   *      unconfirmed.
   *
   * So the honest statement of the trade: a stolen click cannot ban, kick or
   * resolve, but it CAN start a drain and a deploy. That is disruption on a
   * server the operator watches, not a compromise of anyone's account — and it
   * is the price of an escape hatch that stays fast. Recorded so nobody
   * rediscovers it and assumes it was missed.
   */
  // The admin console renders live operational data. Nothing here should sit
  // in a CDN cache, and nothing here should be indexed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https: nui:",
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
