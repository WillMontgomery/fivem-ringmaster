import { createHash, randomBytes } from 'node:crypto'

import { ddb, tables } from './dynamo'

/**
 * The pause-menu handoff token — #23.
 *
 * ============================================================================
 * THE CONTRACT THE GAME SIDE IMPLEMENTS AGAINST. Read this before writing any
 * of the game half; it is written here rather than on the issue because the
 * issue is not what anybody greps.
 * ============================================================================
 *
 * WHAT THIS IS FOR. An admin opens the pause menu, the game spawns an NUI
 * iframe pointed at this console, and the console is already signed in. No
 * login page, no alt-tab.
 *
 * THE COMMON CASE COSTS NOTHING AND MUST NOT BE MADE TO COST ANYTHING. The
 * iframe opens at the PLAIN console URL every time — no token in it. CEF keeps
 * the session cookie for this origin in its cookie jar, and that jar outlives
 * the iframe being destroyed and recreated. So reopening the settings menu is a
 * page load against an existing session: straight to the live players page, no
 * mint, no redeem, no spinner. Everything below is the EXCEPTION path, taken
 * the first time and again whenever the session has lapsed.
 *
 * HOW THE GAME LEARNS IT NEEDS A TOKEN. It does not poll and it does not guess.
 * When this console renders its login page inside a frame it posts one message
 * out to the parent (`components/FrameHandoffSignal.tsx`):
 *
 *     { source: 'ringmaster', v: 1, state: 'signed-out' }
 *
 * THE NUI LISTENER MUST CHECK `event.origin` AGAINST THE CONSOLE'S ORIGIN AND
 * NOTHING ELSE. That handler's whole job is to trigger the minting of an admin
 * session, so a handler that accepts `message` from any origin is a handler
 * that any framed page can drive. `event.origin === '<console origin>'` — an
 * exact string compare, not `endsWith`, not a regex.
 *
 * THE SEQUENCE, then:
 *
 *   1. Game client sees `signed-out` from the frame, tells the GAME SERVER.
 *   2. The game SERVER — never the client — POSTs `/api/handoff/mint` with the
 *      shared secret and the connecting player's verified `discord:` id.
 *      A client that can ask for a token is a client that can ask for someone
 *      else's; the client never touches this endpoint and never holds the
 *      secret.
 *   3. Console answers `{ ok: true, url, token, expiresAt }` inside
 *      {@link MINT_BUDGET_MS}.
 *   4. Game client points the SAME iframe at `url`.
 *   5. This console consumes the token, creates a session, and 303s to `/`.
 *
 * WHAT THE GAME MUST NEVER DO: wait on this console for anything else, retry a
 * mint in a loop, or hold a token past the click that asked for it. If the mint
 * does not answer, the iframe does not open and nothing else about the game is
 * affected — that is graceful degradation, not a dependency.
 *
 * ----------------------------------------------------------------------------
 * THE TOKEN
 * ----------------------------------------------------------------------------
 *
 *   <discordId>.<43 chars of base64url>
 *
 * The left half is a PUBLIC identifier and says who the session is for. The
 * right half is 32 bytes from `randomBytes` and is the entire authorisation.
 * Not a counter, not derived from the license, not an HMAC over anything the
 * caller supplies — `matchId` being an incremental integer was already flagged
 * as a smell in the game repo and this does not repeat it.
 *
 * THE GAME NEVER MINTS AND NEVER PARSES ONE. It receives an opaque string and a
 * ready-built URL and puts the URL in the iframe. Nothing on the game side
 * needs to know this format; it is written down so that the console half cannot
 * quietly change it either.
 *
 * ----------------------------------------------------------------------------
 * THE RECORD — one row per admin, in `ringmaster-handoff`
 * ----------------------------------------------------------------------------
 *
 *   discordId   (String, PARTITION KEY)  who this token is for
 *   tokenHash   (String)                 sha256 hex of the WHOLE token
 *   issuedAt    (Number)                 epoch ms
 *   expiresAt   (Number)                 epoch ms — the expiry that is ENFORCED
 *   expires     (Number)                 epoch SECONDS — the DynamoDB TTL attr
 *
 * KEYED BY THE ADMIN, NOT BY THE TOKEN, and that choice buys three properties
 * that would otherwise each need code:
 *
 *   · IDENTITY BINDING IS STRUCTURAL. The token names its own subject and the
 *     record is keyed by that subject, so a token minted for A is looked up
 *     under A. There is no arrangement of bytes that makes it open a session as
 *     B, because B's row is a different row and the hash under it will not
 *     match.
 *   · A MINT INVALIDATES THE PREVIOUS UNREDEEMED TOKEN, for free, because a
 *     `put` overwrites. This is the answer to the retry question: if the game
 *     gives up at its timeout and the mint actually succeeded a moment later,
 *     the retry's token replaces the orphan rather than sitting beside it.
 *     At most ONE live token per admin exists at any instant, and it is always
 *     the most recent one. That is a stronger guarantee than a short TTL alone.
 *   · NO SECONDARY INDEX. Invalidating by identity on a token-keyed table would
 *     need a GSI over `discordId` — one more operator step and one more thing
 *     to be missing on a stack built from an older copy of the setup doc.
 *
 * THE COST, written down because it is a real behaviour: double-clicking the
 * pause-menu button mints twice, and the first iframe then loses. It lands on
 * the login page, signals `signed-out` again, and the next mint wins. Nobody
 * gets a broken session out of it; somebody gets one extra round trip.
 *
 * THE HASH IS STORED, NOT THE TOKEN. The raw token exists in exactly two
 * places — the mint response and the redeem URL — and never at rest. So a
 * table export, a point-in-time backup, or the `GetItem` on `ringmaster-*` that
 * the game box holds today (docs/aws-setup.md, section 3) yields a sha256
 * digest and no way back to a usable credential.
 *
 * ----------------------------------------------------------------------------
 * WHERE IT LIVES, AND WHY NOT ON AN EXISTING TABLE
 * ----------------------------------------------------------------------------
 *
 * `ringmaster-handoff`, its own table. The tempting alternative was
 * `ringmaster-sessions`: it already has TTL enabled on `expires`, it already
 * holds authentication material, and it would have cost the operator nothing.
 *
 * IT IS THE WRONG TABLE FOR ONE DISQUALIFYING REASON. The mint direction may
 * yet be flipped — if the owner decides the game should mint locally rather
 * than ask this console, the game box needs `PutItem` on wherever these rows
 * live. `ringmaster-sessions` is the Auth.js adapter's table, and granting the
 * game box write access to it grants it the ability to forge a session row
 * directly. No arrangement of that is acceptable, and a table layout that makes
 * the bad grant the easy one is a layout that will eventually be granted.
 *
 * Two lesser reasons that point the same way: `ringmaster-sessions` is owned by
 * a library (docs/aws-setup.md says "Auth.js writes this"), and a second writer
 * with its own key convention in a library-owned table is drift waiting to
 * happen; and rows here live ninety seconds and are deleted by being spent,
 * which is a different operational profile from a thirty-day session row.
 *
 * ----------------------------------------------------------------------------
 * THE TTL, AND WHY NINETY SECONDS
 * ----------------------------------------------------------------------------
 *
 * The original brief assumed a human in the loop — FiveM has no reliable native
 * for opening an external browser, so the fallback was copying the URL to the
 * clipboard for the admin to paste, which is slow. That is not this design.
 * NUI resources are full-screen iframes and the console is framed directly
 * (docs.fivem.net, "Fullscreen NUI"), so every step from the click onwards is a
 * machine step.
 *
 * Ninety seconds covers: a cold CEF frame, one game-side retry inside its own
 * timeout, and a slow cross-region moment on a console in us-west-2 talking to
 * DynamoDB in us-east-2. It does not cover a credential sitting on a client for
 * an evening, which is what the rejected mint-at-join shape would have meant.
 *
 * NO CLOCK SKEW BUDGET IS NEEDED and that is a property of minting here rather
 * than on the game box: the same process that stamps `expiresAt` is the process
 * that compares against it. A game-side mint would have had to tolerate drift
 * between two hosts, and every second of tolerance is a second of extra life.
 *
 * EXPIRY IS ENFORCED IN CODE, NOT BY THE TTL. DynamoDB deletes expired items
 * "typically within 48 hours" — it is a janitor that keeps this table from
 * growing forever, and it is not a security control. {@link redeem} refuses on
 * `expiresAt` itself, and it refuses AFTER consuming the row so that an expired
 * token cannot be retried while the sweeper gets around to it.
 */

