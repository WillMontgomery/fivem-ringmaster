/**
 * Contract checks for how the ACTING ADMIN is resolved to a license.
 *
 *   npx tsx src/lib/grants.check.ts
 *
 * A PLAIN SCRIPT, matching `origin.check.ts`, `handoff.check.ts` and
 * `discordRole.check.ts`: this repo has no test framework. IT IS WIRED INTO
 * `npm run verify` as `check:adminlicense`; a check nothing runs is this
 * repository's signature failure mode.
 *
 * ═══ THE BUG THIS EXISTS FOR ═══
 *
 * The audit log rendered one admin's name as a link and another's as plain
 * text, on rows where THE SAME PERSON was linked as the target. The render is
 * symmetric (`PersonLink` in components/AuditList.tsx), so the asymmetry was in
 * the data: `targetLicense` was set and `actorLicense` was null on one row.
 *
 * `actorLicense` came from ONE place — a `ringmaster-grants` row written BY HAND
 * (`scripts/grant.mjs`; docs/aws-setup.md says so in as many words). Until
 * 4078d47 that was self-correcting, because the same row carried the scopes and
 * `authorize()` refused a null license on every route including reads. That
 * commit removed the gate and made the row optional. It did not make it
 * unnecessary, so an admin made an admin the new way — the Discord role, and
 * nothing in DynamoDB — acted with full authority and signed every row null.
 *
 * ═══ WHAT THIS ACTUALLY EXERCISES ═══
 *
 *   A. THE RULE — `licenseForDiscordId` from `lib/grants.ts`, as shipped,
 *      driven through its `LicenseLookup` seam with fakes. Not a second copy of
 *      the rules.
 *   B. THE WIRING — that `lib/session.ts` calls it AND hands it
 *      `players.licensesFor` as the second source. A resolver nobody invokes,
 *      or one invoked with only the source that was already broken, is the
 *      failure A cannot see.
 *   C. THE DESTINATION — that `lib/actions.ts` still builds the audit actor from
 *      `admin.license`. A correct license that never reaches `audit.begin`
 *      changes nothing on the page the owner was looking at.
 *
 * B and C read source with COMMENTS STRIPPED FIRST, because a check that
 * matches its own explanatory prose asserts nothing, and that has happened in
 * these repos.
 *
 * ═══ WRITTEN TO BE ABLE TO FAIL ═══
 *
 * Reverting `licenseForDiscordId` to `grant?.license ?? null` fails eight cases
 * in A. Letting ambiguity pick a license fails the two-license cases. Letting
 * the index read throw fails the resilience case. Restoring the old
 * `grantsForDiscordId` call in `session.ts` fails B. Every one of those was run.
 */

process.env.AWS_REGION ??= 'us-east-2'
process.env.DDB_TABLE_PREFIX ??= 'ringmaster-'
process.env.DISCORD_CLIENT_ID ??= 'check-client-id'
process.env.DISCORD_CLIENT_SECRET ??= 'check-client-secret'
process.env.DISCORD_GUILD_ID ??= '111111111111111111'
process.env.DISCORD_ADMIN_ROLE_ID ??= '222222222222222222'
process.env.AUTH_SECRET ??= 'check-auth-secret-at-least-32-characters-long'
process.env.AUTH_URL ??= 'http://localhost:3000'
process.env.INGEST_SECRET ??= 'check-ingest-secret-value'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  licenseForDiscordId,
  type Grant,
  type LicenseLookup,
} from './grants'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))

let failed = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) return
  failed++
  console.error(
    `  FAIL  ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`,
  )
}

