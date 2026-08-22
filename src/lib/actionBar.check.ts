/**
 * Contract checks for the profile's moderation bar — #192, the Spectate button.
 *
 *   npx tsx src/lib/actionBar.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts`, `framed.check.ts` and
 * `handoff.check.ts`: this repo has no test framework and adding one to assert
 * a truth table and a dozen call sites would be the larger change. IT IS WIRED
 * INTO `npm run verify` as `check:actionbar`; a check nothing runs is this
 * repository's signature failure mode and has already happened here.
 *
 * ============================================================================
 * WHY A GATE AT ALL, because the answer decides how much of this is worth it.
 *
 * Spectate is HIDDEN, not greyed, when either party is not in-game — the
 * owner's standing rule. Both directions of getting that wrong are invisible to
 * whoever causes it, and only one of them is merely cosmetic:
 *
 *   too eager   a Spectate button offered over a player nobody can watch, or —
 *               far worse — one whose rule has quietly become "the target is
 *               in-game", so an admin at a desk fires a command that can only
 *               be refused, and leaves an audit row saying they watched
 *               somebody when nothing of the kind happened. The log is the
 *               entire justification for this feature; rows in it that did not
 *               happen are the one failure that cannot be tolerated.
 *
 *   too shy     the button never appears, which reads as "the feature did not
 *               ship" and gets rebuilt.
 *
 * Whoever edits the rule next is looking at a browser, where a fixture with
 * both halves true renders identically under either spelling.
 *
 * ============================================================================
 * WHAT IT ACTUALLY EXERCISES. The distinction decides what a pass is worth:
 *
 *   A. THE RULE — `actionBar` from `lib/actionBar.ts`, as shipped, over the
 *      COMPLETE truth table of its five booleans. Thirty-two rows, each
 *      expected value written independently of the implementation.
 *
 *   B. THE CALL SITES — that the components which draw these buttons actually
 *      gate on that function's answer. THIS IS THE HALF THAT MATTERS. A
 *      correct rule nobody invokes is precisely the failure this repository
 *      keeps shipping: a component-level mutation once passed this repo's
 *      entire suite while every pure function in it stayed correct. Section A
 *      alone cannot tell the difference between a shipped rule and a decorative
 *      one, so this reads `PlayerActions.tsx`, `ProfileView.tsx`, the profile
 *      page and `/api/spectate` as text and asserts the wiring.
 *
 *   C. THE TRANSPORT — that the request reaches the game through the ONE
 *      channel the kick already uses, with the argument shape the game repo's
 *      `tools/dispatch.sh` pins, and that the audit row is written BEFORE the
 *      command is sent rather than after it succeeds.
 *
 *   D. THE HARNESS — that `/preview/profile` still carries a fixture holding
 *      each half of the rule false ON ITS OWN. Without those, a mutation that
 *      drops one half renders identically on every case and the harness stops
 *      being able to show the bug it exists to show.
 *
 * ============================================================================
 * SPECTATE HAS NO SCOPE, AND SEVERAL ASSERTIONS HERE EXIST TO KEEP IT THAT WAY.
 *
 * It had one. `/api/spectate` authorised a `spectate` grant and this file
 * required it. The argument was sound — watching somebody is less destructive
 * than removing them, so it is trustable earlier — and it did not survive
 * contact with the fact that NOTHING IN THIS CONSOLE CAN GRANT A SCOPE. There
 * is no scopes UI; the only route is editing DynamoDB by hand; the owner does
 * not. Every admin got a greyed button and a sentence naming a grant no surface
 * hands out. The route moved to `view` in dba5a6a; the button, the prop, the
 * fixture and the truth-table column went with it.
 *
 * THE ASSERTIONS THAT REMAIN ARE THEREFORE NEGATIVE ONES — that no `enabled`
 * has crept back onto Spectate, that no scope sentence has, that the profile
 * page reads no spectate grant. A wall with no door is easy to rebuild by
 * instinct, because gating things feels careful.
 *
 * ============================================================================
 * THESE CHECKS ARE WRITTEN TO BE ABLE TO FAIL, and the mutations they were
 * developed against are named here so a future reader can re-run them:
 *
 *   `shown: i.online` (drop the admin half)          fails A and D
 *   `shown: i.adminOnline` (drop the target half)    fails A
 *   `shown: i.online || i.adminOnline`               fails A
 *   `!i.banned && i.online && i.adminOnline`         fails A
 *   `buttons: 1 + kick + spectate` off by one        fails A
 *   `{true && (` at the JSX gate                     fails B
 *   `{online && (` at the JSX gate                   fails B
 *   deleting `adminOnline` from the page's props     fails B (and tsc)
 *   `disabled={!bar.kick.enabled}` → `disabled={false}`   fails B
 *   re-adding a scope gate to the Spectate button    fails B
 *   re-adding `can(license, 'spectate')` to the page fails B
 *   sending the command before `audit.begin`         fails C
 *   `authorize('spectate', 'write')` on the route    fails C
 *   dropping `admin-offline` from the harness        fails D
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { actionBar, type ActionBarInputs } from './actionBar'

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_DIR = dirname(SRC_DIR)

let failures = 0
function fail(section: string, message: string): void {
  failures++
  console.error(`  FAIL  [${section}] ${message}`)
}

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  fail(
    'rule',
    `${label} -> ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`,
  )
}

/** Source with comments removed, so prose describing a rule is not the rule. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function read(rel: string): string {
  return readFileSync(join(REPO_DIR, rel), 'utf8')
}

/**
 * The text of one `{<gate> && (` … `)}` JSX block, brace-balanced.
 *
 * WHY BALANCED RATHER THAN A REGEX TO THE NEXT `)}`. These blocks contain
 * nested expressions, ternaries and further conditional children, and a lazy
 * match stops at the first inner one — which would let the assertions below
 * pass while looking at a fragment that does not contain the button at all. A
 * check that silently narrows its own subject is worse than no check.
 *
 * Returns null when the gate is not present at all, which every caller treats
 * as a failure rather than as an empty block.
 */
