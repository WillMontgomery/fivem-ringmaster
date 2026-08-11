import NextAuth from 'next-auth'
import Discord from 'next-auth/providers/discord'
import { DynamoDBAdapter } from '@auth/dynamodb-adapter'

import { ddb, tables } from './lib/dynamo'
import { env } from './lib/env'

/**
 * Authentication.
 *
 * Auth.js rather than hand-rolled OAuth on purpose: PKCE, `state` validation
 * and session management are the security-critical parts, and configuring them
 * beats writing them.
 *
 * SESSIONS ARE IN THE DATABASE, NOT JWTs, and this is not a stylistic choice.
 * A self-contained token stays valid until it expires, which would mean the
 * `grant` scope's revoke button does not actually revoke anything for up to the
 * token lifetime. An admin being removed has to take effect *now*.
 */
/**
 * The config is a FUNCTION, not an object literal, and that is a build
 * requirement rather than a style choice.
 *
 * Auth.js evaluates it per request. An object literal is evaluated at module
 * load -- and `next build` imports every module to collect page data, so the
 * build itself would demand a complete production environment and could only
 * run on an already-configured host.
 *
 * Deferring it keeps the useful half of env()'s strictness: a missing variable
 * still fails loudly, naming itself, at the first request instead of at build.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DynamoDBAdapter(ddb, { tableName: tables.sessions }),

  session: { strategy: 'database' },

  providers: [
    Discord({
      clientId: env().DISCORD_CLIENT_ID,
      clientSecret: env().DISCORD_CLIENT_SECRET,
      // `guilds.members.read` lets the signIn callback fetch this account's
      // member record — roles included — in OUR guild specifically. `identify`
      // is the default and gives us the user id. Scopes are requested at
      // authorize time, so changing them needs nothing in the Discord portal.
      authorization: { params: { scope: 'identify guilds.members.read' } },
    }),
  ],

  callbacks: {
    /**
     * The admin role as the sign-in gate, before any grant lookup.
     *
     * Guild membership alone stopped being a meaningful filter the moment the
     * guild doubled as the player community — every player would pass it. So
     * the gate is a specific role, assigned by hand in Discord.
     *
     * ONE CALL DOES BOTH CHECKS: the member endpoint 404s for accounts not in
     * the guild, so membership comes free with the role lookup that replaced
     * the old guild-list scan.
     *
     * This is still not the permission check — that is `lib/grants.ts`, per
     * action, keyed on license. Returning `false` here sends Auth.js to
     * /login?error=AccessDenied, which the login page surfaces as a toast.
     */
    async signIn({ account }) {
      if (!account?.access_token) return false

      try {
        const res = await fetch(
          `https://discord.com/api/users/@me/guilds/${env().DISCORD_GUILD_ID}/member`,
          { headers: { Authorization: `Bearer ${account.access_token}` } },
        )
        // 404: not in the guild. Anything else non-OK: Discord declined to
        // answer. Both deny.
        if (!res.ok) return false

        const member = (await res.json()) as { roles?: string[] }
        return (
          Array.isArray(member.roles) &&
          member.roles.includes(env().DISCORD_ADMIN_ROLE_ID)
        )
      } catch {
        // Discord being unreachable denies the login rather than allowing it.
        // The failure mode of "admins cannot log in for ten minutes" is
        // strictly better than "anyone can log in for ten minutes".
        return false
      }
    },

    /**
     * Put the Discord id on the session so routes can map it to a license.
     *
     * NOTE the direction of the mapping, because it is the whole reason the
     * game side captures identifiers: Discord tells us who is logged in, but
     * every permission, ban and audit row keys on the *license*. The link
     * between them exists only because a player connected to the game server
     * once with Discord integration enabled.
     */
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },

  pages: {
    signIn: '/login',
    // Errors land on OUR login page too, as ?error=<code>. Without this they
    // go to Auth.js's default /api/auth/error — an unstyled "Server error"
    // page that tells the person nothing and tells us nothing, which is
    // exactly where the first real login attempt ended up.
    error: '/login',
  },

  // Auth.js reads AUTH_SECRET and AUTH_URL from the environment on its own;
  // env() is called here purely so a missing one fails with a message naming
  // it, rather than as an OAuth redirect dead-ending on a blank page.
  secret: env().AUTH_SECRET,
}))
