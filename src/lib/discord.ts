import { adminRoleFrom, checkAdminRole } from './discordRole'
import { accentSurface, hexFromInt } from './contrast'
import { env } from './env'
import * as players from './players'
import type { AdminRole, DiscordChrome } from './profile'

/**
 * Discord, as a source of what a player looks like.
 *
 * THE HONEST STARTING POINT: a Discord user id alone is NOT enough to build an
 * avatar URL. The CDN path needs the account's current avatar *hash*, and that
 * hash is only available from the Discord API. Everything derivable from the id
 * by itself is the generic default avatar — one of six coloured logos — which
 * is what this console was showing while calling it a profile picture.
 *
 * SO THERE ARE EXACTLY TWO OPTIONS, and the first is not really one:
 *
 *   1. The default avatar. Deterministic, never 404s, and never that person.
 *   2. A bot token, and one API call per player to learn their hash.
 *
 * This module does (2) when `DISCORD_BOT_TOKEN` is set and falls back to (1)
 * when it is not, so the console works either way and adding a token is a
 * config change rather than a code change. The token is a real credential and
 * a decision about adding one — see docs/deploy.md.
 *
 * THE BOT NEEDS NO PRIVILEGED INTENTS AND NO SERVER MEMBERSHIP. `GET /users/{id}`
 * is public-ish data for any bot: username, global name, avatar hash, banner,
 * accent colour. It cannot read messages, cannot see servers, and cannot act on
 * anyone. That is a much smaller grant than it sounds like.
 *
 * ---------------------------------------------------------------------------
 * NOT CACHED, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
 *
 * The header of this file used to say the avatar hash "is stored on the
 * player's registry row so it survives restarts", with an in-process map
 * described as sitting in front of "the durable copy". THERE WAS NO DURABLE
 * COPY. Nothing in this file ever wrote anything, to DynamoDB or anywhere else.
 * The claim survived because both halves of it were plausible and neither was
 * checked — which is the failure this repo keeps having, and the reason the
 * comment is now a paragraph about what is NOT here.
 *
 * What replaced it, on the owner's instruction: ask Discord on every render.
 * Styling is the one thing where a stale answer is the wrong answer — somebody
 * who changed their avatar an hour ago should not be shown by last week's — and
 * a profile page is opened a few dozen times a day, not a few thousand. That is
 * far inside `GET /users/{id}`'s rate limit, and it costs one request on a page
 * that already makes eight DynamoDB calls.
 *
 * The TTL map that used to be here is gone entirely rather than kept "just in
 * case". A cache nothing reads is how the false claim above lasted this long.
 *
 * NAMES ARE THE EXCEPTION, AND THEY ARE WRITTEN DOWN. See recordDiscordIdentity
 * in lib/players.ts: `GET /users/{id}` only ever returns the present, so a
 * history of names cannot be derived from it however often it is called. The
 * write survives the live fetch because it captures something the fetch
 * structurally cannot.
 */

/**
 * How long a profile page is willing to wait for Discord. The owner's number.
 *
 * PAST THIS THE PAGE RENDERS WITHOUT THE STYLING rather than erroring or
 * hanging. Five seconds is long by the standards of a page load and short by
 * the standards of somebody deciding whether to ban a player, which is the
 * right way round.
 *
 * IT IS NOW THE CEILING ON THE WHOLE PAGE, not just on the face. The profile
 * waits behind skeletons until this resolves (the owner's instruction — see
 * components/ProfileView), so a timeout that failed to fire would be a page that
 * never arrives rather than a face that never arrives. A second, separate
 * ceiling covers the images afterwards: IMAGE_TIMEOUT_MS in
 * components/DiscordChrome. Both are hard, and a profile is drawable within the
 * sum of them whatever Discord does.
 */
export const DISCORD_TIMEOUT_MS = 5_000

/** The subset of `GET /users/{id}` this console has any use for. */
interface DiscordUser {
  id: string
  username?: string | null
  global_name?: string | null
  avatar?: string | null
  banner?: string | null
  /**
   * The accent colour, as a 24-bit integer.
   *
   * `banner_color` IS THE SAME VALUE SPELLED DIFFERENTLY — 16716287, 0xFF11FF
   * and "#ff11ff" are one colour, and Discord sends both fields. They are
   * normalised to one hex string the moment they arrive so nothing downstream
   * has to know there were ever two spellings.
   */
  accent_color?: number | null
  banner_color?: string | null
}

/**
 * Discord's own fallback, derived from the id.
 *
 * NEVER THAT PERSON'S FACE — it is one of six coloured logos. Used when there
 * is no token, when the API says no, and when the account genuinely has no
 * avatar set.
 */
