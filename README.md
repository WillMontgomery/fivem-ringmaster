# Ringmaster

The admin, moderation and observability console for
[FiveM Royale](https://github.com/WillMontgomery/fivem-br-gamemode).

*The ring is the storm circle. Running kicks, bans and events from a console is
ringmaster work.*

---

## What this is

The game repo makes the game work. **Ringmaster makes it possible to run** — to
find out what happened on the server, act on it, and do both without SSHing into
the box.

The forcing function is scale. The gamemode is heading for 2048 slots and
100-player matches; at that size a console you read by eye is not a moderation
tool, and "restart the server to change a number" is not a config system.

| | |
|---|---|
| **Sees** | who is on the server right now, live; host CPU/memory/network; every anticheat firing |
| **Acts** | kick, ban, resolve an incident with a verdict, trigger in-game events, edit hot-reloadable config |
| **Remembers** | bans with the admin who issued them, an audit log of every action, incident reports and their timelines |
| **Operates** | stop/restart the FXServer process, schedule maintenance windows around live matches |

**`spectate` is a grant scope and nothing more.** It is defined in
`src/lib/grants.ts` and there is no surface behind it — see
[Spectate is deliberately absent](#milestones). Screenshots on incidents are the
same shape: the incident pipeline ships, the capture half does not.

## Why this is a separate repo

Ringmaster runs on a **different host, in a different AWS region**, from the game
server — and that is a real security boundary, not an accident of hosting. A
compromised admin panel does not hand an attacker local root on the game box;
it hands them a narrow, authenticated channel to it.

Splitting the code the same way the hosts are split keeps that story honest. The
one piece that must live in the game repo is `br_ringmaster`, the FXServer-side
resource — it physically has to sit under `resources/[fivem-royale]/` to deploy
at all.

**Both repos are public, on purpose.** Nothing here is protected by being
secret; see [Security posture](#security-posture).

## Architecture

```
Cloudflare (proxied DNS, SSL/TLS Full Strict, WAF)
        |  HTTPS — the admin's browser, and nothing else
        v
Ringmaster — us-west-2                          [ this repo ]
  web frontend + API  ·  Discord OAuth2  ·  ingest endpoint
  writes grants/bans/audit  ·  reads everything
        |                                     \
        |  VPC peering, security-group          \  AWS SDK
        |  restricted to the peered CIDR         \
        |    SSH (port 22) — the ONLY channel:    v
        |    commands, process control, telemetry DynamoDB — us-east-2
        v                                         ^
FXServer — us-east-2                              |  instance role:
  supervisor -> FXServer stdin                    |  br-players read/write
  br_ringmaster resource — realtime push  --------+  ringmaster-* GetItem,
  br_ddb resource — DynamoDB reads and writes     |  incidents append
  sshd + dispatch.sh (forced command only)        [ game repo ]
```

**Host telemetry does not travel that right-hand arrow.** It is polled by
Ringmaster over SSH and held in memory on the Ringmaster box; the game server
never writes `ringmaster-telemetry`, and nothing does yet. An earlier version of
this diagram said "stats + telemetry writes", which was wrong in both halves.

### The game server does not depend on Ringmaster

The owner's constraint, in their words: *"I don't want the game server to be
reliant on Ringmaster — only the reverse is okay, since Ringmaster is a
companion to the server."*

That is why the game box talks to DynamoDB directly rather than asking this
console anything. A connecting player's ban check, the in-game scope lookup and
the drain gate are all point reads against DynamoDB, and **all three fail open**
— an unreachable database must not become a server nobody can join. The one
outbound path from game to console is a fire-and-forget push to the ingest
endpoint, which nothing waits on.

**Ringmaster being down costs you the admin panel, never the server.** Anything
that would reverse that is a design change, not a convenience.

### No RCON, and that is a deliberate reversal

An earlier version of this design used FXServer's RCON for game commands. It
should not, and the reason is structural rather than a matter of taste:

**RCON is not a separate service.** It is an out-of-band handler registered on
the *same UDP socket players connect through*, and no convar exists to move or
rebind it — so it cannot be firewalled apart from gameplay traffic. Its
authentication is a plaintext password compared in non-constant time, its rate
limiter is keyed on a spoofable UDP source address (and is bypassed entirely for
proxy addresses), and a successful command runs with full console authority.
Exposing that on the one port that must be open to the world is not a tradeoff
worth making.

**txAdmin, the de facto FiveM admin panel, does not use RCON either.** It spawns
FXServer as a child process and writes commands to its **stdin** —
`proc.stdin.write(command + '\n')` — with no RCON code anywhere in its process
runner. That is the established answer to this exact problem.

So Ringmaster sends commands over the SSH channel it already needs for process
control, and a small supervisor on the game host relays them to FXServer's
stdin. `rcon_password` is left unset, which is FXServer's default. **One
channel, one port, and it is not the world-open one.**

**Both sides use DynamoDB, with deliberately unequal reach.** The game server
reads and writes its own `br-players` table from the `br_ddb` server-side
JavaScript resource, using an EC2 instance role — no static credentials
anywhere.

Its reach into Ringmaster's own `ringmaster-*` tables is narrow and has moved
twice, so it is worth stating as it is today rather than as it was:

- **It reads `ringmaster-bans`, `ringmaster-grants` and `ringmaster-maintenance`**
  — point lookups on a key it already holds, for the connect gate, in-game admin
  scopes and the drain gate.
- **It appends to `ringmaster-incidents`** (conditional on the id being absent,
  so it can file a case and never overwrite one) and, since 2026-08-17, **reads
  back a four-attribute projection of one** — enough to answer "decided, and did
  anything happen", and not the moderator's prose or either party's license.
- **It never touches `ringmaster-audit`.** The audit log is the record of what
  admins did; a compromised game host must not be able to read, still less
  rewrite, the account of its own compromise. **This is the line that does not
  move.**
- **There is no `Query` and no `Scan` anywhere in `br_ddb`**, which is a stronger
  guarantee than the table list and the one to lean on: a compromised game
  server cannot enumerate who is banned, who the admins are, or which cases are
  open. It can only confirm or deny a key it was already given.

An earlier version of this section claimed the game's policy granted "no access
to the grants, bans or audit tables". Two thirds of that is now wrong. The audit
third is still true and is the part that was ever load-bearing.

*Realtime* state — the live player list, host telemetry — takes a different
path, pushing to Ringmaster's ingest endpoint, because polling DynamoDB for a
two-second-fresh player list would be slow and wasteful. Two paths, because the
data has genuinely different latency and durability needs.

Nothing about RCON, SSH or the ingest endpoint touches Cloudflare or the public
internet. Cloudflare fronts the admin's browser traffic only.

### Platform notes worth not relearning

- **FXServer's server-side JS runtime is real Node.js**, not bare V8 —
  `citizen-scripting-node`, genuine libuv loop, `require('crypto')` works, npm
  packages resolve. Node 22 is opt-in via `node_version '22'` in the manifest.
  This is distinct from FXServer's *build* toolchain, which is a bundled
  yarn/Node 16 and auto-builds any resource containing a `package.json` — hence
  the game-side DynamoDB resource ships as a **single committed esbuild bundle
  with no `package.json`**, the same shape the gamemode's NUI build already uses.
- **FiveM's Lua has no HMAC or SHA-2.** All 827 native declarations checked; the
  only crypto natives are bcrypt (`GetPasswordHash`/`VerifyPasswordHash`), which
  block the main thread. So SigV4 belongs in the JS resource, never in Lua.
- **FXServer executes newline-terminated commands from stdin**, which is how
  txAdmin drives it. `rcon_password` is left unset; RCON shares the players'
  UDP socket and cannot be moved (`WithOutOfBand<…, RconOutOfBand>` on the game
  endpoint; no `rcon_port` convar exists).
- **`PerformHttpRequest` has a hardcoded 5-second no-response timeout**, not
  configurable. Applies to the realtime push; not to the AWS SDK, which uses
  Node's own HTTP stack.
- **No prior art.** No published FiveM resource uses the AWS SDK, DynamoDB, S3
  or SigV4 — the ecosystem is overwhelmingly MySQL/MariaDB. Unusually for this
  project, there is nobody to read first.
- **`screenshot-basic` uploads from the client's NUI browser via `fetch`**, and
  passes caller-supplied headers straight through — so incident screenshots can
  go to a **presigned S3 URL directly from the client**, never transiting the
  game server or Ringmaster.

### One channel to the game host

**SSH with a forced command.** An `authorized_keys` entry pinned to
`command="/opt/royale/dispatch.sh"` means even a stolen key runs one script and
never a shell. `dispatch.sh` switches on a fixed set of verbs and never `eval`s
what it receives.

It carries everything: game commands (relayed to FXServer's stdin by the
supervisor), process lifecycle (`stop`, `restart`, `update_check`) and host
telemetry. Game commands and process control were originally two different
channels because RCON cannot restart the process it runs inside — dropping RCON
collapsed them into one.

## Moderation rules that are settled

These are the owner's decisions, not implementation details, and they are the
ones most often got wrong from memory.

- **An incident has exactly two states: `pending_review` and `resolved`.**
  Anything the system actions itself opens as `resolved` — there is nothing for
  anybody to do.
- **An incident cannot be re-opened.** That makes the queue a strictly-shrinking
  worklist rather than something that can bounce, and `resolved` a permanent
  fact about a moment. If the behaviour continues, that is a *new* incident, and
  the profile shows both.
- **A verdict cannot be changed after the fact.** It is written by the same
  conditional update that moves the row to `resolved`, and that update refuses
  to run twice — so there is no resolved incident without a verdict and no path
  that rewrites one. The immutability is what makes the game side's reward safe
  to pay once and never reconcile.
- **A ban issued from an incident is a standard audit action.** It writes a
  `ban.issue` row exactly like any other ban, alongside the `incident.resolve`
  row for the closure. Being reached from a case does not make it a different
  kind of ban.
- **`resolved` with no verdict is not "no action taken".** Incidents closed
  before the verdict field existed, and ones the system auto-resolved, carry no
  verdict at all. That is "do not know", and this console never converts "do not
  know" into an answer.
- **Report limits, per player per match: at most 5 players named in one
  submission, and at most 3 submissions.** They are two separate limits and
  both are live — three submissions naming five distinct players each is fifteen
  reports and is fine. A separate rule caps one accusation per target per match,
  so two submissions naming the same person count once. (`BR.Config.Report` in
  the game repo is the authority; `maxTargets = 5`, `maxPerMatch = 3`.)

## Security posture

The application layer is this repo's responsibility; the network layer (VPC
peering, security groups, Cloudflare WAF and SSL/TLS Full Strict) is handled
outside it.

**Nothing here is protected by the code being private.** Every actual secret
lives outside the repo under any visibility setting — the SSH private key for
the dispatch channel, the Discord OAuth secret, the Discord bot token, the
session signing key, the ingest shared secret, and *who the admins are* (that is
data, in DynamoDB, never a committed file). `.env.example` names every one of
them and holds none. DynamoDB access on both hosts is via an EC2 instance IAM
role, so there is no static credential to leak anywhere. The game repo already
publishes its anticheat thresholds on purpose; this is the same bet.

There is no RCON password on that list because there is no RCON password:
`rcon_password` is left unset, which is FXServer's default. See above.

The load-bearing pieces:

- **Discord OAuth2 with PKCE**, server-validated `state`, plus a guild-membership
  check as a coarse first filter.
- **Server-side sessions, not stateless JWTs** — a revoked admin must lose access
  *immediately*, and a self-contained token stays valid until it expires.
- **Scoped grants, re-checked per action, server-side.** Hiding a button is a
  courtesy, not a boundary. The check lives here and only here: the sole writer
  to the game host's command channel is the supervisor behind a forced-command
  SSH key, so anyone able to reach it already has console authority and a second
  check there would guard nothing.
- **Command injection is the single biggest risk in this design**, and dropping
  RCON did not remove it — a newline in an admin-typed ban reason is still a
  second command once it reaches FXServer's stdin, which is a console with full
  authority. Free text travels base64-encoded as one opaque argument, validated
  at the API boundary, again in `dispatch.sh`, and again in `br_ringmaster`.
- **Two-phase audit logging** — intent written before dispatch, outcome after. A
  log written only on success is the one that fails when it matters most.
- **A secret-scanning gate** runs on every commit.

## Milestones

Tracked as GitHub milestones; this table is the map, `gh issue list` is the queue.

| # | Milestone | What it delivers |
|---|---|---|
| 0 | Foundations | Repo scaffold, toolchain, secret gate, DynamoDB tables, IAM role, deploy |
| 1 | Identity | Discord OAuth2 + PKCE, server-side sessions, the grants table and scope model |
| 2 | Observe | Ingest endpoint, realtime player list, live match/squad/party view |
| 3a | Host observation | `dispatch.sh` over restricted SSH — `status` and `telemetry` verbs only; CPU/memory/network graphs |
| 4 | Act | The command channel, kick, ban, the audit log |
| 5 | Evidence | Incident reports (anticheat- and player-triggered), screenshots, Discord webhook |
| 3b | Process control | `stop` / `restart` / `update_check`, and the supervisor that owns FXServer's stdin |
| 6 | Operate | Live config editing, generic event triggers, scheduled maintenance windows |
| 7 | Investigate | Retrospective history by match/squad/party, full profile view, search |

**Ordered read-before-write on purpose.** Milestones 0–3a cannot change anything
in a running game; the first write path opens in M4. This is the same discipline
the gamemode used for its damage validator, which ran in log-only mode for a
full playtest before it was ever allowed to refuse a shot.

Host control is split into **3a** and **3b** for exactly that reason. An earlier
version listed one M3 shipping `dispatch.sh` with its full verb set — including
`stop` and `restart` — while also claiming M0–M3 could not touch a running game.
Both could not be true. The verbs that only read (`status`, `telemetry`) belong
before the boundary; the ones that end a match for everyone on the box belong
after it, next to the audit log that records them.

**Spectate is deliberately absent.** The camera and client-state machinery
belongs to the game repo's M7 (death-cam spectating), and Ringmaster's
admin-spectate is that same machinery plus a routing-bucket hop and a grant
check. Building it here would mean two spectator modes. The UI can be built
ahead of the tooling; the wiring waits.

## Stack

**Locked** (2026-08-09): Next.js (App Router) + TypeScript + Auth.js, Tailwind 4,
DynamoDB via the AWS SDK's default credential chain. Resolved and locked against
a real `npm install`, so `package-lock.json` — not this list — is the authority
on versions.

**The component primitives are Base UI, not Radix**, with shadcn components in
`src/components/ui/` generated against it. That distinction has bitten this repo
more than once, because most shadcn material on the internet assumes Radix: the
prop for rendering a trigger as something else is **`render`**, not Radix's
`asChild`. See [docs/hover-text.md](docs/hover-text.md), which is where the
consequences are written down.

Node 20+ and TypeScript. Unlike the game's NUI, this runs in a real browser, so
**none of the CEF Chrome 103 constraints apply** — current CSS, current
framework majors, all fine. The gamemode's UI is pinned to HeroUI 2 + Tailwind 3
purely because CEF renders `oklch` and `color-mix` colourless; that constraint
does not follow us here.

## Related

- [fivem-br-gamemode](https://github.com/WillMontgomery/fivem-br-gamemode) — the
  gamemode itself, and the `br_ringmaster` FXServer resource
