/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * THE CLIENT ROUTER CACHE MUST NOT HOLD OPERATIONAL DATA.
   *
   * `export const dynamic = 'force-dynamic'` governs the SERVER: it stops the
   * page being prerendered or cached at the edge. It says nothing about the
   * cache the App Router keeps in the browser — so navigating away from a
   * profile and back re-showed the payload from that in-memory cache, and the
   * page looked frozen even though every source behind it had moved.
   *
   * The symptom was exactly as reported: going back to the player list and
   * clicking the same profile again showed stale data until a hard reload.
   *
   * Zero on both is right for this application specifically. Every page here
   * renders live moderation state, and a stale one is not a performance win —
   * it is a moderator acting on a player who left ten minutes ago.
   */
  experimental: {
    staleTimes: { dynamic: 0, static: 0 },
  },
  // The admin console renders live operational data. Nothing here should sit
  // in a CDN cache, and nothing here should be indexed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
