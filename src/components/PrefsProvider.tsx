'use client'

import { createContext, useContext } from 'react'

import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs'
import { formatInstant, type FormatInstantOptions } from '@/lib/time'

/**
 * The reader's display preferences, resolved once on the server.
 *
 * MOUNTED IN THE ROOT LAYOUT, not passed as a prop, and the difference is
 * thirteen files. `AppShell` is rendered per-page across every route, so
 * threading prefs into it means editing every page and remembering to on the
 * next one. The layout reads the cookies once and everything below can ask.
 *
 * CLIENT COMPONENTS MUST READ THE ZONE FROM HERE AND NEVER FROM `Intl`.
 * Calling `Intl.DateTimeFormat().resolvedOptions().timeZone` during a render is
 * the same class of nondeterminism as calling `Date.now()` during a render —
 * the server and the browser produce different markup and React has to throw
 * one of them away. `LiveBoard` already carries that lesson in a comment; this
 * is the same rule for zones.
 */

const PrefsContext = createContext<Prefs>(DEFAULT_PREFS)

export function PrefsProvider({
  value,
  children,
}: {
  value: Prefs
  children: React.ReactNode
}) {
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): Prefs {
  return useContext(PrefsContext)
}

/**
 * `formatInstant`, already carrying the reader's zone.
 *
 * The helper exists so that call sites read as `fmt(ts)` rather than
 * `formatInstant(ts, prefs)` — a two-argument version invites someone to pass
 * prefs they built locally, which is how the ambient-zone bug gets reintroduced
 * one component at a time.
 *
 * IT USED TO HAND BACK AN `iso` TOO, and that member existed for exactly one
 * purpose: filling `title=` attributes. With the native `title` attribute banned
 * on DOM elements (`docs/hover-text.md`) it had zero callers, and a zone-free
 * `iso` sitting on the zone-aware hook is an invitation to put a fact back
 * somewhere only a mouse can reach it. `utcIso` is still exported from
 * `lib/time.ts` for the visible UTC that `LocalTime` renders.
 */
export function useFormatInstant(): {
  format: (ms: number | null | undefined, opts?: FormatInstantOptions) => string
  timeZone: string
} {
  const prefs = usePrefs()
  return {
    format: (ms, opts) => formatInstant(ms, prefs, opts),
    timeZone: prefs.timeZone,
  }
}
