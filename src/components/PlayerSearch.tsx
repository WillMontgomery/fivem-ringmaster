'use client'

import { Gauge, Search, ShieldAlert, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  Command,
  CommandDialog,
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

/**
 * Open the palette from anywhere, optionally with the box already filled in.
 *
 * A WINDOW EVENT RATHER THAN A CONTEXT, because the palette is mounted exactly
 * once — in the header, by `PlayerSearchTrigger` — and that is load-bearing:
 * AppShell's comment records what two live instances cost last time, which was
 * both of them registering ⌘K and the invisible one swallowing what you typed.
 * A context provider would work too and would mean threading a provider through
 * the shell for one caller; an event keeps the single instance and asks nothing
 * of the tree in between.
 *
 * The alternative that was there — a link to `/players?q=…` — pointed at a
 * route that does not exist (#18).
 */
export const OPEN_SEARCH_EVENT = 'ringmaster:open-search'

export function openPlayerSearch(query = ''): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }),
  )
}

export interface SearchPlayer {
  license: string | null
  name: string
  online?: boolean
}

export function PlayerSearch({
  open,
  onOpenChange,
  seed = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefills the box each time the palette opens. */
  seed?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState(seed)
  const [players, setPlayers] = useState<SearchPlayer[]>([])

  /**
   * Seed on open, not on every render. Deps are `[open, seed]` deliberately:
   * once the palette is up, typing changes `query` and must not be undone by
   * this effect, so `query` is not a dependency.
   */
  useEffect(() => {
    if (open) setQuery(seed)
  }, [open, seed])

  /**
   * Ask the server, on every keystroke.
   *
   * THIS USED TO READ THE LIVE SNAPSHOT and filter it here, which meant search
   * could only ever find somebody who was connected at that exact moment.
   * Looking a player up after they logged off — the ordinary reason to look
   * anyone up — returned nothing. The endpoint searches everyone the console
   * has seen this session, online or not.
   *
   * AND THEN IT READ ONLY THE OTHER HALF, which is #18. Moving off the snapshot
   * moved entirely off it: the endpoint asked the durable registry and the
   * session directory, neither of which knows who is connected — so the
   * section headed "Online now" was the ten most recently *seen* players, most
   * of whom had gone home. The endpoint now joins the live snapshot back in,
   * which is the same in-memory state the live players page renders from.
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
        {/*
          NOT `CommandEmpty`, AND IT CANNOT BE. cmdk renders that component only
          when `filtered.count === 0`, and with `shouldFilter={false}` it sets
          `filtered.count` to the number of registered items rather than to the
          number that matched. The "Go to" group below always registers three,
          so the count is never zero and the empty state was unreachable — the
          palette answered a search that found nobody with a bare list of three
          navigation links and no words at all.

          THE OLD COPY WAS ALSO A LIE, for whenever it did get shown. It said
          only connected players were searchable "until the player history
          stream ships", which had already shipped: the endpoint reads the
          registry of everyone ever seen. Somebody reading that would stop
          looking for a player the console could have found.

          Two states, because they mean opposite things. Nothing typed and
          nothing listed means the server is empty. Something typed and nothing
          listed means we looked through everyone and did not find them.
        */}
        {matches.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {q ? (
              <>
                Nobody called “{query}”.
                <span className="mt-1 block text-xs text-muted-foreground/70">
                  This searched everyone the console has ever seen, not just
                  who is on now.
                </span>
              </>
            ) : (
              <>
                Nobody is on the server right now.
                <span className="mt-1 block text-xs text-muted-foreground/70">
                  Type a name or license to search everyone ever seen.
                </span>
              </>
            )}
          </div>
        )}

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
  /** What the box starts with. Set by `openPlayerSearch`, cleared otherwise. */
  const [seed, setSeed] = useState('')

  /**
   * THE HINT HAS TO MATCH THE KEYBOARD IN FRONT OF THE PERSON READING IT.
   *
   * The binding has always accepted either modifier; the label was hardcoded to
   * ⌘K, so every Windows and Linux admin was told to press a key their keyboard
   * does not have.
   *
   * DETECTED AFTER MOUNT, NOT DURING RENDER. The server has no idea what the
   * viewer is typing on, so deciding this while rendering would produce one
   * answer on the server and possibly another in the browser — a hydration
   * mismatch. Starting at the cross-platform label and correcting in an effect
   * means the wrong-but-harmless answer shows for one frame instead.
   */
  const [mac, setMac] = useState(false)
  useEffect(() => {
    // `userAgentData.platform` is the modern spelling and `platform` the
    // deprecated one that still works everywhere; iPadOS reports MacIntel,
    // which is fine — it wants the ⌘ label too.
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const plat = nav.userAgentData?.platform || navigator.platform || ''
    setMac(/mac|iphone|ipad|ipod/i.test(plat))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        // Cleared, or ⌘K would refill the box with whatever a previous
        // `openPlayerSearch` seeded it with.
        setSeed('')
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** Anywhere in the app asking for the palette. See `openPlayerSearch`. */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ query?: string }>).detail
      setSeed(detail?.query ?? '')
      setOpen(true)
    }
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSeed('')
          setOpen(true)
        }}
        className="group flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-card hover:text-foreground"
        aria-label="Search players"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search players by name or license…</span>
        <CommandShortcut className="ml-auto hidden sm:inline">
          {mac ? '⌘K' : 'Ctrl K'}
        </CommandShortcut>
      </button>
      <PlayerSearch open={open} onOpenChange={setOpen} seed={seed} />
    </>
  )
}
