import { env } from './env'

/**
 * Discord avatars.
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
 * is public-ish data for any bot: username, avatar hash, banner. It cannot read
 * messages, cannot see servers, and cannot act on anyone. That is a much smaller
 * grant than it sounds like.
 *
 * CACHED, because a profile page must not make a Discord call per render and
 * Discord rate-limits aggressively. The hash is stored on the player's registry
 * row so it survives restarts, with an in-process map in front of it so a burst
 * of page views costs one lookup.
 */

/** Hashes live this long before we ask Discord again. Avatars change rarely. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/** discordId -> { hash, at }. Process-local; the durable copy is the player row. */
const memo = new Map<string, { hash: string | null; at: number }>()

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
 * Ask Discord for one user's avatar hash.
 *
 * RETURNS NULL RATHER THAN THROWING on every failure path — no token, a 404, a
 * rate limit, a network problem. A profile page must render when Discord is
 * unreachable; the face is the least important thing on it.
 */
export async function fetchAvatarHash(discordId: string): Promise<string | null> {
  const token = env().DISCORD_BOT_TOKEN
  if (!token) return null

  const cached = memo.get(discordId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.hash

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      // Next would otherwise cache this in its own data cache with rules that
      // have nothing to do with how often avatars change.
      cache: 'no-store',
    })

    if (!res.ok) {
      // A 429 is worth not hammering. Memoising the null means the next render
      // does not immediately ask again and make it worse.
      memo.set(discordId, { hash: null, at: Date.now() })
      return null
    }

    const body = (await res.json()) as { avatar?: string | null }
    const hash = typeof body.avatar === 'string' ? body.avatar : null
    memo.set(discordId, { hash, at: Date.now() })
    return hash
  } catch {
    memo.set(discordId, { hash: null, at: Date.now() })
    return null
  }
}

/**
 * The best avatar URL we can produce for this id, right now.
 *
 * Falls all the way back to the default rather than to null, so the page always
 * has something round to draw and never renders a broken image.
 */
export async function avatarFor(
  discordId: string | null | undefined,
): Promise<string | null> {
  if (!discordId) return null
  const hash = await fetchAvatarHash(discordId)
  return hash ? avatarUrl(discordId, hash) : defaultAvatar(discordId)
}
