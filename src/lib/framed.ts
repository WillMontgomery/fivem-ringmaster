/**
 * Is this request the console being rendered inside the game?
 *
 * WHY THIS EXISTS. The first-run preferences prompt is a modal that opens on
 * every route until somebody states a timezone. In a browser that is fine: it
 * is asked once, answered once, and never seen again. In the pause menu it is
 * wrong even when it works -- it lands on top of a moderation console during a
 * live match, and the thing it asks for is a search through four hundred
 * timezones, which is not what somebody opened the Admin tab to do.
 *
 * The owner's framing, on 2026-08-20: *"Is it possible to hide the popup only
 * for certain user-agents? ... For desktop/mobile users we still have the
 * Settings page."* Settings carries both controls, so nothing is lost in-game
 * that is not reachable from a browser.
 *
 * ------------------------------------------------------------------------
 * TWO SIGNALS, EITHER SUFFICIENT, AND THEY ANSWER DIFFERENT QUESTIONS
 * ------------------------------------------------------------------------
 *
 * `Sec-Fetch-Dest: iframe` says THIS DOCUMENT IS BEING LOADED INTO A FRAME.
 * It is sent by the browser, not by us, it cannot be spoofed by page content,
 * and it is the semantically correct question -- a modal is wrong in a frame
 * whatever is doing the framing. Chrome has sent it since 80; CEF here is 103.
 *
 * The `CitizenFX/` user agent says THIS IS THE GAME CLIENT. FiveM's NUI builds
 * its product string as `Chrome/<version> CitizenFX/1.0.0.<build>` in
 * `nui-core/src/NUIInitialize.cpp`, so the token is theirs and not a guess.
 *
 * BOTH ARE CHECKED BECAUSE EITHER COULD BE ABSENT. A proxy that strips
 * `Sec-Fetch-*` leaves the user agent; a future NUI that drops the CitizenFX
 * token still frames the page. Requiring both would mean one missing header
 * puts the modal back over a live match, and there is no cost to being right
 * twice.
 *
 * ------------------------------------------------------------------------
 * IT FAILS TOWARDS SHOWING THE PROMPT, WHICH IS THE HARMLESS DIRECTION
 * ------------------------------------------------------------------------
 *
 * No headers, unrecognised headers, a static render with no request at all:
 * all false, and the prompt appears. The cost of a false negative is a browser
 * user seeing a dialog they can answer in five seconds. The cost of a false
 * positive is a desktop admin who can never be asked and may never think to
 * open Settings. Those are not comparable, so this leans deliberately.
 *
 * NOT A SECURITY BOUNDARY, and must never become one. A user agent is
 * self-reported and `Sec-Fetch-Dest` is only as honest as the client sending
 * it. This decides whether to draw a dialog. Nothing here may ever gate a
 * permission, a session or a write -- `middleware.ts` and `handoff.ts` are
 * where those questions are answered, from things a caller cannot choose.
 */

/** The shape both `await headers()` and `NextRequest.headers` present. */
export type HeaderReader = { get(name: string): string | null | undefined }

/**
 * FiveM's own product token. Matched case-insensitively and WITHOUT the version
 * suffix -- the build number moves with every client release and pinning it
 * would mean this quietly stopped working on the next one.
 */
const NUI_AGENT = /citizenfx\//i

export function isFramedClient(h: HeaderReader | null | undefined): boolean {
  if (!h) return false

  // Header names are case-insensitive per RFC 9110, and both Next's
  // `headers()` and `NextRequest.headers` lower-case on lookup. Asked in
  // lower case here so it reads the same as it is stored.
  const dest = h.get('sec-fetch-dest')
  if (typeof dest === 'string' && dest.trim().toLowerCase() === 'iframe') {
    return true
  }

  const ua = h.get('user-agent')
  if (typeof ua === 'string' && NUI_AGENT.test(ua)) return true

  return false
}
