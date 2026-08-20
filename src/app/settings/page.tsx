import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { PageLoading } from '@/components/PageLoading'
import { SettingsForm } from '@/components/SettingsForm'
import { readPrefs } from '@/lib/prefs'
import { currentAdmin } from '@/lib/session'

/**
 * How this console looks and what time it thinks it is.
 *
 * THE PAGE THE FIRST-RUN DIALOG POINTS AT. A prompt with nowhere to send the
 * person who closes it is a dead end — they get one chance at a decision and no
 * way back to it. This is the way back, and it is also where the idle policy is
 * written down rather than only appearing five minutes before it fires.
 *
 * Everything here is stored in cookies, so it is per browser rather than per
 * account. That is the right granularity: the theme belongs to the screen and
 * the timezone belongs to the room, neither to the person.
 */
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  return (
    <AppShell
      active="/settings"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
    >
      <Suspense fallback={<PageLoading />}>
        <Body />
      </Suspense>
    </AppShell>
  )
}

/**
 * ONE OF THE FOUR PAGES THE BAR WILL NOT ACTUALLY APPEAR ON, and that is the
 * correct outcome rather than a gap. This reads a cookie off the request; there
 * is no round trip to wait through, so the body resolves in the same tick and
 * the fallback is never committed. The boundary is here so the answer to "does
 * this page show a loading state while its data loads" is yes on every page,
 * and so it starts working by itself if this ever grows a real read.
 */
async function Body() {
  const prefs = readPrefs(await cookies())

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Stored in this browser, not on your account — so a shared machine does
          not carry your choices to the next person.
        </p>
      </div>

      <SettingsForm initial={prefs} />
    </div>
  )
}
