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
| **Acts** | kick, ban, spectate, trigger in-game events, edit hot-reloadable config |
| **Remembers** | bans with the admin who issued them, an audit log of every action, incident reports with evidence |
| **Operates** | stop/restart the FXServer process, schedule maintenance windows around live matches |

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
  the ONLY thing holding AWS credentials
        |                                    \
        |  VPC peering, security-group          \  AWS SDK
        |  restricted to the peered CIDR         \
        |    RCON -> game commands                v
        |    SSH  -> process control + telemetry  DynamoDB (us-west-2)
        v                                         grants · bans · audit
FXServer — us-east-2                              incidents · telemetry
  FXServer process  ·  br_ringmaster resource     [ game repo ]
  sshd + dispatch.sh (forced command only)
```

**Ringmaster is the only thing that talks to DynamoDB.** The game server never
holds AWS credentials and never signs an AWS request — it pushes JSON to
Ringmaster's ingest endpoint and forgets about it. This is a security win (no
credentials on the box most exposed to the public internet) and it sidesteps a
real problem: DynamoDB's API requires SigV4 request signing, and FXServer's Lua
runtime ships no HMAC-SHA256 to sign with.

Nothing about RCON, SSH or the ingest endpoint touches Cloudflare or the public
internet. Cloudflare fronts the admin's browser traffic only.

### Two channels to the game host, deliberately different

**RCON** carries game commands — kick, ban, spectate, event triggers. It reaches
the Lua environment inside a running FXServer.

**SSH with a forced command** carries everything RCON structurally cannot: the
FXServer *process* itself. RCON runs inside the process; it cannot restart it.
An `authorized_keys` entry pinned to `command="/opt/royale/dispatch.sh"` means
even a stolen key runs one script and never a shell.

## Security posture

The application layer is this repo's responsibility; the network layer (VPC
peering, security groups, Cloudflare WAF and SSL/TLS Full Strict) is handled
outside it.

**Nothing here is protected by the code being private.** Every actual secret
lives outside the repo under any visibility setting — RCON password, SSH private
key, Discord OAuth secret, session signing key, and *who the admins are* (that
is data, in DynamoDB, never a committed file). DynamoDB access is via the EC2
instance IAM role, so there is no static credential to leak. The game repo
already publishes its anticheat thresholds on purpose; this is the same bet.

The load-bearing pieces:

- **Discord OAuth2 with PKCE**, server-validated `state`, plus a guild-membership
  check as a coarse first filter.
- **Server-side sessions, not stateless JWTs** — a revoked admin must lose access
  *immediately*, and a self-contained token stays valid until it expires.
- **Scoped grants, re-checked per action, server-side.** Hiding a button is a
  courtesy, not a boundary. `br_ringmaster` re-checks independently on arrival,
  because RCON has no notion of *which* admin sent a command.
- **Command injection into RCON is the single biggest risk in this design.** A
  newline in an admin-typed ban reason is a second command on the most
  privileged surface in the system. Free text travels base64-encoded as one
  opaque argument, validated at the API boundary and again on arrival.
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
| 3 | Host control | `dispatch.sh` over restricted SSH; status, telemetry, CPU/memory/network graphs |
| 4 | Act | RCON channel, kick, ban, the audit log |
| 5 | Evidence | Incident reports (anticheat- and player-triggered), screenshots, Discord webhook |
| 6 | Operate | Live config editing, generic event triggers, scheduled maintenance windows |
| 7 | Investigate | Retrospective history by match/squad/party, full profile view, search |

**Ordered read-before-write on purpose.** Milestones 0–3 cannot change anything
in a running game; the first write path opens in M4. This is the same discipline
the gamemode used for its damage validator, which ran in log-only mode for a
full playtest before it was ever allowed to refuse a shot.

**Spectate is deliberately absent.** The camera and client-state machinery
belongs to the game repo's M7 (death-cam spectating), and Ringmaster's
admin-spectate is that same machinery plus a routing-bucket hop and a grant
check. Building it here would mean two spectator modes. The UI can be built
ahead of the tooling; the wiring waits.

## Stack

**Proposed, not locked** — worth settling in M0 before anything is built on it.

Node 20+ and TypeScript. Unlike the game's NUI, this runs in a real browser, so
**none of the CEF Chrome 103 constraints apply** — current CSS, current
framework majors, all fine. The gamemode's UI is pinned to HeroUI 2 + Tailwind 3
purely because CEF renders `oklch` and `color-mix` colourless; that constraint
does not follow us here.

## Related

- [fivem-br-gamemode](https://github.com/WillMontgomery/fivem-br-gamemode) — the
  gamemode itself, and the `br_ringmaster` FXServer resource
