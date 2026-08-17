'use client'

import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  paginationRange,
} from '@/components/ui/pagination'
import { cn } from '@/lib/utils'

/**
 * The one pagination footer, used by every paginated list in the console.
 *
 * THERE WERE THREE OF THESE AND THEY DISAGREED. Two files carried a
 * byte-identical pair of bare `<button>`s reading "Previous" and "Next" with a
 * hand-rolled `disabled:opacity-30`; a third carried unlabelled chevron
 * `Button`s that no screen reader could name. Page sizes were 10, 20 and 10.
 * One said "1–10 of 34", another said "34 total · page 1 of 4". The owner's
 * complaint was not that any one of them was wrong — it was that a reader
 * moving between two pages of the same app had to work out the control again.
 *
 * SO THE RANGE AND THE CONTROL BOTH LIVE HERE. The numbers survive the restyle
 * because they answer a question the buttons cannot: "1–5 of 23" tells you how
 * much list there is, which is the thing you actually want to know before
 * deciding whether to page through it at all. The page NUMBER is now carried by
 * the numbered buttons themselves, so the old "page 1 of 4" wording is gone
 * without the fact going with it.
 *
 * IT HOLDS NO STATE. `page` comes in already clamped by whoever owns the slice,
 * for the same reason `ui/pagination.tsx` owns none: two ideas of the current
 * page is one more than a list can survive.
 *
 * IT DISAPPEARS ON A SINGLE PAGE. Pagination furniture under a six-row list is
 * noise — two of the three originals already hid it and said so in a comment;
 * the third rendered "7 total · page 1 of 1" with both arrows dead, which is a
 * control that exists only to tell you it is not needed.
 */
export function Pager({
  page,
  perPage,
  total,
  onPage,
  label,
  className,
}: {
  /** Zero-indexed, and already clamped against `total` by the caller. */
  page: number
  perPage: number
  total: number
  onPage: (page: number) => void
  /**
   * What this pager pages, e.g. "Match history pages".
   *
   * NAMED PER LIST BECAUSE A PAGE CAN HOLD SEVERAL. Each of these is a
   * navigation landmark, and the player profile mounts three — incidents,
   * kicks and bans, match history. Landmarks are how a screen-reader user jumps
   * around a page, so three called "pagination" is a menu of three identical
   * entries leading somewhere different. Falls back to the bare name for a page
   * with only one.
   */
  label?: string
  /** Where this footer sits — the border and padding of its host list. */
  className?: string
}) {
  const pages = Math.ceil(total / perPage)
  if (pages <= 1) return null

  const from = page * perPage + 1
  const to = Math.min((page + 1) * perPage, total)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2',
        className,
      )}
    >
      <span className="text-xs tabular-nums text-muted-foreground">
        {from}–{to} of {total}
      </span>

      <Pagination aria-label={label ?? 'pagination'}>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
            />
          </PaginationItem>

          {paginationRange(page, pages).map((p, k) => (
            <PaginationItem key={p === 'ellipsis' ? `gap-${k}` : p}>
              {p === 'ellipsis' ? (
                <PaginationEllipsis />
              ) : (
                <PaginationButton
                  isActive={p === page}
                  aria-label={`Go to page ${p + 1}`}
                  onClick={() => onPage(p)}
                >
                  {p + 1}
                </PaginationButton>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              disabled={page >= pages - 1}
              onClick={() => onPage(page + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
