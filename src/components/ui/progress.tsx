"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@/lib/utils"

/**
 * INDETERMINATE IS A REAL STATE HERE, NOT A BAR PARKED AT SEVENTY PERCENT.
 *
 * Base UI already models it: `value={null}` is documented as indeterminate, it
 * drops `aria-valuenow` so a screen reader is told the amount is unknown rather
 * than told a lie, and it stamps `data-indeterminate` on every part. All of
 * that was already available through this wrapper, because `value` is passed
 * straight down.
 *
 * WHAT WAS MISSING WAS THE PICTURE. Base UI ships no styles, and its indicator
 * sets no width at all when the value is null (`ProgressIndicator.js`: the
 * inline style object is empty unless there is a percentage). So an
 * indeterminate Progress rendered a track with nothing in it — semantically
 * correct and visually absent. The `data-indeterminate:` rules below are that
 * missing half, and they are the honest shape for it: a short band that travels
 * the track and never rests at a number. A bar that filled to some fraction and
 * stopped would be inventing a completion figure we do not have.
 *
 * THE DETERMINATE PATH IS UNTOUCHED. When a value is given, Base UI writes
 * `width` as an inline style, which beats these classes; and the classes are
 * behind a data attribute that is only present when it is null anyway.
 */

function Progress({
  className,
  children,
  value,
  trackClassName,
  ...props
}: ProgressPrimitive.Root.Props & {
  /**
   * Restyle the groove the indicator runs in. The parts are exported and can
   * be composed by hand, but the convenient form above renders them itself, so
   * without this the only way to reach the track is to stop using it.
   */
  trackClassName?: string
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack className={trackClassName}>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full bg-primary transition-all",
        /*
         * The indeterminate band. `w-1/3` because Base UI leaves the width
         * unset in this state, `animate-sweep` (globals.css — the same
         * keyframe the waiting-for-data card uses) to move it, and
         * `transition-none` so the transition above does not fight the
         * animation on the same property. Rounded so it reads as an object
         * crossing the track rather than as a fill that starts at the edge.
         *
         * Reduced motion is handled in globals.css rather than here: it has to
         * beat a blanket `!important` rule, which a utility class cannot.
         */
        "data-indeterminate:w-1/3 data-indeterminate:animate-sweep data-indeterminate:rounded-full data-indeterminate:transition-none",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-sm text-muted-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
