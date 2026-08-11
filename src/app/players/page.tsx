import { Search } from 'lucide-react'
import Link from 'next/link'

import { AppShell } from '@/components/AppShell'
import { ProvenanceTag } from '@/components/Provenance'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { humanDuration } from '@/lib/duration'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { synthSnapshot } from '@/lib/__fixtures__/synth'

/**
 * Search everyone ever seen — not just who is on right now.
 *
 * A SEPARATE PAGE FROM THE LIVE LIST, deliberately, because they answer
 * opposite questions. The live board asks "what is happening"; this asks "who
 * is this", usually about somebody who logged off twenty minutes ago and whose
 * license is sitting in a Discord message. Folding the second into the first
 * would mean a live player list that quietly contains people who are not on
 * the server, which is the one thing that list must never do.
 *
 * The record here is the `player_seen` event stream: every license that has
 * ever connected, with its allowlisted identifiers. That stream does not exist
 * yet, so this renders the current population as stand-in rows and says so.
 */
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim().toLowerCase()

  const snap = synthSnapshot()
  const now = Date.now()

  const rows = snap.snapshot.players
    .filter(
      (p) =>
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.license?.toLowerCase().includes(query) ?? false),
    )
    .slice(0, 40)

  return (
    <AppShell active="/players" user={DEMO_USER} badges={DEMO_BADGES}>
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Player search
            </h1>
            <ProvenanceTag kind="identity" />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Everyone this server has ever seen, by name or by any identifier.
          </p>
        </div>

        <Card className="surface-edge animate-rise gap-0 px-4 py-4">
          <form method="get" className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Name, license, Discord id, Steam id…"
              className="h-11 pl-9 text-sm"
              aria-label="Search all players"
            />
          </form>
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
            Searching identifiers is the point rather than a bonus: the
            realistic moment is somebody pasting a license into Discord asking
            who this is. Note there is no IP field to search — that is never
            collected.
          </p>
        </Card>

        <Card className="surface-edge gap-0 overflow-hidden py-0">
          <header className="flex items-baseline gap-2 border-b border-border bg-card/60 px-4 py-3">
            <span className="text-sm">
              {query ? `Matches for “${q}”` : 'Recently seen'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {rows.length} shown
            </span>
          </header>

          <ul className="divide-y divide-border/60">
            {rows.map((p) => (
              <li key={p.src}>
                <Link
                  href={`/players/${encodeURIComponent(p.license ?? '')}`}
                  className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-muted/30"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{p.name}</div>
                    <code className="block truncate font-mono text-[10px] text-muted-foreground/60">
                      {p.license}
                    </code>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] text-muted-foreground">
                      on now
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground/60">
                      {humanDuration(
                        now -
                          (snap.server.wallMs +
                            (p.connectedAt - snap.server.gameMs)),
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {rows.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nobody matches “{q}”.
            </p>
          )}
        </Card>

        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          <span className="text-warn">Stand-in data.</span> These rows are the
          current population, because the durable record — the{' '}
          <code className="font-mono">player_seen</code> event stream, one row
          per license ever connected — does not exist yet. When it does, this
          page keeps its shape and stops being limited to whoever happens to be
          online.
        </p>
      </div>
    </AppShell>
  )
}
