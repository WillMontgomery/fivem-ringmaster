import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies } from 'next/headers'

import { PrefsProvider } from '@/components/PrefsProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  LEGACY_THEME_KEY,
  PREF_MAX_AGE_SECONDS,
  THEME_COOKIE,
  readPrefs,
} from '@/lib/prefs'

import './globals.css'

/**
 * Geist, self-hosted by next/font — no runtime request to Google, which is
 * both faster and one fewer third party seeing who visits an admin console.
 * Mono is load-bearing rather than decorative: licenses, boot epochs and
 * server ids are all read character by character, usually to compare two.
 */
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'Ringmaster',
  description: 'Admin console for Blitz Royale',
  robots: { index: false, follow: false },
}

/**
 * The theme, and the script that is no longer needed for most people.
 *
 * WITHOUT SOMETHING HERE THE PAGE FLASHES. React cannot restore a choice until
 * it hydrates, so a dark-theme reader would get a white screen for a beat on
 * every navigation — which is exactly the moment it is most unpleasant, at
 * night. That used to require a blocking inline script, because the choice was
 * in localStorage and the server could not see it.
 *
 * IT IS A COOKIE NOW, so for anyone who has chosen light or dark the server
 * emits `<html class="dark">` in the first byte and there is nothing to correct
 * — no script, no pre-hydration DOM mutation, and the markup React renders on
 * the client is identical to what arrived.
 *
 * THE SCRIPT SURVIVES FOR EXACTLY ONE CASE: following the OS. The server cannot
 * read `prefers-color-scheme` — it is not in the request — so `system`, which
 * is also what "never chose" resolves to, still needs a line of JavaScript
 * before first paint. `suppressHydrationWarning` on <html> stays for the same
 * reason.
 *
 * IT ALSO MIGRATES THE OLD localStorage KEY, once, and that half is not
 * optional. Without it every admin who had ever clicked the toggle silently
 * loses their theme on the deploy that ships this.
 *
 * ALL THREE THEME WRITERS CHANGED TOGETHER — here, `ThemeToggle`, and the
 * settings page. A partial migration has a specific and confusing symptom: the
 * server reads the cookie and emits no class, a stale script re-adds one from
 * localStorage, the toggle reads the class off the DOM and shows the wrong
 * icon, and the first click writes the value that was already stored. "The
 * theme does nothing until you click it twice", on every hard navigation.
 */
function themeScript(themeCookieIsSet: boolean): string {
  return `
try {
  var stored = null;
  try { stored = localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)}); } catch (e) {}
  var migrated = false;
  if (!${themeCookieIsSet} && (stored === 'dark' || stored === 'light')) {
    document.cookie = ${JSON.stringify(THEME_COOKIE)} + '=' + stored + '; path=/; max-age=${PREF_MAX_AGE_SECONDS}; samesite=lax' + (location.protocol === 'https:' ? '; secure' : '');
    migrated = true;
    if (stored === 'dark') document.documentElement.classList.add('dark');
  }
  if (!migrated && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`.trim()
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  /**
   * READING COOKIES HERE MAKES EVERY ROUTE DYNAMIC, knowingly. Of the fourteen
   * pages, seven already declare `force-dynamic` and three more are dynamic by
   * way of `currentAdmin()`. The four that change all render the app shell and
   * therefore need the theme anyway, and there is nowhere else to read it: the
   * root layout is the only place `<html>` is emitted, and middleware does not
   * run for two of those four.
   */
  const prefs = readPrefs(await cookies())

  return (
    <html
      lang="en"
      /**
       * The class the server already knows the answer to. `globals.css` defines
       * `dark` as a class variant and `ui/sonner.tsx` watches this attribute to
       * keep toasts on the right theme, so this is the mechanism the rest of
       * the app is already built around — a data attribute would mean editing
       * all three and would silently stop sonner's observer from firing.
       */
      className={prefs.theme === 'dark' ? 'dark' : undefined}
      suppressHydrationWarning
    >
      <head>
        {prefs.theme === 'system' && (
          <script
            dangerouslySetInnerHTML={{ __html: themeScript(prefs.themeIsSet) }}
          />
        )}
      </head>
      <body className={`${sans.variable} ${mono.variable} min-h-screen`}>
        <PrefsProvider value={prefs}>
          {/* Base UI names this `delay`, not Radix's `delayDuration`. */}
          <TooltipProvider delay={200}>
            {children}
            <Toaster position="bottom-left" />
          </TooltipProvider>
        </PrefsProvider>
      </body>
    </html>
  )
}
