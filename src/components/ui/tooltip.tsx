"use client"

/**
 * TOOLTIP: ONE SHORT PHRASE, ON A CONTROL. Its sibling is `hover-card.tsx`, and
 * the boundary between them is the whole reason this comment exists — two
 * components with overlapping jobs and nothing written down is how this console
 * accumulated nine native `title` attributes and one lonely hover card.
 *
 *   Use `Tooltip` for about six words naming or explaining a control that a
 *   keyboard can actually focus, so the popup opens on `:focus-visible` too.
 *   `TooltipContent` is a single-line pill — `inline-flex items-center text-xs`
 *   on an inverted background. A sentence does not survive in it.
 *
 *   Use `HoverCard` when the content has real internal structure: a header row,
 *   a body, a footer. A CARD IS A LAYOUT, NOT AN EMPHASIS LEVEL. Prose is not
 *   promoted to a card for being important; it is moved there for having parts.
 *
 * NEITHER ONE IS AN ACCESSIBILITY MECHANISM. In Base UI 1.7.0 the hover
 * interaction is `mouseOnly: true`, so it never fires on touch. Focus is wired
 * separately (`useFocus`), so a tooltip on a REAL control does open on
 * `:focus-visible` — which is most of why the trigger being focusable matters.
 * But the popup gets no `role="tooltip"` and no `aria-describedby` anywhere in
 * this package, so it is never associated with its trigger and a screen reader
 * is told nothing by it. Any fact worth showing must ALSO exist in the DOM —
 * visible, or as an `sr-only` sibling of the trigger. `ProfileView`'s `Face` is
 * the worked example: one sentence, built once and rendered twice, into the
 * popup and into an `sr-only` span beside it.
 *
 * THERE IS NO `aria-describedby` LEFT IN THIS CONSOLE, which is a fact rather
 * than an oversight. `PlayerTable`'s `FilterChip` was the single site that wired
 * one, and it went when the owner cut the filter chips' descriptions ("We don't
 * need descriptors for those tabs"): an `aria-describedby` aimed at a blank or
 * absent element is a broken reference, not a courtesy. If a description ever
 * returns on a FOCUSABLE trigger, that is the wiring to restore; on an inert
 * one, a sibling `sr-only` span is the whole mechanism.
 *
 * AND THE NATIVE `title` ATTRIBUTE IS NOT THE CHEAP VERSION OF THIS FILE. It is
 * banned on DOM elements; it cannot be selected, focused, or read aloud, and it
 * never fires on a touch device. The full rule, with the reasoning and the
 * per-site history, is in `docs/hover-text.md`.
 *
 * DELAYS ARE PER-TRIGGER. `delay` and `closeDelay` are props on
 * `TooltipTrigger`, not just on the `Provider` — so tuning one site does not
 * require nesting a second provider, and "the delays feel different" is never a
 * reason to reach for the other component.
 */

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
