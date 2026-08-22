import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A vertical timeline: a rail, a marker per row, and whatever the caller puts
 * beside it.
 *
 * THERE IS NO OFFICIAL SHADCN TIMELINE, and this file is not pretending
 * otherwise. Nothing in the registry provides one, the third-party ones are
 * either a dependency or a paid tier, and neither is acceptable here — so this
 * is written to the same conventions as the primitives already in this
 * directory: plain functions, `data-slot` on every element, `cn()` last so a
 * caller can override, and a `cva` variant object for the one thing that varies
 * (`card.tsx` and `badge.tsx` are the two to read).
 *
 * IT KNOWS NOTHING ABOUT INCIDENTS. No timestamps, no formatting, no colours
 * with meaning attached — the caller owns all of that, the same way `Card`
 * knows nothing about the incident it frames. `IncidentTimeline` is the one
 * that decides what a row says; this decides what a row looks like.
 *
 * THE RAIL IS A PSEUDO-ELEMENT ON THE ITEM, not a border on a wrapper, so it
 * can stop at the last row without the caller having to know which row that is
 * (`last:before:hidden`). It starts BELOW the marker rather than behind it, and
 * the marker paints `bg-card` on top, so the line reads as connecting the dots
 * rather than skewering them.
 *
 * NO `currentColor` BACKGROUNDS ANYWHERE IN HERE, and that is a hard constraint
 * rather than a preference — see `scripts/check-cef-css.mjs`. Lightning CSS
 * downlevels a `color-mix()` it cannot compute into `currentColor`, and a
 * background painted in `currentColor` on a rule that also sets a text colour
 * is text painted on itself. The marker's colour therefore travels as a custom
 * property (`--timeline-dot`) set by the variant, and the dot reads it.
 */

function Timeline({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="timeline"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function TimelineItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="timeline-item"
      className={cn(
        "group/timeline-item relative grid grid-cols-[1rem_1fr] gap-x-3 pb-3.5 last:pb-0",
        "before:absolute before:top-5 before:bottom-0 before:left-2 before:w-px before:-translate-x-1/2 before:bg-border last:before:hidden",
        className
      )}
      {...props}
    />
  )
}

const timelineMarkerVariants = cva(
  "relative z-10 mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-card [&>svg]:size-3",
  {
    variants: {
      tone: {
        default: "text-muted-foreground [--timeline-dot:var(--border)]",
        /** The rows that bracket a span rather than sit inside one. */
        accent: "text-primary [--timeline-dot:var(--primary)]",
        /**
         * The rows that bracket the RECORD itself. Asked for by colour rather
         * than by role — see `isCaseBracket` in `lib/matchTimeline`, which is
         * the one place that decides which rows get it and why it is not a
         * severity claim.
         */
        danger: "text-danger [--timeline-dot:var(--danger)]",
        muted:
          "text-muted-foreground/70 [--timeline-dot:var(--muted-foreground)]",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  }
)

function TimelineMarker({
  className,
  tone = "default",
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof timelineMarkerVariants>) {
  return (
    <span
      data-slot="timeline-marker"
      data-tone={tone}
      aria-hidden="true"
      className={cn(timelineMarkerVariants({ tone }), className)}
      {...props}
    >
      {children ?? (
        <span
          data-slot="timeline-dot"
          className="size-2 rounded-full bg-(--timeline-dot)"
        />
      )}
    </span>
  )
}

function TimelineContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

function TimelineTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-title"
      className={cn("text-sm leading-6", className)}
      {...props}
    />
  )
}

/** The line under the title: when, and who. */
function TimelineMeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-meta"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Timeline,
  TimelineItem,
  TimelineMarker,
  TimelineContent,
  TimelineTitle,
  TimelineMeta,
  timelineMarkerVariants,
}