export function defaultAvatar(discordId: string): string | null {
  try {
    const index = Number((BigInt(discordId) >> 22n) % 6n)
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`
  } catch {
    return null
  }
}

/** Build the real CDN URL from an id and a hash. */
export function avatarUrl(discordId: string, hash: string): string {
  // `a_` prefixed hashes are animated; .gif keeps them moving, and .png would
  // still render — just as a still frame — so this is cosmetic rather than
  // load-bearing.
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${ext}?size=128`
}

/**
 * The profile banner, at the size it is actually drawn.
 *
 * 600 RATHER THAN THE 1024 THE CDN WILL HAPPILY SERVE, because this image ends
 * up behind a heavy blur across a card a few hundred pixels tall. Detail past
 * that is thrown away by the filter, and the skeleton is held until this has
 * loaded — so every kilobyte here is time a moderator spends looking at a grey
 * rectangle.
 */
export function bannerUrl(discordId: string, hash: string): string {
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/banners/${discordId}/${hash}.${ext}?size=600`
}

/**
 * The accent colour as one hex string, whichever field it arrived in.
 *
 * ONE CODE PATH, TWO SPELLINGS ON THE WIRE. `accent_color` is the integer and
 * `banner_color` is the same number as a string; a body can carry either or
 * both. Everything past this function deals in `#rrggbb`.
 */
function accentHex(user: DiscordUser): string | null {
  if (typeof user.accent_color === 'number') {
    const hex = hexFromInt(user.accent_color)
    if (hex) return hex
  }
  if (typeof user.banner_color === 'string') return user.banner_color
  return null
}

/**
 * Ask Discord for one user, with a hard ceiling on how long we will wait.
 *
 * RETURNS NULL RATHER THAN THROWING on every failure path — no token, a 404, a
 * rate limit, a network problem, the timeout. A profile page must render when
 * Discord is unreachable; the face is the least important thing on it, and the
 * caller cannot do anything differently for a 429 than for a 500 anyway.
 *
 * `AbortSignal.timeout` rather than a race against a sleeping promise: it
 * actually cancels the request, so a Discord outage does not leave one hanging
 * socket per page view accumulating behind a page that has already rendered.
 */
export async function fetchDiscordUser(
  discordId: string,
  timeoutMs: number = DISCORD_TIMEOUT_MS,
): Promise<DiscordUser | null> {
  const token = env().DISCORD_BOT_TOKEN
  if (!token) return null

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      // Next would otherwise cache this in its own data cache with rules that
      // have nothing to do with how often somebody changes their avatar — and
      // the whole point of asking every render is that the answer is current.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) return null

    const body = (await res.json()) as DiscordUser
    return typeof body?.id === 'string' ? body : null
  } catch {
    // Includes the TimeoutError the abort raises. Deliberately silent: this is
    // an expected outcome, not an incident, and a log line per slow page view
    // would bury the ones that matter. The token must never appear in a log.
    return null
  }
}

/**
 * Is this account an admin? Asked of Discord, on the page's budget, never blocking.
 *
 * ═══ THE COST, STATED, BECAUSE IT IS THE WHOLE DESIGN DECISION ═══
 *
 * `checkAdminRole` is a live call to `GET /guilds/{guild}/members/{user}`. This
 * page already makes one live Discord call (`fetchDiscordUser` above) and already
 * sits behind a full-page skeleton until it answers, so the questions are:
 *
 *   HOW LONG DOES IT ADD?  Nothing. It runs in `Promise.all` beside the user
 *                          fetch on the PAGE's budget (DISCORD_TIMEOUT_MS), not
 *                          on the write gate's own ROLE_CHECK_TIMEOUT_MS — those
 *                          two are separate constants precisely so a page and a
 *                          ban can wait for different lengths of time, and this
 *                          is a page. Worst case for the profile is the max of
 *                          the two calls, which is exactly what it was before.
 *
 *   HOW OFTEN DOES IT FIRE?  Once per profile page view, and nowhere else.
 *                          `discordChromeFor` has exactly one caller — the
 *                          profile route — and no list, table or poll touches it.
 *                          That is the bound on "not an unbounded number of times
 *                          on a list", and it is structural rather than a
 *                          promise: a list would have to import this function to
 *                          break it.
 *
 *   WHY NOT CACHE IT?      For the reason lib/discordRole.ts gives about the
 *                          write gate, which applies here too: a TTL is exactly a
 *                          window in which a removed admin still wears the chip.
 *                          Profile views are tens per day against a global
 *                          ceiling of fifty requests per SECOND. There is nothing
 *                          to save.
 *
 * NEVER THROWS. `checkAdminRole` does not, but `env()` inside it does when a
 * variable is missing, and this promise is resolved through a Suspense boundary
 * where a rejection costs the page rather than the chip. An unreadable
 * environment is `unknown`, which is the honest answer anyway.
 */
async function adminRoleFor(discordId: string, timeoutMs: number): Promise<AdminRole> {
  try {
    return adminRoleFrom(await checkAdminRole(discordId, timeoutMs))
  } catch {
    return 'unknown'
  }
}

/** Empty strings are how Discord spells "not set" in some fields. Treat as null. */
function text(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Everything the profile page needs from Discord, for one render.
 *
 * THIS IS THE ONLY THING THE PAGE AWAITS FOR DISCORD, and it is deliberately
 * never awaited on the critical path: the page hands the promise straight to
 * the client behind a Suspense boundary, so the identifiers, the play record,
 * the incidents and the moderation buttons are all on screen while this is
 * still in flight. See src/app/players/[license]/page.tsx.
 *
 * IT RESOLVES EVEN WHEN EVERYTHING FAILS. `answered: false` with the generic
 * default avatar is a complete, drawable answer — the page shows a profile
 * without the styling rather than an error where a profile should be.
 *
 * THE DYNAMO WRITE HAPPENS HERE, not in the component, because it is a
 * consequence of the fetch rather than of the render: the only moment anybody
 * can notice that a name changed is the moment a fresh answer is compared with
 * the stored one. It is conditional on the row already existing, so opening a
 * profile can never conjure a registry row for somebody the game has not seen.
 */
export async function discordChromeFor(input: {
  discordId: string
  license: string
  /** Already read by the page; passed in so this does not read the row twice. */
  stored: players.DiscordIdentity | null | undefined
  now: number
  /** Overridable for the preview harness and for tests. */
  timeoutMs?: number
}): Promise<DiscordChrome> {
  const { discordId, license, stored, now } = input
  const timeoutMs = input.timeoutMs ?? DISCORD_TIMEOUT_MS

  /*
   * TWO CALLS, ONE WAIT. `Promise.all` rather than two awaits: these are
   * independent questions to the same host, and sequencing them would make a slow
   * Discord cost the page ten seconds instead of five. See `adminRoleFor`.
   */
  const [user, admin] = await Promise.all([
    fetchDiscordUser(discordId, timeoutMs),
    adminRoleFor(discordId, timeoutMs),
  ])

  // The floor: a real id, no answer. Still a face, still a page.
  const fallback: DiscordChrome = {
    id: discordId,
    answered: false,
    avatarUrl: defaultAvatar(discordId) ?? '',
    real: false,
    bannerUrl: null,
    accent: null,
    username: stored?.username ?? null,
    globalName: stored?.globalName ?? null,
    // The stored history still shows when Discord is down: it is Ringmaster's
    // own record, and it is the half of this panel with moderation value.
    formerNames: stored?.former ?? [],
    // NOT FORCED TO `unknown` HERE. The two calls fail independently — a 429 on
    // `GET /users/{id}` says nothing about whether the member lookup answered —
    // and flattening a real "yes" into "we could not check" because the AVATAR
    // request timed out would hide a chip we actually have the evidence for.
    admin,
  }

  if (!user) return fallback

  /*
   * EVERYTHING PAST HERE IS INSIDE A CATCH, and it is not defensive padding.
   *
   * This promise is handed to a client component and resolved through a Suspense
   * boundary rather than awaited by the page. A rejection there does not fail
   * one panel — it takes the boundary down and, in a server render, surfaces as
   * an error rather than as a profile. DynamoDB being unreachable must cost the
   * name history and nothing else.
   */
  try {
    const username = text(user.username)
    const globalName = text(user.global_name)

    // Reconciled against what we last stored, which is also what produces the
    // "formerly known as" list. It only writes when a name has actually moved,
    // so the overwhelmingly common render costs no write at all, and a failed
    // write costs the history of one change rather than the page.
    const identity = await players.recordDiscordIdentity({
      license,
      stored,
      id: discordId,
      username,
      globalName,
      now,
    })

    const avatarHash = text(user.avatar)
    const bannerHash = text(user.banner)

    return {
      id: discordId,
      answered: true,
      avatarUrl: avatarHash
        ? avatarUrl(discordId, avatarHash)
        : (defaultAvatar(discordId) ?? ''),
      real: avatarHash !== null,
      bannerUrl: bannerHash ? bannerUrl(discordId, bannerHash) : null,
      accent: accentSurface(accentHex(user)),
      username,
      globalName,
      formerNames: identity.former,
      admin,
    }
  } catch {
    return fallback
  }
}