/** Ninety seconds. See the header. */
export const HANDOFF_TTL_MS = 90_000

/**
 * What the game may assume about how long `/api/handoff/mint` takes.
 *
 * THE GAME'S TIMEOUT HAS TO BE SET AGAINST A NUMBER AND THIS IS THE NUMBER, so
 * that whoever writes the game half is not guessing. It is built from the
 * work the endpoint actually does rather than picked:
 *
 *   · one Auth.js account lookup (GSI query + get), us-west-2 → us-east-2
 *   · one Discord member fetch, hard-capped at {@link MINT_ROLE_TIMEOUT_MS}
 *   · one `put`
 *
 * The Discord call dominates and is the only unbounded term, which is why it
 * gets its own shorter ceiling here instead of `discordRole.ts`'s five seconds.
 * Five would blow the hard limit above it: this repo records that the game's
 * `PerformHttpRequest` has a hardcoded, non-configurable 5-second no-response
 * timeout (src/app/api/ingest/route.ts), so anything at or near five is a mint
 * the game can never observe succeeding.
 *
 * RECOMMENDED GAME-SIDE TIMEOUT: 3s. Ceiling: 5s, and that is not ours to move.
 */
export const MINT_BUDGET_MS = 2_500

/** The Discord round trip inside a mint. See {@link MINT_BUDGET_MS}. */
export const MINT_ROLE_TIMEOUT_MS = 2_000

