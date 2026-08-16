'use client'

import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  PREF_MAX_AGE_SECONDS,
  THEME_COOKIE,
  TZ_COOKIE,
  normalizeTimeZone,
  writePrefCookie,
  type Theme,
} from '@/lib/prefs'

/**
 * The controls the first-run dialog and the settings page both use.
 *
 * SHARED SO THE TWO CANNOT DRIFT. A theme picker on the settings page that
 * writes the cookie one way and a theme picker in the dialog that writes it
 * another is how half the readers end up on a stale value — and the failure is
 * invisible until somebody notices the setting "does nothing until you toggle
 * it twice".
 */

export const THEME_LABEL: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match my system',
}

export const THEME_ICON: Record<Theme, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

/**
 * Store the theme and apply it to the live page.
 *
 * THE CLASS IS SET HERE AS WELL AS ON THE NEXT RENDER because a preference that
 * only takes effect after a navigation reads as broken. `globals.css` defines
 * `dark` as a class variant and `ui/sonner.tsx` watches `<html>`'s class list
 * with a MutationObserver to keep toasts on the right theme, so this is the one
 * mutation both of those already understand.
 *
 * `system` resolves against `prefers-color-scheme` here, which is the only
 * place it can be resolved — the value is not in the request, which is why one
 * small inline script survives in the layout for the first paint.
 */
export function applyTheme(theme: Theme): void {
  writePrefCookie(THEME_COOKIE, theme, PREF_MAX_AGE_SECONDS)

  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  document.documentElement.classList.toggle('dark', dark)
}

/**
 * Store the timezone.
 *
 * CANONICALISED ON THE WAY IN, not on the way out. `Intl` accepts `Europe/Kyiv`
 * and reports `Europe/Kiev`; storing the former means the picker's own list —
 * built from `Intl`'s spellings — never matches it, and the control renders
 * empty while a zone is genuinely set. `writePrefCookie` refuses anything that
 * is not a canonical zone name, which is also what keeps a `;` out of a
 * `document.cookie` assignment.
 */
export function applyTimeZone(zone: string): string | null {
  const canonical = normalizeTimeZone(zone)
  if (!canonical) return null

  writePrefCookie(TZ_COOKIE, canonical, PREF_MAX_AGE_SECONDS)
  return canonical
}

/**
 * Light / dark / system.
 *
 * A DROPDOWN RADIO GROUP because it is the only radio-style control installed —
 * this tree has no `radio-group.tsx` and no `switch.tsx`, and pulling them in
 * from the shadcn registry risks generating Radix variants that use `asChild`,
 * which does not exist in Base UI (it takes `render`) and appears nowhere in
 * this codebase.
 */
export function ThemeChoice({
  value,
  onChange,
  id,
}: {
  value: Theme
  onChange: (theme: Theme) => void
  id?: string
}) {
  const Icon = THEME_ICON[value]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button id={id} variant="outline" className="w-full justify-start gap-2" />
        }
      >
        <Icon className="size-4" />
        {THEME_LABEL[value]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as Theme)}
        >
          {(Object.keys(THEME_LABEL) as Theme[]).map((t) => {
            const RowIcon = THEME_ICON[t]
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <RowIcon className="size-4" />
                {THEME_LABEL[t]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
