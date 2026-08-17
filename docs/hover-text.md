# Hover text

**Hover text is a fallback, and no fact may live only there.**

This console had nine native `title` attributes, nine tooltips and exactly one hover
card, with nothing written down about which was for what. This is what was written
down.

---

## The rule

### 1. DOM floor

Every string a reader needs must exist in the markup — visible, or `sr-only` and
associated with a control via `aria-describedby`. Only after that may it *also*
appear on hover.

This is not a stylistic preference. In Base UI 1.7.0, verified in
`node_modules` and then in a browser:

- Both triggers set `mouseOnly: true` on their **hover** interaction, so hover
  never fires for touch or pen. Neither component reaches a phone.
- Both also wire `useFocus`, so on a genuinely focusable trigger the popup
  **does** open on `:focus-visible`. Confirmed with a real Tab press on a filter
  chip. On an inert `<span>` trigger it cannot, because nothing focuses.
- But the popup carries **no `role="tooltip"` and no `aria-describedby`** — zero
  occurrences in either package. It is never associated with its trigger, so a
  screen reader is told nothing by it, open or closed.

So the popup serves sighted mouse users, plus sighted keyboard users where the
trigger is a real control. It is never the only copy of anything.
`PlayerTable`'s `FilterChip` is the worked example: the string renders twice, in
one component, so neither half can be deleted without seeing the other — and
there `aria-describedby` points at the `sr-only` copy, never at the popup, which
is what makes the chip announce as "All 26, Everyone connected, whatever they
are doing".

### 2. If the words fit next to the thing, put them there

A one-word noun on an already-rendered value costs a string literal. A tooltip
costs a wrapper, two imports, a portal, and still shows nothing on a phone.
`{humanDuration(m.survivedMs)} alive` beats a popup that says "How long they
stayed alive".

### 3. If the control already says it, delete it

A `title` duplicating an `aria-label` on the same element is noise.

### 4. `Tooltip` = one short phrase on a real control

About six words, on something a keyboard can focus — that is not decoration, it
is the difference between a popup that opens on `:focus-visible` and one that
only ever opens for a mouse. `TooltipContent` is a single-line pill; a sentence
does not survive in it. On an inert trigger a tooltip is permitted only with the
same text present as `sr-only`.

### 5. `HoverCard` = content with real internal structure

A header row, a body, a footer. **A card is a layout, not an emphasis level.** A
single sentence does not get promoted to a 256px card for being important. It
gets moved there for having parts. `FeedStatus` and `Provenance` are the two.

### 6. The native `title` attribute is banned on DOM elements

No exceptions. It cannot be selected, cannot be focused, is never announced, and
never fires on touch. A machine value belongs in a machine-readable attribute —
`<time dateTime>` — not in a tooltip.

> This does **not** touch the `title` **props** on this app's own components.
> `Section`, `SectionHead`, `ConvarGroup`, `ConfirmDialog`, `CommandDialog` and
> `Wireframe` all take a `title` prop, and every one of them is a heading or an
> accessible name. A grep for `title=` returns both kinds; read each hit and
> classify it. In particular **`PlayerSearch.tsx` `title="Search"` is the
> accessible name of the command palette dialog** and looks more like a tooltip
> than anything that actually was one.

### 7. Delays are per-trigger, not global

`delay` and `closeDelay` are props on `TooltipTrigger` and on
`PreviewCardTrigger`, not only on the tooltip `Provider`. Do not nest a second
`TooltipProvider` to tune one site, and never choose between the two components
on the grounds that "the delays feel different".

The one `TooltipProvider` lives at `src/app/layout.tsx`. `HoverCard` has no
provider in Base UI and needs none.

---

## What happened to the nine

| Site | Became |
|---|---|
| `LocalTime.tsx` | `<time dateTime>` + optional visible UTC |
| `AuditList.tsx` | folded into `LocalTime`, UTC now visible below the local time |
| `IncidentQueue.tsx` | inline — `3d waiting` |
| `ProfileView.tsx` placement badge | conditional `Tooltip` + `sr-only` |
| `ProfileView.tsx` survived | inline — `12m 4s alive` |
| `PlayerTable.tsx` filter chips | `Tooltip` + `sr-only` / `aria-describedby` |
| `AppShell.tsx` maintenance badge | `sr-only xl:not-sr-only` |
| `MaintenancePanel.tsx` revert | visible sentence under the button |
| `ui/sidebar.tsx` rail | deleted |

One tooltip also became a hover card: `Provenance.tsx`, which had four
two-sentence paragraphs in a single-line pill.

### Three traps this cost us, worth not rediscovering

- **A disabled button eats pointer events.** A native `title` fires on a
  `disabled` button; a `TooltipTrigger` does not. Converting one deletes the
  explanation in exactly the state that needed explaining. Render a visible
  sentence instead. Do not switch to `aria-disabled` with a guarded handler —
  that is a button that looks dead and still fires.
- **`TooltipTrigger` renders a `<button>` by default; `HoverCardTrigger` renders
  an `<a>`.** A default tooltip trigger inside a row `<Link>` nests a button in
  an anchor. Pass `render={<span … />}` — that is the repo idiom.
- **`aria-label` is not a place to put an explanation.** Appending the
  description to the visible label breaks WCAG 2.5.3 Label in Name and stops
  voice control from working. Use a separate `sr-only` element, placed *outside*
  the control so it does not join the accessible name, and point at it with
  `aria-describedby`.

---

## Known gaps

- **The incident timeline does not show UTC**, though it was meant to. Its
  timestamp sits mid-line with the author after it, and the stacked UTC is a
  block box that splits the inline flow and drops the author onto its own line.
  Enabling `utc` there needs that line restructured first.

- **Touch is still unfixed** for every site that remains a hover affordance. Only
  the inline conversions improved anything on a phone; this work should not be
  described as an accessibility win. The mechanism that would work is `Popover`
  with `openOnHover`. `@base-ui/react/popover` is already installed and
  `src/components/ui/` has no `popover.tsx`, so that is a new file, not a new
  dependency.
- **`PlayerRow.tsx`** uses a `Tooltip` as a copy-confirmation toast on a
  `setTimeout`, invisible to the keyboard user who just pressed Enter. `sonner`
  is already mounted in the root layout.
- **`PlayerActions.tsx`** has the disabled-button defect twice more, worked
  around with a bare wrapper `<span>` that restores the mouse case and nothing
  else.
- **There is no lint rule behind any of this.** An ESLint rule banning the
  `title` JSX attribute on DOM elements — allowlisting `<iframe>`/`<svg>`, never
  matching component props — is what would keep it from decaying, but the repo
  has no ESLint config at all, so that is a bootstrap task of its own.
