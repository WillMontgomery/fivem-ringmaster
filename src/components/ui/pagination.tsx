"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Pagination, for lists that live in React state rather than in the URL.
 *
 * NOT THE REGISTRY COMPONENT, and the difference is not cosmetic. The stock
 * shadcn part renders each page as an `<a href>`, because its worked example
 * pages through a route. Nothing in this console does: every paginated list —
 * the profile panels, the incident queue, the moderation log — holds its page
 * in `useState`, slices an array it already has, and never touches the router.
 * An anchor with no `href` is not focusable and carries no role, and `href="#"`
 * pushes a history entry and jumps the scroll position. So these are real
 * `<button>`s, and the part is named for what it is.
 *
 * IT OWNS NO STATE AND DOES NOT CLAMP. The caller keeps `page`, because the
 * caller is also the one slicing — a page number in here that disagreed with
 * the slice out there is a bug nobody would find by looking. `page` is
 * 0-indexed for the same reason: every call site stores 0-based and every one
 * of them already renders `page + 1`.
 */

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pagination"
      role="navigation"
      aria-label="pagination"
      className={cn("flex w-fit items-center", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      // WRAPS RATHER THAN CLIPS. Nine pages of numbered buttons plus two arrows
      // is wider than a phone-width card, and a nowrap row would put the last
      // pages — including Next — past the edge with nothing to scroll. The
      // parent already wraps the range label away from the control; this lets
      // the control wrap within itself when even that is not enough.
      className={cn("flex flex-row flex-wrap items-center justify-end gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

/**
 * One page number.
 *
 * `variant` is derived, not accepted: the raised outline IS the selected state,
 * and letting a caller pass `variant="ghost"` on the active page would hand
 * them a control with no visible current page. `aria-current="page"` says the
 * same thing to a screen reader, and matters more here than it did on the
 * anchor this replaces, because a button carries no location semantics of its
 * own.
 */
function PaginationButton({
  className,
  isActive = false,
  size = "icon-sm",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant"> & {
  isActive?: boolean
}) {
  return (
    <Button
      data-slot="pagination-button"
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn("tabular-nums", className)}
      {...props}
    />
  )
}

/**
 * Previous and Next, which the registry cannot disable.
 *
 * An anchor has no disabled state, so stock shadcn renders a live link at both
 * ends of the list that goes nowhere. Every list in this console already knows
 * when it is at an end — `disabled={page === 0}` was written by hand at all six
 * of them — so the prop is forwarded to `Button` and `buttonVariants` styles it
 * the way it styles every other disabled button in the app. No local
 * `disabled:opacity-*`: a pagination control that greys out differently from
 * the buttons beside it is exactly the inconsistency this file exists to end.
 *
 * The word is hidden below `sm` and the chevron is not, so a narrow viewport
 * keeps the control on one line. `aria-label` carries the name in both cases,
 * because `display: none` text is not read to anybody.
 */
function PaginationPrevious({
  className,
  size = "sm",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "children">) {
  return (
    <Button
      data-slot="pagination-previous"
      variant="ghost"
      size={size}
      aria-label="Go to previous page"
      className={cn(className)}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">Previous</span>
    </Button>
  )
}

function PaginationNext({
  className,
  size = "sm",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "children">) {
  return (
    <Button
      data-slot="pagination-next"
      variant="ghost"
      size={size}
      aria-label="Go to next page"
      className={cn(className)}
      {...props}
    >
      <span className="hidden sm:block">Next</span>
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden
      className={cn(
        "flex size-7 items-center justify-center text-muted-foreground",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon />
    </span>
  )
}

type PaginationRangeItem = number | "ellipsis"

/**
 * Which page numbers to draw, 0-indexed, with `"ellipsis"` where a run is
 * elided. Pure, and deliberately not a component — a list of nine hundred audit
 * rows must not become ninety buttons, but deciding that is arithmetic, not
 * markup, and it is the one part of a pagination control worth testing on its
 * own.
 */
function paginationRange(
  page: number,
  pages: number,
  siblings = 1
): PaginationRangeItem[] {
  const span = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k)

  // First, last, two ellipses, the current page and its siblings either side.
  // Below that many pages every number fits and an ellipsis would elide
  // nothing — worse, it would elide one number and take the same width.
  const slots = siblings * 2 + 5
  if (pages <= slots) return span(0, pages - 1)

  const left = Math.max(page - siblings, 0)
  const right = Math.min(page + siblings, pages - 1)

  if (left <= 1) return [...span(0, siblings * 2 + 2), "ellipsis", pages - 1]
  if (right >= pages - 2) {
    return [0, "ellipsis", ...span(pages - (siblings * 2 + 3), pages - 1)]
  }
  return [0, "ellipsis", ...span(left, right), "ellipsis", pages - 1]
}

export {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  paginationRange,
  type PaginationRangeItem,
}
