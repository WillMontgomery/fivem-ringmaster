import { z } from 'zod'

/**
 * Environment, validated once at startup.
 *
 * The point is to fail loudly at boot rather than quietly at 2am. A missing
 * DISCORD_CLIENT_SECRET should stop the process with a message naming the
 * variable — not produce an OAuth redirect that dead-ends on a blank page
 * three clicks into a login nobody can debug.
 *
 * NOTHING AWS-CREDENTIAL-SHAPED APPEARS HERE, and that is deliberate. Both
 * hosts get their permissions from an EC2 instance role, which the AWS SDK
 * discovers on its own from instance metadata. If you ever find yourself
 * adding AWS_ACCESS_KEY_ID to this file, the deployment is wrong, not the
 * schema.
 */
const schema = z.object({
  // --- Discord OAuth ---------------------------------------------------
  // From https://discord.com/developers/applications. The client id is
  // public by nature (it travels in the authorize URL); the secret is not.
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),

  // The guild membership check that gates login before any grant lookup
  // runs — a stranger with a Discord account never reaches the scope check.
  DISCORD_GUILD_ID: z.string().min(1),

  // --- Auth.js ---------------------------------------------------------
  // Signing key for session cookies. Generate with: openssl rand -base64 32
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),

  // Public origin, e.g. https://ringmaster.example.com. Auth.js builds the
  // OAuth redirect URI from this, and Discord will reject a mismatch.
  AUTH_URL: z.string().url(),

  // --- AWS -------------------------------------------------------------
  AWS_REGION: z.string().default('us-east-2'),
  DDB_TABLE_PREFIX: z.string().default('ringmaster-'),

  // --- Ingest ----------------------------------------------------------
  // Shared secret the game server presents on its push. The endpoint is only
  // reachable over the peered CIDR, so this is defence in depth rather than
  // the primary control — but the primary control is a security group, and
  // security groups get edited by tired people.
  INGEST_SECRET: z.string().min(16),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // Name every missing variable at once. Reporting them one per restart is
    // how a five-minute setup becomes an hour.
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${problems}\n\nSee .env.example`)
  }

  cached = parsed.data
  return cached
}
