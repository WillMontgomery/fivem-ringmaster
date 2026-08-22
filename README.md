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
| **Sees** | who is on the server right now, live; host CPU/memory/network; every anticheat firing; the game box's live convars, read-only; screenshots of the screen a case was filed against |
| **Acts** | kick, ban, spectate a live player, resolve an incident with a verdict |
| **Remembers** | bans with the admin who issued them, an audit log of every action, incident reports with their artifacts and the match that was running around them |
| **Operates** | schedule maintenance windows around live matches, deploy the game box, switch the branch it is parked on |
| **Travels** | opens inside the game's own pause menu, already signed in — see [The console in the pause menu](#the-console-in-the-pause-menu) |

**Four of the nine grant scopes have no surface behind them.** `moderate`,
`notify`, `config` and `spectate` are all defined in `src/lib/grants.ts` and
nothing checks any of them: every `authorize()` call under `src/app/api/` asks
for `view`, `kick`, `ban` or `process`. Holding one of the four grants nothing
today.

> **`spectate` was checked for exactly one release, and the reason it stopped is
> the general one.** `/api/spectate` authorised it (#192) — and since nothing
> had ever checked it, no grant row carried it, so **every admin on the server
> got a permanently greyed Spectate button** telling them to acquire a scope.
> There is no scopes UI. The only way to issue one is editing DynamoDB by hand.
> The check was a wall with no door, so the route moved to `view` (the scope
> that already opens the console) and the greyed state, its hover sentence and
> its `/preview/profile?mod=spectate-noscope` fixture were all removed.
>
> **The granular check was not wrong, it was early.** If a scopes UI is ever
> built, `spectate` is the first grant worth putting behind it — watching
> somebody is trustable far earlier than removing them. It goes back with the
> door, not before it.

> **This paragraph used to name `spectate` alone, and then add: "Screenshots on
> incidents are the same shape: the incident pipeline ships, the capture half
> does not."** The capture half shipped. It is named here rather than deleted
> because it was load-bearing in the wrong direction: anybody who read it came
> away certain this console cannot show them a picture, and it can — see
> [Artifacts](#artifacts).

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
        |  HTTPS — the admin's browser, and the pause-menu frame
        v
Ringmaster — us-west-2                          [ this repo ]
  web frontend + API  ·  Discord OAuth2  ·  ingest endpoint
  mints pause-menu handoff tokens  ·  signs S3 reads
  writes grants/bans/audit  ·  reads everything
        |                                     \
        |  VPC peering, security-group          \  AWS SDK
        |  restricted to the peered CIDR         \
        |    SSH (port 22) — commands, deploys,   v
        |    branch switches, telemetry       DynamoDB — us-east-2
        |                                     S3 — us-east-2
        v                                         ^
FXServer — us-east-2                              |  instance role:
  supervisor -> FXServer stdin                    |  br-players read/write
  br_ringmaster resource — realtime push  --------+  ringmaster-* GetItem,
  br_ddb resource — DynamoDB and S3 writes        |  incidents PutItem plus an
  br_core — captures artifacts, spools, uploads   |  attribute-scoped UpdateItem,
  sshd + dispatch.sh (forced command only)        |  artifacts PutObject
                                                  [ game repo ]
```

**Two arrows now run right-to-left across the peered link, not one.** The
realtime push to `/api/ingest` has always been there; since the pause-menu
console shipped, the game *server* also POSTs `/api/handoff/mint` to ask for a
sign-in token for an admin who just opened the settings menu. Both authenticate
with the same `x-ringmaster-secret` over the same port, both are
fire-and-forget from the game's point of view, and neither is ever called by a
game *client*.

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
three times, so it is worth stating as it is today rather than as it was:

- **It reads `ringmaster-bans`, `ringmaster-grants` and `ringmaster-maintenance`**
  — point lookups on a key it already holds, for the connect gate, in-game admin
  scopes and the drain gate.
- **It appends to `ringmaster-incidents`** (conditional on the id being absent,
  so it can file a case and never overwrite one) and, since 2026-08-17, **reads
  back a four-attribute projection of one** — enough to answer "decided, and did
  anything happen", and not the moderator's prose or either party's license.
- **It updates five named attributes on `ringmaster-incidents`, and no others.**
  A case filed mid-match has no ending until the match has one, so at match end
  the game writes the timeline back through an `UpdateItem` whose IAM condition
  names every attribute it may touch. `state`, `verdict` and `resolvedBy` are
  not on that list, which is what keeps "the game files cases, the console
  decides them" true now that the verb is no longer append-only. The allowlist
  is in `docs/aws-setup.md` §3 and it is the whole control.
- **It writes screenshots to `royale-incidents-bucket` under `incidents/`**, with
  `s3:PutObject` and nothing else — it cannot read a frame back and cannot erase
  one.
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
- **`screenshot-basic` captures the game's 3D render and nothing else.** NUI and
  the HUD are composited over that frame afterwards, so no overlay the player
  can see is ever in the picture — not the inventory, not the map, not a chat
  box. This is a property of where the capture is taken, not a setting, and it
  cannot be turned off. The console says so on the artifacts panel in the
  owner's own words.
- **`screenshot-basic` has no timeout of its own.** Its server half parks the
  callback in a table keyed by an upload token and fires it only when a
  multipart POST arrives at its HTTP endpoint, so a client that disconnects,
  crashes or simply never uploads leaks that entry forever. The game side times
  each frame out at 15s for exactly this reason.

  > **This bullet used to read: "`screenshot-basic` uploads from the client's
  > NUI browser via `fetch`, and passes caller-supplied headers straight through
  > — so incident screenshots can go to a presigned S3 URL directly from the
  > client, never transiting the game server or Ringmaster."** That described
  > something possible that was never built. What shipped goes the other way:
  > the client uploads to `screenshot-basic`'s own endpoint **on the game box**,
  > the frame lands in a spool directory there, `br_ddb` `PutObject`s it to S3
  > under the box's instance role, and a sweeper deletes the local file. The
  > clause worth not carrying forward is "never transiting the game server" —
  > every frame does.

### One channel to the game host

**SSH with a forced command.** An `authorized_keys` entry pinned to
`command="/opt/royale/dispatch.sh"` means even a stolen key runs one script and
never a shell. `dispatch.sh` switches on a fixed set of verbs and never `eval`s
what it receives.

It carries everything, and the verb set is closed. `dispatch.sh` switches on
exactly eight, mirrored by the `Verb` union in `src/lib/ssh.ts`:

| Verb | What it does |
|---|---|
| `status` | what the box is running, and which ref it is parked on |
| `telemetry` | CPU, memory, network — polled every 15s, held in memory here |
| `configreport` | the allowlisted convars, for the read-only Live config page |
| `kick` | a game command, relayed to FXServer's stdin by the supervisor |
| `spectate` | the other one: point an admin's camera at a player (#192) |
| `deploy` | starts the `royale-deploy` unit, detached |
| `branches` | every remote branch, with whether it may be deployed |
| `switchref` | park the box on a different ref |

> **`kick` used to be described as "the one game command", and it was seven
> verbs rather than eight.** `spectate` joined with #192. Both halves of that
> sentence are load-bearing, so both moved: the set is pinned on the far side by
> the game repo's `tools/verify.sh`, which greps `dispatch.sh` for it and fails
> the build when it grows, precisely so that a new capability from this console
> to that box is a decision somebody records rather than a line somebody added.
> `spectate` is the lightest write there is — it carries no free text at all,
> just two hex licenses and a UUID — but it is still a write, and it still ends
> up on FXServer's stdin.

> **This section used to say the channel carried "process lifecycle (`stop`,
> `restart`, `update_check`)".** No such verb has ever existed on either side —
> they are M3b deliverables and are still in the milestone table below as such.
> What landed instead was the deploy trio, which restarts FXServer as a
> consequence of deploying rather than as an action of its own. The distinction
> matters to anybody sizing the blast radius of a stolen key: there is no verb
> that stops the server and leaves it stopped.

Game commands and process control were originally two different channels because
RCON cannot restart the process it runs inside — dropping RCON collapsed them
into one.

### The console in the pause menu

An admin opens the pause menu, the game frames this console in NUI, and it is
already signed in. No login page, no alt-tab. The game side points at it with
the **`br_adminConsoleUrl`** convar; unset, the tab reports that and opens
nothing.

**The common case costs nothing.** The frame opens at the plain console URL
every time, with no token in it — CEF keeps the session cookie for this origin
in a jar that outlives the iframe being destroyed and recreated, so reopening
the menu is a page load against an existing session. Everything below is the
exception path, taken the first time and whenever the session has lapsed.

1. The console renders its login page inside a frame and posts one message out
   to the parent (`components/FrameHandoffSignal.tsx`):
   `{ source: 'ringmaster', v: 1, state: 'signed-out' }`.
2. The game **server** — never the client — POSTs `/api/handoff/mint` with the
   shared secret and the connecting player's verified `discord:` id. *A client
   that can ask for a token is a client that can ask for someone else's.*
3. The console answers a one-use URL. The game points the same iframe at it, the
   console consumes the token and 303s to `/`.

The token is `<discordId>.<43 chars of base64url>`; `ringmaster-handoff` stores
a **sha256 of it and never the token**, keyed by the admin rather than by the
token, so a credential minted for A cannot open a session as B by any
arrangement of bytes. It expires in 90 seconds, enforced in `src/lib/handoff.ts`
— the table's TTL is a janitor for tokens nobody spent, not a security control.

**Three things this cost, all of them real:**

- **The session cookie is now `SameSite=None; Secure`.** A framed console is a
  third-party context and a `Lax` cookie is not sent to one, so it arrived
  signed out no matter how many times it redeemed. `None` fixes that *and* hands
  every page on the internet a credentialed POST at a console that bans players.
  **What makes it acceptable is the cross-origin refusal in `src/middleware.ts`,
  which shipped first and is not optional.** If that check is ever removed, the
  cookie goes back to `Lax` in the same commit.
- **`X-Frame-Options: DENY` is gone**, replaced by
  `frame-ancestors 'self' https: nui:`. The honest description, which should not
  be softened: **this permits any HTTPS page on the internet to frame the
  console.** The NUI parent is `https://cfx-nui-<resource>`, and that origin
  cannot be written as a CSP source — a wildcard is a whole leftmost label, and
  underscore is not a `host-char`, so `br_ringmaster` is unexpressible.
  citizenfx/fivem#942 has been open since 2021 asking for this to be handled at
  the NUI end. Until it is, "as narrow as actually works" and "any HTTPS origin"
  are the same value.
- **Chromium 103.** See [the Stack section](#this-console-renders-in-chromium-103-and-you-will-not-find-that-out-yourself),
  which is the one thing in this file a contributor most needs before touching
  CSS.

Two smaller adaptations: the first-run preferences modal is suppressed in-frame
(`src/lib/framed.ts` — `Sec-Fetch-Dest: iframe` or a `CitizenFX/` user agent,
either sufficient, failing towards *showing* the prompt), and this console
forwards **Escape** to dismiss the whole overlay, because a cross-origin frame
does not forward key events to the game and no amount of listening from the
parent will produce one.

### Artifacts

An incident carries screenshots of the subject's screen: **one at the moment the
case was opened, one at +5s, one at +10s, and one more for each corroboration**,
to a ceiling of nine frames. They are webp at 0.92, keyed
`incidents/<incident-uuid>/01..09.webp` in `royale-incidents-bucket` (us-east-2,
public access blocked, **180-day expiry**).

- **They capture the game's 3D render and nothing else.** NUI and the HUD are
  composited afterwards, so no overlay the player can see is in the frame.
- **The capture runs on the subject's own machine and tells them nothing** — no
  notice, no sound, no prompt.
- **The timestamp is the server's**, sampled when it decided to ask. This is an
  anticheat surface; the clock on the machine under suspicion is not evidence.
- **The game box holds `s3:PutObject` on `incidents/*` and nothing else.** It
  cannot read a frame back and cannot erase one. Ringmaster holds `s3:GetObject`
  and deliberately **no `ListBucket`**: it finds a case's frames by probing all
  nine keys, and reaches the browser through 60-second presigned GETs.
- **An empty set is normal and is not evidence of anything.** A case can have no
  frames because `screenshot-basic` was not installed, because the subject had
  already disconnected, because the upload failed, or because the frames aged
  out. **The page does not tell those apart, on purpose** — there is no age
  arithmetic in this console, and an old case with no frames is an old case, not
  an innocent one.

### The incident timeline

A case shows the match that was running around it: kills, the weapon each used,
and whether that weapon was one the gamemode issues. **Offsets count from the
moment the incident was opened**, so rows before it read negative.

**Red means an explicit `weaponIssued === false` and nothing else.** Not absent,
not falsy — `npm run check:timeline` exists because absent and `false` rendering
alike would put the unauthorized-weapon marker on every kill filed before the
field existed.

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
- **The damage-refusal bar is one or two refusals in ten seconds, not a dozen in
  thirty.** `BR.Config.Combat.refusalBar = { high = 1, normal = 2 }` over
  `refusalWindowMs = 10000` — a single high-severity refusal files a case, two
  ordinary ones do. **If you have read "a dozen refusals in thirty seconds"
  anywhere, that is a stale comment in `br_lib/shared/combat_solve.lua` and not
  the live rule.** The config is the authority; the number is published on
  purpose, so there is no reason for a second copy of it to exist.
- **An unissued weapon is taken out of the hand and recorded, and the second
  offence opens a case.** Every strip after that corroborates the open case
  rather than filing a new one. **Nobody is exempt, including admins** — an
  admin exemption existed in `server/strip.lua` for one commit and the owner
  removed it on 2026-08-21: *"I don't want admins to be exempt from any
  anticheat."* It will file cases about staff, and that is the point.

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
- **The Discord admin role is re-checked before every write, not only at the
  door.** Grants live in DynamoDB and are independent of Discord, so somebody
  kicked from the server — or merely stripped of the role there — kept a working
  console until a human edited their grants row. Before every ban, lift, kick,
  incident closure, maintenance action, branch switch and deploy, the console
  asks Discord whether that account still holds `DISCORD_ADMIN_ROLE_ID`; if the
  answer is no, the write is refused and the session is deleted. **If Discord
  does not answer within five seconds the write goes ahead**, loudly, with an
  audit row saying the check did not resolve — failing closed would take every
  moderation tool offline during a Discord outage, which is exactly when
  moderation is most needed.
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
- **A secret-scanning gate.** `npm run check:secrets` is the first thing
  `npm run verify` and `npm run build` do, and `.github/workflows/verify.yml`
  runs `verify` on every pull request and every push to `main`. **There is no
  pre-commit hook** — this used to be described as running "on every commit",
  which would have told a contributor that a local commit is already screened.
  It is not; the push is.

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

**This table is the plan, not the state, and the two have diverged in three
places worth naming** so nobody reads a row as a claim about today:

- **M5's screenshots shipped**; its Discord webhook has no code anywhere in
  either repo.
- **M6's "live config editing" shipped as reading only.** `/config` renders the
  allowlisted convars the game box reports and has no write path — there is no
  config endpoint under `src/app/api/`. Its "generic event triggers" are the
  `moderate` scope with nothing behind it.
- **M3b's verbs are still unwritten**, but the deploy trio (`deploy`,
  `branches`, `switchref`) landed ahead of them and restarts FXServer as a
  consequence of deploying. See [One channel to the game host](#one-channel-to-the-game-host).

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

**Spectate was deliberately absent, and the wait is over.** The paragraph here
used to read: "The camera and client-state machinery belongs to the game repo's
M7 (death-cam spectating), and Ringmaster's admin-spectate is that same machinery
plus a routing-bucket hop and a grant check. Building it here would mean two
spectator modes. The UI can be built ahead of the tooling; the wiring waits."

That was right and it is now spent. M7 built the machinery, so #192 built the
console half onto it rather than beside it: a Spectate button on the profile, a
`player.spectate` audit row, and one more verb on the SSH channel the kick
already uses — `spectate <admin-license> <target-license> <command-id>`, whose
name and argument order the game repo's `tools/verify.sh` pins. **There is still
exactly one spectator mode**, which was the whole point of waiting: this console
resolves two licenses and hands them to `br_core`, which owns the camera, the
session and the policy. Ringmaster does not know what spectating is.

**The button is hidden unless the admin and the target are both in-game**, which
is the standing rule for an action with no target and the same treatment the
profile already gives Kick. Both presence readings come out of one snapshot; the
rule is `src/lib/actionBar.ts` and `check:actionbar` asserts that the components
actually gate on it.

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

Node 20+ and TypeScript.

### This console renders in Chromium 103, and you will not find that out yourself

**Read this before writing any CSS.** Ringmaster has two engines to satisfy: a
current browser, and CEF — Chromium 103 — when the game frames it in the pause
menu. `oklch()` and `oklab()` are Chrome 111. Every colour token in
`globals.css` is authored in `oklch`, because that is what the shadcn registry
emits and hand-converting 115 tokens would introduce drift on every one.

**The failure is invisible to whoever causes it.** A custom property is not
validated when it is *declared* — `--background: oklch(…)` parses in any engine.
It fails later, at substitution, when `var(--background)` is resolved into a real
property: the declaration becomes invalid at computed-value time and the property
falls back to unset. Nothing errors, no build warns, and a developer looking at
Chrome sees a correct console. In the game it was reported as
*"a lot of our CSS is mostly a wireframe with no colors"*.

It does not degrade gracefully either. Backgrounds go transparent, so a modal
overlay — `fixed inset-0 z-50` — is still there and still swallowing every
click, just no longer painted. **The console reads as frozen rather than as
unstyled**, which sends whoever reports it looking in entirely the wrong place.

So the fix is build-side and gated:

- `postcss.config.mjs` runs `@csstools/postcss-oklab-function` with
  `preserve: true` and `@csstools/postcss-progressive-custom-properties`, in
  that order. They emit an sRGB fallback ahead of each modern declaration and
  re-state the original inside `@supports (color: oklch(0 0 0))`, so a real
  browser is bit-for-bit unchanged and CEF gets a colour it can parse.
- **`npm run check:cef` enforces it** and is part of `npm run verify`. It runs
  the real PostCSS pipeline rather than reading `.next/`, so it needs no build
  and tests the configuration actually in force.

> **The Stack section used to end: "Unlike the game's NUI, this runs in a real
> browser, so none of the CEF Chrome 103 constraints apply — current CSS,
> current framework majors, all fine."** That was true until the console got a
> pause-menu Admin tab, and it is the single most expensive stale sentence this
> repo has had: it tells a contributor, in as many words, that the thing which
> broke the console in play cannot happen. The gamemode's own UI is still
> pinned to HeroUI 2 + Tailwind 3 for the same engine — the constraint did not
> stop following us, it caught up.

## Related

- [fivem-br-gamemode](https://github.com/WillMontgomery/fivem-br-gamemode) — the
  gamemode itself, and the `br_ringmaster` FXServer resource
