import { z } from 'zod'

/**
 * The wire contract with `br_ringmaster`.
 *
 * The authority is `docs/ingest-envelope.md` in the game repo, and the shapes
 * below are pinned by the fixtures in `__fixtures__/`, which are mirrored
 * byte-identical from `tools/fixtures/` there. Both halves test against the
 * same artifact so neither can drift into a shape the other does not send.
 *
 * PARSING IS THE TRUST BOUNDARY. Everything past this file is treated as
 * well-formed, so everything doubtful has to be caught here.
 */

/** Bumped when a field is removed or its meaning changes. */
export const ENVELOPE_VERSION = 1

/**
 * Identity of the sending process.
 *
 * `bootEpoch` is unique per *resource start* and it is not decoration:
 * `BR.Outbox` restarts its `seq` counter at 0 on every start, and the game
 * host restarts resources after every deploy. Deduping on `seq` alone would
 * silently discard the first N events after each one, as duplicates of the
 * previous run's.
 *
 * `wallMs` and `gameMs` are sampled together. Every timestamp the game
 * produces is `GetGameTimer()` — milliseconds since server start — which is
 * correct in the game and meaningless here. This pair is what makes an event
 * datable: `realMs = wallMs + (at - gameMs)`.
 */
const serverBlock = z.object({
  bootEpoch: z.string().min(1).max(128),
  resource: z.string().min(1).max(64),
  wallMs: z.number().int().nonnegative(),
  gameMs: z.number().int().nonnegative(),
})

/**
 * A player row.
 *
 * Carries `license`, `pos` and `matchId` — the three things the gamemode
 * deliberately withholds from clients, because broadcasting live positions
 * hands a wallhack to anyone reading the event stream. This is server to
 * server over a private link, which is the only reason it is allowed.
 *
 * `placement` is `null` until the player is out. It is always present rather
 * than sometimes absent, because nil does not survive Lua serialisation and
 * "missing" versus "null" is not a distinction this wire can carry.
 */
const playerRow = z.object({
  src: z.number().int().positive(),
  name: z.string().max(128),
  license: z.string().min(1).max(128),
  matchId: z.number().int().nullable(),
  squadId: z.number().int().nullable(),
  state: z.string().max(32),
  hp: z.number(),
  armour: z.number(),
  kills: z.number().int().nonnegative(),
  downs: z.number().int().nonnegative(),
  revives: z.number().int().nonnegative(),
  damage: z.number().nonnegative(),
  placement: z.number().int().nullable(),
  pos: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  posAt: z.number().int().nonnegative(),
  bucket: z.number().int().nonnegative(),
})

const matchRow = z.object({
  id: z.number().int(),
  state: z.string().max(32),
  mode: z.string().max(32),
  bucket: z.number().int().nonnegative(),
  endsAt: z.number().int().nullable(),
  alive: z.number().int().nonnegative(),
  squadsAlive: z.number().int().nonnegative(),
})

/**
 * State. Latest wins, never retried, never queued.
 *
 * `truncated` says the player list was capped. The push is a full snapshot
 * with no delta encoding — fine at the current 48 players, and megabytes per
 * second at the 2048 this milestone exists to enable. A short list that looks
 * complete is a worse failure than an honest flag.
 */
export const snapshotEnvelope = z.object({
  v: z.literal(ENVELOPE_VERSION),
  kind: z.literal('snapshot'),
  server: serverBlock,
  snapshot: z.object({
    takenGameMs: z.number().int().nonnegative(),
    counts: z.object({
      connected: z.number().int().nonnegative(),
      inMatch: z.number().int().nonnegative(),
    }),
    truncated: z.boolean(),
    matches: z.array(matchRow).max(512),
    players: z.array(playerRow).max(2048),
  }),
})

/**
 * Evidence. Ordered, retried, and every one matters.
 *
 * `data` is deliberately loose: event kinds will grow, and a receiver that
 * rejects an envelope because one event carried a field it had not heard of
 * would discard the whole batch — including the events it does understand.
 * The envelope is validated strictly; the payload is the sender's business.
 */
const gameEvent = z.object({
  seq: z.number().int().positive(),
  kind: z.string().min(1).max(64),
  at: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()),
})

export const eventsEnvelope = z.object({
  v: z.literal(ENVELOPE_VERSION),
  kind: z.literal('events'),
  server: serverBlock,
  events: z.array(gameEvent).min(1).max(256),
})

export const ingestEnvelope = z.discriminatedUnion('kind', [
  snapshotEnvelope,
  eventsEnvelope,
])

export type SnapshotEnvelope = z.infer<typeof snapshotEnvelope>
export type EventsEnvelope = z.infer<typeof eventsEnvelope>
export type IngestEnvelope = z.infer<typeof ingestEnvelope>
export type PlayerRow = z.infer<typeof playerRow>
export type MatchRow = z.infer<typeof matchRow>
export type GameEvent = z.infer<typeof gameEvent>

/**
 * Convert a game-clock reading to a real timestamp.
 *
 * The whole reason the envelope carries a clock pair. Without this an audit
 * row reads `4281003`, which is not a time, and nobody notices until they open
 * an incident from last Tuesday.
 */
export function realTime(
  server: { wallMs: number; gameMs: number },
  at: number,
): number {
  return server.wallMs + (at - server.gameMs)
}
