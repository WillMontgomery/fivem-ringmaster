import { z } from 'zod'

import { parseIngestCredentials, type IngestCredential } from './ingestAuth'

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

  // --- Warmup stat board -----------------------------------------------
  /**
   * Leave admins off the warmup leaderboard (#247). DEFAULT OFF, which is the
   * owner's choice: "Config flag defaulting off is good with me".
   *
   * THE FILTER IS LIVE AND TESTED IN BOTH POSITIONS, not commented out. With
   * this unset the board ranks everybody, including admins, and does not read
   * the grants table at all; with it `true`, `lib/scoreboardStore.ts` reads that
   * table once per snapshot and drops those licenses from every card and from
   * the ranks on the per-player half. `src/lib/scoreboard.check.ts` drives both.
   *
   * ═══ WHAT "BEST EFFORT" MEANS HERE, PRECISELY ═══
   *
   * The owner's words were "Even if we cache that data as a best-effort thing.
   * We definitely shouldn't query Discord every time for that." Nothing in this
   * console caches Discord role membership and nothing ever has -
   * `lib/discordRole.ts` asks Discord live before every write and explains why a
   * TTL there would be a hole. So the only durable answer available is
   * `ringmaster-grants`, the hand-written Discord-to-license link rows.
   *
   * THE STALENESS IS NOT A CACHE WINDOW, IT IS THE ROWS THEMSELVES. An admin who
   * holds the Discord role but has no grant row is NOT hidden, because nothing
   * writes them one; someone whose row outlived their role stays hidden. Both are
   * fixed with `scripts/grant.mjs` and neither is fixed by waiting. Turning this
   * on and finding an admin still on the board is that, not a bug in the filter.
   *
   * A STRING, PARSED STRICTLY. `SCOREBOARD_HIDE_ADMINS=yes` stops the process at
   * boot naming the variable rather than being read as false, because a flag that
   * silently means "off" whenever it is misspelled is a flag that is off.
   */
  SCOREBOARD_HIDE_ADMINS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * HOW MUCH THE WARMUP BOARD MOVES (#247). DEFAULT `full`, because the owner
   * asked for motion twice: "We need something with some pizzazz! Some animated
   * background and transitions and colors", and then "Also give us an animated
   * background (be sure it will work on CEF 103)."
   *
   * ⚠ ONLY `full` RENDERS AN ANIMATED BACKGROUND. `transitions` is the view
   * transition alone. A deployment running `SCOREBOARD_MOTION=transitions` is a
   * deployment where the thing he asked for twice is switched off, and there is
   * nothing on the board to say so.
   *
   * ═══ WHAT THIS KNOB ACTUALLY TRADES, CORRECTED ═══
   *
   * THIS COMMENT USED TO SAY CEF PAINTS ONLY WHEN THE PAGE CHANGES, AT UP TO 30
   * FRAMES A SECOND, WITH DIRTY RECTS DISABLED. All three were wrong, the owner
   * was told them, and `lib/scoreboardPage.ts` carries the corrected account with
   * the source it was read from. In short: FiveM blits the whole 1280x720
   * surface EVERY GAME FRAME whether the page moved or not
   * (`NUIRenderCallbacks.cpp`), it is a GPU-local copy of a shared D3D11 texture
   * rather than an upload, and `windowless_frame_rate` is hardcoded to 240 in
   * `NUIWindow.cpp` with no convar to change it.
   *
   * SO THE COST OF MOTION IS FRAME PRODUCTION INSIDE CEF, not texture traffic.
   * While the page animates, CEF's compositor is driven at up to 240fps on each
   * player's machine; while it is still, it is driven not at all. Every animated
   * property on this page is `transform` or `opacity`, which the compositor runs
   * against already-rastered layers, so those frames cost no style, layout,
   * paint or raster on Blink's main thread. Measured in a real browser: the
   * animated background is INDISTINGUISHABLE from no animation at all on main
   * thread throughput, and one whole slide transition costs about ten
   * milliseconds of main-thread time, once.
   *
   * The three levels, and they are an environment variable rather than a
   * constant so the choice can be made on the pad and reversed without a
   * redeploy:
   *
   *   full         the view transition AND the animated background: three soft
   *                orbs and a striped sheet, each on its own promoted layer,
   *                each started at a random point in its own loop. This is what
   *                he asked for.
   *   transitions  the view transition only, and NO animated background. The
   *                surface is still between swaps.
   *   off          no animation anywhere. The instant swap.
   *
   * A STRING, PARSED STRICTLY, for the same reason as the flag above:
   * `SCOREBOARD_MOTION=none` stops the process at boot naming the variable
   * rather than being read as one of these by accident.
   *
   * IT IS READ PER REQUEST, NOT AT MODULE LOAD, so a restart is all it takes.
   * See `src/app/scoreboard/route.ts` and `lib/scoreboardPage.ts`.
   */
  SCOREBOARD_MOTION: z.enum(['full', 'transitions', 'off']).default('full'),

  // --- Ingest ----------------------------------------------------------
  /**
   * ONE SECRET PER GAME SERVER, as a JSON object: `{"prod":"...","dev":"..."}`.
   *
   * THE SERVER'S IDENTITY IS WHICHEVER KEY'S SECRET AUTHENTICATED THE PUSH, and
   * that is the whole design: a server proves who it is rather than saying so.
   * lib/ingestAuth.ts holds the reasoning and the two alternatives that were
   * refused (a field in the payload, and the source address).
   *
   * A THIRD SERVER IS A THIRD KEY HERE AND NOTHING ELSE. No code change, no
   * build, no deploy of this console beyond restarting it with a longer value.
   *
   * OPTIONAL, BECAUSE {@link INGEST_SECRET} BELOW IS STILL A CREDENTIAL. With
   * this unset the console behaves exactly as it did with one server. What is
   * NOT optional is having at least one of the two: the transform at the foot of
   * this file refuses a console with no ingest credential at all, because that
   * console refuses every push from every game server while looking healthy.
   */
  INGEST_SECRETS: z.string().optional(),

  /**
   * The single shared secret this console shipped with, and it still works.
   *
   * IT MEANS `prod`, WHICH IS WHAT IT HAS ALWAYS MEANT, because there was one
   * game server and it is the live one. A console deployed with today's `.env.local`
   * untouched keeps accepting today's prod push, which is the only acceptable
   * behavior for a change that lands in front of a closed beta.
   *
   * IT COMPOSES WITH `INGEST_SECRETS` RATHER THAN BEING REPLACED BY IT, so prod
   * can be rotated without a window where neither value is accepted: put the new
   * secret under `"prod"` there, leave the old one here, move the game box, then
   * delete this.
   *
   * OPTIONAL NOW, AND IT WAS REQUIRED. A console configured entirely through
   * `INGEST_SECRETS` must not be stopped at boot for the absence of a variable
   * it has outgrown. The sixteen-character floor still applies when it is set,
   * and "absent or valid" never means "absent or anything".
   *
   * The endpoint is only reachable over the peered CIDR, so all of this is
   * defense in depth rather than the primary control, but the primary control
   * is a security group, and security groups get edited by tired people.
   */
  INGEST_SECRET: z.string().min(16).optional(),

  // --- Command credential ----------------------------------------------
  /**
   * The shared secret a named MACHINE caller presents to act on an admin's
   * behalf — today `blitz-bot`, whose `/brkick`, `/brban` and `/drain` have no
   * other way to reach the live kick and the maintenance route. Presented in
   * `x-ringmaster-service` and compared with `timingSafeEqual`, the same way
   * INGEST_SECRET is. See lib/service.ts and docs/deploy.md.
   *
   * ═══ WHY IT IS SPELLED `COMMAND_SECRET` ═══
   *
   * IT IS NAMED FOR THE ENDPOINT FAMILY IT GUARDS, exactly as INGEST_SECRET is.
   * That one is not called GAME_SECRET after the box that holds it; it is called
   * after `/api/ingest`, the thing it opens. This one opens the command routes —
   * kick, ban, drain — so it is called after them. A secret named after its
   * holder has to be renamed the day a second holder appears; a secret named
   * after its door does not.
   *
   * AND IT IS DELIBERATELY UNPREFIXED, BECAUSE IT IS SHARED WITH THE BOT. The
   * same value is pasted into `/opt/ringmaster/.env.local` and
   * `/opt/blitz-bot/.env`, so it belongs to the pair rather than to either side
   * — the same reason DISCORD_BOT_TOKEN carries no prefix. A `RINGMASTER_` on
   * the front would read as "this console's setting" in a file where the bot's
   * OWN settings are the ones wearing `BLITZ_`, and an operator comparing the
   * two files would be looking for a name that is not in one of them.
   *
   * A SECOND VARIABLE RATHER THAN REUSING INGEST_SECRET, and the separation is
   * the point. That one lives on the GAME box, where a compromise is already a
   * bad day; if it also opened this door then that bad day would include
   * banning players and scheduling restarts. Two secrets, two blast radii.
   *
   * OPTIONAL, AND UNSET IS A SUPPORTED STATE THAT CLOSES THE DOOR ENTIRELY —
   * every command call is refused with a line in the operator log naming this
   * variable, and the console is otherwise unchanged. It is not made required
   * for the same reason DISCORD_BOT_TOKEN is not: doing so would stop an
   * already-deployed console at boot over a path it has never had.
   *
   * SIXTEEN CHARACTERS AT MINIMUM WHEN IT IS SET, matching INGEST_SECRET,
   * because `.optional()` means "absent or valid" and never "absent or
   * anything" — a one-character secret would be a door with a lock drawn on it.
   *   openssl rand -hex 24
   */
  COMMAND_SECRET: z.string().min(16).optional(),

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

/**
 * The ingest credential set, derived from the two variables above.
 *
 * DERIVED HERE RATHER THAN AT THE ENDPOINT so that a typo in `INGEST_SECRETS` is
 * reported in the same message, at the same moment, as a missing
 * `DISCORD_CLIENT_SECRET`, which is the one thing this file exists to do.
 * Parsing it on first push instead would present as every game server in the
 * estate being refused at once, with a 500 in the journal and a console that
 * looks entirely well.
 *
 * IT IS ALSO WHERE "AT LEAST ONE CREDENTIAL" IS ENFORCED. Neither variable is
 * required on its own now, and a console holding neither is a console that
 * silently refuses every push, so the combination is checked where combinations
 * can be.
 */
const withIngest = schema.transform((raw, ctx) => {
  let credentials: IngestCredential[]
  try {
    credentials = parseIngestCredentials({
      secrets: raw.INGEST_SECRETS,
      legacy: raw.INGEST_SECRET,
    })
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['INGEST_SECRETS'],
      message: e instanceof Error ? e.message : String(e),
    })
    return z.NEVER
  }

  return { ...raw, INGEST_CREDENTIALS: credentials }
})

export type Env = z.infer<typeof withIngest>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached

  const parsed = withIngest.safeParse(process.env)
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
