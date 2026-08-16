'use client'

import { Clock } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ThemeChoice, applyTheme, applyTimeZone } from '@/components/PrefsControls'
import { TimezonePicker } from '@/components/TimezonePicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { IDLE_POLICY_LABEL } from '@/lib/idle'
import {
  NAG_MAX_AGE_SECONDS,
  PREFS_NAG_COOKIE,
  normalizeTimeZone,
  writePrefCookie,
  type Theme,
} from '@/lib/prefs'

/**
 * Asked once: how do you want this console to look, and where are you.
 *
 * THE CONSOLE MUST NOT GUESS THE ANSWER. It could — the browser will report a
 * timezone — and detecting it silently would satisfy every line of code in this
 * feature while defeating its point. Timestamps on a moderation record are read
 * as evidence, and "the machine assumed" is not the same claim as "the reader
 * stated". So the detected zone is offered, pre-selected, one click from
 * accepted, and never written without that click.
 *
 * UNTIL SOMEBODY ANSWERS, TIMES ARE UTC WITH A `UTC` SUFFIX — not the browser's
 * zone. Falling back to the browser would make this feature literally
 * indistinguishable from the behaviour it replaces for anyone who never
 * answers, and would remove every reason to answer.
 *
 * SHOWN ONCE, THEN NEVER AGAIN UNASKED. Dismissal is persisted for six months
 * in `rm_prefs_nag`; without that it would re-fire on every navigation, since
 * the shell that mounts it renders on all thirteen routes. The settings page is
 * the destination for anyone who dismissed it and changed their mind, which is
 * also why this is allowed to be a dialog at all — a modal with nowhere to send
 * the person who closes it is a dead end.
 *
 * OPENED IN AN EFFECT, NEVER DURING RENDER. Whether to prompt is decided on the
 * server from cookies; opening during render would put a focus trap into the
 * server markup and hand it to React to reconcile.
 */
export function PrefsDialog({ initialTheme }: { initialTheme: Theme }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [zone, setZone] = useState<string | null>(null)
  const [detected, setDetected] = useState<string | null>(null)

  useEffect(() => {
    /**
     * The browser's guess, canonicalised through the same normaliser the cookie
     * uses. Read here rather than during render for the reason `PrefsProvider`
     * documents: `Intl` in the browser and `Intl` in Node are two different
     * answers to the same call, and a render that depends on which one ran is a
     * hydration mismatch.
     */
    const guess = normalizeTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    setDetected(guess)
    setZone(guess)
    setOpen(true)
  }, [])

  /** Stop asking. Not an answer — times stay UTC, which is the honest result. */
  const dismiss = () => {
    writePrefCookie(PREFS_NAG_COOKIE, 'off', NAG_MAX_AGE_SECONDS)
    setOpen(false)
  }

  const save = () => {
    applyTheme(theme)
    if (zone) applyTimeZone(zone)
    writePrefCookie(PREFS_NAG_COOKIE, 'off', NAG_MAX_AGE_SECONDS)
    setOpen(false)

    // Server components formatted this page's timestamps with the OLD zone.
    // Without the refresh the setting appears to do nothing until the next
    // navigation, on the very screen where it was just changed.
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Escape and the backdrop both land here. Closing without answering is
        // a dismissal, so it persists — otherwise the dialog returns on the
        // next click and becomes something to fight rather than to read.
        if (!v) dismiss()
      }}
    >
      {/* Wider than the `sm:max-w-sm` default: this holds a searchable list of
          four hundred timezones, not a confirm prompt. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up your console</DialogTitle>
          <DialogDescription>
            Two questions, once. You can change both later in Settings.
          </DialogDescription>
        </DialogHeader>

        {/* Outside DialogDescription deliberately: Base UI renders that as a
            <p>, and a <div> inside a <p> is invalid HTML that React silently
            reparents — the breakage ConfirmDialog already documents. */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prefs-theme">Appearance</Label>
            <ThemeChoice
              id="prefs-theme"
              value={theme}
              onChange={(t) => {
                setTheme(t)
                // Applied live rather than on save. Picking a theme you cannot
                // see until you confirm is a guess, not a choice.
                applyTheme(t)
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Your timezone</Label>
            <p className="text-xs text-muted-foreground">
              Every timestamp in the console is shown in this zone and labelled
              with it. Until you choose, times are shown in UTC.
            </p>
            <TimezonePicker
              value={zone}
              detected={detected}
              onChange={setZone}
            />
          </div>

          {/*
            STATED, NOT OFFERED. The idle window is a server-wide constant on
            purpose — see lib/idle.ts. A security control whose own subject can
            set it to thirty days is not a control, and the people using this
            console hold the scopes that restart the game server. It appears
            here because this is where a reader looks for it.
          */}
          <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            {IDLE_POLICY_LABEL} Anything you were typing is lost, so save work
            before stepping away.
          </p>
        </div>

        {/* Last child: DialogFooter's negative margins assume that position. */}
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          {/* `nativeButton={false}` because the render prop supplies an <a>,
              not a <button>. Base UI logs an accessibility error otherwise —
              it assumes native button semantics unless told the element is
              something else. */}
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/settings" />}
          >
            More settings
          </Button>
          <Button onClick={save} disabled={!zone}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
