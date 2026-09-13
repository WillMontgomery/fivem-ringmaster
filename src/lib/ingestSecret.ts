import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

import type { IngestCredential, ServerId } from './ingestAuth'

/**
 * Turning a presented secret into a proven server identity.
 *
 * ═══ WHY THIS IS A SEPARATE FILE FROM `lib/ingestAuth.ts` ═══
 *
 * The parsing half is imported by `lib/env.ts`, which is reachable from client
 * components (`HostBoard.tsx` -> `lib/maintenance` -> `lib/dynamo` -> `lib/env`),
 * so anything in that chain is compiled for the browser. `node:crypto` has no
 * browser resolution, and webpack answers a `node:` specifier it cannot handle
 * with `UnhandledSchemeError` against a module five hops from the component that
 * pulled it in. That is precisely what happened on 2026-09-13: the comparison
 * lived beside the parser, `next build` died in CI, and `main` was red on the
 * owner's deploy branch a week out from a closed beta.
 *
 * So the split is not tidiness. It is the boundary between a module the browser
 * bundle may contain and one it may not.
 *
 * ═══ `import 'server-only'` IS THE FENCE, AND IT IS THE FIRST LINE ON PURPOSE ═══
 *
 * That package resolves to a module that throws at build time when it is pulled
 * into a client bundle, so importing this file from a client component is a
 * BUILD ERROR NAMING THE IMPORT SITE rather than a scheme error naming a
 * transitive dependency. It is the difference between "you imported a server
 * module here" and "something under here wanted node:crypto", and the first one
 * is fixable in the minute you read it.
 *
 * It is also documentation that survives a refactor. Somebody moving
 * `resolveServerId` back beside the parser to save a file has to delete this
 * line to do it, which is a thing you notice doing.
 *
 * BELT AND BRACES, DELIBERATELY: `scripts/check-client-graph.mjs` runs in
 * `npm run verify` and fails on any node builtin reachable from a client
 * component, whether or not the module carrying it remembered this line.
 */

/**
 * Configured secrets, hashed once per credential set.
 *
 * WEAK-KEYED ON THE ARRAY ITSELF, which is stable because `env()` caches its
 * result and hands back the same `INGEST_CREDENTIALS` array on every call. So
 * the configured set is hashed on the first push after a restart and never
 * again, which is the property the credentials used to get by storing digests
 * before `node:crypto` had to leave that file.
 *
 * THE MEMO IS NOT WHAT MAKES THIS SAFE and must not be mistaken for it. It is
 * keyed on the CONFIGURATION, never on anything a caller presented, so a hit or
 * a miss says nothing about the request. The timing property below is the
 * comparison's, not the cache's.
 */
interface Hashed {
  serverId: ServerId
  digest: Buffer
}

const hashedSets = new WeakMap<readonly IngestCredential[], readonly Hashed[]>()

function digestOf(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function hashed(credentials: readonly IngestCredential[]): readonly Hashed[] {
  let set = hashedSets.get(credentials)
  if (!set) {
    set = credentials.map((c) => ({
      serverId: c.serverId,
      digest: digestOf(c.secret),
    }))
    hashedSets.set(credentials, set)
  }
  return set
}

/**
 * Which server presented this secret, or null if none did.
 *
 * ═══ EVERY CREDENTIAL IS COMPARED, EVERY TIME ═══
 *
 * There is no early return out of the loop and there must never be one. An exit
 * on the first match makes the time this function takes a readout of the
 * matched credential's POSITION in the list, which, with a handful of servers
 * and a caller willing to make a lot of requests, is a way to learn that a
 * guess was closer than another guess. The loop always runs N times, does the
 * same work on each iteration, and decides nothing until it is over.
 *
 * `timingSafeEqual` IS WHAT MAKES EACH COMPARISON SAFE, and it can only do that
 * over equal lengths, which every pair here has, because both sides are sha256
 * digests. Hashing first is also why a presented value of the wrong length does
 * not throw: catching that throw would itself leak the real secret's length.
 *
 * THE RESULT IS SELECTED, NOT BRANCHED AROUND. `matched = hit ? id : matched`
 * performs identical work whether or not this credential was the one, so a
 * matching iteration is not distinguishable from a non-matching one by the work
 * that follows it.
 *
 * AN ABSENT HEADER RETURNS EARLY, and that leaks nothing: it is a fact about the
 * request the caller already knows, decided before any secret is touched.
 */
export function resolveServerId(
  presented: string | null | undefined,
  credentials: readonly IngestCredential[],
): ServerId | null {
  if (!presented) return null

  const a = digestOf(presented)

  let matched: ServerId | null = null
  for (const credential of hashed(credentials)) {
    const hit = timingSafeEqual(a, credential.digest)
    matched = hit ? credential.serverId : matched
  }

  return matched
}