/**
 * Where a successful redeem lands.
 *
 * The live players page, which is the console's ordinary landing page — the
 * same place a normal Discord login arrives at. Deliberately NOT the page the
 * admin was last on: a destroyed iframe has lost its in-page state either way,
 * and remembering a route across a re-auth is a stored preference nobody asked
 * for (owner, 2026-08-20: "maybe not same page, but I guess still signed in").
 */
export const HANDOFF_LANDING = '/'

/** Where a failed redeem lands. Every failure, without distinction. */
export const HANDOFF_REFUSED = '/login'

/**
 * Auth.js's session cookie name, reproduced rather than imported because
 * `@auth/core/lib/utils/cookie` is not a public export path.
 *
 * IT LIVES HERE RATHER THAN IN THE REDEEM ROUTE so that `handoff.check.ts` can
 * assert it without importing a route module. If this copy ever drifts from
 * what `auth()` actually reads, the redeem succeeds and produces a console that
 * is signed out — a failure with no error anywhere in it. The check compares
 * both spellings against the pair `src/middleware.ts` sniffs for, so the two
 * hand copies in this repo cannot drift apart silently.
 *
 * `secure` follows the configured origin's protocol, which is what
 * `@auth/core`'s init does: `config.useSecureCookies ?? url.protocol === 'https:'`.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Secure-authjs.session-token' : 'authjs.session-token'
}

/**
 * Whether cookies are issued `Secure`, from the configured origin's protocol.
 *
 * `config.useSecureCookies ?? url.protocol === 'https:'` is what `@auth/core`'s
 * init does, and this reproduces it so that the redeem route, `src/auth.ts` and
 * the keepalive route cannot each decide it differently. It lived privately in
 * the redeem route until the cookie below started depending on it.
 *
 * UNPARSEABLE FALLS BACK TO `true`, which fails towards a cookie the browser
 * refuses rather than one it accepts over plain HTTP.
 */
export function secureCookies(authUrl: string): boolean {
  try {
    return new URL(authUrl).protocol === 'https:'
  } catch {
    return true
  }
}

/**
 * `SameSite` for every cookie this console's session depends on — #23.
 *
 * ============================================================================
 * `None` IS WHAT MAKES THE PAUSE-MENU CONSOLE WORK AND IT IS A REAL WIDENING.
 * A console framed by NUI is a third-party context, and a `Lax` cookie is not
 * sent on cross-site subresource requests — so the framed console arrives
 * signed out no matter how many times it redeems a token. `None` fixes that and
 * simultaneously hands every page on the internet a credentialed POST into a
 * console that bans players and restarts game servers.
 *
 * THAT IS ONLY ACCEPTABLE BECAUSE `src/middleware.ts` REFUSES CROSS-ORIGIN
 * WRITES. `SameSite=Lax` was the entire CSRF defence in this application before
 * #23; the `Origin` check is what replaced it, it shipped first, and it is not
 * optional. If that check is ever removed, this must go back to `Lax` in the
 * same commit.
 * ============================================================================
 *
 * IT IS DERIVED FROM `secure`, NOT CHOSEN BESIDE IT, and that is the whole
 * point of it being one function. `SameSite=None` without `Secure` is a cookie
 * every modern browser DROPS SILENTLY — no console warning the operator will
 * see, no error, just a console that cannot stay signed in. Making the two
 * impossible to set independently means that state cannot be reached by
 * editing one line and forgetting the other.
 *
 * SO A DEV MACHINE STAYS `Lax`. `http://localhost:3000` gets `secure: false`
 * and therefore `Lax`, which is both the only thing that works there and the
 * posture the console has always had locally. The framed flow is an HTTPS
 * deployment's feature; it was never going to work over plain HTTP anyway.
 */
