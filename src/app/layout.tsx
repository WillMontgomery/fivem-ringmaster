import type { Metadata } from 'next'

import './globals.css'

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
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  )
}