function jsxBlock(code: string, gate: string): string | null {
  const open = code.indexOf(gate)
  if (open === -1) return null

  let depth = 0
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  return null
}

// ===========================================================================
// A. THE RULE
// ===========================================================================

console.log('A. actionBar — the complete truth table')

/**
 * EVERY COMBINATION, not a hand-picked handful.
 *
 * Four booleans is sixteen rows, which is small enough to enumerate and large
 * enough that no reviewer would have written them all out by hand. The
 * expectations are computed from the SPECIFICATION — the sentences in #192 and
 * the two owner quotes about Kick — rather than by calling the function, so
 * this is a second statement of the rule and not an echo of the first.
 *
 * IT WAS THIRTY-TWO ROWS OVER FIVE BOOLEANS. `canSpectate` was the fifth and it
 * is gone, so the table halved. THAT SHRINKAGE IS THE POINT AND NOT A LOSS OF
 * COVERAGE: the sixteen rows it dropped differed only in a scope no code reads,
 * and each one asserted that a button greys for a grant nothing can issue.
 * Rows that describe nothing are not evidence.
 */
const BOOLS = [false, true] as const
let rows = 0

for (const banned of BOOLS) {
  for (const online of BOOLS) {
    for (const adminOnline of BOOLS) {
      for (const canBan of BOOLS) {
        const input: ActionBarInputs = {
          banned,
          online,
          adminOnline,
          canBan,
        }
        rows++

        // The specification, restated:
        //   Kick exists when there is somebody present and unbanned to kick.
        //   Spectate exists when BOTH people are in the game.
        //   The one remaining scope decides only whether Kick works.
        const wantKickShown = online && !banned
        const wantSpectateShown = online && adminOnline
        const want = {
          kick: { shown: wantKickShown, enabled: canBan },
          // NO `enabled` KEY AT ALL, and `check` compares serialised shapes, so
          // re-adding one — even `enabled: true` — fails every row here. That
          // is deliberate: a constant `enabled` is what a call site reads to
          // justify keeping a `disabled={}` branch that can never fire.
          spectate: { shown: wantSpectateShown },
          buttons: 1 + (wantKickShown ? 1 : 0) + (wantSpectateShown ? 1 : 0),
        }

        check(JSON.stringify(input), actionBar(input), want)
      }
    }
  }
}

