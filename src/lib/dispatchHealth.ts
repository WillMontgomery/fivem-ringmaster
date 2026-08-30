import type { Fault } from './ddbHealth'

/**
 * THE CHANNEL EVERY OTHER READING ON THE HOST PAGE ARRIVES OVER.
 *
 * `lib/ssh` is the one wire to the game box: `status` and `telemetry` on the
 * fifteen-second poll, `branches` for the picker, `kick`, `spectate`, `deploy`
 * and `switchref`. The console had an indicator for DynamoDB — which the game
 * box reaches on its OWN transport — and none at all for this one.
 *
 * ═══ WHY THAT GAP COST AN HOUR ═══
 *
 * The Host page went blank: every tile an em-dash, "0 samples", and a footer
 * reading "last update failed". The branch picker 502'd. `GET /api/host`
 * answered 200 the entire time with the cause in its own body:
 *
 *     lastError: 'Command failed: ssh -i /opt/ringmaster-secrets/dispatch …
 *                 Load key "/opt/ringmaster-secrets/dispatch": Permission denied
 *                 ubuntu@10.1.148.227: Permission denied (publickey,password).'
 *
 * The unit ran as one user and the private key was mode 600 owned by another.
 * `chown` fixed it in seconds; FINDING it took browser devtools and an hour,
 * because nothing rendered the string the app already had. Meanwhile the
 * DynamoDB card stayed green and actively misled us — br_ddb reaches AWS from
 * the game box and does not care whether this console can log in.
 *
 * ═══ THE STATES ARE FIVE BECAUSE THE NEXT ACTIONS ARE FIVE ═══
 *
 * A single red "SSH down" light would have been no better than the blank
 * tiles. What an operator does next is entirely determined by WHERE the call
 * stopped, and the five places are on three different machines:
 *
 *   unconfigured    nothing is set up          → this box's .env.local
 *   key-unreadable  the local key won't load   → this box's filesystem  ← the incident
 *   unreachable     no session opened          → the network between them
 *   rejected        the far side said no       → the game box's authorized_keys
 *   verb-failed     it logged in and failed    → the game box's dispatch.sh
 *
 * THE BRIEF FOR THIS WORK NAMED FOUR AND `rejected` IS THE FIFTH, added on the
 * evidence of the incident itself. That error text contains a real
 * `Permission denied (publickey,password)` — and it was a SYMPTOM: ssh could
 * not load the key, so it offered nothing and was refused. Folding a genuine
 * publickey refusal into "cannot reach the host" would point the next operator
 * at the network for a problem that lives in a file on the game box, which is
 * the same class of misdirection as the green DynamoDB card.
 *
 * ═══ NOTHING HERE REACHES A SERVER ═══
 *
 * No runtime imports at all — the same property `lib/ddbHealth` keeps and for
 * the same reason: the chip and the strip are client components, and `lib/ssh`
 * touches `node:child_process` at module scope. The one import below is a TYPE
 * and is erased at compile.
 */

/**
 * WHAT THE CHANNEL IS DOING, RESOLVED TO ONE WORD.
 *
 * `unknown` IS A REAL MEMBER AND IT IS NOT A FAILURE — a console whose poll
 * timer has not run yet (it starts lazily, on the first authenticated request
 * to `/api/host`) has not been told anything. Rendering that as red would be a
 * false alarm on every cold start, which is how an operator learns to ignore
 * the true one. The same rule `reachNow` follows.
 */
export type Dispatch =
  | 'ok'
  | 'unconfigured'
  | 'key-unreadable'
  | 'unreachable'
  | 'rejected'
  | 'verb-failed'
  | 'unknown'

/**
 * The signatures, in the order they are tried, and the order IS the contract.
 *
 * ═══ THE LOCAL KEY IS TESTED BEFORE THE REMOTE REFUSAL, ALWAYS ═══
 *
 * ssh emits BOTH lines when it cannot read the key: `Load key "…": Permission
 * denied` and then, because it had no identity left to offer,
 * `user@host: Permission denied (publickey,password)`. The second is louder,
 * comes last, and is the one a person skims to. Matching it first would have
 * classified the actual incident as `rejected` and sent the operator to the
 * game box's `authorized_keys` for a problem that was `chown` on this box.
 *
 * `check-dispatch-health.mjs` pins that ordering against the incident's own
 * string, so reordering these entries fails the gate rather than review.
 *
 * THE REFUSAL PATTERN IS `Permission denied (publickey` AND NOT `Permission
 * denied`, which is the other half of the same trap: the bare phrase also
 * appears in the `Load key` line, so a looser pattern here would match the
 * local fault even in the right order.
 */