export function sessionSameSite(secure: boolean): 'none' | 'lax' {
  return secure ? 'none' : 'lax'
}

/** The record, exactly as it sits in DynamoDB. */
export interface HandoffRecord {
  discordId: string
  tokenHash: string
  issuedAt: number
  /** Epoch MILLISECONDS. The expiry that is actually enforced. */
  expiresAt: number
  /**
   * Epoch SECONDS. The DynamoDB TTL attribute, named `expires` to match the
   * two tables that already have one (docs/aws-setup.md). Different unit from
   * `expiresAt` because DynamoDB's TTL only reads seconds — hence two fields
   * rather than one that quietly means different things to different readers.
   */
  expires: number
}

/**
 * The two operations this needs from storage, named so the checks can drive the
 * real decision code without a DynamoDB.
 *
 * Same seam as `discordRole.ts`'s `GateDeps`, for the same reason: everything
 * that decides an outcome — what counts as expired, what a losing race returns,
 * whether a mismatched hash is distinguishable from a missing row — is shipped
 * logic exercised by `handoff.check.ts`, not a second copy of the assumptions.
 */
export interface HandoffStore {
  /** Write the single pending record for this admin, replacing any other. */
  put(rec: HandoffRecord): Promise<void>
  /**
   * Consume atomically: delete the row for `discordId` if and only if it
   * carries `tokenHash`, and return what was deleted.
   *
   * Null means the write was REFUSED — no row, or a different token. Refusal
   * and "no such admin" are deliberately the same answer, so nothing upstream
   * can be built into an oracle for whether a token existed.
   */
  take(discordId: string, tokenHash: string): Promise<HandoffRecord | null>
}

/**
 * The real one.
 *
 * THE CONDITIONAL DELETE IS THE SINGLE-USE RULE, enforced by the database
 * rather than by a read followed by a write. Two tabs — or two frames, or a
 * frame and a retry — both looking the row up and both deleting it is a race
 * they can both win. `incidents.resolve()` makes the same argument and takes
 * the same shape: one write, a condition that cannot hold twice, and a
 * `ConditionalCheckFailedException` read as an ordinary outcome rather than an
 * error.
 *
 * The comparison DynamoDB performs on `tokenHash` is a byte compare and not a
 * constant-time one. That is accepted deliberately: extracting 256 bits of
 * `randomBytes` through the timing of a conditional write across a network is
 * not a threat, and the alternative — read the row, compare with
 * `timingSafeEqual`, then delete — reintroduces the race that this whole
 * function exists to close. The atomicity is worth more.
 */
export const dynamoStore: HandoffStore = {
  async put(rec) {
    await ddb.put({ TableName: tables.handoff, Item: rec })
  },

  async take(discordId, tokenHash) {
    try {
      const res = await ddb.delete({
        TableName: tables.handoff,
        Key: { discordId },
        ConditionExpression: 'tokenHash = :h',
        ExpressionAttributeValues: { ':h': tokenHash },
        ReturnValues: 'ALL_OLD',
      })
      return (res.Attributes as HandoffRecord | undefined) ?? null
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        return null
      }
      throw e
    }
  },
}

/**
 * Discord snowflakes are decimal digits. Anchored, bounded, and applied to the
 * id BEFORE it is used as a partition key or interpolated into a token — a
 * caller that sends `123.456` must not be able to make the split below
 * ambiguous.
 */
const DISCORD_ID = /^[0-9]{1,32}$/

/** sha256 hex of the whole token, identity included. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Split a token back into the identity it names and the digest to match.
 *
 * Returns null for anything that is not exactly `<digits>.<base64url>`. Every
 * malformed shape lands here rather than reaching the store, so a caller
 * cannot probe DynamoDB with a partition key of its own choosing.
 */
export function parseToken(
  token: unknown,
): { discordId: string; tokenHash: string } | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
    return null
  }

  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null

  const discordId = token.slice(0, dot)
  const secret = token.slice(dot + 1)

  if (!DISCORD_ID.test(discordId)) return null
  // 32 bytes of base64url is 43 characters with no padding. Anything else is
  // not one of ours.
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null

  return { discordId, tokenHash: hashToken(token) }
}

/**
 * Mint one, replacing whatever this admin had before.
 *
 * THE CALLER HAS ALREADY DECIDED THIS PERSON MAY HAVE A SESSION. Nothing here
 * checks the Discord role, the grants row or the shared secret — that is
 * `/api/handoff/mint`'s job and it does all three before calling this. Keeping
 * the authorisation out of the minting means the checks are visible at the
 * endpoint rather than buried under a helper that sounds harmless.
 */
