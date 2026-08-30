'use client'

import { OctagonAlert } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  faults,
  type BundleState,
  type DdbProbe,
  type Fault,
  type Reach,
} from '@/lib/ddbHealth'
import { dispatchFaults, type Dispatch } from '@/lib/dispatchHealth'
import { cn } from '@/lib/utils'

/**
 * WHEN br_ddb IS BROKEN, ON EVERY PAGE, UNTIL IT IS NOT.
 *
 * The owner, on a failed br_ddb check: "It needs to be a critical
 * notification, a chip, and a popup on click that describes exactly what went
 * wrong and how to fix it. These elements cannot be dismissed until the problem
 * is fixed." That is three surfaces and they are all here, off one reading.
 *
 * ═══ NOTHING BLOCKS. THE GAME SERVER IS NEVER MADE TO DEPEND ON THIS ═══
 *
 * The original ask was for the game server to REFUSE TO START on a failed
 * check, and the owner withdrew it: "Let's not refuse connect for DDB, you're
 * right. But it needs to be an obvious issue". So this is loud and it is
 * inert — a console that reports. Nothing in this file can reach the game box,
 * nothing gates on it, and the game server does not know the console exists.
 *
 * ═══ HOW "UNDISMISSABLE" IS BUILT, WHICH IS BY NOT BUILDING IT ═══
 *
 * There is no dismiss control, no `dismissed` flag, no storage key and no
 * snooze. Every surface below is a plain render of `faults(reach, bundle)`,
 * which is a pure function of the two CURRENT readings — so:
 *
 *   * it cannot be dismissed, because there is nothing to dismiss;
 *   * it clears itself the poll after br_ddb recovers, because the reading
 *     changed, not because anybody acknowledged anything;
 *   * and it comes straight back if the fault returns, for the same reason.
 *
 * A dismissed-flag with a re-arm rule is the usual shape and it fails in both
 * directions: the flag outlives the fault, or the re-arm never fires and a
 * fixed problem stays on screen until somebody reloads. `check-ddb-health.mjs`
 * pins that `faults` takes readings and nothing else.
 *
 * ═══ NOT IN `chipCluster`, AND THAT IS THE POINT ═══
 *
 * `lib/serverPhase`'s cluster arbitrates the header's OTHER chips — feed,
 * deploy, update, maintenance — and its whole invariant is that exactly one of
 * them may speak, so a restart does not set off four alarms at once. Putting
 * this chip inside that rule would let a deploy in flight SUPPRESS a critical
 * database fault, which is precisely the thing that may not happen here. It
 * renders beside the cluster, subject to nothing, and `check-ddb-health.mjs`
 * asserts it is never gated on a deploy phase.
 *
 * ═══ SILENT WHEN HEALTHY, AND SILENT WHEN NOT TOLD ═══
 *
 * Both readings are three-valued and only a STATED failure produces anything.
 * A console that has not polled, a game build with no probe, a dispatcher with
 * no bundle block — all render nothing at all in the chrome. The Host page's
 * two cards carry the quiet states; this is only ever the alarm.
 *
 * ═══ AND THE SSH CHANNEL IS IN HERE TOO, RATHER THAN BESIDE IT ═══
 *
 * `lib/dispatchHealth` reads a second subsystem — the one wire this console has
 * to the game box, which carries telemetry, the branch list and every deploy —
 * and it earns exactly the treatment the owner specified for br_ddb: a card, a
 * chip, a strip and a popup, ending when the fault ends. That is this file, so
 * it renders here.
 *
 * WHAT REUSE BUYS, CONCRETELY, is not fewer lines. It is that `faults` and
 * `dispatchFaults` are the same shape, both surfaces are a render of a pure
 * function of a current reading, both share ONE poll of `/api/host`, and
 * `check-ddb-health.mjs`'s sweep of this file for `localStorage`, a `dismissed`
 * flag, a snooze and an import of `chipCluster` now protects the new alarm
 * without a line being added to it. A second file would have been a second
 * place for "undismissable" to be re-argued.
 *
 * THEY STAY TWO SUBJECTS, THOUGH, and never merge into one list. The chip says
 * which subsystem it is about, because `br_ddb` and `dispatch` are two
 * different afternoons: one is the game box's route to AWS, the other is this
 * box's route to the game box. That is the same anti-collapse rule
 * `lib/ddbHealth` keeps between reachability and the bundle, one level up.
 */

