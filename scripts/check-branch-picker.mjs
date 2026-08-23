/**
 * THE BRANCH LIST IS READ AGAIN EVERY TIME THE PICKER IS OPENED.
 *
 * WHY THIS GATE EXISTS. The owner merged the PR that made `dev` deployable
 * again and the picker kept refusing it — "changes tools/dispatch.sh — deploy
 * it through main and PR review" — in his words, it "doesn't seem to ever
 * realize the conflict is resolved". Nothing was wrong with the merge or with
 * the game box. `onOpenChange` fired the load only while `branches === null`,
 * so the list was one reading taken once per page session, and reopening the
 * picker re-rendered it rather than re-asking for it.
 *
 * WHY IT IS INVISIBLE TO EVERY OTHER CHECK. The stale path typechecks, renders,
 * lints and looks correct in every screenshot: a list of branches with reasons
 * beside them. It is only wrong in the fourth dimension, and the one-token
 * change that reintroduces it — adding a `branches === null` back to the open
 * handler, "so we don't hammer the box" — is the kind that reads as a tidy-up.
 *
 * `blockedBy` IS THE READING THIS IS REALLY ABOUT. Everything else in the list
 * moves forward: a new commit, a new branch, a bigger `ahead`. A refusal is the
 * one value on the page that is SUPPOSED to stop being true, and it stops being
 * true because of something a human just did somewhere else. That is the same
 * defect 4fb0e33 and a5b2c2d fixed on the settled card — a recorded fact
 * rendered where a reader is asking a live question — and it is why the fix is
 * to make the reading fresh rather than to write a sentence about its age.
 *
 * AND THE BOX'S OWN REFS RIDE ON IT. `do_branches` in the game repo's
 * `tools/dispatch.sh` is what runs the `git fetch --prune`; `ref_blocked_by`
 * decides the refusal against `origin/main`. A console that never re-asks
 * leaves that fetch unpaid, so the refusal is stale at both ends at once.
 *
 * THE FOUR PROPERTIES THIS FILE HOLDS:
 *
 *   1. OPENING RE-ASKS, UNCONDITIONALLY. No `branches === null` guard on the
 *      open path; the only permitted guard is against two loads at once.
 *
 *   2. AND IT IS STILL NOT POLLED. On-open costs what Refresh costs — one
 *      bounded fetch per deliberate human act. A timer would spend it forever
 *      on a page left open, which is what the `process` scope on the route
 *      exists to prevent. `loadBranches` may be reached from the open handler
 *      and the refresh button and nothing else.
 *
 *   3. A RELOAD DOES NOT BLANK THE LIST — not while it is in flight, and not
 *      when it fails. The warm case follows what Refresh already did (the
 *      button spins, the rows stay); the cold placeholder stays gated on
 *      having nothing to show.
 *
 *   4. A PICK CANNOT OUTLIVE THE ROW IT WAS MADE FROM. `api/maintenance` does
 *      not re-check a switch's eligibility — it says so, in as many words —
 *      because "the picker has already gated on that branch's own `eligible`".
 *      Once the list moves under a selection, that promise is only kept if the
 *      selection is re-pointed or dropped.
 *
 * A PLAIN SCRIPT, matching check-deploy-target.mjs and check-deploy-phase.mjs:
 * this repo has no test framework and adding one would be the larger change.
 * `branchRefusal` is imported for real, so there is no second copy of the rule
 * here to drift out of step with the shipped one; the call sites are read as
 * text, for the reason check-deploy-phase.mjs records — this repo has three
 * times had a change pass every check while a component wired a correct
 * function up wrongly.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { branchRefusal } from '../src/lib/maintenance.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL  ${msg}`)
}

const panel = read('src/components/MaintenancePanel.tsx')

/**
 * THE OPEN HANDLER, ISOLATED FROM THE PROSE AROUND IT. Everything in this file
 * that reads the panel as text reads code lines only — the comments explain the
 * bug at length and name the very expression that caused it, so an `includes`
 * over the whole file would match the explanation and fail on a correct panel.
 */
