'use client'

import { Clock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ThemeChoice, applyTheme, applyTimeZone } from '@/components/PrefsControls'
import { TimezonePicker } from '@/components/TimezonePicker'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { IDLE_POLICY_LABEL } from '@/lib/idle'
import { normalizeTimeZone, type Prefs, type Theme } from '@/lib/prefs'
import { formatInstant } from '@/lib/time'

/**
 * The settings page's body.
 *
 * SAVES ON CHANGE, with no Save button. Every control here is a single value
 * that takes effect immediately and visibly — a theme you can see and a
 * timezone the sample line below re-renders in. A form that collects three
 * immediate effects behind a button invites the "did that save?" question the
 * immediacy already answers.
 */
export function SettingsForm({ initial }: { initial: Prefs }) {
  const router = useRouter()
  const [theme, setTheme] = useState<Theme>(initial.theme)
  const [zone, setZone] = useState<string>(initial.timeZone)
  const [detected, setDetected] = useState<string | null>(null)

  /**
   * Read after mount, never during render — the browser's `Intl` and Node's are
   * two answers to the same call, and a render that depends on which one ran is
   * a hydration mismatch. Same rule `PrefsProvider` documents.
   */
  useEffect(() => {
    setDetected(normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone))
  }, [])

  const chooseZone = (next: string) => {
    const canonical = applyTimeZone(next)
    if (!canonical) {
      toast.error('That is not a timezone this console can use.')
      return
    }
    setZone(canonical)
    toast.success(`Times are now shown in ${canonical.replace(/_/g, ' ')}.`)

    // Server components on this and every other page formatted with the old
    // zone. Without the refresh the change is invisible until a navigation.
    router.refresh()
  }

  /**
   * A live example, formatted through the same function the audit log uses, so
   * what this line shows is exactly what the rest of the console will show. The
   * instant is fixed rather than `Date.now()` — a clock ticking in a settings
   * row draws the eye away from the control it is explaining, and calling
   * `Date.now()` during render is the nondeterminism this whole feature removes.
   */
  const sample = formatInstant(1755310440000, { timeZone: zone, locale: initial.locale })

  return (
    <div className="space-y-4">
      <Card className="surface-edge gap-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="settings-theme">Appearance</Label>
          <p className="text-xs text-muted-foreground">
            Remembered per browser rather than per account — the same person
            wants dark at 2am and light on a phone in daylight.
          </p>
          <div className="max-w-xs">
            <ThemeChoice
              id="settings-theme"
              value={theme}
              onChange={(t) => {
                setTheme(t)
                applyTheme(t)
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="surface-edge gap-4 p-5">
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <p className="text-xs text-muted-foreground">
            {initial.timeZoneIsSet
              ? 'Every timestamp in the console is shown in this zone and labelled with it.'
              : 'Nothing is set, so times are shown in UTC. Pick a zone and every timestamp follows it.'}
          </p>
          <p className="text-xs text-muted-foreground">
            An audit row from{' '}
            <span className="font-mono tabular-nums text-foreground">{sample}</span>{' '}
            is how times will read.
          </p>
          <TimezonePicker
            value={zone}
            detected={detected}
            onChange={chooseZone}
            className="max-w-md"
          />
        </div>
      </Card>

      <Card className="surface-edge gap-2 p-5">
        <Label className="gap-2">
          <Clock className="size-4" />
          Inactivity
        </Label>
        {/*
          READ-ONLY, DELIBERATELY. Not an oversight and not a missing control:
          the window is a server-wide constant because the people reading this
          page can ban players and restart the game server, and
          a timeout its own subject can extend to thirty days protects nobody.
          Stated here because this is where somebody looks for it. See
          lib/idle.ts.
        */}
        <p className="text-sm text-muted-foreground">
          {IDLE_POLICY_LABEL} You get a warning a few minutes beforehand with a
          button to stay signed in. Moving the mouse or typing counts as being
          here; the console&rsquo;s own background polling does not.
        </p>
        <p className="text-xs text-muted-foreground/70">
          This is set for everyone and cannot be changed per person — a sign-out
          you could switch off would not be worth having.
        </p>
      </Card>
    </div>
  )
}
