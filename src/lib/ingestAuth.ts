/**
 * Which game server is pushing. infradocs#23.
 *
 * ═══ THIS HALF IS PURE, AND THAT IS A BUILD CONSTRAINT, NOT A PREFERENCE ═══
 *
 * NOTHING HERE MAY IMPORT A NODE BUILTIN. `lib/env.ts` imports this file so the
 * credential set is validated in the one pass that names every bad variable at
 * once, and `env.ts` is reachable from client components through
 * `lib/dynamo.ts`: `HostBoard.tsx` -> `lib/maintenance` -> `lib/dynamo` ->
 * `lib/env` -> here. Webpack cannot resolve `node:crypto` for the browser, so a
 * single `node:crypto` import in this file is a failed production build with an
 * `UnhandledSchemeError` naming a module five hops from the component that
 * caused it. It shipped exactly that way once, on 2026-09-13, and `npm run
 * verify` did not catch it because `next build` was only ever run in CI.
 *
 * THE COMPARISON LIVES IN `lib/ingestSecret.ts`, which carries `import
 * 'server-only'` so that importing it from the client graph is a build error at
 * the import site rather than a webpack scheme error downstream. Only the two
 * route handlers import it. `scripts/check-client-graph.mjs` walks the client
 * closure on every `npm run verify` and fails on any node builtin reachable
 * from it, which is the cheap version of the build CI runs.
 *
 * ═══ IDENTITY IS A PROPERTY OF THE CREDENTIAL, NEVER OF THE PAYLOAD ═══
 *
 * The console ingests from more than one game server now, and every push has to
 * be filed under the right one. There were three ways to decide that and the
 * owner chose this one: A SEPARATE SECRET PER SERVER, with the identity read off
 * whichever secret authenticated the request.
 *
 * The two that were not chosen, and why it matters that they were refused
 * rather than merely passed over:
 *
 *   A FIELD IN THE BODY is a claim. Anything holding any valid ingest secret
 *   could then write itself into the prod view by spelling `prod` in its
 *   envelope, and a dev box left pointing at the prod console after an
 *   afternoon of testing would do exactly that by accident.
 *
 *   THE SOURCE ADDRESS is not a claim, and it is still wrong. It ties identity
 *   to a NAT boundary, a peering route and an instance's private IP: three
 *   things that get renumbered by people who have no idea they are editing an
 *   authentication decision.
 *
 * So there is no function in this file that takes a request body, and there is
 * no server id anywhere in `lib/ingest.ts`'s wire schema. `ingestAuth.check.ts`
 * section D reads `app/api/ingest/route.ts` off disk to assert the route keeps
 * it that way, because the absence of a code path is the actual property and no
 * amount of unit testing in here can demonstrate it.
 *
 * ═══ WHY THE SET IS AN ENVIRONMENT VARIABLE AND NOT SSM ═══
 *
 * `INGEST_SECRETS` is one variable holding `{"prod":"...","dev":"..."}`, and a
 * third server is a third key in it, no code change, which is the requirement.
 * SSM Parameter Store was the alternative and it loses on the one constraint
 * this endpoint has above all others: THE GAME'S `PerformHttpRequest` CARRIES A
 * HARDCODED FIVE-SECOND CEILING. Reading a parameter is a network call, so it
 * would have to be cached, and a cache in front of a credential is a staleness
 * question ("how long after rotating does the old secret still work") that
 * nobody has asked for. It would also be the first thing in `lib/env.ts` that
 * is not in `process.env`, breaking the one rule that file is built on: every
 * setting is validated in one pass, at one moment, naming every problem at once.
 *
 * Ringmaster already takes every secret it holds from `/opt/ringmaster/.env.local`
 * on a box with an instance role and no static AWS credentials. This is the
 * fourth such secret and it is stored like the other three.
 */

/**
 * A server's name in this estate.
 *
 * `dev` and `prod`, and the vocabulary is not this file's invention: the `Env`
 * instance tag on both boxes already carries exactly those two values and
 * `blitz-metrics` dimensions every metric by it. One word for one concept
 * across the estate is worth more than a prettier name here.
 *
 * A STRING RATHER THAN A UNION OF THE TWO, deliberately. A third server must be
 * a third key in an environment variable and nothing else. A union type would
 * make it a code change, a build and a deploy.
 */
export type ServerId = string

/**
 * The shape a server id may take.
 *
 * Lowercase, because these values end up in log lines, metric dimensions and
 * eventually a URL query for the dropdown, and `Prod` versus `prod` being two
 * different servers is a bug nobody enjoys. Bounded and free of separators so
 * that an id can never be mistaken for a path segment or a key prefix.
 */
export const SERVER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * The server every reader means when it does not say.
 *
 * THE LIVE BOX IS PROD AND THE CONSOLE'S EXISTING PAGES ARE ABOUT IT. Every
 * caller of `liveView()` today is a page written before there was a second
 * server, and this constant is what keeps every one of them showing precisely
 * what it showed yesterday. The selection dropdown is the follow-up to #23, and
 * it will pass an explicit id; until it does, the default is the answer.
 *
 * THE CONSEQUENCE, SO IT IS NOT A SURPRISE: a console whose only sender is a dev
 * box shows an empty board, because nothing has pushed as `prod`. That is the
 * correct reading of a prod-scoped page, and it is also the exact behavior that
 * stops a newly added dev server from quietly becoming what the live pages mean.
 */
