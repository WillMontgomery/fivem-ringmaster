import type { NavBadges } from '@/components/AppShell'

/**
 * Placeholder chrome for the pages that are not wired to anything yet.
 *
 * ONE PLACE, so there is exactly one thing to delete when each page becomes
 * real — rather than eight copies of a fake admin scattered through the app,
 * one of which survives into production and shows a signed-out visitor a user
 * named Will with four scopes.
 */

export const DEMO_USER = {
  name: 'Will',
  avatarUrl: null,
}

/**
 * Badge state for the harness.
 *
 * Non-zero on purpose: a badge system reviewed at zero is a badge system
 * nobody has actually looked at, and "does 3 unread read as urgent or as
 * noise" is the only question worth asking about it.
 */
export const DEMO_BADGES: NavBadges = {
  incidents: 3,
  maintenance: 'scheduled',
}
