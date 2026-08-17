'use client'

import { Clock } from 'lucide-react'
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
import { normalizeTimeZone, type Theme } from '@/lib/prefs'

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
 * ANSWERING IS THE ONLY WAY OUT, and every other exit has been removed: no
 * "Not now", no "More settings", no close X, no backdrop press, no Escape.
 *
 * IT USED TO HAVE ALL FIVE AND THAT IS WHAT MADE IT RECUR. `shouldPrompt` is
 * `rm_tz` unset — a cookie only saving writes — so the only exit that stopped
 * the question being asked again was Save. "Not now" and the X wrote a
 * six-month `rm_prefs_nag` to paper over it, but "More settings" wrote NOTHING
 * and navigated to /settings, which renders this same shell: the dialog
 * remounted on top of the page it had just sent you to, and again on every
 * navigation after. The one button that looked like the way to answer properly
 * was the one that guaranteed the question would keep coming back.
 *
 * That is why there is no nag cookie any more. A dialog with one exit needs no
 * record of the other four, and a cookie nothing writes but something still
 * reads is the shape of bug this codebase produces most.
 *
 * A MANDATORY MODAL IS ONLY ACCEPTABLE BECAUSE THE ANSWER IS PRE-FILLED. The
 * detected zone arrives selected and Save is live on the first frame, so the
 * cost of the question is one click. It stays a question rather than a silent
 * detection for the reason above: timestamps here are read as evidence.
 *
 * Base UI asks for a `Dialog.Close` inside a modal popup so touch screen
 * readers can escape it. Save is that escape — it is reachable by keyboard from
 * the moment the dialog opens and it always closes the dialog.
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

  const save = () => {
    applyTheme(theme)
    if (zone) applyTimeZone(zone)
    setOpen(false)

    // Server components formatted this page's timestamps with the OLD zone.
    // Without the refresh the setting appears to do nothing until the next
    // navigation, on the very screen where it was just changed.
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      // NO `onOpenChange`, and that is the whole mechanism. The dialog is
      // controlled, so a close request from Escape or the backdrop reaches a
      // handler that does not exist and the open state never moves. Save is the
      // only code path that lowers it.
      //
      // `disablePointerDismissal` on top of that, so an outside press does not
      // even start the close it cannot finish.
      disablePointerDismissal
    >
      {/* Wider than the `sm:max-w-sm` default: this holds a searchable list of
          four hundred timezones, not a confirm prompt.

          `showCloseButton={false}`: the X is the shell's default and it was one
          of the exits that let this recur. */}
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
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

        {/* Last child: DialogFooter's negative margins assume that position.

            One button. `disabled` is unreachable in practice — `zone` is seeded
            from the browser's own detection in the mount effect — and is kept
            for the case where `Intl` reports something the normaliser rejects,
            where the picker below is still a working way to answer. */}
        <DialogFooter>
          <Button onClick={save} disabled={!zone}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
