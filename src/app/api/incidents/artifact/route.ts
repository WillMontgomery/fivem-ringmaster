import { artifactKey } from '@/lib/artifacts'
import { presign } from '@/lib/artifactStore'
import { currentAdmin } from '@/lib/session'

/**
 * One artifact frame, fetched through this console rather than from S3 directly.
 *
 * ═══ WHY THE `<img>` POINTS HERE AND NOT AT A PRESIGNED URL ═══
 *
 * The obvious build signs nine URLs while rendering the page and puts them in
 * the HTML. It is worse in three ways that all have the same shape — a
 * presigned URL is a bearer credential, and HTML is a bad place to keep one:
 *
 *   · IT OUTLIVES THE SESSION. Sign for fifteen minutes and the URL still works
 *     fifteen minutes after the admin signs out, or after their Discord role
 *     is taken away. Signed here, per fetch, the session is checked every time.
 *   · IT LEAVES THE CONSOLE. "View source", a screenshot of devtools, a page
 *     saved and pasted into Discord — each one hands over a link to a picture of
 *     a player's screen that anybody can open. What is in this page's markup is
 *     `/api/incidents/artifact?id=…&n=3`, which is worthless without the cookie.
 *   · IT GOES STALE IN AN OPEN TAB. A moderator reads the timeline, takes a
 *     call, comes back and clicks to frame 5. A URL signed at render time is
 *     long dead; one signed when the browser asks for it cannot be.
 *
 * So the signature never reaches the browser as a URL to keep. It is the target
 * of a redirect, alive for sixty seconds, redeemed immediately.
 *
 * ═══ AS PERMISSIVE AS THE PAGE, AND NO MORE ═══
 *
 * `currentAdmin()`, not `authorize()`. Reading an incident takes a session and
 * nothing else — `app/incidents/[id]/page.tsx` requires nothing more, and only
 * RESOLVING one is a write. An image route stricter than its page would hide
 * evidence from admins who are allowed to see the case; one looser would serve
 * players' screens to anyone who guessed a UUID. The rule is that this route and
 * that page agree, and `currentAdmin()` is what the page uses.
 *
 * IT ALSO COVERS IDLE. `currentAdmin()` returns null for a session that timed
 * out, which is why the check is that call rather than a bare `auth()`.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const admin = await currentAdmin()
  if (!admin) return new Response(null, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  const index = Number(url.searchParams.get('n'))

  /**
   * VALIDATED BY BEING ABLE TO NAME A KEY, which is one check rather than two
   * that could disagree. `artifactKey` holds the v4 UUID shape and the 1..9
   * bound, and it is the same function the probe and `check:artifacts` use — so
   * a key this route would sign is a key the game could have written.
   */
  if (!artifactKey(id, index)) return new Response(null, { status: 400 })

  const signed = await presign(id, index)
  if (!signed) return new Response(null, { status: 400 })

  /**
   * `no-store` ON THE REDIRECT, and it matters more than it looks. The redirect
   * carries a sixty-second credential; a cached one would send the browser at a
   * dead URL for as long as the cache held it, and the frame would render as a
   * broken image on a case where the evidence is fine.
   *
   * 302, NOT 307: the method is already GET and there is no body to preserve, so
   * the plain "found elsewhere" is the honest status.
   */
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed,
      'Cache-Control': 'private, no-store, max-age=0',
      /**
       * S3's hostname would otherwise reach the referrer of the image request.
       * It is not a secret, but nothing needs it either.
       */
      'Referrer-Policy': 'no-referrer',
    },
  })
}
