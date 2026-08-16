'use client'

import { Check, Globe } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { normalizeTimeZone } from '@/lib/prefs'
import { DISPLAY_LOCALE, FALLBACK_TIME_ZONE } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * Choosing a timezone out of four hundred of them.
 *
 * TYPE-TO-FILTER IS THE REQUIREMENT, which is what rules out the `Select` this
 * console uses everywhere else: its list is a plain scrolling box with no
 * search and no virtualisation, its popup is pinned to the trigger's width so
 * `America/Argentina/Buenos_Aires` clips, and nobody scrolls to Kathmandu. cmdk
 * is the only searchable list already installed — `PlayerSearch` uses it — and
 * it is worth the one inconsistency of being the sole Radix-backed component
 * in a Base UI tree.
 *
 * RENDERED INLINE, NOT AS A `CommandDialog`. This control appears inside the
 * first-run dialog, and a dialog inside a dialog is two focus traps arguing.
 * The same inline list serves the settings page.
 */

/**
 * The zone list, built in the browser.
 *
 * BUILT IN AN EFFECT RATHER THAN DURING RENDER, because `Intl` is the one API
 * whose answer can legitimately differ between the Node build of ICU and the
 * browser's. A list computed during render is a list React has to compare
 * across that boundary, and a mismatch here throws away the whole page's server
 * markup. The dialog only opens after mount, so nobody sees this fill in.
 */
function useZones(): string[] {
  const [zones, setZones] = useState<string[]>([])

  useEffect(() => {
    const raw =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : []

    /**
     * `UTC` IS APPENDED BY HAND, and leaving it out is the mistake anyone
     * building this list makes once. `supportedValuesOf('timeZone')` returns
     * 418 entries and `UTC` is not among them — verified — even though `Intl`
     * accepts it, this console falls back to it, and it is the correct answer
     * for anybody working off a server clock. Without this line the fallback
     * zone is the one zone that cannot be chosen.
     */
    const all = new Set<string>([FALLBACK_TIME_ZONE])
    for (const z of raw) {
      // Through the same normaliser the cookie goes through, so a stored value
      // always matches an entry in this list. Storing one spelling and listing
      // another is how a control ends up showing its placeholder while a real
      // value is set.
      const canonical = normalizeTimeZone(z)
      if (canonical) all.add(canonical)
    }

    setZones([...all].sort())
  }, [])

  return zones
}

/** The current offset, so a row reads as a place *and* a time. */
function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'shortOffset',
    }).formatToParts(Date.now())

    const time = parts
      .filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal')
      .map((p) => p.value)
      .join('')
      .trim()
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    return `${time} ${name}`.trim()
  } catch {
    return ''
  }
}

export function TimezonePicker({
  value,
  onChange,
  detected,
  className,
}: {
  /** The zone currently stored, canonical, or null when none is set. */
  value: string | null
  onChange: (zone: string) => void
  /** The browser's own guess, offered first. Null before mount. */
  detected?: string | null
  className?: string
}) {
  const zones = useZones()

  /**
   * The browser's guess is pulled to the top rather than left to be found by
   * scrolling — for nearly everybody it is the answer, and the whole reason
   * this dialog exists is to have them confirm it rather than have the console
   * assume it.
   */
  const suggestion = useMemo(
    () => (detected && zones.includes(detected) ? detected : null),
    [detected, zones],
  )

  return (
    <Command className={cn('rounded-lg border border-border bg-card', className)}>
      <CommandInput placeholder="Search for a city or region…" />
      <CommandList className="max-h-56">
        <CommandEmpty>No timezone matches that.</CommandEmpty>

        {suggestion && (
          <CommandGroup heading="Detected">
            <ZoneRow
              zone={suggestion}
              selected={value === suggestion}
              onSelect={onChange}
            />
          </CommandGroup>
        )}

        <CommandGroup heading="All timezones">
          {zones.map((zone) => (
            <ZoneRow
              key={zone}
              zone={zone}
              selected={value === zone}
              onSelect={onChange}
            />
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function ZoneRow({
  zone,
  selected,
  onSelect,
}: {
  zone: string
  selected: boolean
  onSelect: (zone: string) => void
}) {
  return (
    <CommandItem value={zone} onSelect={() => onSelect(zone)}>
      {selected ? (
        <Check className="size-4 text-primary" />
      ) : (
        <Globe className="size-4 text-muted-foreground/50" />
      )}
      <span className="flex-1 truncate">{zone.replace(/_/g, ' ')}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {offsetLabel(zone)}
      </span>
    </CommandItem>
  )
}
