import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

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
 * Applies the theme before first paint.
 *
 * WITHOUT THIS THE PAGE FLASHES. React cannot restore the choice until it
 * hydrates, so a dark-theme user would get a white screen for a beat on every
 * navigation — which is exactly the moment it is most unpleasant, at night.
 * A blocking inline script in <head> is the standard fix and the only one that
 * runs early enough.
 *
 * THE OS PREFERENCE IS THE DEFAULT, and a stored choice beats it — someone who
 * has clicked the toggle has expressed a stronger opinion than their system
 * setting, so the toggle is not silently overridden on the next navigation.
 * This previously carried a literal `&& false` on the media-query branch, which
 * disabled OS detection entirely and hard-defaulted everyone to light.
 */
const themeScript = `
try {
  var t = localStorage.getItem('ringmaster.theme');
  var osDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  if (t === 'dark' || (!t && osDark)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`.trim()

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} min-h-screen`}>
        {/* Base UI names this `delay`, not Radix's `delayDuration`. */}
        <TooltipProvider delay={200}>
          {children}
          <Toaster position="bottom-left" />
        </TooltipProvider>
      </body>
    </html>
  )
}
