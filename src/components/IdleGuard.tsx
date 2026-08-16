'use client'

import { useIdleTimeout } from '@/hooks/use-idle-timeout'

/**
 * Mounts the idle timeout. Renders nothing.
 *
 * A COMPONENT RATHER THAN A HOOK CALL because `AppShell` is an async server
 * component and cannot hold hooks itself. Same shape as `UpdateWatcher`, which
 * is mounted a few lines away for the same reason.
 *
 * MOUNTED ONLY WHERE THERE IS A SESSION. The preview harness renders the shell
 * with no user, and an idle guard there would POST keepalives that 401 forever
 * against a design page that is not signed in to anything.
 */
export function IdleGuard({ deadline }: { deadline: number | null }) {
  useIdleTimeout(deadline)
  return null
}