const code = panel
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// =====================================================================
// PROPERTY 1 — OPENING THE PICKER RE-ASKS, EVERY TIME.
// =====================================================================

{
  const open = code.indexOf('onOpenChange={(v) => {')
  if (open < 0) {
    fail(
      'MaintenancePanel has no BranchPicker open handler — if it was renamed, this ' +
        'check has to follow it rather than quietly stop testing anything',
    )
  } else {
    const body = code.slice(open, code.indexOf('}}', open))

    /** THE LOAD IS ON THE OPEN PATH AT ALL. */
    if (!/if \(v &&[^)]*\) void loadBranches\(\)/.test(body)) {
      fail(
        'opening the branch picker no longer loads the branch list — the picker would ' +
          'show whatever the last page load left in it',
      )
    }

    /**
     * AND NOTHING ON THAT PATH ASKS WHETHER THERE IS ALREADY A LIST. This is
     * the bug, spelled exactly as it shipped and also in the shapes a
     * well-meaning re-introduction would take.
     */
    if (/branches\s*(===|==|!==|!=)\s*null/.test(body) || /\!branches\b/.test(body)) {
      fail(
        'the open handler is gated on whether a list is already held — that is the ' +
          'once-per-page-session reading the owner hit: a refusal resolved by a merge ' +
          'stays on screen until the tab is reloaded',
      )
    }
    if (/branches\?\.length|branches\.length/.test(body)) {
      fail(
        'the open handler is gated on the size of the list it already has — same ' +
          'defect as a null check, one step along',
      )
    }

    /**
     * THE ONE GUARD THAT IS ALLOWED, and it is about concurrency rather than
     * freshness: an open that fires while a load is in flight must not start a
     * second `git fetch --prune` on the box.
     */
    if (!body.includes('!loadingBranches')) {
      fail(
        'the open handler no longer guards against a load already in flight — two ' +
          'opens in quick succession would each spend a fetch on the game box',
      )
    }
  }
}

// =====================================================================
// PROPERTY 2 — AND IT IS STILL NOT POLLED.
// =====================================================================

{
  /**
   * READ AS CALL SITES, NOT AS A COUNT OF THE WORD. `loadBranches` appears as
   * its own definition, as the open handler's call, and as the refresh button's
   * handler. Any other reference is a new way of reaching it and has to be
   * looked at — a timer, an effect, a retry loop.
   */
  const sites = [...code.matchAll(/loadBranches/g)].length
  const declared = /const loadBranches = async/.test(code)
  const onOpen = /void loadBranches\(\)/.test(code)
  const onRefresh = /onRefresh=\{loadBranches\}/.test(code)
  if (!declared || !onOpen || !onRefresh) {
    fail(
      'the branch load is no longer reached from exactly the declaration, the open ' +
        'handler and the refresh button',
    )
  } else if (sites !== 3) {
    fail(
      `loadBranches is referenced ${sites} times in code (expected 3: the ` +
        'declaration, the open handler, the refresh button). A fourth reference is ' +
        'a new way of reaching a real `git fetch --prune` on the game box — if it is ' +
        'a timer, it is the poll this list has never been allowed to have',
    )
  }

  /** Said again from the other side, because a timer is the specific fear. */
  for (const timer of ['setInterval(', 'setTimeout(']) {
    const re = new RegExp(`${timer.replace('(', '\\(')}[^;]{0,200}loadBranches`)
    if (re.test(code)) {
      fail(`the branch list is loaded from a ${timer} — it must not be polled`)
    }
  }
}

// =====================================================================
// PROPERTY 3 — A RELOAD NEVER BLANKS THE LIST.
// =====================================================================