/* -------------------------------------------------------------------------- */
/* the shared reading                                                          */
/* -------------------------------------------------------------------------- */

interface Reading {
  reach: Reach
  bundle: BundleState
  probe: DdbProbe | null
  /** The SSH channel to the game box. See lib/dispatchHealth. */
  dispatch: Dispatch
  /**
   * THE POLLER'S OWN ERROR TEXT, CARRIED VERBATIM AND UNPARSED.
   *
   * It is the counterpart of `probe` above and it exists for the same stated
   * reason: an AccessDenied and a timeout are two different afternoons. Here it
   * matters more, because this string is the one that was already in
   * `/api/host`'s body throughout the outage, naming the key path and the
   * failure, while every surface showed the operator nothing.
   */
  lastError: string | null
}

const IDLE: Reading = {
  reach: 'unknown',
  bundle: 'unknown',
  probe: null,
  dispatch: 'unknown',
  lastError: null,
}

/**
 * ONE STORE FOR TWO COMPONENTS, AT MODULE SCOPE — the same shape as
 * `UpdateBadge` and for the same two reasons.
 *
 * `AppShell` is rendered by each page rather than by a layout, so every
 * client-side navigation unmounts the whole header and mounts a new one.
 * Component state would restart at "unknown" on each one — meaning a critical
 * banner would BLINK OUT on every nav click and return a round trip later,
 * which on an alert whose entire value is being impossible to miss is the worst
 * available behaviour. A module-level store survives the re-mount and the new
 * instance reads the last value synchronously on first render.
 *
 * It also means the chip and the banner cannot disagree: they are two readers
 * of one value, not two pollers.
 *
 * THE TIMER IS REFERENCE-COUNTED, so a console with no header mounted stops
 * asking, and the last value is deliberately retained when it does.
 */
let value: Reading = IDLE
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function publish(next: Reading): void {
  if (
    next.reach === value.reach &&
    next.bundle === value.bundle &&
    next.probe?.error === value.probe?.error &&
    next.dispatch === value.dispatch &&
    next.lastError === value.lastError
  ) {
    return
  }
  value = next
  listeners.forEach((l) => l())
}

async function tick(): Promise<void> {
  try {
    const res = await fetch('/api/host', { cache: 'no-store' })
    if (!res.ok) return

    const v = (await res.json()) as {
      configured?: boolean
      ddb?: { reach?: Reach; probe?: DdbProbe | null } | null
      bundle?: BundleState
      dispatch?: Dispatch
      lastError?: string | null
    }

    /**
     * AN UNCONFIGURED CONSOLE SAYS NOTHING, and it must. `GAME_HOST` unset is
     * the normal state of a development box and of the console before the game
     * host connection is set up — the Host page renders "not configured yet"
     * for exactly this — and a red database alarm across the chrome of a
     * console that was never pointed at a server is a false critical.
     *
     * IT COVERS THE DISPATCH ALARM TOO, and it is the same judgement rather
     * than a shortcut: `dispatchNow` already answers `unconfigured` for this
     * case and `dispatchFaults` already raises nothing for it, so the line
     * below is belt and braces on a state that is a setup step, not a fault.
     */
    if (!v.configured) {
      publish(IDLE)
      return
    }

    /**
     * BOTH READINGS COME RESOLVED FROM THE SERVER, and this does not re-derive
     * them. `hostView()` runs `reachNow` and `bundleNow` because the first
     * needs a clock and a clock read during a client render disagrees with the
     * one the markup was built against. Falling back to `unknown` on a payload
     * that carries neither field keeps an older console answering silence
     * rather than a guess.
     */
    publish({
      reach: v.ddb?.reach ?? 'unknown',
      bundle: v.bundle ?? 'unknown',
      probe: v.ddb?.probe ?? null,
      dispatch: v.dispatch ?? 'unknown',
      lastError: v.lastError ?? null,
    })
  } catch {
    /* leave the last value; a dropped poll is not news, and it is not a fault */
  }
}

/**
 * TEN SECONDS, WHICH IS FASTER THAN THE UPDATE CHIP AND SLOWER THAN THE FEED.
 *
 * A deploy is a minutes-scale event, so `UpdateBadge` polls at thirty. A
 * database that has fallen over is something an operator wants to see promptly
 * and, more importantly, something they want to see CLEAR promptly once they
 * have fixed it — an alarm that lingers half a minute after the fix is the
 * quickest way to teach somebody it is not to be believed. `/api/host` answers
 * from the poller's memory, so this costs one in-process read, never SSH.
 */
