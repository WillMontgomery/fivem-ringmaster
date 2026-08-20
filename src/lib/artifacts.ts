/**
 * Where an incident's artifacts live, and how this console finds them.
 *
 * ═══ EMPTY IS NORMAL AND IS NOT EVIDENCE OF ANYTHING ═══
 *
 * That sentence was the comment on `Incident.captureKeys`, a field this module
 * replaces and which has been deleted. The field is gone; the sentence is not,
 * because it is the reason the carousel is built the way it is and the one
 * thing that stops a future reader deciding an empty set needs explaining.
 *
 * A case can have no artifacts for four unrelated reasons:
 *
 *   1. `screenshot-basic` is not installed on the game server, so nothing was
 *      ever asked for.
 *   2. The subject had already disconnected — the capture runs on THEIR machine.
 *   3. The upload failed, or was blocked, or the frame arrived empty.
 *   4. The frames aged out. The bucket has a 180-day expiry (docs/aws-setup.md
 *      §6), so an incident older than that has necessarily lost them.
 *
 * None of those four is a statement about the accused, and **the page does not
 * tell them apart.** That was ruled by the owner, 2026-08-20: "yeah agreed it
 * never reads as innocent, but we don't need helper text to convey that. it's
 * assumed." So there is deliberately no age arithmetic here, no expiry
 * constant, and no fifth state — an empty set renders as plainly empty and says
 * nothing at all. Absence of a mechanism is the decision, not an omission.
 *
 * ═══ WHY THIS PROBES INSTEAD OF READING A LIST ═══
 *
 * Nothing in DynamoDB says which frames a case has, and nothing can. The game
 * writes the incident row under a grant of `PutItem` conditional on the id
 * being absent — it can file a case and cannot reach inside one, so it has no
 * way to append a key after the fact. Widening that to an `UpdateItem` would
 * cost exactly what the append-only posture buys: a compromised game box that
 * can file noise but cannot touch a verdict.
 *
 * So the key format is fixed and enumerable ON PURPOSE, and this console holds
 * `s3:GetObject` with deliberately **no `ListBucket`**. It finds a case's frames
 * by trying all nine keys and keeping the ones that answer. Nine HEADs on a page
 * a human opened, no wire contract, nothing to go stale.
 *
 * ═══ THIS FILE IS PURE, AND THAT IS LOAD-BEARING ═══
 *
 * No AWS SDK, no `env()`, no `next/headers`. The S3 half lives next door in
 * `lib/artifactStore.ts`, which is server-only. Keeping the names here means the
 * carousel (a client component) and `scripts/check-artifact-keys.mjs` (a plain
 * script) can both import them without dragging a 400 KB SDK into either.
 */

/**
 * The most frames one incident can have: three timed plus six corroboration
 * (owner, 2026-08-20).
 *
 * THIS BOUNDS THE NAMESPACE, which is a different job from enforcing the cap —
 * the game enforces that, in `br_lib/shared/artifact_plan`. What it does here is
 * make `incidents/<id>/01..09` a COMPLETE enumeration of a case, so a reader
 * with GetObject and no ListBucket can find every frame without being told.
 *
 * It must equal the game's `ARTIFACT_MAX_INDEX`. `check:artifacts` asserts that
 * against the real constant in the gamemode checkout.
 */
export const ARTIFACT_MAX_INDEX = 9

/**
 * THE PREFIX IS THE GRANT on the writing side: the game box's policy is
 * `s3:PutObject` on `arn:aws:s3:::royale-incidents-bucket/incidents/*` and
 * nothing else. Keys are built from it here, once.
 */
export const ARTIFACT_PREFIX = 'incidents/'

/** webp at 0.92 (owner, 2026-08-20). The game writes nothing else today. */
export const ARTIFACT_EXTENSION = 'webp'

/**
 * The ids the game mints, and only those.
 *
 * A SECURITY BOUNDARY, NOT A TIDINESS CHECK. `artifactKey` is reached from a
 * query string (see `app/api/incidents/artifact/route.ts`), and a key is a path:
 * an id containing a slash or a `..` would sign a URL for an object outside the
 * prefix this console is meant to be able to read. Matching the exact v4 UUID
 * shape rather than "some safe characters" means the key cannot contain a
 * slash, a dot-dot, a space or a control character by construction.
 *
 * The same regex, for the same reason, is on the game side in
 * `js-src/br_ddb/src/artifacts.js`.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Two digits, so `01..09` sorts as capture order in any listing that sees it. */
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Every index a case can have, in capture order.
 *
 * 01–03 are the timed frames — immediately, +5s, +10s — and 04 onward are
 * corroborations. **Gaps are completely normal**: 01 and 04 existing while 02
 * and 03 do not is the ordinary shape of photographing somebody else's machine.
 */
export const ARTIFACT_INDEXES: readonly number[] = Array.from(
  { length: ARTIFACT_MAX_INDEX },
  (_, i) => i + 1,
)

/**
 * The S3 key for one frame, or `null` if the inputs could not name one.
 *
 * NULL RATHER THAN A THROWN ERROR, because both callers want to answer a
 * request rather than crash a page: the route turns it into a 400 and the probe
 * skips the index.
 */
export function artifactKey(incidentId: string, index: number): string | null {
  if (typeof incidentId !== 'string' || !UUID_RE.test(incidentId)) return null
  if (!Number.isInteger(index) || index < 1 || index > ARTIFACT_MAX_INDEX) {
    return null
  }
  return `${ARTIFACT_PREFIX}${incidentId}/${pad2(index)}.${ARTIFACT_EXTENSION}`
}

/**
 * One frame that actually exists, as the page sees it.
 *
 * `index` IS THE S3 INDEX, not a position in the array — the set is sparse, so
 * the two differ the moment a frame is missing.
 */
export interface Artifact {
  index: number
  /**
   * Unix ms, the game server's clock at the moment it decided to ask for the
   * frame. NOT the subject's clock — this is an anti-cheat surface and the whole
   * premise is that they may be running modified software — and not the upload
   * time either, which would be a different fact in the same field.
   *
   * NULLABLE BECAUSE THE OBJECT MIGHT NOT CARRY IT. An object written by an
   * older build, or by hand, has no `captured-at` metadata. A frame with no
   * readable time is still evidence, so it renders with `LocalTime`'s own
   * em-dash rather than being dropped.
   */
  capturedAt: number | null
}

/**
 * Where the browser asks for one frame's bytes.
 *
 * NOT A PRESIGNED URL, and that is deliberate — see the route's own header. The
 * `<img>` points at this console, which checks the session and signs a fresh
 * 60-second URL per request. A presigned URL baked into the HTML would outlive
 * the session, survive being pasted into Discord, and go stale in a tab left
 * open over lunch.
 */
export function artifactSrc(incidentId: string, index: number): string {
  const params = new URLSearchParams({ id: incidentId, n: String(index) })
  return `/api/incidents/artifact?${params}`
}
