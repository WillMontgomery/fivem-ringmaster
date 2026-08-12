'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import { PlayerRowView } from '@/components/PlayerRow'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PlayerRow as Player } from '@/lib/ingest'
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

/** State filter chips. `null` = everyone. */
const FILTERS: Array<{ key: string; label: string; match: (p: Player) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'alive', label: 'Alive', match: (p) => p.state === 'ALIVE' },
  { key: 'downed', label: 'Downed', match: (p) => p.state === 'DBNO' },
  { key: 'dead', label: 'Dead', match: (p) => p.state === 'DEAD' },
  { key: 'lobby', label: 'Lobby', match: (p) => p.state === 'LOBBY' },
]

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
  const [filter, setFilter] = useState('all')
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
          return a.state.localeCompare(b.state) * dir
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
          {FILTERS.map((f) => {
            const count = players.filter(f.match).length
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] transition-colors',
                  filter === f.key
                    ? 'bg-primary/15 text-[12px]rimary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-50">{count}</span>
              </button>
            )
          })}
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
                    'group/th cursor-pointer select-none text-[10px] uppercase tracking-wider transition-colors hover:text-foreground',
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
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
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
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Nothing here called{' '}
              <span className="font-mono text-muted-foreground">{query}</span>.
              Searching a license from another session?{' '}
              <Link
                href={`/players?q=${encodeURIComponent(query)}`}
                className="text-[12px]rimary underline-offset-2 hover:underline"
              >
                Search everyone ever seen
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}
