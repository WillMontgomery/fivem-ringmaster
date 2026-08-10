import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { TooltipProvider } from '@/components/ui/tooltip'

import './globals.css'

/**
 * Geist, self-hosted by next/font — no runtime request to Google, which is
 * both faster and one fewer third party seeing who visits an admin console.
 * Mono is load-bearing rather than decorative: licenses, boot epochs and
 * server ids are all read character by character, usually to compare two of
 * them.
 */
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'Ringmaster',
  description: 'Admin console for FiveM Royale',
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // `dark` is hardcoded rather than toggled. There is one theme here on
    // purpose — see the note in globals.css.
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} min-h-screen`}>
        {/* Base UI names this `delay`, not Radix's `delayDuration`. */}
        <TooltipProvider delay={200}>{children}</TooltipProvider>
      </body>
    </html>
  )
}
