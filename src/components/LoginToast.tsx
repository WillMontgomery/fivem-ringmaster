'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { REVOKED_DESCRIPTION, REVOKED_REASON } from '@/lib/revocation'

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
 *
 * THE REVOKED-ROLE MESSAGE IS A FOURTH, AND IT IS AN ERROR, NOT INFORMATION.
 * The idle one is reassuring — nothing went wrong, the timeout did its job. This
 * one is the opposite: somebody was halfway through issuing a ban, the ban did
 * not happen, and their access is gone. Showing that as a calm blue "session
 * ended" would be a lie of tone. It also has to say WHAT was removed and WHERE,
 * because the fix is in Discord and not in this console — an admin who reads
 * "signed out" will simply try to sign in again, and `auth.ts` will refuse them
 * on the same role with a less specific message.
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

    if (reason === REVOKED_REASON) {
      fired.current = true
      // Longer than the others on purpose: this one is asking the reader to go
      // do something in a different application, and eight seconds is not
      // enough to read a sentence and decide who to ask.
      toast.error('Your Discord admin role was removed', {
        description: REVOKED_DESCRIPTION,
        duration: 15000,
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
