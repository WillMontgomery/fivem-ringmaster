import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { ARTIFACT_INDEXES, artifactKey, type Artifact } from './artifacts'
import { env } from './env'

/**
 * The bucket half of artifacts: the one S3 client, the probe, and the signature.
 *
 * SERVER ONLY. Nothing under `src/components/` may import this — it pulls in the
 * S3 SDK, and a client component that touched it would ship several hundred
 * kilobytes of AWS to the browser to render a carousel. `check:artifacts`
 * asserts that no component imports it, because that is the sort of thing a
 * later refactor does by accident and nothing else notices.
 *
 * The names, the key format and the reasoning behind probing rather than
 * reading a list all live next door in `lib/artifacts.ts`, which is pure.
 */

/**
 * ONE NAMED CONSTANT, NOT A LITERAL AT EACH CALL SITE. The operator's words,
 * 2026-08-20: "Public access is disabled so you can hard-code that bucket in."
 *
 * IT IS NOT A SECRET AND `check-secrets` HAS NOTHING TO SAY ABOUT IT. The bucket
 * blocks public access, so the name grants nothing without credentials. What
 * would make a future rename expensive is the name appearing in six places, so
 * it appears in one. Recorded in docs/aws-setup.md §6.
 */
export const ARTIFACT_BUCKET = 'royale-incidents-bucket'

/**
 * How long a signature is good for.
 *
 * SIXTY SECONDS IS NOT STINGY, IT IS THE POINT. This URL is not handed to a
 * human or written into a page — it is the target of a redirect the browser
 * follows immediately, so its whole life is one round trip. Anything longer is a
 * credential sitting in a proxy log or a browser history for no benefit, and the
 * console is right here to sign another one.
 */
export const PRESIGN_TTL_SECONDS = 60

/**
 * The one S3 client, constructed on first use.
 *
 * SAME SHAPE AND SAME REASONS AS `lib/dynamo.ts`, which explains both halves:
 * no credentials are passed because the SDK's default provider chain finds the
 * EC2 instance role on its own, and construction is deferred behind a Proxy
 * because `create()` reads `env()` — which throws on a missing variable — while
 * `next build` imports every module to collect page data. Constructing at
 * import time made the BUILD demand a complete production environment, and CI
 * has no secrets by design.
 */
const globalForS3 = globalThis as unknown as { s3?: S3Client }

function create(): S3Client {
  return new S3Client({ region: env().AWS_REGION })
}

const s3: S3Client = new Proxy({} as S3Client, {
  get(_target, prop, receiver) {
    const real = (globalForS3.s3 ??= create())
    const value = Reflect.get(real, prop, receiver)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

/**
 * The metadata key carrying the capture time.
 *
 * WITHOUT THE `x-amz-meta-` PREFIX, AND THIS IS THE TRAP. The game writes
 * `Metadata: { 'captured-at': ... }` and S3 puts it on the wire as
 * `x-amz-meta-captured-at`; the SDK then strips the prefix again and
 * lower-cases what is left. Looking for the wire name here finds nothing, every
 * frame gets a null timestamp, and the carousel quietly renders em-dashes.
 */
const CAPTURED_AT = 'captured-at'

/**
 * Everything one case has in the bucket.
 *
 * NINE HEADS, IN PARALLEL, AND NO LIST. See `lib/artifacts.ts` for why the keys
 * are enumerable rather than stored: the game cannot append to the incident row
 * after filing it, so there is no list to read. `s3:GetObject` covers HEAD as
 * well as GET, which is what makes the capture time arrive from the same request
 * that establishes the frame exists — one source of truth, no second lookup.
 *
 * HEAD, NOT GET, AND THE DIFFERENCE IS THE WHOLE COST ARGUMENT. Nine HEADs move
 * headers only. Nine GETs would move nine full screenshots for a moderator who
 * is about to look at one of them.
 *
 * @returns the frames that exist, in capture order. Possibly none, which is
 *   normal and means nothing — the four unrelated reasons are listed in
 *   `lib/artifacts.ts` and none of them is about the accused.
 */
export async function probe(incidentId: string): Promise<Artifact[]> {
  const found = await Promise.all(
    ARTIFACT_INDEXES.map((index) => head(incidentId, index)),
  )
  return found.filter((a): a is Artifact => a !== null)
}

async function head(incidentId: string, index: number): Promise<Artifact | null> {
  const key = artifactKey(incidentId, index)
  if (!key) return null

  try {
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key }),
    )
    const raw = res.Metadata?.[CAPTURED_AT]
    const at = raw === undefined ? NaN : Number(raw)
    return { index, capturedAt: Number.isFinite(at) && at > 0 ? at : null }
  } catch (e) {
    /**
     * A MISSING FRAME ANSWERS 403 HERE, NOT 404, and getting this wrong would
     * turn every empty case into a page of server errors.
     *
     * S3 only tells you an object is absent if you are allowed to LIST the
     * bucket. This console deliberately is not — `RingmasterAppRole` holds
     * `s3:GetObject` and no `ListBucket`, so that it can never enumerate other
     * people's screenshots — and the documented consequence is that a key that
     * does not exist is refused as AccessDenied rather than reported as
     * NotFound. Both mean the same thing to us: no frame at that index, which
     * is the ordinary case for six of the nine on most incidents.
     */
    const status = statusOf(e)
    if (status === 403 || status === 404) return null

    /**
     * ANYTHING ELSE IS LOGGED AND STILL TREATED AS ABSENT. A throw here would
     * take down the incident page — the verdict, the timeline and the resolve
     * buttons — over a picture, and those are the parts an admin actually needs.
     * The frame is the most disposable thing on the page and the page is not.
     *
     * IT IS LOUD IN THE SERVER LOG rather than on the page, because the page has
     * nothing honest to say: an outage and an empty case look identical from the
     * browser, and inventing a distinction is the exact thing this feature is
     * forbidden from doing.
     */
    console.warn(
      `[artifacts] ${incidentId}/${index}: ${e instanceof Error ? e.message : e}`,
    )
    return null
  }
}

function statusOf(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null
  const meta = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
  return typeof meta?.httpStatusCode === 'number' ? meta.httpStatusCode : null
}

/**
 * A signature good for one fetch of one frame.
 *
 * NO VALIDATION HERE BEYOND THE KEY, deliberately: `artifactKey` refusing to
 * build a key IS the validation, and it is the only thing standing between a
 * query string and an object outside this bucket's incident prefix. Callers get
 * `null` and answer 400.
 *
 * SAFE TO CALL CONCURRENTLY ON THE SHARED CLIENT, which is worth recording
 * because it was not always true and the failure would be maddening. Older
 * `getSignedUrl` implementations added a middleware to the client and removed it
 * afterwards, so two overlapping presigns fought over one stack. 3.1114.0 calls
 * `client.middlewareStack.clone()` and never mutates the client — checked in
 * `node_modules`, not assumed.
 */
export async function presign(
  incidentId: string,
  index: number,
): Promise<string | null> {
  const key = artifactKey(incidentId, index)
  if (!key) return null

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  )
}
