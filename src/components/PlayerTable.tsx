'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import { openPlayerSearch } from '@/components/PlayerSearch'
import { PlayerRowView } from '@/components/PlayerRow'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { PlayerRow as Player } from '@/lib/ingest'
import { bucketOf, stateKey, type StateBucket } from '@/lib/playerState'
import { cn } from '@/lib/utils'

/**
 * A searchable, sortable player table.
 *
 * SEARCH MATCHES NAME *AND* LICENSE, and that is the whole reason it exists.
 * The realistic moment is: somebody pastes a license into Discord asking who
 * this is, or an admin has a name and needs the license to act on. Both are a
 * paste-and-look, and neither works if the box only searches the display name.
 *
 * Client-side because the whole population is already here — the snapshot is a
 * complete list by design. At the 2048 this is heading for that assumption
 * fails along with the snapshot itself, and both get fixed together.
 */

export type SortKey =
  | 'name'
  | 'state'
  | 'hp'
  | 'kills'
  | 'damage'
  | 'connected'
  | 'squad'

interface Column {
  key: SortKey
  label: string
  align?: 'right'
  /** Ascending first for text; descending first for anything you rank by. */
  descFirst?: boolean
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Player' },
  { key: 'state', label: 'State' },
  { key: 'hp', label: 'Health', descFirst: true },
  { key: 'connected', label: 'Connected', align: 'right', descFirst: true },
  { key: 'kills', label: 'Kills', align: 'right', descFirst: true },
  { key: 'damage', label: 'Damage', align: 'right', descFirst: true },
]

/**
 * State filter chips.
 *
 * NONE OF THESE EVER MATCHED A ROW (#17). They compared against `'ALIVE'`,
 * `'DBNO'`, `'DEAD'` and `'LOBBY'`; `BR.PlayerState` is lowercase and the
 * snapshot carries it verbatim, so every chip except All filtered to nothing —
 * and because the empty result fell through to "No players match", selecting
 * one looked like a table that had simply not changed.
 *
 * Two things had to be true for a fix to hold. The comparison has to be against
 * the value the game actually sends (see `lib/playerState.ts`, which folds
 * case so the uppercase FIXTURE keeps working too), and every state has to land
 * under exactly one chip — the old set offered four buckets for ten states, so
 * a player in the bus, in freefall, under a chute, in warmup, spectating or
 * mid-disconnect matched nothing at all. `bucketOf` is where that mapping
 * lives, with the reasoning.
 *
 * ALL MEANS ALL: every row in the snapshot, no exceptions, so its count always
 * equals the population of the table it sits above.
 */
const FILTERS: Array<{
  key: 'all' | StateBucket
  label: string
  /**
   * The chip's explanation — "In the air" has to say which states it holds.
   *
   * Rendered by `FilterChip` in two places at once: a tooltip for the mouse and
   * an `sr-only` element for everyone else. Edit it here; the chip is the only
   * consumer.
   */
  title: string
  match: (p: Player) => boolean
}> = [
  {
    key: 'all',
    label: 'All',
    title: 'Everyone connected, whatever they are doing',
    match: () => true,
  },
  {
    key: 'alive',
    label: 'Alive',
    title: 'On their feet in a match — alive, or waiting in warmup',
    match: (p) => bucketOf(p.state) === 'alive',
  },
  {
    key: 'air',
    label: 'In the air',
    title: 'Still dropping — on the bus, in freefall, or under a chute',
    match: (p) => bucketOf(p.state) === 'air',
  },
  {
    key: 'downed',
    label: 'Downed',
    title: 'Downed but not out — the game calls this state dbno',
    match: (p) => bucketOf(p.state) === 'downed',
  },
  {
    key: 'dead',
    label: 'Dead',
    title: 'Out of the match — dead, spectating, or disconnected mid-match',
    match: (p) => bucketOf(p.state) === 'dead',
  },
  {
    key: 'lobby',
    label: 'Lobby',
    title: 'Connected but not in a match',
    match: (p) => bucketOf(p.state) === 'lobby',
  },
]

/**
 * One filter chip, with its explanation attached in both directions at once.
 *
 * THE TWO HALVES ARE ONE COMPONENT ON PURPOSE. This is the only site in the
 * console where a tooltip is strictly better than putting the words on screen:
 * six chips sit in a row and their explanations are one to two lines each, so
 * inlining them would be a paragraph where a toolbar belongs. These are also
 * real `<button>`s, so the popup opens on `:focus-visible` — verified with an
 * actual Tab press — which the native `title` never did.
 *
 * BUT A TOOLTIP ALONE IS A REGRESSION HERE. The native `title` this replaces was
 * announced by screen readers, and Base UI's popup carries no `role="tooltip"`
 * and no `aria-describedby` at all (verified in 1.7.0), so it is never
 * associated with the button and never announced. Shipping only the popup would
 * quietly take the explanation away from the readers who most needed it.
 *
 * So the string is rendered twice and neither copy can be deleted without
 * noticing the other. There is no lint rule standing behind this; the component
 * boundary is the enforcement.
 *
 * THE `sr-only` SPAN SITS OUTSIDE THE BUTTON, and that placement is the whole
 * trick. Inside, it would join the button's accessible name — the "All" chip
 * would announce as "All 12 Everyone connected, whatever they are doing" — so it
 * lives outside and is pointed at with `aria-describedby`, which is the
 * attribute for "extra detail, read after the name".
 *
 * AND NOT `aria-label`. Overwriting the name with `${label}, ${count}. ${title}`
 * is the tempting one-liner and it breaks WCAG 2.5.3 Label in Name: the
 * accessible name would no longer contain the visible text verbatim, so
 * "click All" stops working for anyone driving this by voice.
 */
