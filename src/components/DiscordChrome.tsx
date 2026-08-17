'use client'

import {
  createContext,
  Suspense,
  use,
  useContext,
  useEffect,
  useState,
} from 'react'

import type { AccentSurface } from '@/lib/contrast'
import type { DiscordChrome } from '@/lib/profile'

/**
 * The Discord half of a profile page, and the gate that decides when to show it.
 *
 * THREE REQUIREMENTS THAT PULL AGAINST EACH OTHER, resolved here rather than in
 * the view:
 *
 *   1. ASK DISCORD EVERY RENDER (owner). Styling is the one thing where a
 *      cached answer is the wrong answer, so there is no cache anywhere — see
 *      lib/discord.ts.
 *   2. NEVER BLANK THE PAGE. A moderator opening a profile is deciding
 *      something about a person, and the identifiers, the play record and the
 *      moderation buttons must not wait five seconds on somebody's avatar.
 *   3. NOTHING POPS IN LATE (owner). "Data displays, then images lag behind" is
 *      the specific thing to avoid, so the Discord-shaped parts of the page
 *      appear at ONE instant, after their images are decoded — not when the
 *      JSON arrives.
 *
 * HOW THEY FIT TOGETHER. The server never awaits Discord; it hands this
 * component a promise. `Resolver` sits alone inside a Suspense boundary and is
 * the only thing that suspends, so the rest of the page streams immediately (1
 * and 2). When the promise lands, the images are fetched and DECODED before any
 * state flips (3). Every Discord-dependent element reads one status off the
 * context, so they cannot arrive at different times even by accident.
 *
 * `absent` IS NOT `loading`, and the distinction is the owner's: a player with
 * no Discord identifier must render immediately with no skeleton and no wait,
 * because there is nothing to wait for. A skeleton there would be a promise the
 * page cannot keep.
 *
 * WHY THE RESOLVER RENDERS NOTHING. It could have rendered the chrome directly
 * and let Suspense do the swap — but the swap would then happen when the JSON
 * arrived, which is exactly requirement 3's failure. Lifting the value into
 * state costs one render and buys the image gate.
 */

/**
 * How long the images get, after Discord has already answered.
 *
 * A SECOND BUDGET, NOT A SHARE OF THE FIRST. The owner's five seconds is the
 * API's; the CDN is a different service with a different failure mode, and a
 * fast API answer followed by a wedged image request would otherwise hold the
 * skeleton forever. Five again, because the images are the thing being waited
 * for on purpose and the rest of the page is already on screen — but it is a
 * ceiling, not a target: the ordinary case is two cached CDN images in well
 * under 200ms.
 */
const IMAGE_TIMEOUT_MS = 5_000

export type DiscordChromeState =
  /** No Discord id for this player. Render now; there is nothing coming. */
  | { status: 'absent' }
  /** A Discord id exists and we are waiting — on the API, then on its images. */
  | { status: 'loading' }
  /**
   * Resolved and drawable. `chrome.answered` says whether Discord actually
   * replied: a timeout still reaches `ready`, with the generic default avatar
   * and no accent, because "we asked and got nothing" is a finished answer.
   */
  | { status: 'ready'; chrome: DiscordChrome }

const Ctx = createContext<DiscordChromeState>({ status: 'absent' })

/** What the page knows about this player's Discord styling, right now. */
export function useDiscordChrome(): DiscordChromeState {
  return useContext(Ctx)
}

/**
 * The context, handed a finished state rather than a promise.
 *
 * REAL PAGES WANT `DiscordChromeProvider` BELOW, which resolves the promise and
 * runs the image gate. This is the half underneath it, exported for one reason:
 * the preview harness needs to hold `loading` still, and there is no promise
 * that produces that state without also producing a request that never ends.
 *
 * That is not a hypothetical either. The obvious version — hand the provider a
 * promise that never settles — does hold the skeleton, and holds the RSC stream
 * open with it: the response never completes, the tab spins forever, and
 * anything driving the browser blocks until it times out. Moving the promise to
 * the client does not help, because a client component is still rendered on the
 * server and `use()` still suspends there. Pinning the state is the only way to
 * look at a loading screen for longer than it exists.
 */
