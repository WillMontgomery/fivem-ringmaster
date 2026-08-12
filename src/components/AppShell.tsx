import Link from 'next/link'
import {
  Activity,
  LogOut,
  CalendarClock,
  CircleDot,
  FileSearch,
  Gauge,
  ScrollText,
  Settings2,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { FeedStatus } from '@/components/FeedStatus'
import { PlayerSearchTrigger } from '@/components/PlayerSearch'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UpdateBadge } from '@/components/UpdateBadge'
import { UpdateWatcher } from '@/components/UpdateWatcher'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DEMO_BADGES } from '@/lib/demo'
import { currentAdmin } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * The console chrome.
 *
 * BUILT ON shadcn's Sidebar rather than the hand-rolled rail this replaced.
 * The hand-rolled one looked the part but had none of the behaviour: no
 * collapse, no persistence, no mobile sheet, no keyboard affordance. Those are
 * exactly the things you do not notice missing until you are working in the
 * tool at 2am on a laptop. The real component brings icon-mode collapse
 * (cookie-persisted, so it survives a reload), a rail you can drag, ⌘B, and a
 * proper off-canvas sheet on mobile.
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
    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-warn ring-1 ring-inset ring-warn/30">
      {n > 99 ? '99+' : n}
    </span>
  )
}

function MaintenanceBadge({ state }: { state: 'scheduled' | 'draining' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
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
      { href: '/host', label: 'Host', icon: Gauge },
      { href: '/anticheat', label: 'Anticheat', icon: ShieldAlert, soon: 'M5' },
    ],
  },
  {
    group: 'Act',
    items: [
      { href: '/moderation', label: 'Kick & ban', icon: CircleDot },
      {
        href: '/incidents',
        label: 'Incidents',
        icon: FileSearch,
        soon: 'M5',
        badge: (b) => <IncidentBadge n={b.incidents ?? 0} />,
      },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
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

export async function AppShell({
  children,
  active = '/',
  user,
  badges,
  feed,
}: {
  children: React.ReactNode
  active?: string
  /**
   * The signed-in user for the sidebar. Omit it and the shell resolves the
   * real admin itself — so every page shows the actual person, avatar and all,
   * without each one threading `currentAdmin()` through. Pass it explicitly
   * (the live board and host page do) to avoid a second lookup, or pass `null`
   * to force the signed-out state (the preview harness).
   */
  user?: { name: string; avatarUrl?: string | null } | null
  /**
   * Badge counts. Defaults rather than being required, because a badge that
   * appears only on the pages that remembered to pass it is worse than none —
   * the whole point is that an unread incident is visible from wherever you
   * happen to be standing.
   */
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
  const resolvedUser =
    user === undefined
      ? await currentAdmin().then((a) =>
          a ? { name: a.name, avatarUrl: a.avatarUrl } : null,
        )
      : user

  // Placeholder counts until M5 (incidents) and M6 (maintenance) produce real
  // ones. Centralised here so there is exactly one line to change then.
  const b = badges ?? DEMO_BADGES

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="sidebar-surface">
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/25">
              {/* The storm circle, which is where the name comes from. */}
              <div className="size-3.5 rounded-full border-2 border-primary" />
            </div>
            <div className="leading-tight group-data-[collapsible=icon]:hidden">
              <div className="text-sm font-semibold">Ringmaster</div>
              <div className="text-[11px] text-muted-foreground">
                Blitz Royale
              </div>
            </div>
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {NAV.map((section) => (
            <SidebarGroup key={section.group}>
              <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const badge = item.badge?.(b)
                    return (
                      <SidebarMenuItem key={item.href}>
                        {/* Base UI takes `render`, not Radix's `asChild` — the
                            same difference that bites every shadcn snippet
                            copied from the docs into this app. */}
                        <SidebarMenuButton
                          render={<Link href={item.href} />}
                          isActive={item.href === active}
                          tooltip={item.label}
                          className={cn(item.soon && 'text-muted-foreground/60')}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {badge ? (
                          <SidebarMenuBadge>{badge}</SidebarMenuBadge>
                        ) : item.soon ? (
                          <SidebarMenuBadge className="text-[10px] uppercase tracking-wider text-muted-foreground/40">
                            {item.soon}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          {resolvedUser ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="group/user flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:px-0">
                  {/* Discord avatar when we have one, initials as the fallback
                      — a broken image on an admin's own name reads as
                      "something is wrong with my account", so the fallback is a
                      real design state, not an afterthought. */}
                  {resolvedUser.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolvedUser.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      className="size-7 shrink-0 rounded-full object-cover ring-1 ring-inset ring-primary/25"
                    />
                  ) : (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/25">
                      {resolvedUser.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                    <div className="truncate text-sm">{resolvedUser.name}</div>
                  </div>
                  {/*
                    Sign out, revealed on hover. This deletes the session RECORD
                    in DynamoDB via Auth.js -- which clearing cookies does not:
                    that merely orphans the row until TTL. With server-side
                    sessions, the button is the revocation-correct exit, not a
                    nicety. focus-visible keeps it reachable by keyboard, where
                    "revealed on hover" would otherwise mean "does not exist".
                  */}
                  <form
                    className="group-data-[collapsible=icon]:hidden"
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
              </SidebarMenuItem>
            </SidebarMenu>
          ) : (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              Not signed in
            </div>
          )}
        </SidebarFooter>

        {/* The drag rail — the affordance that makes collapse discoverable. */}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-5 backdrop-blur-xl">
          <SidebarTrigger className="-ml-1.5" />

          <PlayerSearchTrigger />

          <div className="ml-auto flex items-center gap-2">
            {feed && (
              <FeedStatus
                lastPushAt={feed.lastPushAt}
                bootEpoch={feed.bootEpoch}
                now={feed.now}
                live={feed.live}
              />
            )}
            <UpdateBadge />
            {b.maintenance && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5 border-0 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset',
                  b.maintenance === 'draining'
                    ? 'bg-warn/10 text-warn ring-warn/30'
                    : 'bg-info/10 text-info ring-info/30',
                )}
              >
                <CalendarClock className="size-3" />
                Maintenance {b.maintenance}
              </Badge>
            )}
            <ThemeToggle />
          </div>
        </header>

        {/* Announces an available update once per session, and again whenever
            one appears while the console is open. */}
        <UpdateWatcher />

        <main className="animate-rise min-w-0 flex-1 px-5 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
