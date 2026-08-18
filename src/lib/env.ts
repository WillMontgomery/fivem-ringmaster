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

  /**
   * OPTIONAL, and it now does two jobs. ONE TOKEN, NOT TWO — a second bot
   * credential for the second job would be a second thing to rotate and a
   * second thing to leak.
   *
   * (1) REAL PROFILE PICTURES. A Discord user id cannot be turned into an
   * avatar URL on its own — the CDN path needs the account's current avatar
   * hash, which only the API knows. Without this the console shows Discord's
   * generic default avatar, which is never that person. One uncached call per
   * profile page view with a five-second ceiling, and the page never blocks on
   * it. See lib/discord.ts and components/DiscordChrome.tsx.
   *
   * (2) THE ADMIN-ROLE RE-CHECK BEFORE EVERY WRITE. Ringmaster's permissions
   * live in DynamoDB and are independent of Discord, so an admin removed from
   * the Discord server kept a working console until a human revoked their row.
   * Before every action that changes something, `GET
   * /guilds/{guild}/members/{user}` is asked whether they still hold
   * DISCORD_ADMIN_ROLE_ID. See lib/discordRole.ts.
   *
   * THE SECOND JOB CHANGED WHAT THE BOT NEEDS, and this is the one deployment
   * fact worth reading twice. Job (1) works from outside the server — `GET
   * /users/{id}` answers any bot. Job (2) does NOT: the bot must be a MEMBER of
   * the guild named in DISCORD_GUILD_ID. It still needs no privileged intents
   * (only LIST Guild Members requires one; fetching a single member does not),
   * still cannot read messages, and still cannot act on anyone.
   *
   * LEAVING IT UNSET IS A SUPPORTED STATE AND IT TURNS THE RE-CHECK OFF. The
   * console keeps working on DynamoDB grants alone, exactly as it did before,
   * and every write logs a warning naming this variable. It is not made
   * required here because doing so would stop an already-deployed console at
   * boot over a defence-in-depth check it had never had.
   */
  DISCORD_BOT_TOKEN: z.string().optional(),

  // The guild membership check that gates login before any grant lookup
  // runs — a stranger with a Discord account never reaches the scope check.
  DISCORD_GUILD_ID: z.string().min(1),

  // The Discord role required to sign in AT ALL. Coarser than the grants
  // table and checked before it: guild membership alone stopped being enough
  // the moment the guild is also the player community. Right-click the role
  // in Server Settings -> Roles -> Copy Role ID (needs Developer Mode).
  DISCORD_ADMIN_ROLE_ID: z.string().min(1),

  // --- Auth.js ---------------------------------------------------------
  // Signing key for session cookies. Generate with: openssl rand -base64 32
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),

  // Public origin, e.g. https://ringmaster.example.com. Auth.js builds the
  // OAuth redirect URI from this, and Discord will reject a mismatch.
  AUTH_URL: z.string().url(),

  // --- AWS -------------------------------------------------------------
  AWS_REGION: z.string().default('us-east-2'),
  DDB_TABLE_PREFIX: z.string().default('ringmaster-'),
  // The GAME's tables, which this box reads and never writes. Separate from the
  // console's prefix so the two can be granted separately in IAM.
  DDB_GAME_TABLE_PREFIX: z.string().default('br-'),

  // --- Ingest ----------------------------------------------------------
  // Shared secret the game server presents on its push. The endpoint is only
  // reachable over the peered CIDR, so this is defence in depth rather than
  // the primary control — but the primary control is a security group, and
  // security groups get edited by tired people.
  INGEST_SECRET: z.string().min(16),

  // --- Game host SSH ---------------------------------------------------
  // The forced-command channel to the game box, for host status and
  // telemetry. All optional: with them unset, the Host page shows
  // "not configured" rather than erroring, exactly like the ingest endpoint.
  // The private key never leaves this box; only its path is named here.
  GAME_HOST: z.string().optional(),          // private IP over the peering link
  GAME_SSH_USER: z.string().default('ubuntu'),
  GAME_SSH_KEY: z.string().optional(),       // path, e.g. /opt/ringmaster/.ssh/dispatch

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