const POLL_MS = 10_000

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!timer) {
    timer = setInterval(() => void tick(), POLL_MS)
    void tick()
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * A harness seed. See `AppShell`'s `ddb` prop; nothing in the app passes one.
 */
export type DdbSeed = { reach: Reach; bundle: BundleState; probe?: DdbProbe | null }

/**
 * The same, for the channel. See `AppShell`'s `dispatch` prop.
 *
 * IT CARRIES THE ERROR TEXT because the popup renders it verbatim, and a
 * fixture that omitted it could not review the one thing this feature is for —
 * the difference between a card that says `Key unreadable` and a card that also
 * hands the operator `Load key "…": Permission denied`.
 */
export type DispatchSeed = { dispatch: Dispatch; lastError?: string | null }

/**
 * SERVER SNAPSHOT IS `IDLE`, NOT THE LAST VALUE. The third argument to
 * `useSyncExternalStore` is what the server renders and what the client
 * hydrates against; returning the live store there would let a value that
 * arrived between the two produce a hydration mismatch on the alarm.
 *
 * THE SEED LOSES TO THE POLL, ALWAYS, and it only ever applies while the store
 * is still untouched. In the app no seed is passed and this line does nothing;
 * on the harness no poll ever succeeds (`/api/host` is session-guarded) so the
 * fixture stands for as long as the page is open.
 *
 * ONE HOOK FOR BOTH SUBJECTS. The two derivations below take the same reading
 * and each reads only its own fields, which is what keeps the br_ddb chip and
 * the dispatch chip from being two pollers that can disagree.
 */
function useReading(seed?: Partial<Reading>): Reading {
  const r = useSyncExternalStore(subscribe, () => value, () => IDLE)
  return r === IDLE && seed ? { ...IDLE, ...seed } : r
}

function useFaults(seed?: DdbSeed): { list: Fault[]; probe: DdbProbe | null } {
  const live = useReading(seed)
  return { list: faults(live.reach, live.bundle), probe: live.probe ?? null }
}

/**
 * `dispatchFaults` TAKES THE READING AND NOTHING ELSE, and the error text is
 * handed along beside it rather than into it — exactly as `probe` is above. The
 * words the machine used are worth rendering and are worthless for deciding
 * WHICH fault this is.
 */
function useDispatchFaults(seed?: DispatchSeed): {
  list: Fault[]
  lastError: string | null
} {
  const live = useReading(seed)
  return { list: dispatchFaults(live.dispatch), lastError: live.lastError ?? null }
}

/* -------------------------------------------------------------------------- */
/* the popup                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * "A POPUP ON CLICK THAT DESCRIBES EXACTLY WHAT WENT WRONG AND HOW TO FIX IT."
 *
 * THE ONE PLACE IN THIS CONSOLE THAT IS ALLOWED PROSE, because the owner asked
 * for it by name. It is held to what he asked for: what broke, and the steps.
 * No background on what the checks mean, no caveats about what they prove, no
 * empty-state copy — that reasoning is in `lib/ddbHealth`'s comments, where it
 * costs a reader nothing.
 *
 * IT CLOSES; THE ALARM DOES NOT. Closing this dialog dismisses a dialog. The
 * chip and the banner are rendered from the reading and are still there behind
 * it, which is the distinction between "I have read the instructions" and "the
 * database is fine now".
 *
 * ═══ EXPORTED, BECAUSE THE HOST PAGE'S CARD OPENS THIS ONE ═══
 *
 * The dispatch card carries the poller's error truncated to a line, and the
 * full text has to be reachable from there. It opens THIS dialog rather than
 * one of its own, so the popup an operator reaches from the card, from the chip
 * and from the strip is the same popup with the same steps — and so there is
 * one place that decides how a long ssh command line is rendered.
 */
export function FaultDialog({
  open,
  onOpenChange,
  list,
  probe = null,
  lastError = null,
  many,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  list: Fault[]
  probe?: DdbProbe | null
  /** The poller's own error text, for the `dispatch-*` faults. */
  lastError?: string | null
  /**
   * The title when more than one fault is showing. OPTIONAL, AND ABSENT MEANS
   * THE FIRST FAULT'S OWN TITLE — the dispatch states are mutually exclusive,
   * so its list is never longer than one and inventing a plural sentence for a
   * case that cannot happen would be copy nobody asked for.
   */
  many?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <OctagonAlert className="size-4 text-danger" />
            {list.length === 1 ? list[0]!.title : (many ?? list[0]?.title)}
          </DialogTitle>
        </DialogHeader>

        {/* Outside DialogDescription deliberately: Base UI renders that as a
            <p>, and this body is block content. See ConfirmDialog. */}
        <div className="space-y-5">
          {list.map((f) => (
            <div key={f.id} className="space-y-2">
              {list.length > 1 && (
                <div className="text-sm font-medium text-danger">{f.title}</div>
              )}
              <p className="text-sm text-muted-foreground">{f.detail}</p>

              {/*
                THE GAME'S OWN WORDS FOR THE FAILURE, when it gave any. This is
                the line that turns "DynamoDB is unreachable" into something
                actionable — an AccessDenied and a timeout are two different
                afternoons — and it is the reason the probe travels beside the
                verdict instead of being reduced to a boolean at the source.
              */}
              {f.id === 'ddb-unreachable' && probe && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/40 p-3 text-xs">
                  {probe.error ? (
                    <>
                      <dt className="text-muted-foreground">error</dt>
                      <dd className="font-mono break-all">{probe.error}</dd>
                    </>
                  ) : null}
                  {probe.region ? (
                    <>
                      <dt className="text-muted-foreground">region</dt>
                      <dd className="font-mono">{probe.region}</dd>
                    </>
                  ) : null}
                  {probe.prefix ? (
                    <>
                      <dt className="text-muted-foreground">table prefix</dt>
                      <dd className="font-mono">{probe.prefix}</dd>
                    </>
                  ) : null}
                  {typeof probe.ms === 'number' ? (
                    <>
                      <dt className="text-muted-foreground">round trip</dt>
                      <dd className="font-mono">{probe.ms}ms</dd>
                    </>
                  ) : null}
                </dl>
              )}

              {/*
                ═══ THE STRING THE APP HAD ALL ALONG ═══

                This is `lastError` out of `/api/host`, rendered exactly as it
                arrived. During the outage it read

                  Command failed: ssh -i /opt/ringmaster-secrets/dispatch …
                  Load key "…/dispatch": Permission denied
                  ubuntu@10.1.148.227: Permission denied (publickey,password).

                and finding it meant opening browser devtools. Everything above
                this block — the state, the title, the steps — is derived FROM
                this string, so it is the one thing on the page that cannot be
                wrong about what happened.

                `whitespace-pre-wrap` RATHER THAN THE `<dl>` TREATMENT ABOVE.
                The probe error is one AWS sentence; this is several lines, and
                ssh puts the cause on its own line. Collapsing it would run
                `Load key "…": Permission denied` into the middle of a hundred
                characters of command line, which is precisely how it went
                unread the first time. `break-all` keeps the unbroken key path
                inside the dialog; `max-h-48` keeps a long command line from
                pushing the steps off the bottom of the screen, and it scrolls.

                IT IS HERE AND NOT IN THE CHROME'S STRIP, deliberately: it
                contains a key path and the game box's private address. This
                console's audience already has both, so the constraint is not
                secrecy — it is that a full ssh command line is not a headline.
              */}
              {f.id.startsWith('dispatch-') && lastError && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-3 font-mono text-xs">
                  {lastError}
                </pre>
              )}

              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {f.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* the chip                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The header chip. Renders nothing at all unless something is stated broken.
 *
 * `--danger`, WHICH NOTHING ELSE IN THIS HEADER WEARS AT REST. `Update failed`
 * and `Server not back` use it too, and that is correct company: those are the
 * other two "a thing you were relying on is not working" states. Everything
 * routine in the cluster is info, warn or muted.
 *
 * ═══ ICON-ONLY BELOW `xl`, WHICH WAS MEASURED RATHER THAN CHOSEN ═══
 *
 * THE WORD WAS GOING TO STAY AT EVERY WIDTH. The argument was that narrow
 * overwhelmingly means touch, where the tooltip `UpdateBadge` recovers its
 * meaning from never fires, so a bare red dot in a header is not a
 * notification. THE ARGUMENT WAS RIGHT AND THE LAYOUT SAID NO: at 375px the
 * header cluster is already 178px of `Falling behind` plus `scheduled` plus the
 * theme toggle, and adding 84px of chip took the document to 381px against a
 * 375px viewport — a horizontally scrolling console, on the one page whose
 * card grid is measured at that width to three significant figures.
 *
 * SO IT FOLLOWS `UpdateBadge` AND THE MAINTENANCE CHIP TO `xl`, and what makes
 * that acceptable HERE is the thing those two do not have: a banner directly
 * underneath, in words, spanning the full width, at every breakpoint. The chip
 * is never the only statement of this fault, so below `xl` it is a marker
 * pointing at a notification that is already saying the sentence — which is
 * exactly the case a tooltip is a poor substitute for and a banner is not.
 * `sr-only` rather than `hidden`, so the word never leaves the accessibility
 * tree and the button is not an unlabelled icon to a screen reader.
 */
export function DdbHealthChip({ seed }: { seed?: DdbSeed }) {
  const { list, probe } = useFaults(seed)
  const [open, setOpen] = useState(false)

  if (list.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-danger/10 px-2 py-1',
          'text-xs font-semibold uppercase tracking-wider text-danger',
          'ring-1 ring-inset ring-danger/30 transition-colors hover:bg-danger/20',
        )}
      >
        <OctagonAlert className="size-3" />
        <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">br_ddb</span>
      </button>
      <FaultDialog
        open={open}
        onOpenChange={setOpen}
        list={list}
        probe={probe}
        many="br_ddb has two problems"
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* the notification                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The critical notification: a strip across every page, under the header.
 *
 * A BANNER RATHER THAN A TOAST, and the reason is the owner's own requirement.
 * A toast is dismissible by construction — it has a close button and it expires
 * on a timer — so "cannot be dismissed until the problem is fixed" cannot be
 * built out of one without fighting it. A strip in the chrome is rendered from
 * the reading on every page, has no close control, and ends when the reading
 * ends. `sonner` is already installed and is used for the update announcement,
 * which is news; this is a condition.
 *
 * ABOVE THE OFF-MAIN BANNER, on the one occasion both are showing. That one
 * says the code is unreviewed; this one says bans are not being checked and
 * match results are not being saved. `role="alert"` rather than `role="status"`
 * for the same reason — this is the console's only assertive live region.
 *
 * THE ROLE IS ON THE WRAPPER AND THE BUTTON IS INSIDE IT, which was a lint
 * failure before it was a decision. `role="alert"` on the `<button>` itself
 * REPLACES the button role: `aria-haspopup` becomes invalid on it (which is
 * what `jsx-a11y/role-supports-aria-props` reported) and, far worse, a screen
 * reader stops announcing the strip as something you can press. The live region
 * and the control are two jobs and they now sit on two elements, with the
 * button filling the wrapper so nothing changes visually.
 *
 * THE WHOLE STRIP IS THE TRIGGER. The owner asked for "a popup on click", and a
 * small link inside a red bar is a smaller target than the bar; on touch it is
 * a much smaller one. The bar is the button.
 */
export function DdbHealthBanner({ seed }: { seed?: DdbSeed }) {
  const { list, probe } = useFaults(seed)
  const [open, setOpen] = useState(false)

  if (list.length === 0) return null

  return (
    <div role="alert" className="border-b border-danger/30 bg-danger/10">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        /*
          `hover:bg-danger/20`, WHICH IS THE CHIP'S HOVER RATHER THAN A SHADE
          PICKED FOR THIS STRIP. `/15` was the first choice and `check:cef`
          refused it: every tinted token fill needs an entry in the CEF 103
          override block at the end of globals.css, or the tint collapses to an
          OPAQUE fill in the in-game console and the strip becomes a solid red
          bar with its own text invisible inside it. `/20` is already in that
          list, is already what this feature's chip hovers to, and adding a
          twenty-second entry to buy a 5% difference nobody can see would have
          been the worse trade.
        */
        className="block w-full px-5 py-2.5 text-left transition-colors hover:bg-danger/20"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <OctagonAlert className="size-4 shrink-0 text-danger" />
          <span className="font-medium text-danger">
            {list.length === 1 ? list[0]!.title : 'br_ddb has two problems'}
          </span>
          <span className="text-muted-foreground underline decoration-dotted underline-offset-4">
            What went wrong, and how to fix it
          </span>
        </div>
      </button>
      <FaultDialog
        open={open}
        onOpenChange={setOpen}
        list={list}
        probe={probe}
        many="br_ddb has two problems"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* the same two surfaces, for the channel                                      */
/* -------------------------------------------------------------------------- */

/**
 * The header chip for the SSH channel. Silent unless the channel is stated
 * broken, exactly like the one above.
 *
 * ═══ A SEPARATE CHIP RATHER THAN A SECOND ENTRY IN THE br_ddb ONE ═══
 *
 * They are two subsystems on two transports and the chip is where the operator
 * learns WHICH. `br_ddb` is the game box's route to DynamoDB, measured by the
 * game and pushed here; `dispatch` is this box's route to the game box, and
 * when it is down the console cannot read telemetry, list branches or deploy.
 * A single chip covering both would be the "one light for two facts" defect
 * `lib/ddbHealth` was written against, one level up.
 *
 * IN PRACTICE THEY RARELY BOTH SPEAK. Reachability rides the ingest push and
 * the bundle rides the `status` verb — so when this channel dies the bundle
 * reading goes `unknown` and falls silent by itself, which is the correct
 * behaviour and not a coincidence: it is the same rule that an absence is never
 * a failure.
 *
 * ICON-ONLY BELOW `xl`, FOLLOWING THE br_ddb CHIP, AND FOR ITS MEASURED REASON.
 * At 375px the header cluster has no room for a word, and this chip is never
 * the only statement of the fault — the strip below is saying it in words at
 * every width, and the Host page carries the message itself.
 */
export function DispatchHealthChip({ seed }: { seed?: DispatchSeed }) {
  const { list, lastError } = useDispatchFaults(seed)
  const [open, setOpen] = useState(false)

  if (list.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-danger/10 px-2 py-1',
          'text-xs font-semibold uppercase tracking-wider text-danger',
          'ring-1 ring-inset ring-danger/30 transition-colors hover:bg-danger/20',
        )}
      >
        <OctagonAlert className="size-3" />
        <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">dispatch</span>
      </button>
      <FaultDialog
        open={open}
        onOpenChange={setOpen}
        list={list}
        lastError={lastError}
      />
    </>
  )
}

/**
 * The critical notification for the channel: the same strip, under the br_ddb
 * one on the vanishingly rare page load where both are up.
 *
 * WHY IT IS SECOND. br_ddb being down means bans are not checked at connect and
 * match results are not being saved — players are affected while nobody acts.
 * This being down means the console is blind and cannot deploy, which is
 * serious and is a tool, not a live service. The order is the same judgement
 * that put br_ddb above the off-main banner.
 *
 * IT CARRIES THE TITLE AND NOT THE ERROR TEXT. The strip is on every page and
 * the error is a multi-line ssh command line naming a key path and the game
 * box's address — a headline it is not. The full text is one click away in the
 * popup, and it is printed on the Host page itself, which is where somebody
 * looking at this problem is going next.
 *
 * NOTHING HERE IS DISMISSIBLE, for the reason the br_ddb strip is not: it is a
 * render of `dispatchFaults(reading)`, so it ends when the channel comes back
 * and returns if it goes again. There is no close control because there is no
 * state to close.
 */
export function DispatchHealthBanner({ seed }: { seed?: DispatchSeed }) {
  const { list, lastError } = useDispatchFaults(seed)
  const [open, setOpen] = useState(false)

  if (list.length === 0) return null

  return (
    <div role="alert" className="border-b border-danger/30 bg-danger/10">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        /* `/20` for the reason the br_ddb strip uses it: it is already in the
           CEF 103 override block, and a tint that is not collapses to an opaque
           red bar with its own text invisible inside it in the pause menu. */
        className="block w-full px-5 py-2.5 text-left transition-colors hover:bg-danger/20"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <OctagonAlert className="size-4 shrink-0 text-danger" />
          <span className="font-medium text-danger">{list[0]!.title}</span>
          <span className="text-muted-foreground underline decoration-dotted underline-offset-4">
            What went wrong, and how to fix it
          </span>
        </div>
      </button>
      <FaultDialog
        open={open}
        onOpenChange={setOpen}
        list={list}
        lastError={lastError}
      />
    </div>
  )
}