if (rows !== 16) fail('rule', `enumerated ${rows} rows, expected 16`)
console.log(`  ok    ${rows} rows`)

/**
 * THE FOUR PROPERTIES THAT SURVIVE A REWRITTEN TABLE.
 *
 * The block above compares two spellings of the same rule; if somebody edits
 * both together it passes vacuously. These are stated as properties instead —
 * they are what the feature MEANS, and they hold whatever shape the code takes.
 */
console.log('\nA. actionBar — the properties, stated independently')

{
  const all: ActionBarInputs[] = []
  for (const banned of BOOLS)
    for (const online of BOOLS)
      for (const adminOnline of BOOLS)
        for (const canBan of BOOLS)
          all.push({ banned, online, adminOnline, canBan })

  // 1. THE SCOPE NEVER HIDES ANYTHING. Hidden means "there is nobody to do this
  //    to"; a permission you lack is a different sentence and stays visible.
  for (const i of all) {
    const withScopes = actionBar({ ...i, canBan: true })
    const bar = actionBar(i)
    if (
      bar.kick.shown !== withScopes.kick.shown ||
      bar.spectate.shown !== withScopes.spectate.shown ||
      bar.buttons !== withScopes.buttons
    ) {
      fail('rule', `a scope changed what is DRAWN: ${JSON.stringify(i)}`)
      break
    }
  }

  /**
   * 1b. SPECTATE IS NOT A FUNCTION OF THE SCOPE AT ALL, which is stronger than
   *     property 1 and is the one that would catch the whole feature being put
   *     back. `canBan` is the only scope left, so if a `canSpectate` ever
   *     returns it will arrive alongside it — and anything that makes Spectate
   *     vary with a permission fails here regardless of which permission.
   */
  for (const i of all) {
    if (
      actionBar({ ...i, canBan: true }).spectate.shown !==
      actionBar({ ...i, canBan: false }).spectate.shown
    ) {
      fail('rule', `a scope changed whether Spectate is drawn: ${JSON.stringify(i)}`)
      break
    }
  }

  /**
   * 1c. SPECTATE CARRIES NO `enabled`, ASSERTED AT RUNTIME AND NOT ONLY BY TSC.
   *
   * `ShownOnly` makes `bar.spectate.enabled` a compile error, but an excess
   * property on an object literal that is widened — or a rewrite that goes back
   * to `ActionState` with `enabled: true` — type-checks fine. A drawn Spectate
   * button has no state in which it is present and refuses, and this is where
   * that sentence is enforced.
   */
  for (const i of all) {
    if ('enabled' in actionBar(i).spectate) {
      fail(
        'rule',
        `Spectate has an \`enabled\` again — there is no scope behind it, and a constant one invites a dead \`disabled={}\` branch: ${JSON.stringify(i)}`,
      )
      break
    }
  }

  // 2. NEITHER PRESENCE FLAG ALONE IS ENOUGH FOR SPECTATE. This is the exact
  //    mutation the harness case `admin-offline` exists for, asserted here too
  //    so it fails in CI rather than only under somebody's eye.
  for (const i of all) {
    if (i.online !== i.adminOnline && actionBar(i).spectate.shown) {
      fail(
        'rule',
        `Spectate is drawn with only one party in-game: ${JSON.stringify(i)}`,
      )
      break
    }
  }

  // 3. A BAN DOES NOT TOUCH SPECTATE. It hides Kick because kicking a banned
  //    player is redundant; watching one who is still connected is not.
  for (const i of all) {
    if (
      actionBar({ ...i, banned: true }).spectate.shown !==
      actionBar({ ...i, banned: false }).spectate.shown
    ) {
      fail('rule', `a ban changed whether Spectate is drawn: ${JSON.stringify(i)}`)
      break
    }
  }

  // 4. THE COUNT IS THE BAR. Ban-or-lift is always exactly one button, so the
  //    number the skeleton draws is one plus however many of the other two are
  //    shown. An off-by-one here is an 88px hole that fills in when Discord
  //    answers, which is the jump the skeleton exists to prevent.
  for (const i of all) {
    const bar = actionBar(i)
    const drawn = 1 + (bar.kick.shown ? 1 : 0) + (bar.spectate.shown ? 1 : 0)
    if (bar.buttons !== drawn) {
      fail(
        'rule',
        `buttons says ${bar.buttons} and the bar draws ${drawn}: ${JSON.stringify(i)}`,
      )
      break
    }
    if (bar.buttons < 1 || bar.buttons > 3) {
      fail('rule', `buttons out of range (${bar.buttons}): ${JSON.stringify(i)}`)
      break
    }
  }
}
console.log('  ok    the scope never hides, Spectate has no scope and no enabled,')
console.log('        one party is never enough, a ban never touches Spectate, and')
console.log('        the count matches the bar')

