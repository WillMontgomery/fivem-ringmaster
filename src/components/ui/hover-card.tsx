"use client"

/**
 * HOVER CARD: CONTENT WITH PARTS. Its sibling is `tooltip.tsx`, and the boundary
 * between them is the whole reason this comment exists — two components with
 * overlapping jobs and nothing written down is how this console accumulated nine
 * native `title` attributes and one lonely hover card.
 *
 *   Use `HoverCard` when what you are showing has real internal structure: a
 *   header row, a body, a footer. `FeedStatus` is the reference — status dot and
 *   label, then the age, then the refresh interval. `Provenance` is the second,
 *   and it spent a long time crammed into a tooltip that could not hold it.
 *
 *   Use `Tooltip` for about six words on a focusable control. A CARD IS A
 *   LAYOUT, NOT AN EMPHASIS LEVEL: a single important sentence does not get
 *   promoted to a 256px popup with 10px of padding for being important. If the
 *   words fit next to the thing, they belong next to the thing and neither
 *   component is the answer.
 *
 * NEITHER ONE IS AN ACCESSIBILITY MECHANISM. In Base UI 1.7.0 the hover
 * interaction is `mouseOnly: true`, so it never fires on touch; focus is wired
 * separately, but every hover card in this app triggers from an inert `<span>`,
 * which nothing can focus. And the popup gets no `role` and no
 * `aria-describedby`, so it is never announced. Any fact worth showing must ALSO
 * exist in the DOM — visible, or `sr-only`. See `docs/hover-text.md`.
 *
 * TWO SHARP EDGES. `HoverCardTrigger` renders an `<a>` by default, so pass
 * `render={<span … />}` unless a link is genuinely what you want. And this is
 * Base UI's `PreviewCard` underneath, not a "hover card" namespace — the name
 * here is shadcn's, which is worth knowing before searching the upstream docs.
 * Delays (`delay`, `closeDelay`) are props on the trigger; there is no provider
 * for this component and none is needed.
 */

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@/lib/utils"

function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 4,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-64 origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
