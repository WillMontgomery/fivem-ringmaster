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

**The component library is Base UI, not Radix.** `@base-ui/react`, pinned at
**1.7.0** in `package-lock.json`; there is no `@radix-ui/*` package in this repo
at all. That matters on every line below, and it matters most when you go
looking for help: nearly all shadcn material on the internet assumes Radix, and
the two differ in the one prop this document leans on hardest —
**`render={<span … />}`, never Radix's `asChild`.** Generating a component from
the shadcn registry without checking will hand you the Radix variant.

This is not a stylistic preference. In Base UI 1.7.0, verified in
`node_modules` and then in a browser:

- Both triggers set `mouseOnly: true` on their **hover** interaction, so hover
  never fires for touch or pen. Neither component reaches a phone.
- Both also wire `useFocus`, so on a genuinely focusable trigger the popup
  **does** open on `:focus-visible`. Confirmed with a real Tab press on a filter
  chip, back when the filter chips still had a tooltip to open. On an inert
  `<span>` trigger it cannot, because nothing focuses.
- But the popup carries **no `role="tooltip"` and no `aria-describedby`** — zero
  occurrences in either package. It is never associated with its trigger, so a
  screen reader is told nothing by it, open or closed.

So the popup serves sighted mouse users, plus sighted keyboard users where the
trigger is a real control. It is never the only copy of anything.
`ProfileView`'s `Face` is the worked example: one sentence, built once and
rendered twice — into the popup, and into an `sr-only` span beside the trigger.

**`PlayerTable`'s `FilterChip` used to be the example here, and is not any
more.** It was this console's only `aria-describedby`, pointing each chip at its
own `sr-only` copy so it announced as "All 26, Everyone connected, whatever they
are doing". The owner then cut the descriptions outright — *"We don't need
descriptors for those tabs"* — and the tooltip, the `sr-only` span and the
`aria-describedby` went with them, because **an `aria-describedby` aimed at a
blank or absent element is a broken reference, not a kindness**: the reader
hears nothing and an audit sees a defect where the truth is a deliberate
absence. A grep for `aria-describedby=` now returns nothing at all.

That is rule 8 outranking rule 1, in the order this document already sets out:
rule 1 governs where a string goes *once it exists*. When the answer is that it
should not exist, the wiring goes too — it is not emptied and left in place.

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
gets moved there for having parts.

**There are four sites, in three files** — `Provenance.tsx`, two in
`ProfileView.tsx`, and one in `IncidentTimeline.tsx`. A grep for `<HoverCard`
returns exactly those.

Two are gone and two are new since this list was last written, so the count has
moved from three to four and the membership has not otherwise:

