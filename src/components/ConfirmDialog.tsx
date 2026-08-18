'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * "Are you sure?", once, for every destructive action that is not a ban.
 *
 * ONE COMPONENT SO THE GESTURE IS THE SAME EVERYWHERE. An admin who has learned
 * that red-on-the-right means "this happens now" should not have to re-learn it
 * per page — and a lift that took one click while a kick took two would teach
 * exactly the wrong lesson about which is reversible.
 *
 * The ban flow has its own dialog because it collects input first; this is the
 * confirm-only case.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  busyLabel,
  confirmDisabled,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  busyLabel: string
  /**
   * Hold the confirm button until the body says it is ready.
   *
   * FOR BODIES THAT COLLECT SOMETHING, which is why it is optional and defaults
   * to off — most confirms have nothing to collect and this prop should not
   * appear at their call sites. The one that does is the incident page's "no
   * action" verdict, where the reason has the same minimum length a ban reason
   * does and the confirm is the last step before something permanent. Keeping
   * that in this dialog rather than forking a fourth one is the whole point of
   * there being one "are you sure" in the console.
   */
  confirmDisabled?: boolean
  /** Resolves when the action is done; the dialog closes itself. */
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Refuse to close mid-flight: the spinner is the only signal that
        // something is happening, and a dialog that vanishes under it leaves
        // the admin unsure whether the action went through.
        if (busy) return
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Outside DialogDescription on purpose: Base UI renders it as a <p>,
            and these bodies contain block elements — a <div> inside a <p> is
            invalid HTML that React silently reparents, wrecking the layout. */}
        <div className="space-y-2 text-sm text-muted-foreground">{body}</div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Go back
          </Button>
          <Button
            variant="destructive"
            disabled={busy || confirmDisabled === true}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
