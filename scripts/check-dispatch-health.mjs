/**
 * THE FOUR RULES THE DISPATCH-CHANNEL INDICATOR MAY NOT BREAK.
 *
 * ═══ WHY THIS IS A GATE ═══
 *
 * This feature exists because of an outage in which every piece of the console
 * behaved correctly and told nobody anything. The Host page rendered em-dashes
 * and the words "last update failed"; `GET /api/host` returned 200 with the
 * cause in its own body; the DynamoDB card stayed green because br_ddb reaches
 * AWS on a different transport; and `journalctl -u ringmaster` was empty,
 * because every failing path in `lib/telemetry` ended in a bare `catch {}`. An
 * hour, two machines, and the fix was `chown`.
 *
 * Every one of the ways that recurs is INVISIBLE to a typecheck, a lint and a
 * screenshot of a healthy console:
 *
 *   1. THE STATES COLLAPSE. Five failures with five different next actions —
 *      on three different machines — reduced to one red word, or two of them
 *      given the same label. The operator learns something is broken and not
 *      which of three boxes to open.
 *
 *   2. THE CAUSE LOSES TO THE SYMPTOM. When ssh cannot read the key it prints
 *      BOTH `Load key "…": Permission denied` AND, because it then had no
 *      identity to offer, `Permission denied (publickey,password)`. The second
 *      is louder and comes last. A classifier that matches it first sends the
 *      operator to the game box's authorized_keys for a problem that was
 *      `chown` on this one.
 *
 *   3. THE FAILURE IS NOT ON THE PAGE. A card that renders when the channel is
 *      healthy is worth nothing; the assertion that matters is that a FAILING
 *      channel is visible, with the machine's own words, on the Host page and
 *      in the chrome.
 *
 *   4. THE JOURNAL IS SILENT AGAIN. A `catch {}` reads as tidy and is how this
 *      outage cost an hour. Every catch in `lib/telemetry` must log.
 *
 * Rules 1 and 2 are checked EXHAUSTIVELY against real ssh output. Rules 3 and 4
 * are checked structurally, against the source, for the reason
 * check-deploy-phase.mjs records: this repo has three times had a change pass
 * every check while a component wired a correct function up wrongly.
 *
 * A PLAIN SCRIPT, matching check-ddb-health.mjs — this repo has no test
 * framework and adding one to assert three dozen cases would be the larger
 * change. It runs in `npm run verify`.
 *
 * IMPORTED FOR REAL, never re-implemented. `src/lib/dispatchHealth.ts` has no
 * runtime imports, so tsx loads the shipped functions and there is no second
 * copy here to drift.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DISPATCH_LABEL,
  dispatchFaults,
  dispatchNow,
  machineSaid,
} from '../src/lib/dispatchHealth.ts'
import { HOST_DISPATCH } from '../src/lib/__fixtures__/hostSamples.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

/** Comments discuss every one of these at length; only CODE may be searched. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL  ${msg}`)
}

const STATES = [
  'ok',
  'unconfigured',
  'key-unreadable',
  'unreachable',
  'rejected',
  'verb-failed',
  'unknown',
]

/** The states that are a stated failure of the channel, and so raise an alarm. */
const FAULTING = ['key-unreadable', 'unreachable', 'rejected', 'verb-failed']

/* ------------------------------------------------------------------ */
/* RULE 2 (FIRST, BECAUSE IT IS THE INCIDENT) — the cause beats the    */
/*         symptom                                                     */
/* ------------------------------------------------------------------ */

/**
 * THE STRING FROM THE OUTAGE, REPRODUCED FROM THE REPORT. Both `Permission
 * denied`s are in it, in the order ssh emits them, with the useless
 * `Command failed:` framing first — which is the whole difficulty.
 */
const INCIDENT =
  'Command failed: ssh -i /opt/ringmaster-secrets/dispatch -o BatchMode=yes ' +
  '-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ' +
  'ubuntu@10.1.148.227 status\n' +
  'Load key "/opt/ringmaster-secrets/dispatch": Permission denied\n' +
  'ubuntu@10.1.148.227: Permission denied (publickey,password).'

