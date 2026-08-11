import Link from 'next/link'
import {
  Activity,
  LogOut,
  CalendarClock,
  CircleDot,
  FileSearch,
  Gauge,
  ScrollText,
  Search,
  Settings2,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { FeedStatus } from '@/components/FeedStatus'
import { ThemeToggle } from '@/components/ThemeToggle'
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
 * NAVIGATION MIRRORS THE MILESTONES, and the not-yet-built entries are
 * deliberate rather than lazy. An admin panel that hides everything it cannot
 * do gives no sense of what it is becoming, so the shape of the finished tool
 * cannot be argued with until it is expensive to change. They link to
 * wireframes rather than being dead: a page that says what it will be and what
 * it is blocked on is more useful than a greyed-out word.
 */

export interface NavBadges {
  /** Incidents nobody has looked at. The number that should make you click. */
  incidents?: number
  /** A maintenance window scheduled or draining right now. */
  maintenance?: 'scheduled' | 'draining' | null
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Absent when the page is real. Present = what it is waiting on. */
  soon?: string
  badge?: (b: NavBadges) => React.ReactNode
}

/**
 * The unread-incident count.
 *
 * URGENT-COLOURED AND CAPPED. Amber rather than red because red in this
 * console means "dead", and an unreviewed report is not an emergency — it is
 * a queue. Capped at 99+ because the difference between 140 and 200 unread
 * incidents changes nothing about what you do next, and four digits wreck the
 * column.
 */
function IncidentBadge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-warn ring-1 ring-inset ring-warn/30">
      {n > 99 ? '99+' : n}
    </span>
  )
}

function MaintenanceBadge({ state }: { state: 'scheduled' | 'draining' }) {
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
        state === 'draining'
          ? 'bg-warn/15 text-warn ring-warn/30'
          : 'bg-info/15 text-info ring-info/30',
      )}
    >
      {state === 'draining' && (
        <span className="size-1.5 animate-pulse rounded-full bg-warn" />
      )}
      {state}
    </span>
  )
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Observe',
    items: [
      { href: '/', label: 'Live players', icon: Users },
      { href: '/players', label: 'Player search', icon: Search },
      { href: '/host', label: 'Host', icon: Gauge, soon: 'M3a' },
      { href: '/anticheat', label: 'Anticheat', icon: ShieldAlert, soon: 'M5' },
    ],
  },
  {
    group: 'Act',
    items: [
      { href: '/moderation', label: 'Kick & ban', icon: CircleDot, soon: 'M4' },
      {
        href: '/incidents',
        label: 'Incidents',
        icon: FileSearch,
        soon: 'M5',
        badge: (b) => <IncidentBadge n={b.incidents ?? 0} />,
      },
      { href: '/audit', label: 'Audit log', icon: ScrollText, soon: 'M4' },
    ],
  },
  {
    group: 'Operate',
    items: [
      {
        href: '/maintenance',
        label: 'Maintenance',
        icon: CalendarClock,
        soon: 'M6',
        badge: (b) =>
          b.maintenance ? <MaintenanceBadge state={b.maintenance} /> : null,
      },
      { href: '/config', label: 'Live config', icon: Settings2, soon: 'M6' },
      { href: '/process', label: 'Process', icon: Activity, soon: 'M6' },
    ],
  },
]

function NavLink({
  item,
  active,
  badges,
}: {
  item: NavItem
  active: boolean
  badges: NavBadges
}) {
  const Icon = item.icon
  const badge = item.badge?.(badges)

  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all duration-200',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : item.soon
            ? 'text-muted-foreground/55 hover:bg-sidebar-accent/40 hover:text-muted-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
    >
      {/* Active marker as a bar rather than a background alone — it survives
          being seen at the edge of vision, which a fill does not. */}
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <Icon
        className={cn(
          'size-4 shrink-0 transition-colors',
          active ? 'text-primary' : 'text-muted-foreground/60',
        )}
      />
      <span className="truncate">{item.label}</span>

      {badge ??
        (item.soon ? (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/35">
            {item.soon}
          </span>
        ) : null)}
    </Link>
  )
}

export function AppShell({
  children,
  active = '/',
  user,
  badges = {},
  feed,
}: {
  children: React.ReactNode
  active?: string
  user?: { name: string; scopes: string[] } | null
  badges?: NavBadges
  /**
   * Feed status for the header chip. Omit on pages that draw nothing from the
   * live feed — claiming "Live" above a wireframe would be a lie about data
   * that page never asked for.
   */
  feed?: {
    lastPushAt: number | null
    bootEpoch: string | null
    now: number
    /** Poll for fresh state. The real app sets it; the harness does not. */
    live?: boolean
  }
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
            <div className="text-[11px] text-muted-foreground">FiveM Royale</div>
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
                    badges={badges}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <Separator className="bg-sidebar-border" />

        <div className="p-3">
          {user ? (
            <div className="group/user flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/25">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px]">{user.name}</div>
                {/*
                  Scopes, not a role. There is no "admin" in this system —
                  someone who can kick may well not be able to ban, and showing
                  the actual grant set is how they find that out before a
                  button refuses them.
                */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="truncate text-[10px] text-muted-foreground" />
                    }
                  >
                    {user.scopes.length
                      ? user.scopes.join(' · ')
                      : 'no scopes granted'}
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[18rem]">
                    Your grants. Every action re-checks these server-side at the
                    moment it runs — hiding a button is a courtesy, not the
                    boundary.
                  </TooltipContent>
                </Tooltip>
              </div>
              {/*
                Sign out, revealed on hover. This deletes the session RECORD in
                DynamoDB via Auth.js -- which clearing cookies does not: that
                merely orphans the row until TTL. With server-side sessions,
                the button is the revocation-correct exit, not a nicety.
                focus-visible keeps it reachable by keyboard, where "revealed
                on hover" would otherwise mean "does not exist".
              */}
              <form
                action={async () => {
                  'use server'
                  const { signOut } = await import('@/auth')
                  await signOut({ redirectTo: '/login' })
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="submit"
                        aria-label="Sign out"
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/user:opacity-100"
                      />
                    }
                  >
                    <LogOut className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Sign out</TooltipContent>
                </Tooltip>
              </form>
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
            {feed && (
              <FeedStatus
                lastPushAt={feed.lastPushAt}
                bootEpoch={feed.bootEpoch}
                now={feed.now}
                live={feed.live}
              />
            )}
            {badges.maintenance && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5 border-0 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset',
                  badges.maintenance === 'draining'
                    ? 'bg-warn/10 text-warn ring-warn/30'
                    : 'bg-info/10 text-info ring-info/30',
                )}
              >
                <CalendarClock className="size-3" />
                Maintenance {badges.maintenance}
              </Badge>
            )}
            <Badge
              variant="outline"
              className="border-primary/25 bg-primary/10 text-[10px] font-medium uppercase tracking-wider text-primary"
            >
              Slice 1 · read only
            </Badge>
            <ThemeToggle />
          </div>
        </header>

        <main className="animate-rise min-w-0 flex-1 px-5 py-6">{children}</main>
      </div>
    </div>
  )
}
