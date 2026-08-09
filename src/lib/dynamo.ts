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

export const ddb: DynamoDBDocument = globalForDdb.ddb ?? create()

if (env().NODE_ENV !== 'production') globalForDdb.ddb = ddb

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
} as const