{
  const got = dispatchNow(true, INCIDENT, true)
  if (got !== 'key-unreadable') {
    fail(
      `the incident's own error classified as \`${got}\`, not \`key-unreadable\`. ` +
        'That message contains a real `Permission denied (publickey,password)` ' +
        'which was a SYMPTOM — ssh could not load the key, so it offered ' +
        'nothing and was refused. Matching the refusal first sends the operator ' +
        "to the game box's authorized_keys for a problem that was chown on this box.",
    )
  }
}

/**
 * AND THE SAME REFUSAL WITHOUT THE `Load key` LINE IS A DIFFERENT FAULT. This
 * is the pair: identical last line, different cause, different machine to open.
 * A classifier that gets one of these right by being blunt gets the other wrong.
 */
{
  const refusalOnly =
    'Command failed: ssh -i /opt/ringmaster-secrets/dispatch ubuntu@10.1.148.227 status\n' +
    'ubuntu@10.1.148.227: Permission denied (publickey,password).'
  const got = dispatchNow(true, refusalOnly, true)
  if (got !== 'rejected') {
    fail(
      `a bare publickey refusal classified as \`${got}\`, not \`rejected\` — the ` +
        'key loaded and the far side would not take it, which is a line in ' +
        'authorized_keys and not a file on this box',
    )
  }
  if (dispatchNow(true, INCIDENT, true) === dispatchNow(true, refusalOnly, true)) {
    fail(
      'the unreadable key and the refused key produce the SAME state. They end ' +
        'with the same line and they are two different machines to go and fix.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* RULE 1 — the states never collapse                                  */
/* ------------------------------------------------------------------ */

/**
 * REAL ssh AND execFile OUTPUT, one row per way this channel breaks. Written
 * out rather than sampled, because the classifier is a list of patterns and the
 * only thing that can go wrong with it is a message it does not recognise or
 * recognises as the wrong thing.
 */
const CLASSIFICATIONS = [
  ['key: permission denied (THE INCIDENT)', INCIDENT, 'key-unreadable'],
  [
    'key: missing file',
    'Command failed: ssh -i /opt/ringmaster/.ssh/dispatch ubuntu@10.1.148.227 status\n' +
      'Load key "/opt/ringmaster/.ssh/dispatch": No such file or directory\n' +
      'ubuntu@10.1.148.227: Permission denied (publickey).',
    'key-unreadable',
  ],
  [
    'key: world readable',
    '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n' +
      '@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n' +
      'Permissions 0644 for \'/opt/ringmaster/.ssh/dispatch\' are too open.',
    'key-unreadable',
  ],
  [
    'key: not a key',
    'Load key "/opt/ringmaster/.ssh/dispatch": invalid format',
    'key-unreadable',
  ],
  [
    'refused: publickey',
    'ubuntu@10.1.148.227: Permission denied (publickey,password).',
    'rejected',
  ],
  [
    'refused: host key changed',
    'Host key verification failed.',
    'rejected',
  ],
  [
    'refused: agent offered too many',
    'Received disconnect from 10.1.148.227 port 22:2: Too many authentication failures',
    'rejected',
  ],
  [
    'unreachable: timed out',
    'ssh: connect to host 10.1.148.227 port 22: Connection timed out',
    'unreachable',
  ],
  [
    'unreachable: refused',
    'ssh: connect to host 10.1.148.227 port 22: Connection refused',
    'unreachable',
  ],
  [
    'unreachable: no route',
    'ssh: connect to host 10.1.148.227 port 22: No route to host',
    'unreachable',
  ],
  [
    'unreachable: dns',
    'ssh: Could not resolve hostname game-box.internal: Name or service not known',
    'unreachable',
  ],
  [
    'unreachable: filtered mid-handshake',
    'ssh_exchange_identification: Connection closed by remote host',
    'unreachable',
  ],
  [
    'verb: dispatcher printed something else',
    'dispatch returned non-JSON: /opt/fivem/tools/dispatch.sh: line 84: tmux: command not found',
    'verb-failed',
  ],
  [
    'verb: an error with no transport fingerprint at all',
    'Command failed: ssh -i /opt/ringmaster/.ssh/dispatch ubuntu@10.1.148.227 status',
    'verb-failed',
  ],
]

for (const [label, text, want] of CLASSIFICATIONS) {
  const got = dispatchNow(true, text, true)
  if (got !== want) fail(`dispatchNow: ${label} -> \`${got}\`, expected \`${want}\``)
}

/** Every state the table is supposed to reach is reached by it. */
for (const state of FAULTING) {
  if (!CLASSIFICATIONS.some(([, , want]) => want === state)) {
    fail(`no error message in the table classifies as \`${state}\` — it is untested`)
  }
}

/**
 * THE LABELS ARE WHAT AN OPERATOR READS, so two states sharing one is the
 * collapse happening in the only place it is visible. Also: no failure may
 * borrow the em-dash, which means "not told" on every other card on that page,
 * and none may read as the healthy word.
 */
{
  const seen = new Map()
  for (const state of STATES) {
    const word = DISPATCH_LABEL[state]
    if (typeof word !== 'string' || word === '') {
      fail(`DISPATCH_LABEL has no word for \`${state}\``)
      continue
    }
    if (seen.has(word)) {
      fail(`\`${state}\` and \`${seen.get(word)}\` both render as "${word}"`)
    }
    seen.set(word, state)
  }
  if (DISPATCH_LABEL.unknown !== '—') {
    fail('unknown must render as the em-dash the rest of the card row uses for "not told"')
  }
  for (const state of FAULTING) {
    if (DISPATCH_LABEL[state] === '—') {
      fail(`\`${state}\` renders as the em-dash — that is the blank tile this change removes`)
    }
    if (DISPATCH_LABEL[state] === DISPATCH_LABEL.ok) {
      fail(`\`${state}\` renders as the healthy word`)
    }
  }
}

/**
 * ONE FAULT PER FAULTING STATE, WITH ITS OWN ID AND ITS OWN STEPS — and none at
 * all for the three that are not failures. `unconfigured` is in that second
 * group deliberately: GAME_HOST unset is a development box, and a red strip
 * across a console that was never pointed at a game server is a false critical
 * of exactly the kind DdbHealth refuses to raise.
 */
{
  const ids = new Set()
  for (const state of FAULTING) {
    const list = dispatchFaults(state)
    if (list.length !== 1) {
      fail(`dispatchFaults(${state}) produced ${list.length} faults, expected 1`)
      continue
    }
    const f = list[0]
    if (ids.has(f.id)) fail(`two states share the fault id \`${f.id}\``)
    ids.add(f.id)
    if (!f.title || !f.detail) fail(`the \`${state}\` fault has no title or no detail`)
    if (!Array.isArray(f.steps) || f.steps.length === 0) {
      fail(`the \`${state}\` fault carries no steps — the popup is what it is for`)
    }
  }
  for (const state of ['ok', 'unknown', 'unconfigured']) {
    if (dispatchFaults(state).length !== 0) {
      fail(`\`${state}\` raised an alarm. Only a STATED failure may.`)
    }
  }
}

/**
 * IT CLEARS ON RECOVERY AND THERE IS NOTHING TO DISMISS — the same property
 * `check-ddb-health.mjs` pins for `faults`, and for the same requirement: "these
 * elements cannot be dismissed until the problem is fixed". A second argument is
 * where an acknowledgement timestamp gets in.
 */
if (dispatchFaults.length !== 1) {
  fail(
    `dispatchFaults() takes ${dispatchFaults.length} arguments, expected exactly 1 ` +
      '(the reading). A second input is how "undismissable" becomes a flag that ' +
      'outlives the fault.',
  )
}
for (const state of FAULTING) {
  const before = dispatchFaults(state)
  if (dispatchFaults('ok').length !== 0) {
    fail(`recovery from \`${state}\` did not clear the alert`)
  }
  if (dispatchFaults(state).length !== before.length) {
    fail(`a regression to \`${state}\` did not raise the alert again`)
  }
}

/* ------------------------------------------------------------------ */
/* dispatchNow's other two inputs                                      */
/* ------------------------------------------------------------------ */

/** Unconfigured wins over everything — including an error left in memory. */
for (const text of [null, undefined, '', INCIDENT]) {
  if (dispatchNow(false, text, true) !== 'unconfigured') {
    fail('an unconfigured console must read `unconfigured` whatever else is held')
  }
}

/**
 * AND THE COLD CONSOLE IS SILENT. The poll timer starts lazily, on the first
 * authenticated request to /api/host, so "no error and never polled" is the
 * normal state of a console nobody has opened the Host page on yet. Reporting
 * that as either healthy or broken would be a claim.
 */
if (dispatchNow(true, null, false) !== 'unknown') {
  fail('a console whose poll has never run must read `unknown`, not a verdict')
}
if (dispatchNow(true, null, true) !== 'ok') {
  fail('a poll that landed with no error must read `ok`')
}
if (dispatchNow(true, '', true) !== 'ok') {
  fail('an empty error string is not an error')
}

/* ------------------------------------------------------------------ */
/* the one line the card has room for                                  */
/* ------------------------------------------------------------------ */

/**
 * `machineSaid` DECIDES WHAT THE OPERATOR SEES WITHOUT CLICKING, and getting it
 * wrong reproduces the original defect in miniature: `execFile` puts
 * `Command failed: ssh -i … -o BatchMode=yes …` FIRST, so a naive first-line
 * render shows a hundred characters of our own arguments and truncates away the
 * line that names the fault.
 */
{
  const line = machineSaid(INCIDENT)
  if (/^Command failed:/.test(line)) {
    fail(
      'the card line leads with execFile\'s "Command failed: ssh …" framing — ' +
        'that is the console reading its own arguments back to the operator, ' +
        'and it pushes the cause past the truncation',
    )
  }
  if (!line.startsWith('Load key')) {
    fail(`the card line leads with "${line.slice(0, 60)}…" rather than the cause`)
  }
  /** The symptom is still carried; it is ordered behind the cause, not dropped. */
  if (!line.includes('publickey')) {
    fail('the card line dropped part of what the machine said rather than reordering it')
  }
}

/** A message that is not execFile's framing is never truncated by this. */
{
  const bare = 'ssh: connect to host 10.1.148.227 port 22: Connection timed out'
  if (machineSaid(bare) !== bare) {
    fail('machineSaid ate a line from a message that had no command-line prefix')
  }
  if (machineSaid('Command failed: ssh -i /k host status') === '') {
    fail('machineSaid returned nothing for a message that was only the prefix')
  }
}

/* ------------------------------------------------------------------ */
/* RULE 3 — the failing channel is ON THE PAGE                         */
/* ------------------------------------------------------------------ */

/**
 * THE ASSERTION THIS WHOLE GATE IS FOR. A card that renders when the channel is
 * healthy is worth nothing — the console already had one of those for DynamoDB
 * and it was green throughout the outage. What has to be true is that a stated
 * failure reaches the Host page, carrying the words the machine used.
 */
{
  const board = code(read('src/components/HostBoard.tsx'))

  if (!/dispatchFaults\(/.test(board)) {
    fail(
      'HostBoard does not call dispatchFaults — the card is not derived from the ' +
        'same reading as the chip and the strip, so they can disagree',
    )
  }
  if (!/DISPATCH_LABEL\[/.test(board)) {
    fail('HostBoard does not render DISPATCH_LABEL — there is no state word on the card')
  }

  /**
   * THE MESSAGE ITSELF, WHICH IS THE POINT. `lastError` was in this payload
   * throughout the outage and no surface read it. Rendering it through
   * `machineSaid` is what turns an hour into ten seconds.
   */
  if (!/machineSaid\(view\.lastError\)/.test(board)) {
    fail(
      'HostBoard does not print view.lastError. That field carried the cause of ' +
        'the outage in /api/host the entire time and the page showed the ' +
        'operator nothing — this is the change.',
    )
  }

  /** And the full text has to be reachable, because the card truncates it. */
  if (!/<FaultDialog/.test(board) || !/lastError=\{view\.lastError\}/.test(board)) {
    fail(
      'the Host page truncates the error with no way to reach the whole of it — ' +
        'an ssh command line runs to hundreds of characters and reproducing the ' +
        'call by hand is the next thing an operator does',
    )
  }

  /** The vague line it replaced must not quietly come back beside it. */
  if (/last update failed/.test(board)) {
    fail(
      '"last update failed" is back on the Host page. Five words in the footer, ' +
        'in warn, with no message and nothing to press, was the console\'s entire ' +
        'account of the outage.',
    )
  }
}

/**
 * AND IN THE CHROME, ON EVERY PAGE, because the Host page is the one you have
 * to already suspect. The br_ddb alarm is a chip and a strip for exactly this
 * reason and this rides the same mechanism.
 */
{
  const surface = code(read('src/components/DdbHealth.tsx'))
  const shell = code(read('src/components/AppShell.tsx'))

  for (const name of ['DispatchHealthChip', 'DispatchHealthBanner']) {
    if (!new RegExp(`export function ${name}\\b`).test(surface)) {
      fail(`DdbHealth.tsx does not export ${name}`)
    }
    if (!new RegExp(`<${name}\\b`).test(shell)) {
      fail(`AppShell does not render ${name} — the alarm is only on the Host page`)
    }
  }

  /**
   * REUSED RATHER THAN REBUILT. The whole argument for putting this in
   * DdbHealth.tsx is that check-ddb-health.mjs's sweep of that file for
   * localStorage, a dismissed flag, a snooze and an import of the chip
   * precedence rule then covers the new alarm for free. A second surface file
   * would be a second place for "undismissable" to be re-argued, and it would
   * not be swept.
   */
  if (!/dispatchFaults/.test(surface)) {
    fail(
      'the chrome surfaces do not derive from dispatchFaults — see the reuse ' +
        'argument at the top of DdbHealth.tsx',
    )
  }
  if (!/export function FaultDialog\b/.test(surface)) {
    fail(
      'FaultDialog is no longer exported, so the Host page card cannot open the ' +
        'same popup the chip and the strip do — two popups is two sets of steps',
    )
  }

  /**
   * ONE POLL FOR BOTH SUBJECTS. Two pollers of /api/host is two readings that
   * can disagree about the same instant, which on an alarm is the failure mode.
   */
  const fetches = (surface.match(/fetch\('\/api\/host'/g) ?? []).length
  if (fetches !== 1) {
    fail(`DdbHealth.tsx polls /api/host ${fetches} times; the two alarms must share one`)
  }
}

/** The reading has to be computed and shipped, or every surface reads unknown. */
{
  const tel = code(read('src/lib/telemetry.ts'))
  if (!/dispatch:\s*dispatchNow\(/.test(tel)) {
    fail('hostView() does not resolve `dispatch` — /api/host ships no reading to render')
  }
  if (!/lastError:\s*state\.lastError/.test(tel)) {
    fail('hostView() no longer ships lastError, which is the string the whole feature renders')
  }
}

/* ------------------------------------------------------------------ */
/* RULE 4 — the journal is not silent                                  */
/* ------------------------------------------------------------------ */

/**
 * EVERY CATCH IN lib/telemetry SAYS SOMETHING. `journalctl -u ringmaster` was
 * empty for the whole outage because the failing paths in that file ended in a
 * bare `catch {}` with a comment explaining why the failure was survivable —
 * which it was. Surviving a failure and swallowing it are two decisions.
 *
 * BRACE-MATCHED RATHER THAN GREPPED. A regex for `catch {}` catches only the
 * empty case; the interesting regression is a catch that does three things and
 * says nothing.
 */
{
  const tel = code(read('src/lib/telemetry.ts'))
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g
  let m
  let blocks = 0
  let quiet = 0
  while ((m = re.exec(tel)) !== null) {
    blocks++
    let depth = 1
    let i = m.index + m[0].length
    for (; i < tel.length && depth > 0; i++) {
      if (tel[i] === '{') depth++
      else if (tel[i] === '}') depth--
    }
    const body = tel.slice(m.index + m[0].length, i - 1)
    if (!/console\./.test(body)) {
      quiet++
      fail(
        `a catch in lib/telemetry.ts swallows its failure silently: ` +
          `\`${body.trim().replace(/\s+/g, ' ').slice(0, 70)}\``,
      )
    }
  }
  if (blocks === 0) {
    fail('found no catch blocks in lib/telemetry.ts — this check has stopped checking')
  }
  if (quiet === 0 && blocks < 3) {
    fail(
      `only ${blocks} catch block(s) found in lib/telemetry.ts; the three that ` +
        'went silent during the outage were the poll, the branches read and the ' +
        'forced status read',
    )
  }
}

/**
 * AND THE STARTUP CHECK IS LOUD AND NOT FATAL. "A console that refuses to start
 * because it cannot reach the game box is worse than one that starts and says
 * so loudly" — so the one thing this file may never do is stop the boot.
 */
{
  const boot = code(read('src/instrumentation.ts'))
  if (!/console\.error/.test(boot)) {
    fail('the startup check never writes an error — it exists to be read in the journal')
  }
  if (/process\.exit/.test(boot)) {
    fail(
      'the startup check calls process.exit. Loud and running beats dead: a ' +
        'console that will not start is one you cannot use to find out why.',
    )
  }
  if (/\bthrow\b/.test(boot)) {
    fail('the startup check throws. A failed probe must not be able to stop the service.')
  }
  if (!/void startupProbe\(\)/.test(boot)) {
    fail(
      'register() awaits the probe — that puts an SSH round trip between systemd ' +
        'starting the unit and the first request being served',
    )
  }
  /** The check that is the incident, and the one that needs no network. */
  if (!/access\(key, constants\.R_OK\)/.test(boot)) {
    fail('the startup check does not test that the running user can READ the key')
  }
  if (!/getuid/.test(boot) || !/s\.uid/.test(boot)) {
    fail(
      'the startup check does not print the running uid beside the key owner. ' +
        'The key was already 600; what was wrong was whose 600 it was.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* the harness can reach every state without an outage                 */
/* ------------------------------------------------------------------ */

/**
 * THESE STATES ARE OTHERWISE UNREVIEWABLE — seeing one for real means a console
 * whose key is genuinely unreadable or a game box that is genuinely down. The
 * page spent an hour of a real outage in a shape nobody had ever looked at.
 *
 * THE FIXTURES ARE CLASSIFIED, NOT ASSERTED. Each carries an error string and
 * the state it claims to be; running the shipped classifier over it is what
 * stops the harness from quietly reviewing a state the real code never produces.
 */
for (const [key, fx] of Object.entries(HOST_DISPATCH)) {
  if (!STATES.includes(fx.dispatch)) {
    fail(`HOST_DISPATCH.${key} claims the unknown state \`${fx.dispatch}\``)
    continue
  }
  if (fx.lastError) {
    const got = dispatchNow(true, fx.lastError, true)
    if (got !== fx.dispatch) {
      fail(
        `HOST_DISPATCH.${key} is labelled \`${fx.dispatch}\` but its own error text ` +
          `classifies as \`${got}\` — the harness is reviewing a state the app cannot produce`,
      )
    }
  } else if (FAULTING.includes(fx.dispatch)) {
    fail(`HOST_DISPATCH.${key} is a failure with no error text; the card would have no line`)
  }
}
for (const state of FAULTING) {
  if (!Object.values(HOST_DISPATCH).some((f) => f.dispatch === state)) {
    fail(`no fixture reaches \`${state}\` — that state cannot be reviewed before it happens`)
  }
}

/* ------------------------------------------------------------------ */

if (failed) {
  console.error(`\ndispatch health: ${failed} check(s) failed.`)
  console.error(
    'The cause must beat the symptom, the five states must never collapse into ' +
      'one word, a FAILING channel must be visible on the Host page carrying the ' +
      "machine's own message, and no catch in lib/telemetry may be silent — see " +
      'src/lib/dispatchHealth.ts',
  )
  process.exit(1)
}
console.log(
  `dispatch health: ${CLASSIFICATIONS.length} real ssh failures classify to ` +
    `${FAULTING.length} distinct faults, the cause outranks the symptom, the ` +
    `Host page renders the message, ${Object.keys(HOST_DISPATCH).length} fixtures ` +
    'agree with the classifier, and the journal is not silent',
)