/** Source with comments removed, so an assertion cannot match the prose. */
function codeOf(file: string): string {
  return readFileSync(join(LIB_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

async function main(): Promise<void> {
  // ===========================================================================
  // A. The rule.
  // ===========================================================================

  const DISCORD_ID = '333333333333333333'
  const GRANTED = 'license:granted0000000000000000000000000'
  const SEEN = 'license:seen00000000000000000000000000000'
  const OTHER = 'license:other0000000000000000000000000000'

  const THROWS = Symbol('throws')

  interface Recorded {
    askedGranted: string[]
    askedSeen: string[]
    logs: Array<{ level: 'warn' | 'error'; message: string }>
  }

  function harness(
    grant: Grant | null,
    seen: string[] | typeof THROWS,
  ): { deps: LicenseLookup; rec: Recorded } {
    const rec: Recorded = { askedGranted: [], askedSeen: [], logs: [] }

    return {
      rec,
      deps: {
        granted: async (id) => {
          rec.askedGranted.push(id)
          return grant
        },
        seen: async (id) => {
          rec.askedSeen.push(id)
          if (seen === THROWS) throw new Error('identifier index unreachable')
          return seen
        },
        log: (level, message) => rec.logs.push({ level, message }),
      },
    }
  }

  const grantRow: Grant = { license: GRANTED, discordId: DISCORD_ID }

  /**
   * THE CASE THE OWNER REPORTED. No hand-written row, one license the game has
   * actually seen behind this Discord account. Before the fix this was null and
   * the admin's own name rendered as plain text on rows they wrote.
   */
  {
    const { deps, rec } = harness(null, [SEEN])
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('no grants row + one seen license -> that license', got.license === SEEN, got)
    check('no grants row -> grant stays null', got.grant === null, got)
    check(
      'the index is asked for the QUALIFIED id',
      rec.askedSeen.length === 1 && rec.askedSeen[0] === `discord:${DISCORD_ID}`,
      rec.askedSeen,
    )
    check('an unambiguous answer is not logged about', rec.logs.length === 0, rec.logs)
  }

  /** The hand-written assertion beats the observation, and stops the second read. */
  {
    const { deps, rec } = harness(grantRow, [OTHER])
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('grants row wins over the index', got.license === GRANTED, got)
    check('grants row is returned intact', got.grant === grantRow, got)
    check('the index is not read at all when a row exists', rec.askedSeen.length === 0, rec.askedSeen)
  }

  /** ...including when the index would have thrown. The extra read is not paid. */
  {
    const { deps, rec } = harness(grantRow, THROWS)
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('a grants row is immune to an index outage', got.license === GRANTED, got)
    check('and nothing is logged about it', rec.logs.length === 0, rec.logs)
  }

  /** Nobody the game has ever seen. Null is the honest answer and is not loud. */
  {
    const { deps, rec } = harness(null, [])
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('no row and nothing seen -> null', got.license === null, got)
    check('an admin who has never played is not a warning', rec.logs.length === 0, rec.logs)
  }

  /**
   * AMBIGUITY RESOLVES TO NULL, LOUDLY. Two licenses behind one Discord account is
   * the mismatch `recordConnect` raises for a human. Stamping a moderation record
   * with a guess is worse than leaving it unattributed.
   */
  for (const listed of [
    [SEEN, OTHER],
    [OTHER, SEEN],
    [SEEN, OTHER, GRANTED],
  ]) {
    const { deps, rec } = harness(null, listed)
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check(`ambiguous (${listed.length}) -> null`, got.license === null, got)
    check(
      `ambiguous (${listed.length}) -> warned`,
      rec.logs.length === 1 && rec.logs[0]?.level === 'warn',
      rec.logs,
    )
  }

  /** One license listed twice is one license, not an ambiguity. */
  {
    const { deps, rec } = harness(null, [SEEN, SEEN, SEEN])
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('a repeated license is not ambiguous', got.license === SEEN, got)
    check('and is not warned about', rec.logs.length === 0, rec.logs)
  }

  /** Junk in the index does not become a license. */
  {
    const { deps } = harness(null, ['', SEEN])
    const got = await licenseForDiscordId(DISCORD_ID, deps)
    check('empty strings in the index are ignored', got.license === SEEN, got)
  }

  /**
   * A FAILING INDEX READ COSTS ATTRIBUTION, NEVER THE CONSOLE. `currentAdmin()`
   * runs on every page render; a throw here would white-screen the app for the
   * exact admins this change is for.
   */
  {
    const { deps, rec } = harness(null, THROWS)
    let threw: unknown = null
    let got: Awaited<ReturnType<typeof licenseForDiscordId>> | null = null
    try {
      got = await licenseForDiscordId(DISCORD_ID, deps)
    } catch (e) {
      threw = e
    }
    check('an index outage does not throw', threw === null, threw)
    check('an index outage yields a null license', got?.license === null, got)
    check(
      'an index outage is logged as an error, not swallowed',
      rec.logs.length === 1 && rec.logs[0]?.level === 'error',
      rec.logs,
    )
  }

  /** The first source is asked exactly once, with the bare Discord id. */
  {
    const { deps, rec } = harness(null, [SEEN])
    await licenseForDiscordId(DISCORD_ID, deps)
    check(
      'the grants row is asked for once, by bare id',
      rec.askedGranted.length === 1 && rec.askedGranted[0] === DISCORD_ID,
      rec.askedGranted,
    )
  }

  // ===========================================================================
  // B. The wiring. A rule nobody invokes is the failure A cannot see.
  // ===========================================================================

  {
    const code = codeOf('session.ts')

    check(
      'session.ts calls licenseForDiscordId',
      /licenseForDiscordId\s*\(/.test(code),
      null,
    )
    check(
      'session.ts hands it players.licensesFor as the second source',
      /seen\s*:\s*licensesFor\b/.test(code),
      null,
    )
    check(
      'session.ts hands it grantsForDiscordId as the first source',
      /granted\s*:\s*grantsForDiscordId\b/.test(code),
      null,
    )
    /**
     * THE REGRESSION SHAPE, NAMED. `license: grant?.license ?? null` in
     * currentAdmin() IS the bug — it is what shipped, and it is the one-line edit
     * that would quietly undo this.
     */
    check(
      'session.ts no longer derives the license from the grants row alone',
      !/license\s*:\s*grant\s*\?\.\s*license\s*\?\?\s*null/.test(code),
      null,
    )
  }

  // ===========================================================================
  // C. The destination. The resolved license has to reach the audit row.
  // ===========================================================================

  {
    const code = codeOf('actions.ts')

    check(
      'actions.ts builds the audit actor from the resolved license',
      /license\s*:\s*admin\.license\b/.test(code),
      null,
    )
  }

  {
    const code = codeOf('audit.ts')

    check(
      'audit.begin writes the actor license onto the row',
      /actorLicense\s*:\s*input\.actor\.license\b/.test(code),
      null,
    )
    /**
     * The consumer the owner did NOT notice. `forPlayer().taken` answers "what has
     * this admin done" with an equality on `actorLicense`, so a null does not
     * merely unlink a name — it empties that admin's own profile panel.
     */
    check(
      'forPlayer still finds an admin’s own actions by actorLicense',
      /actorLicense\s*===\s*license/.test(code),
      null,
    )
  }

}

// ===========================================================================

void main().then(
  () => {
    if (failed > 0) {
      console.error(`
check:adminlicense — ${failed} failing case(s)`)
      console.error(
        'The acting admin’s license is what links their name in the audit ' +
          'log and what finds their actions on their own profile. See ' +
          'licenseForDiscordId in src/lib/grants.ts.',
      )
      process.exit(1)
    }
    console.log(
      'check:adminlicense — resolution rules, session wiring and audit destination all pass',
    )
  },
  (e: unknown) => {
    // A throw out of the checks themselves is a failure too, and an exit code
    // of 0 on an unhandled rejection is how a check quietly stops checking.
    console.error('check:adminlicense — threw', e)
    process.exit(1)
  },
)