- **`FeedStatus`** held the first card in the app, and the component was deleted
  when the owner asked for the live/falling-behind/feed-lost chips to be hidden;
  the state it read (`lastPushAt`) survived it and is now what proves a deployed
  server has come back. See `lib/serverPhase`.

  **The component is back and the card is not** ("yes please put the live chip
  back"). What they asked for is the chip — a tone and a word — and the card was
  "Last update: 4.2s ago" over "The board refreshes every 2s", which rule 8
  forbids restoring and rule 5's closing line forbids re-adding in that shape:
  it was a chip-shaped card whose only affordance was `cursor-help`. So the
  count is still three, and this entry stays on the list of what is gone. The
  exact age in seconds is what was lost with it; if the owner wants a number
  back it is theirs to ask for, in their own words.
- **`Provenance`** is the oldest survivor: four two-sentence paragraphs that had
  been crammed into a single-line tooltip.
- **`ProfileView`'s `IdLabel`** was the first that was a *label* rather than a
  chip — the "Display name" and "In-game name" rows of the identifiers panel,
  each a heading, what the row was, and the trap it warned about. **It is gone
  too.** Those two rows merged into one "Other names" row at the owner's request,
  which left it with no call sites, and a merged descriptor would have been copy
  nobody asked for. See rule 8.
- **The ban chip on the profile** is the worked example of rule 1 on a card
  rather than a tooltip. Its three rows — reason, who issued it, how long — are a
  `<dl>` in the popup *and* an `sr-only` sentence inside the trigger, so the
  screen-reader user gets the same three facts the popup carries. It also earns
  its own affordance: `cursor-help` alone only pays out once the pointer is
  already there, so the word "Banned" carries a dotted underline.
- **The names in "Other names"**, one card per name, are the newest and the one
  that bends this rule rather than satisfying it. Each is one line, no heading, no
  second paragraph. **That is a tooltip's shape in a card's component**, and it is
  deliberate: the owner asked for a hover card by name ("Each name should have its
  own hover card which reads 'known as X until Y'"), and rule 8 forbids inventing
  the extra parts that would have earned one. Every `sr-only` copy carries the
  same sentence with the UTC instant, because `LocalTime` renders an element
  rather than a string.

  **Two sentences, both the owner's, in one list** — because past names have an
  end and the current one has a start:

  | name | card |
  |---|---|
  | any superseded name, game or Discord | `known as X until Y` |
  | the current Discord display name | `First seen as X on Y` |

  The second is verbatim from the owner ("How about we word it as 'First seen a X
  on Y' (date)"), including its capital F. **Do not normalise the two to match** —
  that is editing their copy, not formatting it. `Y` is the same class of
  timestamp in both: the moment Ringmaster *noticed*, never the moment the player
  renamed. That distinction lives in `OtherNameCard`'s comment and must not reach
  the page.

  **A name we can date neither end of still gets no card at all** — plain text, no
  hover affordance. That is a player whose current display name we have never
  watched them change *into*, so there is no first sighting to point at. Do not
  fill that gap with a sentence, and do not borrow the other one — ask.

- **The unauthorized weapon on the incident timeline** is the newest, and the
  only one whose trigger is a word in the middle of a sentence rather than a
  chip. It has real parts — a heading naming what was found, then what that
  means about the player — which is rule 5 satisfied rather than bent, and the
  content was asked for by name in the issue that built it (#30). It follows the
  ban chip on both counts that matter here: the sentence exists twice, once in
  the popup and once `sr-only` inside the trigger, and it advertises itself with
  a dotted underline as well as the red, because `cursor-help` alone pays out
  only after the pointer is already on the word.

  **The red is the fact and the card is the elaboration**, which is the test a
  fourth card had to pass. A reader who never hovers still sees that the console
  flagged the weapon; what the popup adds is why. The claim itself — the game
  does not issue this weapon — is `weaponIssued === false` and nothing else, and
  `check:timeline` exists because absent and `false` rendering alike would put
  that card on every kill filed before the field existed.

**Do not add another chip-shaped card without a visible affordance.** A chip
that hides its own explanation until somebody happens to point at it is the
complaint that produced `IdLabel` in the first place.

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

### 8. Never write the words yourself

The owner, 2026-08-19:

> "please do not add any helper text to any pages on your own ever. I know
> you're just trying to help but it comes across as 'AI slop' if you're writing
> text without the context of the person who's using it and their intent or
> familiarity."

This rule sits **above** every rule before it. Rules 1–7 govern *where* a string
goes once it exists; this one governs whether it may exist at all. Only text the
owner asked for, and where they gave exact wording, verbatim.

**Data is not helper text.** Values, timestamps, counts, names, column headers,
chip labels and link labels are all showing rather than explaining. The line is
anything written to *explain*.

What that has already cost, so the next person does not restore it by reflex:

- The ADMIN chip has no tooltip. `ADMIN?` — the state where Discord did not
  answer — has no tooltip and no `sr-only` gloss either; it is a one-word label
  flagged to the owner rather than explained at the reader.
- "Other names" has a plain label, not an `IdLabel` card, and `IdLabel` is
  deleted with it.
- "Actions taken" uses `ProfileView`'s house `Empty` when it has no rows, like
  the four other panels on that page. It does not explain what it would contain.
- **The live table's filter chips carry no description at all** — "We don't need
  descriptors for those tabs". `All`, `In match` and `Lobby` are a label and a
  count. The `title` field is gone from `FILTERS`, not merely unset, and
  `FilterChip` has no `description` prop to thread an empty string through. This
  one cost the document its own worked example, above; that is the rule working,
  not a gap in it.

When a state genuinely has no honest wording, the answer is to **report it and
wait**, not to write something reasonable-sounding. A hover card asserting a
date we do not have is worse than no hover card, and a paragraph nobody asked
for is worse than a blank.

---

## What happened to the nine

| Site | Became |
|---|---|
| `LocalTime.tsx` | `<time dateTime>` + optional visible UTC |
| `AuditList.tsx` | folded into `LocalTime`, UTC now visible below the local time |
| `IncidentQueue.tsx` | inline — `3d ago` (it read `3d waiting` until the owner asked for "ago") |
| `ProfileView.tsx` placement badge | conditional `Tooltip` + `sr-only` |
| `ProfileView.tsx` survived | inline — `12m 4s alive` |
| `PlayerTable.tsx` filter chips | `Tooltip` + `sr-only` / `aria-describedby`, then **deleted** — see rule 8 |
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

  **It moved to `IncidentTimeline.tsx` with #30 and the constraint did not
  change.** That line is now `<LocalTime /> · {byName} · +4:00`, which is the
  same inline run with one more item in it, so the block box would still break
  it. Worth writing down only because "the timeline was rebuilt" reads like the
  restructure this was waiting for, and it was not.

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
- **There is no lint rule behind any of this, and `npm run lint` is not one
  either.** The script exists in `package.json` and there is no ESLint config
  file and no `eslint` dependency anywhere in the repo, so it is a name rather
  than a gate — and it is *not* part of `npm run verify`, which is what actually
  runs (`check:secrets`, `check:banrule`, `check:xpcurve`, `check:verdict`,
  `check:discordrole`, `check:chips`, `check:deployphase`, `check:contrast`,
  `typecheck`). An ESLint rule banning the `title` JSX
  attribute on DOM elements — allowlisting `<iframe>`/`<svg>`, never matching
  component props — is what would keep this from decaying, but standing ESLint
  up at all is the bootstrap task in front of it.

  Until then the check is a grep, and rule 6's caveat is the whole difficulty:
  `title=` returns both banned DOM attributes and legitimate component props,
  and every hit has to be read and classified by hand.
