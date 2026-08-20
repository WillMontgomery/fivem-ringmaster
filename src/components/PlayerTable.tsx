'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

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
import type { PlayerRow as Player } from '@/lib/ingest'
import { stateKey } from '@/lib/playerState'
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
 * THREE, AT THE OWNER'S REQUEST: "the tabs all/alive/in the air/downed/dead/
 * lobby are not all necessary. Let's cut it down to all/in-match/lobby. 'in
 * match' should include dead/in the air/down/alive."
 *
 * SPLIT ON `matchId`, NOT ON THE STATE STRING, and that is the one decision in
 * here worth defending. Both were available: `bucketOf(p.state)` folded the ten
 * wire states into five buckets, and `LiveBoard` already split the lobby off
 * with `p.matchId === null`. Keeping both would have left two answers to "is
 * this player in a match" on a single page, so the loser was DELETED rather
 * than left lying around — `bucketOf`, `inBucket` and `StateBucket` are gone
 * from `lib/playerState`, where a note now stands in their place.
 *
 * `matchId` WINS BECAUSE IT IS THE GAME'S OWN ANSWER AND IT IS ALREADY ON
 * SCREEN. `ServerStrip` sits directly above these chips reading `on server`,
 * `in lobby`, `in match` — "the two halves it splits into", as its own comment
 * puts it — and the envelope's `counts.inMatch` is the count of players
 * carrying a `matchId`, dead ones included: the contract fixture holds a `DEAD`
 * player at `matchId: 41` and `counts.inMatch: 3` across four players. A chip
 * derived from the state string could have printed a different "in match" than
 * the figure two rows above it.
 *
 * IT IS ALSO WHERE THE OWNER ASKED FOR IT. `isInMatch` — this console's other
 * predicate, mirroring `BR.Server.isInMatch` — returns FALSE for `dead`,
 * `spectating` and `left`, so it is the wrong tool for a chip that must hold
 * the dead. It stays where it belongs, counting who is still standing on a
 * match card.
 *
 * WHERE THE TWO COULD HAVE DISAGREED, so the next reader does not reintroduce
 * the other one: a player whose state has gone to `lobby` before the roster
 * clears their `matchId`, or the reverse; and any state this build has never
 * heard of, which `bucketOf` defaulted to `alive` on purpose. That default is
 * "wrong but visible" across five chips and merely wrong across two — it would
 * have filed an unknown-state lobby player under In match with nothing on
 * screen to show for it. `matchId` has no fallback to be wrong about.
 *
 * ALL MEANS ALL: every row in the snapshot, no exceptions, so its count always
 * equals the population of the table it sits above — and In match plus Lobby
 * always equals it too, because they are one predicate and its negation.
 *
 * A LABEL AND A COUNT, AND NOTHING ELSE. Each of these carried a `title` — a
 * one-line explanation rendered as both a tooltip and an `sr-only` element —
 * until the owner ruled: "We don't need descriptors for those tabs." The field
 * is gone from the type, not merely unset, so there is nothing to quietly
 * repopulate. See `FilterChip` for why it was removed rather than blanked.
 */
const FILTERS: Array<{
  key: 'all' | 'in-match' | 'lobby'
  label: string
  match: (p: Player) => boolean
}> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'in-match', label: 'In match', match: (p) => p.matchId !== null },
  { key: 'lobby', label: 'Lobby', match: (p) => p.matchId === null },
]

/**
 * One filter chip: a label, a count, a real `<button>`.
 *
 * NO DESCRIPTION, BY INSTRUCTION. The owner: "We don't need descriptors for
 * those tabs." This used to render each chip's explanation twice over — a Base
 * UI tooltip for the mouse, and an `sr-only` element pointed at with
 * `aria-describedby` for everyone else — because rule 1 of `docs/hover-text.md`
 * will not let a fact live on hover alone. With no fact left to place, the
 * entire apparatus went with it: the tooltip, the `sr-only` span, the
 * `aria-describedby`, the `useId`, and the `title` field on `FILTERS` that fed
 * all of them.
 *
 * DELETED RATHER THAN EMPTIED, which is the part worth not undoing. An
 * `aria-describedby` pointing at an absent or blank element is WORSE than no
 * attribute: the screen reader announces nothing, and an audit reads a broken
 * reference where the truth is a deliberate absence. A `TooltipContent` holding
 * an empty string is the same mistake with a mouse — a popup that opens to show
 * a blank pill. So there is no `description` prop left to thread `''` through;
 * the type cannot express the empty case because the case does not exist.
 *
 * IF A DESCRIPTION IS EVER ASKED FOR AGAIN it must be the owner's own words
 * (rule 8), and it does NOT go in `aria-label`: appending it to the visible name
 * breaks WCAG 2.5.3 Label in Name, and "click All" stops working for anyone
 * driving this by voice. It goes back the way it left — an `sr-only` element
 * OUTSIDE the button so it cannot join the accessible name, plus a tooltip.
 */
function FilterChip({
  label,
  count,
  active,
  onSelect,
}: {
  label: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-md px-2 py-1 text-xs transition-colors',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-50">{count}</span>
    </button>
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
}: {
  players: Player[]
  server: { wallMs: number; gameMs: number }
  now: number
  squadColour?: (squadId: number | null) => string | undefined
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
      {/*
        CHIPS FIRST, SEARCH SECOND, AND THAT IS THE WHOLE LAYOUT: "the tabs
        should be aligned left, with the in-line search directly to the right of
        the tabs instead of left like it is now."

        DOM ORDER, NOT MARGINS. The search used to come first and wear an
        `ml-auto` that shoved it to the far right, which left the chips stranded
        beyond it — the arrangement the owner is describing. Reordering the two
        children is what actually puts the chips on the left edge, so the
        `ml-auto` is gone rather than mirrored onto the other element; a second
        auto margin fighting the first is how this drifts back.

        The search keeps `w-full sm:w-64`, so below the `sm` breakpoint it wraps
        onto its own line under the chips instead of crushing them.
      */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="flex gap-0.5 rounded-lg border border-border bg-background/40 p-0.5">
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              count={players.filter(f.match).length}
              active={filter === f.key}
              onSelect={() => setFilter(f.key)}
            />
          ))}
        </div>

        <div className="relative w-full sm:w-64">
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
