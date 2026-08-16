'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/**
 * Surfaces a sign-in failure as a toast, once.
 *
 * TWO MESSAGES, NOT A TAXONOMY. `AccessDenied` means Discord authenticated
 * the person and our gate refused them — they lack the admin role — and
 * telling them that plainly is fine: they already know who they are, and an
 * admin who just lost the role learns why the door stopped opening. Every
 * OTHER error code stays generic, because "Configuration" versus "Callback"
 * versus "OAuthAccountNotLinked" is a debugging taxonomy for us, not
 * information for a visitor — and enumerating server internals on an
 * unauthenticated page is a gift to nobody we want reading it.
 *
 * THE IDLE MESSAGE IS A THIRD, and it belongs under the same rule rather than
 * breaking it: it is not an error code leaking outward, it is the console
 * telling somebody who was working thirty seconds ago why they are suddenly
 * looking at a sign-in button. Without it an idle sign-out is indistinguishable
 * from the session having broken.
 */
export function LoginToast({
  error,
  reason,
}: {
  error?: string
  reason?: string
}) {
  // React 18 dev runs effects twice; a toast that fires twice looks broken.
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return

    if (reason === 'idle') {
      fired.current = true
      toast.info('Signed out for inactivity', {
        description:
          'The console had been idle for two hours. Sign in again to pick up where you were.',
        duration: 8000,
      })
      return
    }

    if (!error) return
    fired.current = true

    if (error === 'AccessDenied') {
      toast.error('Access denied', {
        description:
          'Your Discord account does not have the admin role for this console.',
        duration: 8000,
      })
    } else {
      toast.error('Sign-in failed', {
        description: 'Something went wrong on our side. Try again, and if it persists, check the server logs.',
        duration: 8000,
      })
    }
  }, [error, reason])

  return null
}
