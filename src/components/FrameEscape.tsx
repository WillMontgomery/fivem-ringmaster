'use client'

import { useEffect } from 'react'

/**
 * Escape inside the pause-menu frame takes the whole overlay down.
 *
 * WHY THIS HAS TO LIVE HERE AND NOT IN THE GAME. `screens/Admin.tsx` already
 * binds Escape, and its own comment is honest about the limit: *"IT ONLY WORKS
 * WHILE OUR DOCUMENT HAS THE KEY ... once the admin clicks inside the frame,
 * the console's document has focus and its keystrokes never reach this
 * listener. Nothing can change that from this side."*
 *
 * That is correct -- a cross-origin frame does not forward key events, and no
 * amount of listening from the parent will produce one. But *this* is the other
 * side, and we own it. The key event is ours; we just have to say so.
 *
 * The owner's ask, 2026-08-20: *"when in the iframe, if the player presses ESC,
 * the entire menu should be dismissed please. One button - overlay gone."* So
 * this dismisses everything rather than stepping back to the pause menu. The
 * Back button, which steps back one screen, is unchanged -- two exits that do
 * two different things, rather than one exit somebody has to press twice.
 *
 * ------------------------------------------------------------------------
 * IT YIELDS TO ANYTHING ELSE THAT WANTED THE KEY
 * ------------------------------------------------------------------------
 *
 * Escape already means something inside this console: it closes the command
 * palette, a confirm dialog, a hover card. Taking the whole menu down instead
 * of closing the ban dialog somebody is halfway through typing would be a far
 * worse bug than the one this fixes.
 *
 * Two guards, and they cover different cases:
 *
 *   · BUBBLE PHASE, and `defaultPrevented` is respected. A component that
 *     consumed the key has already run by the time this sees it. Capture phase
 *     would preempt every one of them, which is exactly wrong here.
 *   · NO OPEN DIALOG ANYWHERE. Base UI renders open popups with `role=dialog`
 *     or `role=alertdialog`; if one is on screen, Escape belongs to it whether
 *     or not it remembered to mark the event handled. Belt and braces, because
 *     "it usually calls preventDefault" is not a thing to bet a typed ban on.
 *
 * ------------------------------------------------------------------------
 * NOTHING HAPPENS IN A BROWSER TAB
 * ------------------------------------------------------------------------
 *
 * `window.parent === window` and this returns immediately, the same first line
 * `FrameHandoffSignal` uses. A desktop admin pressing Escape on the player list
 * should get nothing, and does.
 *
 * The message shape mirrors `FrameHandoffSignal` deliberately -- same `source`,
 * same version field -- because the game validates both against one origin
 * check and reads them in one listener. `'*'` as the target origin for the
 * reason that file gives at length: the NUI parent is
 * `https://cfx-nui-<resource>` and the resource name belongs to the game
 * repository, so this side cannot name it. Nothing secret is in the payload;
 * it is the word "dismiss".
 */

/** Bumped with `FrameHandoffSignal`'s, so an old game build can ignore a new one. */
const PROTOCOL_VERSION = 1

export function FrameEscape() {
  useEffect(() => {
    if (window.parent === window) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return

      try {
        window.parent.postMessage(
          { source: 'ringmaster', v: PROTOCOL_VERSION, action: 'dismiss' },
          '*',
        )
      } catch {
        // A parent that cannot receive it changes nothing here. The admin
        // still has the Back button, which is why that is a button.
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return null
}
