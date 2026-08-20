import { Progress } from '@/components/ui/progress'

/**
 * What a page shows while its data is still on the way.
 *
 * ═══ WHY THIS IS NOT A `loading.tsx` ═══
 *
 * The file convention is the idiomatic App Router answer and it was the first
 * thing tried. It does not work HERE, for a reason specific to this codebase:
 * `loading.tsx` installs its Suspense boundary around the page and INSIDE the
 * nearest layout — and the only layout in this app is the root one, which
 * emits `<html>` and nothing else. `AppShell` is rendered by each page. So the
 * segment fallback replaces the sidebar and the header along with the page
 * body, and a reader who clicks Audit log gets an empty window with a bar in
 * it until the query returns.
 *
 * MEASURED RATHER THAN REASONED ABOUT. Sampling the DOM every 100ms across a
 * five-second navigation: with a segment-level `loading.tsx`, the sidebar's
 * link count was 0 for the whole load. With the boundary moved inside the page,
 * as below, it was 9 for the whole load and the bar appeared in the body inside
 * 205ms. Same indicator, same timing, no flash.
 *
 * SO EACH PAGE SPLITS ITSELF: the session check and `AppShell` stay in the
 * default export, and everything that awaits data moves into a `Body` under a
 * `<Suspense fallback={<PageLoading />}>`. The one cost is a little ceremony
 * per page; the one bonus is that `AppShell`'s own badge reads and the page's
 * data reads now overlap instead of running back to back.
 *
 * A note for whoever adds the next page: a boundary only shows this when the
 * thing under it actually suspends. Four routes — the live board, anticheat,
 * host and settings — read their data out of memory or a cookie and resolve in
 * the same tick, so the bar correctly never appears on them. That is the
 * requirement working, not the wiring being broken.
 *
 * INDETERMINATE, DELIBERATELY. We know the page is not ready; we do not know
 * how close it is, and there is no way to find out — the work is a session
 * lookup plus one or more DynamoDB reads, none of which report progress. A bar
 * that eased to seventy percent and waited would look better and would be
 * stating a figure nobody measured. See `ui/progress.tsx` for the state Base UI
 * provides and the styling this repo had to add on top of it.
 *
 * NO TEXT UNDER IT. `aria-label` is the whole accessible name, because a
 * progress bar with no value and no name is announced as an unlabelled widget;
 * that attribute is markup for a screen reader, not a line of copy on screen.
 *
 * THE HEIGHT IS WHY IT LOOKS CENTRED. `<main>` in AppShell is a flex child that
 * only grows to fit its content, so a bare `items-center` would centre the bar
 * inside a box the height of the bar — pinned under the header. The calc fills
 * the rest of the window instead: 7rem is the header plus main's own vertical
 * padding, measured. It is an approximation by design — the off-main banner can
 * push main down a little — and being a few pixels off centre is invisible,
 * where being anchored to the top would not be.
 *
 * `svh` rather than `vh` so a mobile browser's collapsing address bar does not
 * make the page scroll to hold a loading indicator.
 */
export function PageLoading() {
  return (
    <div className="flex min-h-[calc(100svh-7rem)] w-full items-center justify-center">
      <Progress
        value={null}
        aria-label="Loading"
        className="w-56 max-w-[70vw]"
        /*
         * NO GROOVE, WHICH IS BOTH THE HONEST DRAWING AND THE READABLE ONE.
         *
         * The primitive fills its track with `--muted`, and that is right for a
         * determinate bar: the unfilled part of the groove is the part still to
         * do, and there IS a part still to do. Here there is not. We do not
         * know the total, so a groove would be drawing the remainder of a
         * quantity nobody has — the same invention as parking the bar at
         * seventy percent, just quieter.
         *
         * IT IS ALSO WHAT CLEARS THE CONTRAST FLOOR. Measured off globals.css
         * with the repo's own `contrastRatio`, the band against its neighbour:
         *
         *   track            light bg   light card   dark bg   dark card
         *   --muted            5.31       —            4.14      —      FAIL
         *   primary at 15%     4.66       4.86         4.37      4.02   FAIL
         *   primary at 5%      5.40       5.64         4.85      4.53   ok
         *   none (this)        5.80       6.05         5.04      4.75   ok
         *
         * `--primary` in the dark theme sits close to `--muted` in luminance,
         * so any wash between the two pulls the band under 4.5:1. Removing the
         * fill leaves the page itself as the neighbour, which is the widest gap
         * available and the only one with margin in it.
         */
        trackClassName="bg-transparent"
      />
    </div>
  )
}
