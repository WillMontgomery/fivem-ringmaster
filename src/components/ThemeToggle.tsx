'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { applyTheme } from '@/components/PrefsControls'
import { usePrefs } from '@/components/PrefsProvider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Light / dark, one click, in the header.
 *
 * THE CHOICE PERSISTS PER BROWSER, not per account — it is a property of where
 * you are reading, not of who you are. The same admin wants light on a phone in
 * daylight and dark at 2am. It lives in a cookie rather than localStorage so
 * the SERVER can read it: that is what lets the layout emit the right class in
 * the first byte instead of letting the page paint white and then correct
 * itself. (This comment used to say a server-side preference "would fight
 * that". A cookie is still per browser, so it does not.)
 *
 * The class goes on <html> rather than <body> so the toggle also reaches
 * portalled content — tooltips, dialogs and sheets render outside the body
 * tree, and a light dialog over a dark page is the exact bug this avoids.
 *
 * TWO STATES HERE, THREE ON THE SETTINGS PAGE. This is the fast path; a header
 * control that cycles through three values makes you click twice to get back to
 * where you were. `system` is chosen deliberately, in the place where you go to
 * choose deliberately.
 */
export function ThemeToggle() {
  const prefs = usePrefs()

  /**
   * NO POST-MOUNT DOM READ FOR AN EXPLICIT CHOICE. The server knows the answer
   * and passed it down, so the icon is right in the first frame. It used to
   * read `classList.contains('dark')` after mount, which left a beat where a
   * dark page showed the Sun.
   *
   * `system` is the one case that still needs the DOM, because resolving it
   * means asking `prefers-color-scheme`, which the server cannot see. The
   * inline script in the layout has already applied the class by the time this
   * runs, so the icon settles rather than flashing the wrong page colour.
   */
  const [dark, setDark] = useState(prefs.theme === 'dark')

  useEffect(() => {
    if (prefs.theme !== 'system') return
    setDark(document.documentElement.classList.contains('dark'))
  }, [prefs.theme])

  const toggle = () => {
    const next = !dark
    setDark(next)
    applyTheme(next ? 'dark' : 'light')
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
