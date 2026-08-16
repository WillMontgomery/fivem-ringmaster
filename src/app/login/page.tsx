import { Space_Grotesk } from 'next/font/google'
import { redirect } from 'next/navigation'

import { signIn } from '@/auth'
import { LoginToast } from '@/components/LoginToast'
import { currentAdmin } from '@/lib/session'

/**
 * The sign-in page.
 *
 * `auth.ts` has pointed `pages.signIn` here since M0 and the route did not
 * exist, so every unauthenticated redirect landed on a 404 — the one page a
 * person is guaranteed to see before they can do anything.
 *
 * Deliberately spare. There is exactly one way in, no username field, no
 * "forgot password", nothing to enumerate. Everything that decides whether you
 * get in happens server-side after Discord answers: guild membership first as a
 * coarse filter, then the per-action grant checks in lib/grants.ts.
 */

/** A display face for the wordmark only — the console body stays on Geist. */
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'] })

/** Discord's brand mark — lucide has no brand icons, so it's inlined. */
function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  )
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string
    callbackUrl?: string
    /** `idle` when the session ended for inactivity rather than by choice. */
    reason?: string
  }>
}) {
  /**
   * THE SAME DEFINITION OF "SIGNED IN" AS EVERY OTHER PAGE, and that is the
   * structural half of the redirect loop this page was one end of.
   *
   * This read `auth()` directly while all thirteen other routes read
   * `currentAdmin()`, which is `auth()` PLUS a scope lookup and a non-idle
   * check. The moment those two disagreed, `/` bounced here because
   * currentAdmin was null and this bounced back because the session was valid
   * — a loop with no exit, which is what the browser reports as "the page
   * isn't redirecting properly".
   *
   * Any future condition added to currentAdmin() is now automatically
   * reflected here, so the two cannot drift apart again. Whatever else breaks,
   * the login page must remain reachable: it is the only way back in.
   */
  if (await currentAdmin()) redirect('/')

  const { error, callbackUrl, reason } = await searchParams

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      {/* Aurora: slow-drifting colour fields behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="aurora-a absolute -left-40 -top-40 size-[40rem] rounded-full bg-[oklch(0.55_0.24_295_/_45%)] blur-3xl" />
        <div className="aurora-b absolute -right-48 top-0 size-[36rem] rounded-full bg-[oklch(0.60_0.19_235_/_40%)] blur-3xl" />
        <div className="aurora-c absolute -bottom-48 left-1/4 size-[38rem] rounded-full bg-[oklch(0.64_0.18_165_/_34%)] blur-3xl" />
      </div>

      <div className="w-full max-w-sm">
        <div className="surface-edge rounded-2xl border border-border bg-card/70 p-8 shadow-xl backdrop-blur-xl">
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-inset ring-primary/25">
              {/* The storm circle, where the name comes from. */}
              <div className="size-5 rounded-full border-2 border-primary" />
            </div>
            <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>
              Ringmaster
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Admin console for Blitz Royale
            </p>
          </div>

          {/* The toast carries the message now; the inline fallback stays for
              anyone who dismissed it or arrived with the param in a shared link. */}
          <LoginToast error={error} reason={reason} />
          {reason === 'idle' && !error ? (
            /* The inline copy of the toast, for anyone who dismissed it or
               landed here from a shared link. Informational rather than a
               warning: nothing went wrong, the timeout did its job. */
            <p
              role="status"
              className="mb-5 rounded-md border border-info/30 bg-info/5 px-4 py-3 text-sm text-info"
            >
              You were signed out after two hours of inactivity.
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn"
            >
              {error === 'AccessDenied'
                ? 'Your Discord account does not have the admin role for this console.'
                : 'That account cannot sign in right now. If you believe it should, ask an existing admin to check your access.'}
            </p>
          ) : null}

          <form
            action={async () => {
              'use server'
              // callbackUrl is passed straight to Auth.js, which validates it
              // against the configured origin. Never interpolate it into markup
              // or a redirect by hand — an open redirect on a login page is how
              // a convincing phishing link gets built out of a real domain.
              await signIn('discord', { redirectTo: callbackUrl ?? '/' })
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#4752c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <DiscordMark className="size-5" />
              Continue with Discord
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