export async function mint(input: {
  discordId: string
  now?: number
  store?: HandoffStore
}): Promise<{ token: string; expiresAt: number }> {
  if (!DISCORD_ID.test(input.discordId)) {
    throw new Error('mint: discordId is not a snowflake')
  }

  const now = input.now ?? Date.now()
  const expiresAt = now + HANDOFF_TTL_MS
  const token = `${input.discordId}.${randomBytes(32).toString('base64url')}`

  await (input.store ?? dynamoStore).put({
    discordId: input.discordId,
    tokenHash: hashToken(token),
    issuedAt: now,
    expiresAt,
    expires: Math.ceil(expiresAt / 1000),
  })

  return { token, expiresAt }
}

/**
 * `malformed` never reached the store. `refused` covers no row, a stale hash
 * and a race that was lost — three causes that must stay indistinguishable
 * upstream. `expired` was consumed and then rejected on its own timestamp.
 *
 * ALL THREE PRODUCE THE SAME REDIRECT at the endpoint. The distinction exists
 * for the checks and for a log line, and the log line never carries the token.
 */
export type RedeemResult =
  | { ok: true; discordId: string }
  | { ok: false; reason: 'malformed' | 'refused' | 'expired' }

/**
 * Spend one.
 *
 * THE ROW IS DELETED BEFORE THE EXPIRY IS CHECKED, and that order is the point.
 * Checking first and deleting second leaves an expired row that a caller can
 * keep presenting until the TTL sweeper notices, which can be up to 48 hours.
 * Consuming unconditionally means the second attempt at any token — fresh,
 * stale, or racing another frame — finds nothing.
 */
export async function redeem(
  token: unknown,
  opts?: { now?: number; store?: HandoffStore },
): Promise<RedeemResult> {
  const parsed = parseToken(token)
  if (!parsed) return { ok: false, reason: 'malformed' }

  const rec = await (opts?.store ?? dynamoStore).take(
    parsed.discordId,
    parsed.tokenHash,
  )
  if (!rec) return { ok: false, reason: 'refused' }

  const now = opts?.now ?? Date.now()
  if (!(typeof rec.expiresAt === 'number') || rec.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }

  /**
   * The identity comes from the ROW, never from the token string, even though
   * the two agree by construction. A partition key is what DynamoDB matched on;
   * the string is what a caller sent. When they can only agree, take the one
   * that is not attacker-supplied.
   */
  if (rec.discordId !== parsed.discordId) return { ok: false, reason: 'refused' }

  return { ok: true, discordId: rec.discordId }
}

/**
 * A bound on how many tokens can be asked for.
 *
 * IN-MEMORY AND PER-PROCESS, which is the honest description: it resets when
 * the console restarts and it would not be shared across a second instance
 * were there ever one. That is adequate for what it defends against — a mint
 * endpoint that would otherwise issue without limit to a caller that already
 * holds the shared secret — and pretending otherwise by putting it in DynamoDB
 * would add a round trip to the one endpoint with a latency budget.
 *
 * TWO LIMITS, because they catch different things. The per-admin one bounds a
 * stuck retry loop on the game side, which is the realistic failure. The global
 * one bounds a game box that has been taken over, where the per-admin limit
 * buys nothing because the attacker can vary the id.
 */
export interface RateLimiter {
  allow(key: string, now?: number): boolean
}

export function createRateLimiter(opts: {
  perKey: number
  globalMax: number
  windowMs: number
}): RateLimiter {
  let windowStart = 0
  let globalCount = 0
  const perKey = new Map<string, number>()

  return {
    allow(key, now = Date.now()) {
      if (now - windowStart >= opts.windowMs) {
        windowStart = now
        globalCount = 0
        perKey.clear()
      }

      if (globalCount >= opts.globalMax) return false

      const used = perKey.get(key) ?? 0
      if (used >= opts.perKey) return false

      perKey.set(key, used + 1)
      globalCount += 1
      return true
    },
  }
}

/**
 * Six per admin per minute, sixty overall.
 *
 * Six is generous for a button a human presses: the honest cost of a refusal is
 * that the admin alt-tabs and signs in the ordinary way, so the limit is set
 * where a loop is caught and a person is not.
 */
export const mintLimiter = createRateLimiter({
  perKey: 6,
  globalMax: 60,
  windowMs: 60_000,
})
