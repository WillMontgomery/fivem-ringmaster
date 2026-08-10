import { Construction } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * A page that does not exist yet, drawn honestly.
 *
 * WHY BUILD THESE AT ALL. Two reasons, and neither is decoration. A console
 * whose nav is eight dead links tells you nothing about what it is becoming,
 * so the shape of the finished tool cannot be argued with until it is
 * expensive to change. And writing the layout down forces the question "what
 * data does this need" early — which is how `connectedAt` got added to the
 * wire contract before anybody had built a column that wanted it.
 *
 * They are deliberately WIREFRAMES rather than mockups with fake numbers.
 * Grey blocks cannot be mistaken for a working feature; a convincing chart
 * full of invented data can, and eventually is.
 */

export interface WireBlock {
  /** Rough height in Tailwind units, so a page has a believable rhythm. */
  h: number
  label?: string
  /** Split into columns of equal width. */
  cols?: number
}

export function Wireframe({
  title,
  milestone,
  intent,
  needs,
  blocks,
}: {
  title: string
  /** Which milestone delivers it, so "soon" has a meaning. */
  milestone: string
  /** What the page is FOR, in one or two sentences. */
  intent: string
  /** What has to exist before it can be built. The useful part. */
  needs: string[]
  blocks: WireBlock[]
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
              <Construction className="size-3" />
              {milestone}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {intent}
          </p>
        </div>
      </div>

      <Card className="surface-edge animate-rise gap-0 px-4 py-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Blocked on
        </div>
        <ul className="space-y-1.5">
          {needs.map((n) => (
            <li key={n} className="flex gap-2 text-[13px] text-muted-foreground">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/40" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="stagger space-y-3">
        {blocks.map((b, i) => (
          <div
            key={i}
            className={cn('grid gap-3', b.cols ? '' : 'grid-cols-1')}
            style={
              b.cols
                ? { gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` }
                : undefined
            }
          >
            {Array.from({ length: b.cols ?? 1 }).map((_, c) => (
              <div
                key={c}
                className="relative overflow-hidden rounded-xl border border-dashed border-border bg-card/20"
                style={{ height: `${b.h * 0.25}rem` }}
              >
                <Skeleton className="absolute inset-0 rounded-xl opacity-[0.25]" />
                {b.label && c === 0 && (
                  <span className="absolute left-3 top-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {b.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
