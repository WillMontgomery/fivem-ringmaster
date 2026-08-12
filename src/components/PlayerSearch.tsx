'use client'

import { Gauge, Search, ShieldAlert, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'

/**
 * Player search, as an overlay rather than a page.
 *
 * A DESTINATION WAS THE WRONG SHAPE. Searching for a player is something you do
 * *while* looking at something else — a report in Discord, a live board, a
 * profile — and a nav tab meant leaving the thing that prompted the search, and
 * then navigating back. An overlay keeps the context underneath and costs one
 * keystroke to open.
 *
 * RESULTS ARE CAPPED AT TEN. The list is a shortlist, not a report: a palette
 * that can show forty rows invites scrolling and reading, which is what the
 * (still real) profile pages are for. If what you want is not in the first ten,
 * the query is not specific enough — and typing one more character is faster
 * than scanning.
 */

const MAX_RESULTS = 10

export interface SearchPlayer {
  license: string | null
  name: string
  online?: boolean
}

export function PlayerSearch({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<SearchPlayer[]>([])

  /**
   * Ask the server, on every keystroke.
   *
   * THIS USED TO READ THE LIVE SNAPSHOT and filter it here, which meant search
   * could only ever find somebody who was connected at that exact moment.
   * Looking a player up after they logged off — the ordinary reason to look
   * anyone up — returned nothing. The endpoint searches everyone the console
   * has seen this session, online or not.
   */
  useEffect(() => {
    if (!open) return
    let alive = true

    const run = async () => {
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(query)}`,
          { cache: 'no-store' },
        )
        if (!res.ok || !alive) return
        const data = (await res.json()) as { players?: SearchPlayer[] }
        setPlayers(data.players ?? [])
      } catch {
        /* an empty palette is a fine failure mode */
      }
    }

    // Debounced: typing a name should not fire a request per keystroke.
    const t = setTimeout(run, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [open, query])

  const go = useCallback(
    (href: string) => {
      onOpenChange(false)
      setQuery('')
      router.push(href)
    },
    [onOpenChange, router],
  )

  const q = query.trim()
  // Filtered and capped by the endpoint; see api/players/search.
  const matches = players.slice(0, MAX_RESULTS)

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find a player by name or identifier, or jump to a page."
    >
      {/*
        shadcn's CommandDialog renders its children straight into the dialog
        without a <Command> wrapper, so cmdk's context has to be established
        here or CommandInput throws.

        `shouldFilter={false}` because the list is already filtered above
        against license as well as name — letting cmdk re-rank would quietly
        drop exact identifier matches that do not look name-shaped.
      */}
      <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search players by name or license…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {q ? (
            <span>
              Nobody online matches “{query}”.
              <span className="mt-1 block text-xs text-muted-foreground/70">
                Only players currently connected are searchable until the
                player history stream ships.
              </span>
            </span>
          ) : (
            'Type a name or license.'
          )}
        </CommandEmpty>

        {matches.length > 0 && (
          <CommandGroup heading={q ? 'Players' : 'Online now'}>
            {matches.map((p) => (
              <CommandItem
                key={p.license ?? p.name}
                value={p.license ?? p.name}
                onSelect={() =>
                  go(`/players/${encodeURIComponent(p.license ?? '')}`)
                }
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name}</div>
                  {p.license && (
                    <code className="block truncate font-mono text-xs text-muted-foreground/60">
                      {p.license}
                    </code>
                  )}
                </div>
                {p.online && (
                  <span className="shrink-0 text-xs uppercase tracking-wider text-live">
                    online
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Go to">
          <CommandItem value="live players" onSelect={() => go('/')}>
            <Users />
            Live players
          </CommandItem>
          <CommandItem value="host" onSelect={() => go('/host')}>
            <Gauge />
            Host
          </CommandItem>
          <CommandItem value="moderation kick ban" onSelect={() => go('/moderation')}>
            <ShieldAlert />
            Kick &amp; ban
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}

/**
 * The button that opens it, plus the ⌘K / Ctrl-K binding.
 *
 * The shortcut is registered here rather than in the dialog so the key works
 * on every page whether or not the palette has ever been opened.
 */
export function PlayerSearchTrigger() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-card hover:text-foreground"
        aria-label="Search players"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search players by name or license…</span>
        <CommandShortcut className="ml-auto hidden sm:inline">⌘K</CommandShortcut>
      </button>
      <PlayerSearch open={open} onOpenChange={setOpen} />
    </>
  )
}