function FilterChip({
  label,
  count,
  description,
  active,
  onSelect,
}: {
  label: string
  count: number
  description: string
  active: boolean
  onSelect: () => void
}) {
  const id = useId()

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-describedby={id}
              onClick={onSelect}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            />
          }
        >
          {label}
          <span className="ml-1.5 tabular-nums opacity-50">{count}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{description}</TooltipContent>
      </Tooltip>
      {/* `sr-only` is `position: absolute`, so this is not a flex item and adds
          no gap to the chip row it sits in. */}
      <span id={id} className="sr-only">
        {description}
      </span>
    </>
  )
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (dir === 'asc') return <ArrowUp className="size-3" />
  if (dir === 'desc') return <ArrowDown className="size-3" />
  return (
    <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-40" />
  )
}

export function PlayerTable({
  players,
  server,
  now,
  squadColour,
  /** Rendered above the table. Lets a caller title the section without a wrapper. */
  caption,
}: {
  players: Player[]
  server: { wallMs: number; gameMs: number }
  now: number
  squadColour?: (squadId: number | null) => string | undefined
  caption?: React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]!

    const filtered = players.filter((p) => {
      if (!f.match(p)) return false
      if (!q) return true
      // Name or license. See the note at the top of this file.
      return (
        p.name.toLowerCase().includes(q) ||
        (p.license?.toLowerCase().includes(q) ?? false)
      )
    })

    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'state':
          // Folded, so a snapshot that mixed spellings could not split one
          // state into two runs in the sorted column.
          return stateKey(a.state).localeCompare(stateKey(b.state)) * dir
        case 'hp':
          return (a.hp - b.hp) * dir
        case 'kills':
          return (a.kills - b.kills) * dir
        case 'damage':
          return (a.damage - b.damage) * dir
        case 'squad':
          return ((a.squadId ?? 0) - (b.squadId ?? 0)) * dir
        case 'connected':
          // Earlier connectedAt = longer connected. Compare the origin rather
          // than a computed duration so the order cannot wobble with `now`.
          return (a.connectedAt - b.connectedAt) * dir
      }
    })
  }, [players, query, filter, sort])

  const toggle = (col: Column) => {
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: col.descFirst ? 'desc' : 'asc' },
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {caption}

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or license…"
            className="h-8 pl-8 pr-8 text-sm"
            aria-label="Search players by name or license"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-0.5 rounded-lg border border-border bg-background/40 p-0.5">
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              count={players.filter(f.match).length}
              description={f.title}
              active={filter === f.key}
              onSelect={() => setFilter(f.key)}
            />
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            {COLUMNS.map((col) => {
              const dir = sort.key === col.key ? sort.dir : null
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    'group/th cursor-pointer select-none text-xs uppercase tracking-wider transition-colors hover:text-foreground',
                    col.align === 'right' && 'text-right',
                    dir && 'text-foreground',
                  )}
                  onClick={() => toggle(col)}
                  aria-sort={
                    dir === 'asc'
                      ? 'ascending'
                      : dir === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {col.label}
                    <SortIcon dir={dir} />
                  </span>
                </TableHead>
              )
            })}
            <TableHead className="text-right text-xs uppercase tracking-wider">
              ID
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((p) => (
            <PlayerRowView
              key={p.src}
              p={p}
              accent={squadColour?.(p.squadId)}
              server={server}
              now={now}
            />
          ))}
        </TableBody>
      </Table>

      {rows.length === 0 && (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No players match.</p>
          {query && (
            <p className="mt-1 text-xs text-muted-foreground/60">
              Nothing here called{' '}
              <span className="font-mono text-muted-foreground">{query}</span>.
              Searching a license from another session?{' '}
              {/*
                OPENS THE SEARCH. It was a link to `/players?q=…` — a route that
                has never existed (there is only `/players/[license]`), so the
                one control offering to widen a failed search answered it with a
                404 (#18).

                It hands the typed query to the palette that is already mounted
                in the header rather than mounting a second one: AppShell's
                comment on PlayerSearchTrigger records what two live instances
                cost last time — both registered ⌘K, and the invisible one ate
                the keystrokes.
              */}
              <button
                type="button"
                onClick={() => openPlayerSearch(query)}
                className="text-primary underline-offset-2 hover:underline"
              >
                Search everyone ever seen
              </button>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}