{
  /**
   * IN FLIGHT: the rows stay and the Refresh button carries the spinner, which
   * is the treatment Refresh has always had and the reason there is no second
   * one to invent. `setBranches(null)` anywhere would empty the picker at the
   * start of a reload; the cold placeholder is what covers having nothing.
   */
  if (/setBranches\(\s*null\s*\)/.test(code)) {
    fail(
      'MaintenancePanel clears the branch list to null — on a reload that blanks the ' +
        'picker an operator is reading, either mid-flight or on a failure that says ' +
        'nothing about whether those rows were right',
    )
  }
  /**
   * THE COLD PLACEHOLDER STAYS COLD-ONLY. "Asking the game host…" is for a
   * picker with nothing in it; showing it over a warm reload would replace the
   * list with a spinner, which is the flash this whole property is about.
   */
  if (!code.includes('loading && branches === null')) {
    fail(
      'the "Asking the game host…" placeholder is no longer gated on having nothing ' +
        'to show — a reload would blank the rows it is drawn over',
    )
  }

  /** And the spinner Refresh already had is still what reports a warm reload. */
  if (!/disabled=\{loading\}/.test(code) || !/onClick=\{onRefresh\}/.test(code)) {
    fail(
      'the Refresh button no longer reports the in-flight load — it is the one signal ' +
        'a warm reload has, and the on-open reload borrows it',
    )
  }

  /**
   * AND A FAILED RELOAD IS STATED. The list surviving is only defensible while
   * the failure is on screen; a retained list under no error at all would be a
   * stale reading presented as a current one, which is the defect this whole
   * change exists to close.
   */
  if (!code.includes('setBranchError(')) {
    fail('a failed branch read no longer records an error for the picker to render')
  }
  if (!/\{error && \(/.test(code)) {
    fail(
      'the picker no longer renders the branch error — with the list now kept across ' +
        'a failure, that banner is the only thing saying the rows are not a fresh read',
    )
  }

  /**
   * THE HOST'S OWN STALENESS IS NOT BORROWED FOR OUR FAILURE. `stale` means the
   * box answered from refs on disk, and the banner it draws says exactly that.
   * Setting it from the console's catch would print a cause nobody established.
   */
  const catchAt = code.indexOf('} catch (e) {', code.indexOf('const loadBranches'))
  const finallyAt = code.indexOf('} finally {', catchAt)
  if (catchAt >= 0 && finallyAt > catchAt) {
    const body = code.slice(catchAt, finallyAt)
    if (body.includes('setBranchesStale(')) {
      fail(
        'the branch load writes `stale` from its own failure path — that flag is the ' +
          "game host's admission that it answered from refs on disk, and its banner " +
          'says so; a console-side failure is a different fact and keeps its own words',
      )
    }
    if (body.includes('setBranches(') || body.includes('setBranchesFromSha(')) {
      fail(
        'the branch load still discards the list or the commit it was counted from ' +
          'when a read fails — that was harmless while the only load was the first ' +
          'one, and deletes an operator\'s rows now that opening re-asks',
      )
    }
  }
}

// =====================================================================
// PROPERTY 4 — A PICK CANNOT OUTLIVE THE ROW IT WAS MADE FROM.
// =====================================================================

/**
 * The rule itself, imported. `deployedRef` is the ref the box is ON, which is
 * what makes a row "already running".
 */
const B = (over = {}) => ({
  name: 'dev',
  ahead: 4,
  behind: 0,
  eligible: true,
  ...over,
})

/** [label, branch, deployedRef, expected] */
const refusalCases = [
  ['an ordinary branch, ahead of the box', B(), 'main', null],
  ['blocked by the box', B({ eligible: false }), 'main', 'blocked'],
  [
    'blocked, and it is also the one running',
    B({ eligible: false, ahead: 0, behind: 0 }),
    'dev',
    'blocked',
  ],
  ['running, and it has moved since', B({ ahead: 4 }), 'dev', null],
  ['running, and the box is behind nothing but ahead', B({ ahead: 0, behind: 3 }), 'dev', null],
  [
    'running at this exact commit — the restart that changes nothing',
    B({ ahead: 0, behind: 0 }),
    'dev',
    'no-change',
  ],
  [
    'level with the box but NOT the branch it is on',
    B({ name: 'feature/x', ahead: 0, behind: 0 }),
    'dev',
    null,
  ],
  ['the host has not named its ref', B({ ahead: 0, behind: 0 }), null, null],
  ['the host has not named its ref, and the branch is blocked', B({ eligible: false }), null, 'blocked'],
]

for (const [label, b, ref, expected] of refusalCases) {
  const got = branchRefusal(b, ref)
  if (got !== expected) {
    fail(
      `branchRefusal: ${label}\n        expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(got)}`,
    )
  }
}

{
  /**
   * ONE RULE, READ BY THE ROW AND BY THE RECONCILIATION. Written as two
   * expressions they would eventually disagree, and the direction they disagree
   * in is a live "Schedule switch" over a row the picker is showing as refused.
   */
  if (!/disabled=\{refusal !== null\}/.test(code)) {
    fail(
      'the branch row is not disabled by `branchRefusal` — the row and the pick that ' +
        'survives a reload would be two rules that only happen to agree',
    )
  }
  if (!/const refusal = branchRefusal\(b, deployedRef\)/.test(code)) {
    fail('the branch row no longer derives its refusal from lib/maintenance')
  }

  /**
   * AND THE RELOAD RECONCILES THE PICK. Both halves are asserted because either
   * alone passes the bug: re-pointing without re-checking keeps a pick the box
   * now refuses, and dropping without re-pointing leaves a stale pinned sha
   * whenever the branch simply moved.
   */
  const load = code.slice(
    code.indexOf('const loadBranches'),
    code.indexOf('} catch (e) {', code.indexOf('const loadBranches')),
  )
  if (!/setPicked\(/.test(load)) {
    fail(
      'a reload of the branch list leaves `picked` untouched — it holds the row the ' +
        'operator clicked, sha and eligibility included, from a reading that has been ' +
        'replaced',
    )
  }
  if (!/list\.find\(\(b\) => b\.name === p\.name\)/.test(load)) {
    fail(
      'the reload does not re-point `picked` at the fresh row — "the sha travels with ' +
        'the name", and an un-repointed pick pins a commit the row above it no longer ' +
        'names',
    )
  }
  if (!/branchRefusal\(fresh, ref\) === null/.test(load)) {
    fail(
      'the reload keeps `picked` without re-checking that the fresh row is still ' +
        'choosable — api/maintenance does not re-check a switch, on the stated ' +
        "grounds that \"the picker has already gated on that branch's own `eligible`\"",
    )
  }
}

// =====================================================================
// AND THE ROUTE STILL DELEGATES, which is what makes property 4 load-bearing.
// =====================================================================

{
  const route = read('src/app/api/maintenance/route.ts')
  if (!/if \(!input\.targetRef\) \{/.test(route)) {
    fail(
      'api/maintenance no longer skips the parked-ref refusal for a switch — if that ' +
        'guard changed, re-read PROPERTY 4: it exists because the switch path trusts ' +
        'the picker',
    )
  }
}

if (failed) {
  console.error(`\nbranch picker: ${failed} check(s) failed.`)
  console.error(
    'Opening the picker re-reads the branch list, every time and not only the ' +
      'first; the reload never blanks the rows it is replacing; and a selection ' +
      'does not outlive the row it was made from — see loadBranches in ' +
      'src/components/MaintenancePanel.tsx and branchRefusal in src/lib/maintenance.ts',
  )
  process.exit(1)
}
console.log(
  `branch picker: on-open re-read, the no-poll budget, the warm and failed ` +
    `reload paths and ${refusalCases.length} refusal cases match the contract`,
)
