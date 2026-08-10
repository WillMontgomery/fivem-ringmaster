'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Light / dark, remembered.
 *
 * LIGHT IS THE DEFAULT, and the choice persists per browser rather than per
 * account — it is a property of where you are reading, not of who you are. The
 * same admin wants light on a phone in daylight and dark at 2am, and a
 * server-side preference would fight that.
 *
 * The class goes on <html> rather than <body> so the toggle also reaches
 * portalled content — tooltips, dialogs and sheets render outside the body
 * tree, and a light dialog over a dark page is the exact bug this avoids.
 */

const KEY = 'ringmaster.theme'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  // Read the stored choice after mount. Doing it during render would produce
  // different markup on the server than the client; the inline script in the
  // layout is what stops the page flashing in the meantime.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light')
    } catch {
      // Private browsing, or storage disabled. The toggle still works for this
      // page; it simply will not be remembered. Not worth an error for.
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          />
        }
      >
        {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {dark ? 'Light theme' : 'Dark theme'}
      </TooltipContent>
    </Tooltip>
  )
}