export const DEFAULT_SERVER_ID: ServerId = 'prod'

/**
 * One configured credential: a server, and the secret that proves it is that
 * server.
 *
 * IT CARRIES THE SECRET RATHER THAN A DIGEST OF IT, because hashing needs
 * `node:crypto` and this file cannot have it. `lib/ingestSecret.ts` derives the
 * digests instead, memoized on the identity of the array, so the configured set
 * is still hashed once and not once per push. The value is no more exposed here
 * than it was in `process.env`, which is where it came from.
 */
export interface IngestCredential {
  serverId: ServerId
  secret: string
}

/** What `lib/env.ts` hands the parser, straight out of `process.env`. */
export interface IngestSecretSources {
  /** `INGEST_SECRETS`, a JSON object mapping a server id to its secret. */
  secrets?: string
  /** `INGEST_SECRET`, the single secret this console shipped with. */
  legacy?: string
}

/** Matches `INGEST_SECRET`'s own floor. A short secret is a lock drawn on a door. */
const MIN_SECRET_LEN = 16

/**
 * Build the credential set from the environment.
 *
 * THROWS, AND IT IS MEANT TO BE CALLED FROM `lib/env.ts`, so a bad value stops
 * the console at the same moment and in the same message as a missing
 * `AUTH_SECRET`. A JSON typo that was only discovered on the first push would
 * present as every game server in the estate being refused at once, with a
 * 500 in the journal and a perfectly healthy-looking console.
 *
 * ═══ THE LEGACY VARIABLE IS NOT DEPRECATED, IT IS THE PROD CREDENTIAL ═══
 *
 * `INGEST_SECRET` is appended as a `prod` credential whenever it is set. That is
 * the whole migration: a console deployed with today's `.env.local` and nothing
 * added keeps accepting today's prod push, because the value it has always
 * compared against is still in the set and still means prod. Nothing about the
 * live server's configuration has to change on the day this ships.
 *
 * AND IT COMPOSES WITH THE NEW VARIABLE RATHER THAN BEING REPLACED BY IT, which
 * buys a rotation for free: put a fresh prod secret in `INGEST_SECRETS`, leave
 * the old one in `INGEST_SECRET`, and both are accepted as prod until the game
 * box has been moved over and the old variable can be deleted.
 *
 * ONE VALUE MAY NEVER MEAN TWO SERVERS. That is the one configuration this
 * refuses outright, and the duplicate check below is it. Everything else it can make
 * sense of, it accepts.
 */
export function parseIngestCredentials(
  sources: IngestSecretSources,
): IngestCredential[] {
  const creds: IngestCredential[] = []

  /** Secret value -> the server it already means. The ambiguity guard. */
  const claimed = new Map<string, ServerId>()

  const add = (serverId: string, secret: string, where: string): void => {
    if (!SERVER_ID_RE.test(serverId)) {
      throw new Error(
        `${where}: \`${serverId}\` is not a usable server id. Use a short lowercase ` +
          `token such as \`prod\` or \`dev\`, the same values the Env instance tag carries.`,
      )
    }
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LEN) {
      throw new Error(
        `${where}: the secret for \`${serverId}\` must be a string of at least ` +
          `${MIN_SECRET_LEN} characters. Generate one with: openssl rand -hex 24`,
      )
    }

    const already = claimed.get(secret)
    if (already !== undefined) {
      /**
       * THE SAME VALUE FOR THE SAME SERVER IS THE MIGRATION, not a mistake:
       * `INGEST_SECRETS` naming prod with the value `INGEST_SECRET` already
       * holds. One credential, no complaint.
       */
      if (already === serverId) return

      throw new Error(
        `${where}: the same secret is configured for more than one server ` +
          `(\`${already}\` and \`${serverId}\`). A push carrying it could not be ` +
          `attributed, so identity would depend on which entry was compared last. ` +
          `Give every server its own secret.`,
      )
    }

    claimed.set(secret, serverId)
    creds.push({ serverId, secret })
  }

  const raw = sources.secrets?.trim()
  if (raw) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      throw new Error(
        `INGEST_SECRETS is not valid JSON (${e instanceof Error ? e.message : String(e)}). ` +
          `It is an object mapping a server id to its secret, e.g. ` +
          `{"prod":"...","dev":"..."}`,
      )
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        'INGEST_SECRETS must be a JSON object mapping a server id to its secret, ' +
          'e.g. {"prod":"...","dev":"..."}',
      )
    }

    for (const [serverId, secret] of Object.entries(parsed as Record<string, unknown>)) {
      add(serverId, secret as string, 'INGEST_SECRETS')
    }
  }

  const legacy = sources.legacy?.trim()
  if (legacy) add(DEFAULT_SERVER_ID, legacy, 'INGEST_SECRET')

  if (creds.length === 0) {
    throw new Error(
      'No ingest credential is configured. Set INGEST_SECRETS to a JSON object ' +
        'mapping each game server to its own secret, e.g. {"prod":"...","dev":"..."}, ' +
        'or INGEST_SECRET to a single value for the prod server. With neither, every ' +
        'push from every game server is refused. See .env.example.',
    )
  }

  return creds
}

/** The servers this console will accept a push from. For operator output only. */
export function configuredServers(
  credentials: readonly IngestCredential[],
): ServerId[] {
  return [...new Set(credentials.map((c) => c.serverId))].sort()
}