const SIGNATURES: ReadonlyArray<readonly [Exclude<Dispatch, 'ok' | 'unknown'>, RegExp]> = [
  /**
   * `runVerb` rejects with this before it spawns anything when either variable
   * is unset. Reachable through a caller that ran before the env was read.
   */
  ['unconfigured', /\bssh not configured\b/],

  /**
   * EVERY WAY ssh REPORTS THAT THE IDENTITY FILE ON THIS BOX IS UNUSABLE.
   * `Permission denied` (the incident), `No such file or directory` (wrong
   * path), `bad permissions` and the UNPROTECTED banner (world-readable),
   * `invalid format` (a public key or a PEM it cannot parse). All five are one
   * next action — look at that file, on this machine — so they are one state.
   */
  ['key-unreadable', /Load key "[^"]*":|UNPROTECTED PRIVATE KEY FILE|No such identity/i],

  /**
   * The far side answered and would not let us in. `Host key verification
   * failed` belongs here rather than with the transport: the session reached a
   * real host, and what failed is that the two ends disagree about who it is.
   */
  ['rejected', /Permission denied \(publickey|Too many authentication failures|Host key verification failed/i],

  /**
   * No session at all. DNS, route, filter, or a box that is not up.
   * `ssh_exchange_identification` and `Connection closed by` are in here
   * because they are what a TCP filter and a dying sshd look like from this
   * end — the login never happened.
   */
  [
    'unreachable',
    /Connection timed out|Connection refused|No route to host|Network is unreachable|Could not resolve hostname|Operation timed out|ssh_exchange_identification|Connection closed by|Connection reset|connect to host .+ port \d+/i,
  ],

  /**
   * The channel worked and the answer did not. `runVerb` raises the first when
   * stdout is not the single JSON line the dispatcher is supposed to print.
   */
  ['verb-failed', /dispatch returned non-JSON|Unexpected token|not valid JSON/i],
]

/**
 * ANYTHING UNRECOGNISED IS `verb-failed`, AND THE RESIDUAL IS DELIBERATE.
 *
 * Every pattern above is a transport-level fingerprint. An error that matches
 * none of them got past the parts of ssh that announce themselves — including
 * the six-second `execFile` wall, which fires with no stderr at all and, given
 * `ConnectTimeout=5` announces its own failures in text first, means the
 * session opened and the far side hung.
 *
 * IT IS HONEST BECAUSE THE MACHINE'S OWN WORDS TRAVEL BESIDE IT. The surfaces
 * render `lastError` verbatim, so an unclassified failure is never reduced to
 * this label — the operator reads the same string we could not parse. A sixth
 * "something else" state would add a word to the card and nothing to the page.
 */
const RESIDUAL: Dispatch = 'verb-failed'

/**
 * The channel, right now, from the poller's two facts.
 *
 * `lastError` WINS OVER EVERYTHING BUT CONFIGURATION, because `lib/telemetry`
 * deliberately keeps the last good `status` after a failed poll — a graph that
 * blanks on one dropped round trip is worse than one that holds its shape. So
 * a held reading is NOT evidence the channel works, and only the absence of an
 * error is.
 *
 * `polled` IS THE THIRD ARGUMENT AND IT ONLY EVER SEPARATES `ok` FROM
 * `unknown`. Without it a console that has never run the timer is
 * indistinguishable from one whose last poll succeeded, and the honest answer
 * for the first is silence.
 */
export function dispatchNow(
  configured: boolean,
  lastError: string | null | undefined,
  /** Has the timer ever landed a reading? `statusAt > 0` in lib/telemetry. */
  polled: boolean,
): Dispatch {
  if (!configured) return 'unconfigured'
  if (typeof lastError !== 'string' || lastError === '') {
    return polled ? 'ok' : 'unknown'
  }
  for (const [state, re] of SIGNATURES) {
    if (re.test(lastError)) return state
  }
  return RESIDUAL
}

/**
 * THE PART OF THE ERROR THAT IS AN ANSWER, FOR THE ONE LINE THE CARD HAS ROOM
 * FOR.
 *
 * `execFile` prefixes every failure with `Command failed: ` and the whole
 * command line — which here is a hundred-odd characters of `ssh -i … -o
 * BatchMode=yes -o ConnectTimeout=5 …` that this console composed itself. It is
 * the LEAST informative line in the message and it is the FIRST, so a naive
 * "show the first line" on the Host page would have rendered our own arguments
 * back at the operator and pushed `Load key "…": Permission denied` off the
 * end. That is close enough to the original defect to be worth a function.
 *
 * SO: DROP OUR OWN COMMAND, KEEP WHAT ssh AND THE FAR SIDE SAID, in order,
 * joined so the cause leads. On the incident's message this yields
 *
 *   Load key "…/dispatch": Permission denied · ubuntu@…: Permission denied (publickey,password).
 *
 * whose first words are the fault.
 *
 * IT ONLY EVER DROPS A LINE IT RECOGNISES, and never the only line there is: a
 * message that is not `execFile`'s framing is returned whole. Nothing here
 * interprets, summarises or shortens the text — the popup still renders the
 * full original including the command line, because reproducing the call by
 * hand is the next thing an operator does.
 */
export function machineSaid(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const rest = /^Command failed:/.test(lines[0] ?? '') ? lines.slice(1) : lines
  return (rest.length > 0 ? rest : lines).join(' · ')
}

/**
 * What the card says. `Connected` is `REACH_LABEL`'s word, on purpose — the two
 * cards sit on one row and answer the same shape of question, so a second
 * spelling for the healthy case would read as a second meaning.
 *
 * EVERY FAILING STATE IS A DISTINCT WORD AND NONE OF THEM IS THE EM-DASH. The
 * em-dash means "not told" everywhere on this page; a failure that borrowed it
 * would be the blank tile this whole change exists to remove.
 *
 * `unconfigured`'s WORD IS THE ONE THE CARD NEVER SHOWS, and that is not an
 * oversight. `HostBoard` returns the whole-page "not configured yet" panel
 * before the card row in that state — a display the owner settled and one that
 * already says this. The entry exists because this is a total map over
 * `Dispatch` and because the preview harness reviews the state; if that panel
 * ever goes, this is what the card falls back to.
 */
export const DISPATCH_LABEL: Record<Dispatch, string> = {
  ok: 'Connected',
  unconfigured: 'Not configured',
  'key-unreadable': 'Key unreadable',
  unreachable: 'Unreachable',
  rejected: 'Key refused',
  'verb-failed': 'No answer',
  unknown: '—',
}

/**
 * WHAT IS WRONG WITH THE CHANNEL RIGHT NOW — one argument, no flag.
 *
 * SAME SIGNATURE DISCIPLINE AS `faults(reach, bundle)` AND FOR THE SAME
 * REASON. The owner's rule for the br_ddb alarm was that it "cannot be
 * dismissed until the problem is fixed", and the way that is built here is by
 * having nothing to dismiss: every surface renders this function of the
 * current reading, so it clears the poll after the channel recovers and comes
 * straight back if it breaks again. A second argument is where an
 * acknowledgement timestamp gets in; `check-dispatch-health.mjs` pins the
 * arity.
 *
 * `lastError` IS NOT AN ARGUMENT. It travels beside the fault to the popup,
 * exactly as `DdbProbe` does — the words the machine used are worth rendering
 * and are worthless for deciding WHICH fault this is, which is what this
 * function does.
 *
 * `unconfigured` RAISES NOTHING, and that is the same call `DdbHealth` makes
 * for an unconfigured console: `GAME_HOST` unset is the normal state of a
 * development box and of this console before the game host was ever wired up.
 * A red strip across a console that was never pointed at a server is a false
 * critical. The card still says `Not configured`, which is a reading rather
 * than an alarm.
 */
export function dispatchFaults(state: Dispatch): Fault[] {
  switch (state) {
    case 'key-unreadable':
      return [
        {
          id: 'dispatch-key-unreadable',
          title: 'The console cannot read its dispatch key',
          detail:
            'ssh could not load GAME_SSH_KEY on this box. Host telemetry, the ' +
            'branch list and every deploy go over that key.',
          /**
           * THE OWNERSHIP STEP IS FIRST BECAUSE IT IS THE ONE THAT HAPPENED.
           * `docs/deploy.md` documents the unit as `User=ubuntu`; production
           * has run as a different user; the key was left owned by `ubuntu`.
           * Nothing reconciles those three, so the first thing to establish is
           * which user the service is actually running as.
           */
          steps: [
            'systemctl show ringmaster -p User — that is the user that has to read the key.',
            'ls -l on the GAME_SSH_KEY path and compare the owner.',
            'sudo chown <that user> <key> && sudo chmod 600 <key>',
            'sudo systemctl restart ringmaster',
          ],
        },
      ]

    case 'unreachable':
      return [
        {
          id: 'dispatch-unreachable',
          title: 'The console cannot reach the game box',
          detail: 'ssh did not open a session to GAME_HOST.',
          steps: [
            'Check the game box is up.',
            'Check its security group allows port 22 from this box over the peering link.',
            'Check GAME_HOST is the private address of that box on the link.',
          ],
        },
      ]

    case 'rejected':
      return [
        {
          id: 'dispatch-rejected',
          title: 'The game box refused the dispatch key',
          detail: 'ssh reached GAME_HOST and the key was not accepted.',
          steps: [
            'Check the public half of GAME_SSH_KEY is in the authorized_keys of GAME_SSH_USER on the game box.',
            'Check the forced command on that line still runs tools/dispatch.sh.',
            'If the host key changed, remove its line from known_hosts beside GAME_SSH_KEY.',
          ],
        },
      ]

    case 'verb-failed':
      return [
        {
          id: 'dispatch-verb-failed',
          title: 'The dispatcher did not answer',
          detail:
            'The channel opened and the command did not come back with a usable ' +
            'answer.',
          steps: [
            'Run tools/dispatch.sh status on the game box.',
            'Check FXServer and its tmux session are up there.',
          ],
        },
      ]

    default:
      return []
  }
}
