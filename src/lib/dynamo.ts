import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb'

import { env } from './env'

/**
 * The one DynamoDB client.
 *
 * NO CREDENTIALS ARE PASSED. The SDK's default provider chain finds the EC2
 * instance role from instance metadata on its own. Locally it falls back to
 * whatever `aws configure` set up. Either way, nothing credential-shaped is in
 * this repo or in the environment — see src/lib/env.ts.
 *
 * Next.js reloads modules aggressively in development, which would otherwise
 * leak a new client (and its socket pool) on every edit. Stashing it on
 * globalThis is the standard escape hatch.
 */
const globalForDdb = globalThis as unknown as {
  ddb?: DynamoDBDocument
}

function create(): DynamoDBDocument {
  const client = new DynamoDBClient({ region: env().AWS_REGION })

  return DynamoDBDocument.from(client, {
    marshallOptions: {
      // A field set to undefined should mean "not present", not an explicit
      // null. Same instinct as the gamemode's roster deltas, where a cleared
      // field travels as a named clear list rather than as a null nobody can
      // distinguish from "unchanged".
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  })
}

/**
 * Constructed on first use, not on import — and this is a build requirement,
 * not a micro-optimisation.
 *
 * `create()` reads env(), which throws when a variable is missing. That is
 * correct at runtime: a misconfigured host should fail loudly, naming the
 * variable. But `next build` imports every module to collect page data, so
 * constructing here meant the BUILD demanded a complete production
 * environment — a real Discord secret, a real signing key — and could only run
 * on an already-configured host. CI has no secrets by design, so CI could
 * never build this app.
 *
 * The proxy defers construction to the first property access. Callers see an
 * ordinary DynamoDBDocument and nothing downstream changes.
 *
 * TESTED BY MOVING `.env.local` OUT OF THE WAY, which is the part I got wrong
 * the first time: Next loads `.env.local` from disk automatically, so
 * unsetting shell variables proves nothing at all. That bad test is why this
 * fix was written, reverted as unnecessary, and then written again after the
 * build failed on a real box.
 */
export const ddb: DynamoDBDocument = new Proxy({} as DynamoDBDocument, {
  get(_target, prop, receiver) {
    const real = (globalForDdb.ddb ??= create())
    const value = Reflect.get(real, prop, receiver)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

/**
 * Table names, all derived from one prefix so a second environment (a staging
 * stack, a throwaway test stack) is one variable rather than six.
 */
export const tables = {
  get grants() {
    return `${env().DDB_TABLE_PREFIX}grants`
  },
  get bans() {
    return `${env().DDB_TABLE_PREFIX}bans`
  },
  get audit() {
    return `${env().DDB_TABLE_PREFIX}audit`
  },
  get incidents() {
    return `${env().DDB_TABLE_PREFIX}incidents`
  },
  get sessions() {
    return `${env().DDB_TABLE_PREFIX}sessions`
  },
  get telemetry() {
    return `${env().DDB_TABLE_PREFIX}telemetry`
  },
  /**
   * The scheduled maintenance window. One item, fixed key — see lib/maintenance.
   * The game reads this table too (via br_ddb) so it knows to refuse
   * connections while draining, which is why it is a table rather than
   * in-memory state on this box.
   */
  get maintenance() {
    return `${env().DDB_TABLE_PREFIX}maintenance`
  },
  /** The player registry. Keyed on license — see lib/players.ts. */
  get players() {
    return `${env().DDB_TABLE_PREFIX}players`
  },
  /**
   * Reverse index: identifier -> the licenses that have presented it.
   *
   * A SEPARATE TABLE because the question it answers cannot be asked of a
   * license-keyed one. "Has this Discord account been here under a different
   * license before" has no answer from a row you look up BY that license — a
   * new license is simply a new row with nothing to compare against.
   */
  get playerIds() {
    return `${env().DDB_TABLE_PREFIX}player-ids`
  },
} as const
