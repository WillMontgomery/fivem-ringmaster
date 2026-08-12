import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'
import { LoginToast } from '@/components/LoginToast'

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
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}) {
  const session = await auth()
  if (session?.user) redirect('/')

  const { error, callbackUrl } = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Ringmaster</h1>
      <p className="mt-2 text-sm text-slate-400">
        Admin console for Blitz Royale.
      </p>

      {/* The toast carries the message now; the inline fallback stays for
          anyone who dismissed it or arrived with the param in a shared link. */}
      <LoginToast error={error} />
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn"
        >
          {error === 'AccessDenied'
            ? 'Your Discord account does not have the admin role for this console.'
            : 'That account cannot sign in right now. If you believe it should, ask an existing admin to check your access.'}
        </p>
      ) : null}

      <form
        className="mt-6"
        action={async () => {
          'use server'
          // callbackUrl is passed straight to Auth.js, which validates it
          // against the configured origin. Never interpolate it into markup or
          // a redirect by hand — an open redirect on a login page is how a
          // convincing phishing link gets built out of a real domain.
          await signIn('discord', { redirectTo: callbackUrl ?? '/' })
        }}
      >
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Continue with Discord
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-500">
        You must be a member of the project&rsquo;s Discord, and an admin must
        have granted your license a scope. Both are checked server-side.
      </p>
    </main>
  )
}