export function DiscordChromeStateProvider({
  state,
  children,
}: {
  state: DiscordChromeState
  children: React.ReactNode
}) {
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

/**
 * The accent surface, or null until there is one.
 *
 * Null covers all three of "no Discord id", "still loading" and "they never set
 * an accent colour", because every caller does the same thing with all three:
 * keep the theme's own colours. Anything that needs to tell them apart reads
 * `useDiscordChrome()` directly.
 */
export function useAccent(): AccentSurface | null {
  const state = useDiscordChrome()
  return state.status === 'ready' ? state.chrome.accent : null
}

/**
 * Suspends on the promise and hands the result up. Renders nothing, ever.
 *
 * The `use()` call is what makes the server stream: the RSC payload carries a
 * pending chunk for this promise, the rest of the page is flushed without
 * waiting for it, and this boundary is filled in when Discord answers.
 */
function Resolver({
  promise,
  onResolved,
}: {
  promise: Promise<DiscordChrome>
  onResolved: (chrome: DiscordChrome) => void
}) {
  const chrome = use(promise)

  useEffect(() => {
    onResolved(chrome)
  }, [chrome, onResolved])

  return null
}

/**
 * Load and decode every image the chrome will draw, then report.
 *
 * DECODE, NOT JUST LOAD. `onload` fires when the bytes have arrived; the browser
 * can still spend a frame decoding a large PNG when it is first painted, which
 * is the flicker this whole arrangement exists to prevent. `img.decode()`
 * resolves only when the image is ready to paint with no further work.
 *
 * EVERY FAILURE COUNTS AS DONE. A 404 on a banner, a blocked request, a broken
 * data URI — none of them is a reason to hold a moderation page hostage, and
 * `<img>` will render its own broken state perfectly well. The timeout is the
 * backstop for the one case that has no event at all: a request that never
 * settles.
 */
function whenPainted(urls: string[], signal: AbortSignal): Promise<void> {
  if (urls.length === 0) return Promise.resolve()

  const loaded = urls.map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        const done = () => resolve()
        if (typeof img.decode === 'function') {
          img.src = url
          img.decode().then(done, done)
        } else {
          img.onload = done
          img.onerror = done
          img.src = url
        }
      }),
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, IMAGE_TIMEOUT_MS)
    signal.addEventListener('abort', () => resolve())
  })

  // `Promise.race` does not cancel the loser, so the timer is cleared by hand.
  // Left alone it would sit for five seconds resolving a promise nobody is
  // holding — harmless, and exactly the kind of harmless that keeps a process
  // awake in a test runner.
  return Promise.race([Promise.all(loaded).then(() => undefined), capped]).finally(
    () => clearTimeout(timer),
  )
}

export function DiscordChromeProvider({
  promise,
  children,
}: {
  /**
   * Resolved chrome for this player, or null when they have no Discord id.
   *
   * A PROMISE RATHER THAN A VALUE, from a server component, on purpose. Awaiting
   * it on the server would make every profile page wait up to five seconds
   * before its first byte; passing it lets React stream the answer into a page
   * that is already on screen.
   */
  promise: Promise<DiscordChrome> | null
  children: React.ReactNode
}) {
  const [state, setState] = useState<DiscordChromeState>(
    // The initial value has to be identical on the server and on the client or
    // hydration mismatches: `promise === null` is the same fact on both sides.
    promise ? { status: 'loading' } : { status: 'absent' },
  )

  const [chrome, setChrome] = useState<DiscordChrome | null>(null)

  useEffect(() => {
    if (!chrome) return

    const urls = [chrome.avatarUrl, chrome.bannerUrl].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    )

    const abort = new AbortController()
    let live = true

    whenPainted(urls, abort.signal).then(() => {
      // Guarded rather than assumed: a moderator can navigate away from a
      // profile inside five seconds, and setting state on the way out is how a
      // console fills up with warnings nobody reads any more.
      if (live) setState({ status: 'ready', chrome })
    })

    return () => {
      live = false
      abort.abort()
    }
  }, [chrome])

  return (
    <DiscordChromeStateProvider state={state}>
      {/*
        fallback={null} because this renders nothing in either state. The
        skeletons are not here — they are on the individual elements, which is
        what lets the rest of the page render while this is outstanding.
      */}
      {promise ? (
        <Suspense fallback={null}>
          <Resolver promise={promise} onResolved={setChrome} />
        </Suspense>
      ) : null}
      {children}
    </DiscordChromeStateProvider>
  )
}
