/**
 * WHAT ACTUALLY HAPPENED TO A COMMAND WE SENT THE GAME HOST — fivem-ringmaster#42.
 *
 * ═══ THE OWNER'S SECOND COMMENT, WHICH THIS FILE EXISTS TO ANSWER ═══
 *
 * "the response from the bot shouldn't be when it sent to ringmaster, but
 * instead what it receives from ringmaster which should be something along the
 * lines of 'done/failed' and not just 'acknowledged'".
 *
 * `POST /api/kick` used to answer `{ ok: true, accepted: true }` for everything
 * that did not throw, and throw one 502 sentence for everything that did. So a
 * kick the game box REFUSED and a kick that never reached the box at all came
 * back identical, and a kick that was merely handed to a terminal came back
 * looking finished. `accepted: true` is receipt. The bot cannot write a sentence
 * for an admin out of receipt.
 *
 * ═══ WHAT IS ACTUALLY DISTINGUISHABLE, WHICH IS NOT WHAT ONE WOULD WANT ═══
 *
 * Walking `lib/ssh.ts` and the dispatcher contract, the console can tell these
 * apart and no others:
 *
 *   not-configured  GAME_HOST / GAME_SSH_KEY are unset. Nothing was sent, and
 *                   nothing was going to be. An operator fixes this, not an
 *                   admin.
 *   unreachable     `runVerb` rejected: connect timeout, auth failure, the
 *                   six-second wall, or an answer that was not JSON. We do not
 *                   know that the box heard anything.
 *   refused         The dispatcher answered, structurally, and said no —
 *                   `do_kick` exits non-zero with a JSON line on a malformed
 *                   license and friends (see the exit-code note in `runVerb`).
 *                   A definite negative with a reason attached.
 *   dispatched      The dispatcher answered `ok`. `tmux send-keys` typed the
 *                   command into the live FXServer console.
 *
 * ═══ AND `done` IS NOT ONE OF THEM, WHICH IS SAID OUT LOUD RATHER THAN FUDGED ═══
 *
 * There is NO fifth state for "the player was actually removed", because this
 * console has no way to learn it. `lib/ssh.ts` says the outcome "arrives
 * separately as an outcome event carrying `commandId`" — and today nothing
 * does: `/api/ingest` has no handler for one, `lib/audit` has no lookup by
 * `commandId` (it says so where `resolve` explains why it takes `ts`), and every
 * `player.kick` row in the table therefore stays `pending` for good. So the
 * confirmation channel that sentence describes is a plan, not a thing that runs.
 *
 * The honest consequence is that `dispatched` CARRIES `confirmed: false` rather
 * than being reported as success. The bot can say "sent to the server" and must
 * not say "done"; the day an outcome event exists, this gains an `outcome:
 * 'done'` with `confirmed: true` and the bot's wording changes in one place.
 * Inventing that state now would be the console claiming knowledge it does not
 * have — the same claim `/api/kick` already refuses to make when it deliberately
 * leaves the audit row `pending`. The response and the row now agree; before
 * this file, the row said "unknown" while the response said "accepted".
 *
 * ═══ ONE CLASSIFIER, BECAUSE TWO ROUTES SEND THIS COMMAND ═══
 *
 * `/api/kick` and `/api/bans` both call `kickPlayer`, and before this they wrote
 * the same try/catch out twice and reported it in two different shapes. A bot
 * that has to word `/brkick` and `/brban` differently because of that is being
 * asked to model an accident.
 *
 * PURE, AND THE DISPATCH IS INJECTED — nothing here opens an SSH connection, so
 * `service.check.ts` walks every branch offline.
 */

/** Why a command did not happen. Machine codes; the bot writes the sentence. */
export type CommandFailure = 'not-configured' | 'unreachable' | 'refused'

export type CommandOutcome =
  | {
      outcome: 'dispatched'
      /**
       * ALWAYS `false`, AND IT IS A FIELD RATHER THAN AN OMISSION so that a
       * reader has to look at it. See the header: nothing in this system reports
       * whether the player was really removed, so a caller that treats
       * `dispatched` as `done` is wrong and the type says which.
       */
      confirmed: false
    }
  | {
      outcome: 'failed'
      failure: CommandFailure
      /**
       * The game host's own words, or the transport error. Passed through
       * unedited: it is the half an admin can act on ("that is not a license"),
       * and rewriting it here would put this file between them and the truth.
       */
      detail: string
    }

/**
 * The failed half, named so a helper that only ever handles failures can SAY so
 * in its signature instead of re-narrowing at every call site.
 */
export type CommandFailed = Extract<CommandOutcome, { outcome: 'failed' }>

/** The one shape `lib/ssh.ts` answers a dispatch verb in. */
interface DispatchAnswer {
  ok: boolean
  error?: string
}

/**
 * Run one kick and classify what came back.
 *
 * THE TWO FAILURES ARE SEPARATED HERE AND NOWHERE ELSE, which is the whole
 * reason this is a function rather than a type. `runVerb` folds a deliberate
 * refusal and a dead link into the same `catch` for its callers — it resolves
 * with `{ ok: false }` for the first and rejects for the second — and both
 * routes then wrote `throw new Error(res.error ?? 'kick refused')`, which threw
 * the distinction away one line after receiving it.
 *
 * NEVER THROWS. Every path out of here is a `CommandOutcome`, so a caller cannot
 * accidentally report a transport failure as a refusal by forgetting a branch.
 */
export async function dispatchKick(
  run: () => Promise<DispatchAnswer>,
): Promise<CommandOutcome> {
  let answer: DispatchAnswer
  try {
    answer = await run()
  } catch (e) {
    return {
      outcome: 'failed',
      failure: 'unreachable',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  if (answer.ok) return { outcome: 'dispatched', confirmed: false }

  return {
    outcome: 'failed',
    failure: 'refused',
    // The same fallback the routes used before this file existed, kept so a
    // dispatcher that refuses without saying why reads exactly as it always did.
    detail: answer.error?.trim() || 'kick refused',
  }
}

/** The channel is not wired up at all. Nothing was attempted. */
export function channelNotConfigured(): CommandFailed {
  return {
    outcome: 'failed',
    failure: 'not-configured',
    detail: 'The command channel to the game server is not configured.',
  }
}

/**
 * The sentence an ADMIN reads, for the browser's error toast.
 *
 * THE BOT DOES NOT READ THIS. It branches on `failure` and writes its own words
 * in Discord — that is the entire reason the code and the prose are separate
 * fields. This exists because the dialogs already showed a sentence and must go
 * on showing one.
 *
 * `unreachable` IS THE ONE WORDING THAT CHANGED, and it changed because it was
 * wrong: a connect timeout was being reported as "the game server refused the
 * kick", which sends an admin to look for a rule that refused them when the box
 * simply was not answering.
 */
export function failureMessage(outcome: CommandFailed): string {
  switch (outcome.failure) {
    case 'not-configured':
      return outcome.detail
    case 'unreachable':
      return `The game server could not be reached: ${outcome.detail}`
    case 'refused':
      return `The game server refused the kick: ${outcome.detail}`
  }
}

/**
 * The HTTP status for a failed command.
 *
 * 502 FOR BOTH REACHABLE-AND-REFUSED AND UNREACHABLE, which is what this path
 * already answered before the two were told apart — the distinction now travels
 * in `failure`, where it can be acted on, rather than in a status code that the
 * browser and the bot would both have to reverse-engineer. 503 for an
 * unconfigured channel, because that is this console not being ready.
 */
export function failureStatus(outcome: CommandFailed): number {
  return outcome.failure === 'not-configured' ? 503 : 502
}