// ===========================================================================
// B. THE CALL SITES
// ===========================================================================

console.log('\nB. the call sites — the buttons are gated on that function')

const PLAYER_ACTIONS = 'src/components/PlayerActions.tsx'
const PROFILE_VIEW = 'src/components/ProfileView.tsx'
const PROFILE_PAGE = 'src/app/players/[license]/page.tsx'

{
  const code = codeOf(read(PLAYER_ACTIONS))

  if (!/from ['"]@\/lib\/actionBar['"]/.test(code)) {
    fail('call-site', `${PLAYER_ACTIONS} no longer imports lib/actionBar`)
  }

  /**
   * THE BAR IS BUILT FROM ALL FOUR INPUTS. Dropping one from this call is the
   * cheapest possible way to break the feature while leaving the rule correct
   * — `actionBar({ banned, online, canBan })` type-errors today, but a future
   * optional field would not.
   */
  const call = /const\s+bar\s*=\s*actionBar\(\{([^}]*)\}\)/.exec(code)
  if (!call) {
    fail('call-site', `${PLAYER_ACTIONS} does not build its bar with actionBar()`)
  } else {
    const args = call[1] ?? ''
    /**
     * EVERY FIELD IS PASSED AS SHORTHAND — `{ banned, online, … }` — and that
     * is asserted rather than merely "the word appears".
     *
     * `adminOnline: true` CONTAINS THE WORD `adminOnline` and satisfies any
     * check that only looks for it, while pinning half the rule open: the
     * function still computes `online && adminOnline` correctly, the truth
     * table in section A still passes, and the button appears over an admin who
     * is not in the game. That mutation escaped this file's first draft, which
     * is exactly the class of bug section B exists for — a prop the component
     * accepts, ignores, and substitutes a constant for.
     *
     * Shorthand also means a renamed prop is a compile error rather than a
     * silent literal, which is the property worth having.
     */
    for (const field of ['banned', 'online', 'adminOnline', 'canBan']) {
      if (!new RegExp(`(^|[{,\\s])${field}\\s*(,|$)`).test(args.trim())) {
        fail(
          'call-site',
          `${PLAYER_ACTIONS} does not pass ${field} to actionBar() as the prop of that name — a literal or a rename here pins half the rule open while every unit case still passes`,
        )
      }
    }
    if (/\b(true|false)\b/.test(args)) {
      fail(
        'call-site',
        `${PLAYER_ACTIONS} passes a boolean LITERAL to actionBar(): ${args.trim()}`,
      )
    }
  }

  /**
   * EACH BUTTON SITS INSIDE ITS OWN GATE, checked by reading the block rather
   * than by finding the two strings anywhere in the file. `{bar.spectate.shown
   * && (` followed by a button somewhere else in the tree is the mutation this
   * section exists for, and a pair of `includes()` calls on the whole file
   * would wave it straight through.
   */
  for (const [gate, label, enabled] of [
    /**
     * SPECTATE'S EXPECTED `disabled` IS `watching`, NOT A SCOPE.
     *
     * It read `!bar.spectate.enabled || watching` and the scope half is gone
     * with the scope. What is left is the double-click guard: Spectate is the
     * only action in this bar with no dialog in front of it, so it is the only
     * one that can be fired twice before the first request lands.
     */
    ['{bar.spectate.shown && (', 'Spectate', 'watching'],
    ['{bar.kick.shown && (', 'Kick', '!bar.kick.enabled'],
  ] as const) {
    const block = jsxBlock(code, gate)
    if (block === null) {
      fail('call-site', `${PLAYER_ACTIONS} has no \`${gate}\` gate`)
      continue
    }
    /**
     * THE LABEL AS A JSX TEXT CHILD, ON ITS OWN LINE — not merely the substring
     * somewhere in the block. `block.includes('Kick')` is satisfied by
     * `setKickOpen(true)`, which would make this assertion vacuous on the one
     * button it was written for.
     */
    if (!new RegExp(`^\\s*${label}\\s*$`, 'm').test(block)) {
      fail('call-site', `the ${label} button's label is not inside its own gate`)
    }
    /**
     * THE `disabled` ATTRIBUTE ITSELF, not the block around it.
     *
     * `block.includes('!bar.spectate.enabled')` is satisfied by the two
     * conditional children further down that render the tooltip and the
     * `sr-only` span — so `disabled={watching}` on the button passed this
     * check while the scope stopped disabling anything, and an admin without
     * the grant got a live button. Read the attribute.
     */
    const disabled = /disabled=\{([^}]*)\}/.exec(block)
    if (!disabled) {
      fail('call-site', `the ${label} button has no disabled attribute at all`)
    } else if (!disabled[1]?.includes(enabled)) {
      fail(
        'call-site',
        `the ${label} button's disabled state is \`${disabled[1]?.trim()}\`, which does not read \`${enabled}\``,
      )
    }
  }

  /**
   * NO SECOND SPELLING OF EITHER RULE ANYWHERE IN THIS FILE. The whole reason
   * the rule moved into a module is that it was being written down twice; a
   * re-derivation here would put it back without moving the import.
   */
  for (const re of [
    /!\s*banned\s*&&\s*online/,
    /\bonline\s*&&\s*adminOnline/,
    /\badminOnline\s*&&\s*online/,
  ]) {
    if (re.test(code)) {
      fail(
        'call-site',
        `${PLAYER_ACTIONS} re-derives a bar rule inline (${re.source}) instead of reading actionBar()`,
      )
    }
  }

  /**
   * THE SPECTATE BUTTON HAS NO SCOPE STATE OF ANY KIND — asserted three ways,
   * because this is the assertion that was inverted rather than deleted.
   *
   * It used to REQUIRE a `NO_SPECTATE_SCOPE` sentence rendered into both a
   * tooltip and an `sr-only` span, under docs/hover-text.md rule 1: no fact may
   * live only on hover. The rule is untouched and still governs Kick beside it.
   * What changed is that the fact stopped being true — there is no scope to be
   * missing — and a sentence naming an unobtainable grant is worse than silence.
   *
   * A future reader restoring a scope will restore this sentence with it, and
   * will have to delete these three lines to do it. That is the intended cost:
   * it means the wall cannot go back up without somebody deciding to build the
   * door, in this file, on purpose.
   */
  if (/NO_SPECTATE_SCOPE/.test(code)) {
    fail(
      'call-site',
      `${PLAYER_ACTIONS} names a Spectate scope sentence again — the scope was removed because nothing in this console can grant one`,
    )
  }
  if (/bar\.spectate\.enabled/.test(code)) {
    fail(
      'call-site',
      `${PLAYER_ACTIONS} reads \`bar.spectate.enabled\` — Spectate is drawn or absent, never greyed`,
    )
  }
  if (/canSpectate/.test(code)) {
    fail('call-site', `${PLAYER_ACTIONS} has a canSpectate again`)
  }
}

