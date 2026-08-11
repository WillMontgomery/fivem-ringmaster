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
 */
export function LoginToast({ error }: { error?: string }) {
  // React 18 dev runs effects twice; a toast that fires twice looks broken.
  const fired = useRef(false)

  useEffect(() => {
    if (!error || fired.current) return
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
  }, [error])

  return null
}
