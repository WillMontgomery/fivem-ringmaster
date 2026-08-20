'use client'

import { useEffect } from 'react'

/**
 * Tell the page that framed us that nobody is signed in. Renders nothing.
 *
 * THIS IS THE ONLY THING THAT MAKES THE COMMON CASE FREE. The game opens its
 * NUI iframe at the plain console URL every time the pause menu is opened —
 * no token, no mint, no spinner — because CEF's cookie jar outlives the frame
 * and an existing session simply renders. That leaves one question the game
 * cannot answer on its own: it cannot read a cross-origin frame's URL or
 * content, so it has no way to notice that this particular open landed on the
 * login page instead. So the console says so.
 *
 * THE ALTERNATIVES WERE WORSE. Having the game poll a "do I have a session"
 * endpoint does not work from the game SERVER at all — the cookie is in the
 * player's CEF jar, not on the box — and doing it from the NUI page means a
 * credentialed cross-origin fetch that only succeeds because FiveM's CEF runs
 * with web security disabled, which is not a thing to build on. Having the game
 * mint speculatively on every open throws away the entire saving.
 *
 * ----------------------------------------------------------------------------
 * WHAT THE NUI LISTENER ON THE OTHER SIDE MUST DO
 * ----------------------------------------------------------------------------
 *
 *     window.addEventListener('message', (e) => {
 *       if (e.origin !== '<the console origin>') return   // EXACT compare
 *       if (e.data?.source !== 'ringmaster') return
 *       ...
 *     })
 *
 * THE ORIGIN CHECK IS NOT OPTIONAL AND IS NOT A FORMALITY. That handler's job
 * is to make the game server mint an admin session. A handler that accepts
 * `message` from any origin is one that any other framed page — an embedded
 * video, a map, anything else NUI loads — can drive into minting. `===` against
 * the console's origin. Never `includes`, never `endsWith`, never a regex.
 *
 * ----------------------------------------------------------------------------
 * WHY `'*'` GOING OUT IS NEVERTHELESS FINE
 * ----------------------------------------------------------------------------
 *
 * A `postMessage` needs a target origin, and this side does not know one: the
 * NUI parent is `https://cfx-nui-<resource>`, whose resource name belongs to
 * the game repo, and hard-coding it here would couple this console's build to a
 * string in another repository.
 *
 * `'*'` is acceptable ONLY because the payload is worth nothing. It is one bit
 * — "the console you are framing is showing a login page" — which a framer can
 * already infer from the fact that it framed a login page. No token, no
 * identity, no session state beyond that. NOTHING SENSITIVE MAY EVER BE ADDED
 * TO THIS MESSAGE without giving it a real target origin first.
 */

/** Bumped if the shape ever changes, so an old game build can ignore a new one. */
const PROTOCOL_VERSION = 1

export function FrameHandoffSignal() {
  useEffect(() => {
    // Not framed: an ordinary browser tab, and there is nobody to tell.
    if (window.parent === window) return

    try {
      window.parent.postMessage(
        { source: 'ringmaster', v: PROTOCOL_VERSION, state: 'signed-out' },
        '*',
      )
    } catch {
      // A parent that cannot receive it changes nothing about this page. The
      // admin is looking at a working login button either way.
    }
  }, [])

  return null
}