{
  const code = codeOf(read(PROFILE_VIEW))

  /**
   * THE SKELETON COUNTS WHAT THE BAR DRAWS. It used to re-spell the rule as
   * `!banned && online ? 2 : 1`, with a comment admitting it was kept in step
   * by hand; that is the drift this asserts is gone.
   */
  if (!/moderationButtons=\{[\s\S]*?actionBar\(\{[\s\S]*?\}\)\.buttons/.test(code)) {
    fail(
      'call-site',
      `${PROFILE_VIEW} does not count its skeleton buttons with actionBar().buttons`,
    )
  }
  if (/moderationButtons=\{[^}]*\?\s*\d\s*:\s*\d/.test(code)) {
    fail(
      'call-site',
      `${PROFILE_VIEW} has gone back to a hand-written skeleton button count`,
    )
  }

  // The admin's presence reaches the bar. Passed-but-unread is its own defect,
  // and read-but-unpassed does not compile.
  //
  // `canSpectate={moderation.canSpectate}` WAS THE SECOND ENTRY HERE and went
  // with the scope; the negative below is what stops it drifting back in.
  for (const prop of ['adminOnline={moderation.adminOnline}']) {
    if (!code.includes(prop)) {
      fail('call-site', `${PROFILE_VIEW} does not hand \`${prop}\` to PlayerActions`)
    }
  }
  if (/canSpectate/.test(code)) {
    fail('call-site', `${PROFILE_VIEW} carries a canSpectate again`)
  }
}

{
  const code = codeOf(read(PROFILE_PAGE))

  /**
   * ONE PRESENCE PATH, TWO LICENSES. The rule the issue sets is that the
   * admin's presence is not derived a second way — so it must come off the same
   * `view.players` array the player's does, and not from a session field, the
   * handoff token, or a second query.
   */
  if (!/view\.players\.some\(\(p\) => p\.license === admin\.license\)/.test(code)) {
    fail(
      'call-site',
      `${PROFILE_PAGE} does not derive the admin's presence from the same view.players snapshot`,
    )
  }
  /**
   * THE PAGE READS NO SPECTATE GRANT, and this assertion is the exact inverse
   * of the one it replaces (`if (!/can\(admin\.license, 'spectate'\)/)`).
   *
   * The read was not merely useless. It cost a DynamoDB call in the page's hot
   * batch to fetch a boolean that was false for every account on the server,
   * and its only effect was to grey a working button.
   */
  if (/can\(admin\.license,\s*'spectate'\)/.test(code)) {
    fail(
      'call-site',
      `${PROFILE_PAGE} reads a spectate grant again — /api/spectate authorises \`view\`, and no surface in this console can issue a \`spectate\``,
    )
  }
  if (/canSpectate/.test(code)) {
    fail('call-site', `${PROFILE_PAGE} carries a canSpectate again`)
  }
  for (const prop of ['adminOnline:']) {
    if (!code.includes(prop)) {
      fail('call-site', `${PROFILE_PAGE} does not pass \`${prop}\` in its moderation prop`)
    }
  }
}
console.log('  ok    PlayerActions, ProfileView and the profile page all read the')
console.log('        one rule, and the admin is looked up in the one snapshot')

// ===========================================================================
// C. THE TRANSPORT AND THE AUDIT ROW
// ===========================================================================

console.log('\nC. /api/spectate — one channel, and the row goes first')

const ROUTE = 'src/app/api/spectate/route.ts'

{
  const code = codeOf(read(ROUTE))

  /**
   * THE SCOPE IS `view`, AND THIS ASSERTION USED TO REQUIRE `spectate`.
   *
   * A separate scope was the original design and the argument for it was good:
   * watching somebody is less destructive than removing them, so it is a thing
   * a trainee could hold earlier. It was still wrong, because NOTHING IN THIS
   * CONSOLE CAN GRANT A SCOPE -- there is no scopes UI, the only route is
   * editing DynamoDB by hand, and the owner does not. The check built a wall
   * with no door and the feature shipped unreachable.
   *
   * WHAT IS STILL ASSERTED IS THE INTENT, and that half was never the problem.
   * `write` is what re-reads the grant live and re-checks Discord; a read
   * intent would skip both. The scope moved, the freshness requirement did not.
   */
  if (!/authorize\(\s*'view',\s*'write'\s*\)/.test(code)) {
    fail(
      'transport',
      `${ROUTE} does not authorise on the view scope as a WRITE (a read intent skips the Discord re-check, and a granular scope nothing can grant is a wall with no door)`,
    )
  }

  /**
   * THE ROW IS WRITTEN BEFORE THE COMMAND LEAVES. `lib/audit.ts`: "an unlogged
   * admin action is precisely what this table exists to make impossible, so a
   * failure to record is a failure to act." Recording afterwards would lose the
   * one case the log exists for — the request that reached the game and then
   * went wrong.
   */
  const beganAt = code.indexOf('audit.begin(')
  const sentAt = code.indexOf('spectatePlayer(')
  if (beganAt === -1) fail('transport', `${ROUTE} writes no audit row at all`)
  else if (sentAt === -1) fail('transport', `${ROUTE} never dispatches the command`)
  else if (beganAt > sentAt) {
    fail('transport', `${ROUTE} sends the command before it records the intent`)
  }

  if (!/action:\s*'player\.spectate'/.test(code)) {
    fail('transport', `${ROUTE} does not write a \`player.spectate\` row`)
  }
  if (!/targetLicense:\s*input\.license/.test(code)) {
    fail('transport', `${ROUTE}'s audit row does not name who was watched`)
  }
  if (!/audit\.resolve\(ts, 'failed'/.test(code)) {
    fail('transport', `${ROUTE} leaves a refused command's row at pending forever`)
  }

  /**
   * NO SECOND TRANSPORT. The issue asked for the Kick's channel to be followed
   * rather than a new one invented; anything reaching the game box from a route
   * that is not `lib/ssh` is that invention.
   */
  if (!/from '@\/lib\/ssh'/.test(code)) {
    fail('transport', `${ROUTE} does not go through lib/ssh`)
  }
  if (/\bfetch\(/.test(code)) {
    fail('transport', `${ROUTE} opens its own connection to something`)
  }
}

{
  const ssh = codeOf(read('src/lib/ssh.ts'))

  // The verb name is a contract with the game repo, whose tools/verify.sh pins
  // the dispatcher's whole verb set and fails when it moves.
  if (!/\|\s*'spectate'/.test(ssh)) {
    fail('transport', 'lib/ssh.ts does not declare the `spectate` verb')
  }

  const call = /runVerb\('spectate',([^)]*)\)/.exec(ssh)
  if (!call) {
    fail('transport', 'lib/ssh.ts never dispatches the spectate verb')
  } else {
    const args = (call[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (args.length !== 3) {
      fail(
        'transport',
        `spectate is dispatched with ${args.length} argument(s); dispatch.sh reads exactly three: <admin-license> <target-license> <command-id>`,
      )
    }
    if (args[0] !== 'adminLicense' || args[1] !== 'targetLicense') {
      fail(
        'transport',
        `spectate's arguments are (${args.join(', ')}); the admin's license comes FIRST — swapping them points the camera the wrong way round`,
      )
    }
  }

  /**
   * NO BASE64 ON THIS VERB, and the absence is deliberate rather than an
   * omission. A kick reason is free text an admin typed, so it is encoded to
   * stop a newline in it becoming a second line on FXServer's stdin. Every
   * argument here is machine-generated, so encoding one would hide its shape
   * from `runVerb`'s own argument check and gain nothing.
   *
   * SLICED TO THE FUNCTION rather than measured in characters: `switchRef`
   * further down the same file legitimately encodes a display name, and a
   * proximity window would eventually drift onto it and report a bug in the
   * wrong function.
   */
  const fnStart = ssh.indexOf('export async function spectatePlayer')
  if (fnStart === -1) {
    fail('transport', 'lib/ssh.ts no longer exports spectatePlayer')
  } else {
    const next = ssh.indexOf('\nexport ', fnStart + 1)
    const body = ssh.slice(fnStart, next === -1 ? undefined : next)
    if (/base64/i.test(body)) {
      fail(
        'transport',
        'spectatePlayer encodes an argument; none of the three is free text',
      )
    }
  }
}
console.log('  ok    one channel, three arguments in the pinned order, and the')
console.log('        audit row is written before the command is sent')

// ===========================================================================
// D. THE HARNESS
// ===========================================================================

console.log('\nD. /preview/profile — each half of the rule is falsifiable by eye')

{
  const preview = read('src/app/preview/profile/page.tsx')
  const cases = /const MOD_CASES = \{([\s\S]*?)\n\} as const/.exec(preview)

  if (!cases) {
    fail('harness', 'MOD_CASES is gone or has changed shape')
  } else {
    const body = codeOf(cases[1] ?? '')

    // A case with the TARGET in-game and the ADMIN out of it. Without one,
    // `online && adminOnline` and `online` render identically everywhere.
    if (!/online:\s*true,\s*adminOnline:\s*false/.test(body)) {
      fail(
        'harness',
        'no fixture holds the admin out of the game with the player still in it, so dropping `adminOnline` from the rule is invisible here',
      )
    }
    /**
     * AND NO FIXTURE HOLDS A SPECTATE SCOPE BACK, because none can.
     *
     * This assertion used to REQUIRE `canBan: true, canSpectate: false` — the
     * `spectate-noscope` case, "what every admin's grant row looks like the day
     * this ships". It shipped, every admin's row looked like that forever, and
     * the button was greyed for all of them. The fixture and the state it
     * depicted are both gone; what is left is the check that they stay gone.
     */
    if (/canSpectate/.test(body)) {
      fail(
        'harness',
        'a MOD_CASES fixture carries `canSpectate` again — Spectate has no scope, so there is no greyed state for a fixture to show',
      )
    }
    // And one where both are in-game, or nothing shows the button at all.
    if (!/online:\s*true,\s*adminOnline:\s*true/.test(body)) {
      fail('harness', 'no fixture draws a working Spectate button')
    }
  }

  // The case key itself, not just its contents — a fixture left in the ?mod=
  // axis with its scope field deleted would be a link to a state indistinguish-
  // able from `online`, and the axis nav renders every key.
  if (/'spectate-noscope'/.test(preview)) {
    fail('harness', '`spectate-noscope` is back in the ?mod= axis')
  }
}
console.log('  ok    admin-offline is present and no scope fixture has returned')

console.log()
if (failures > 0) {
  console.error(`check:actionbar FAILED with ${failures} problem(s)`)
  process.exit(1)
}
console.log('check:actionbar — all cases pass')
