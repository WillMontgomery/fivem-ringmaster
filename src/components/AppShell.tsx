import Link from 'next/link'
import {
  Activity,
  CircleDot,
  FileSearch,
  Gauge,
  ScrollText,
  Settings2,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The console chrome.
 *
 * NAVIGATION MIRRORS THE MILESTONES, and the disabled entries are deliberate
 * rather than lazy. An admin panel that hides everything it cannot do yet
 * gives no sense of what it is becoming; one that shows greyed items with a
 * reason tells you where you are. They are `span`s, not links — a disabled
 * anchor is still clickable with a keyboard.
 */

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Absent when the item is live. Present = why it is not, in a tooltip. */
  soon?: string
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Observe',
    items: [
      { href: '/', label: 'Live players', icon: Users },
      { href: '/host', label: 'Host', icon: Gauge, soon: 'M3a — needs the SSH channel to the game box' },
      { href: '/anticheat', label: 'Anticheat', icon: ShieldAlert, soon: 'M5 — refusal history lands with the event stream' },
    ],
  },
  {
    group: 'Act',
    items: [
      { href: '/moderation', label: 'Kick & ban', icon: CircleDot, soon: 'M4 — the first write path, opens in Slice 2' },
      { href: '/audit', label: 'Audit log', icon: ScrollText, soon: 'M4 — written two-phase, intent before outcome' },
      { href: '/incidents', label: 'Incidents', icon: FileSearch, soon: 'M5 — reports and anticheat escalations' },
    ],
  },
  {
    group: 'Operate',
    items: [
      { href: '/config', label: 'Live config', icon: Settings2, soon: 'M6 — hot-reloadable values only' },
      { href: '/process', label: 'Process', icon: Activity, soon: 'M6 — stop and restart, the most dangerous button here' },
    ],
  },
]

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon

  const base =
    'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all duration-200'

  if (item.soon) {
    return (
      <Tooltip>
        {/* Base UI's `render` replaces Radix's `asChild`. */}
        <TooltipTrigger
          render={
            <span
              aria-disabled="true"
              className={cn(base, 'cursor-default text-muted-foreground/45')}
            />
          }
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{item.label}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/40">
            soon
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[15rem]">
          {item.soon}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={item.href}
      className={cn(
        base,
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          active ? 'text-primary' : 'text-muted-foreground/70',
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

export function AppShell({
  children,
  active = '/',
  user,
}: {
  children: React.ReactNode
  active?: string
  user?: { name: string; scopes: string[] } | null
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl md:flex">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="relative flex size-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/25">
            {/* The storm circle, which is where the name comes from. */}
            <div className="size-3.5 rounded-full border-2 border-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Ringmaster</div>
            <div className="text-[11px] text-muted-foreground">
              FiveM Royale
            </div>
          </div>
        </div>

        <Separator className="bg-sidebar-border" />

        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={item.href === active}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <Separator className="bg-sidebar-border" />

        <div className="p-3">
          {user ? (
            <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/25">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px]">{user.name}</div>
                {/*
                  Scopes, not a role. There is no "admin" in this system --
                  someone who can kick may well not be able to ban, and showing
                  the actual grant set is how they find that out before a
                  button refuses them.
                */}
                <div className="truncate text-[10px] text-muted-foreground">
                  {user.scopes.length
                    ? user.scopes.join(' · ')
                    : 'no scopes granted'}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              Not signed in
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-5 backdrop-blur-xl">
          <div className="flex items-center gap-2 md:hidden">
            <div className="size-3 rounded-full border-2 border-primary" />
            <span className="text-sm font-semibold">Ringmaster</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary/25 bg-primary/10 text-[10px] font-medium uppercase tracking-wider text-primary"
            >
              Slice 1 · read only
            </Badge>
          </div>
        </header>

        <main className="min-w-0 flex-1 animate-rise px-5 py-6">{children}</main>
      </div>
    </div>
  )
}
