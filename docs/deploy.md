# Deploying Ringmaster

Setting up the us-west-2 box.

## Two boxes, and never assume which one you are on

**There are two separate machines and no command in this file spans both.**

| | Box | Region | What it is |
|---|---|---|---|
| **CONSOLE** | Ringmaster | us-west-2 | Node, Caddy, the systemd unit — this document |
| **GAME** | FXServer | us-east-2 | FXServer, `br_ddb`, `dispatch.sh` — the game repo's deploy |

**Unless a step says `[GAME]`, it runs on the CONSOLE box.** Every shell block
below is on the CONSOLE box except the two marked otherwise, and those two are
marked in their own heading as well as inline. This is spelled out because
copy-pasting a run of commands that silently changes machines part-way through
is how a box ends up with half of the wrong software on it — and `npm ci` on the
game host in particular is a real hazard, since it is a machine that must not
have Node at all.

**You cannot chain across the two.** There is no `ssh` step in this document.
The only link between the boxes is the forced-command SSH channel the app opens
at runtime, over VPC peering, outbound from CONSOLE to GAME — configured here
via `GAME_HOST`/`GAME_SSH_KEY` and never driven by hand from this file.

---

## 1. Node — CONSOLE box

Node 22 LTS. `package.json` requires `>=20`; 22 is the current LTS and is what
the systemd unit below assumes.

```bash
sudo apt update && sudo apt install -y curl ca-certificates gnupg git
```

NodeSource rather than Ubuntu's own package, because the distro's `nodejs` is
usually years behind and Next.js 15 will refuse to start on it:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
node -v && npm -v
```

Expect `v22.x` and `10.x` or later. If `node -v` prints `v12` or `v18`, an old
apt `nodejs` is shadowing it — `sudo apt remove -y nodejs libnode-dev` and
re-run the NodeSource step.

> **Do not install Node on the GAME box.** It does not need one and the
> gamemode's deploy explicitly avoids requiring it — FXServer ships its own
> runtime, and `br_ddb` is committed as a pre-bundled file precisely so nothing
> has to be installed there. Only the CONSOLE box runs Node.

### Get the code

```bash
sudo mkdir -p /opt/ringmaster && sudo chown "$USER:$USER" /opt/ringmaster
```

```bash
git clone https://github.com/WillMontgomery/fivem-ringmaster.git /opt/ringmaster
```

```bash
cd /opt/ringmaster && npm ci
```

`npm ci` rather than `npm install`: it installs exactly what `package-lock.json`
pins and fails if the lockfile and `package.json` disagree, instead of quietly
resolving something newer than what was tested.

### Environment, before building

```bash
cp .env.example .env.local && nano .env.local
```

Fill in every value marked `REPLACE_ME`. `AUTH_URL` must be the **public** origin
(`https://your-domain`), because Auth.js builds the OAuth redirect URI from it
and Discord rejects a mismatch.

> **`AUTH_URL` also decides whether the in-game console can stay signed in, and
> that failure looks like nothing at all.** Every cookie this app writes takes
> its `Secure` flag from that URL's protocol, and `SameSite` is derived from
> `Secure` rather than chosen beside it (`src/lib/cookieFlags.ts`). The
> pause-menu console is a third-party context and needs `SameSite=None`, which
> **every modern browser drops silently without `Secure`** — no warning, no
> error, just a console that redeems a handoff token and arrives signed out
> anyway. An `http://` origin here is therefore not merely insecure; it is a
> pause-menu Admin tab that can never hold a session.

**Four are genuinely optional** and the app starts without them —
`DISCORD_BOT_TOKEN`, `COMMAND_SECRET`, and `GAME_HOST` / `GAME_SSH_KEY`. Without
the last two the Host page says "not configured" rather than erroring, and that
panel names both variables and the file they go in, because it is the only
surface that state has; `GAME_SSH_USER` defaults to `ubuntu`. `src/lib/env.ts`
is the authority on which are which: it validates the whole environment at first
use and names **every** missing variable at once rather than one per restart.

> **This paragraph said "three" until `COMMAND_SECRET` shipped on 2026-08-30**,
> and it is corrected rather than quietly renumbered because the fourth is the
> one an operator is most likely to think is required. It is not: unset, the
> Discord bot's door is simply shut and nothing else about the console changes.
> §6 is the whole of it.

> **`DISCORD_BOT_TOKEN` now does two jobs, and this document used to name only
> the first.** It used to say the token's absence meant "every player shows a
> Discord default avatar rather than their own", full stop. That is still true
> and is no longer the whole cost:
>
> 1. **Real profile pictures.** A Discord user id cannot be turned into an
>    avatar URL on its own; only the API knows the current avatar hash.
> 2. **The admin-role re-check before every write.** Before every ban, lift,
>    kick, incident closure, maintenance action, branch switch and deploy, the
>    console asks Discord whether that account still holds
>    `DISCORD_ADMIN_ROLE_ID`. Without the token this check is **disabled**, with
>    a warning logged on every write — so somebody stripped of the admin role in
>    Discord keeps a working console until a human edits their grants row.
>
> **Job 2 changed what the bot needs.** Read this twice if you set the token up
> before the check existed: job 1 works from outside your server, job 2 requires
> **the bot to be a member of the guild** in `DISCORD_GUILD_ID`. Invite it with
> no permissions at all — it needs none, and no privileged intents.

> **THE GAME BOX HAS A DISCORD CREDENTIAL OF ITS OWN NOW, AND IT IS NOT THIS
> ONE.** Since 2026-08-31 the FXServer host reads two convars — `br_discord_bot_token`
> and `br_discord_guild_id` — to decide whether the in-game Discord card is shown
> to a player, and it asks Discord directly rather than asking this console.
> **They may well hold the same two values as `DISCORD_BOT_TOKEN` and
> `DISCORD_GUILD_ID` here, and they are still two settings on two machines**:
> filling them in on this box does nothing for the game, and filling them in
> there does nothing for the console. Their setup lives in the game repo's
> `server.cfg.example` and in Infradocs, and `docs/aws-setup.md` §3 records why
> it is not repeated in this estate. **The token is a real credential and its
> value goes in no document, this one included** — it belongs in the game box's
> `server.cfg`, which is gitignored for exactly that.

**`DISCORD_ADMIN_ROLE_ID` is required, not optional.** Guild membership stopped
meaning anything once the guild became the player community, so the role is the
coarse filter that runs before any grant is consulted. The app refuses to start
without it.

```bash
chmod 600 .env.local
```

This file holds the Discord OAuth secret, the Discord bot token, the session
signing key, the ingest shared secret, and the **path** to the game host's SSH
key — the key itself lives at that path and never enters this file or the repo.
It is gitignored, and the secret-scanning gate would fail the build if it ever
were not.

> **The build does not require these**, deliberately — nothing reads the
> environment at module load, so CI can build with no secrets at all. Set them
> first anyway: the app needs them the moment it serves a request, and finding
> that out at `systemctl status` is worse than finding it out now.

### Build

```bash
npm run build
```

---

## 2. Why a reverse proxy — CONSOLE box

**One reason, and it is not architecture for its own sake: `next start` serves
plain HTTP and cannot terminate TLS.** Something has to hold the Cloudflare
Origin CA certificate, and Next will not.

That matters because of a decision already locked in: **SSL/TLS mode Full
(Strict)**. Cloudflare encrypts browser→edge either way, but Full (Strict) is
what encrypts edge→origin *and* verifies the origin's certificate. Without a
TLS terminator on the box the only way to make Cloudflare talk to it is
**Flexible** mode, which sends your admin traffic — session cookies included —
across the public internet from Cloudflare to this box **in plaintext**. That
is precisely what Full (Strict) was chosen to avoid.

Two smaller things it also buys, neither decisive on its own:

- **Node never binds 443.** Ports below 1024 need root or an explicit
  capability grant; the app stays unprivileged on 3000 and the proxy owns the
  public port.
- **It can require that traffic came from Cloudflare**, so somebody who
  discovers the box's IP cannot bypass the WAF by connecting directly.

**What it is not for:** it is not caching, not load balancing, and not
"best practice". If Next could terminate TLS this document would not mention a
proxy at all.

Caddy over nginx because the entire config is six lines and it will not silently
serve HTTP if the certificate is wrong.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
```

```bash
sudo apt update && sudo apt install -y caddy
```

### The Origin CA certificate

Cloudflare dashboard → your domain → **SSL/TLS** → **Origin Server** → *Create
Certificate*. Accept the defaults, and **copy both blocks before closing the
page** — the private key is shown exactly once.

```bash
sudo mkdir -p /etc/caddy/certs && sudo nano /etc/caddy/certs/origin.pem
```

Paste the **certificate** block. Then:

```bash
sudo nano /etc/caddy/certs/origin.key
```

Paste the **private key** block. Then lock it down — this key is why the
padlock means anything:

```bash
sudo chown root:caddy /etc/caddy/certs/origin.* && sudo chmod 640 /etc/caddy/certs/origin.*
```

### Caddyfile

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the whole file with this, changing the domain:

```caddyfile
ringmaster.example.com {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl restart caddy && systemctl status caddy --no-pager
```

Then in Cloudflare: an **A record** for that hostname pointing at this box's
public IP, **proxied** (orange cloud), and **SSL/TLS → Overview → Full
(Strict)**.

---

## 3. The app as a service — CONSOLE box

```bash
sudo nano /etc/systemd/system/ringmaster.service
```

```ini
[Unit]
Description=Ringmaster admin console
After=network-online.target
Wants=network-online.target
# systemd gives up after five restarts in ten seconds by default, which is the
# wrong behaviour for something that should keep trying at 3am. It belongs in
# [Unit] even though the thing it governs is [Service]'s Restart= — put it in
# [Service] and systemd drops it without failing, so the limit stays on.
StartLimitIntervalSec=0

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ringmaster
EnvironmentFile=/opt/ringmaster/.env.local
ExecStart=/usr/bin/npm run start

Restart=always
RestartSec=5

# It talks to DynamoDB and to the game host, and reads one directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/ringmaster/.next

StandardOutput=journal
StandardError=journal
SyslogIdentifier=ringmaster

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ringmaster
```

> **UNRESOLVED: `User=` above, the user this box actually runs as, and who owns
> `GAME_SSH_KEY` are three statements and at least two of them disagree.** This
> document has said `User=ubuntu` for as long as there have been boxes.
> Production has been observed running as `will`. The dispatch private key was
> mode `600` owned by `ubuntu`.
>
> That combination is what took the Host page down for an hour: `ssh -i` could
> not open the key, so every verb failed — telemetry, the branch list, deploys —
> while the console kept serving pages and reporting DynamoDB healthy. The fix
> was one `chown`; finding it was the hour.
>
> **This note does not say which of the three is correct**, because that is a
> decision about the box rather than about this file, and writing a guess here
> would produce a fourth statement. What it does say is that they must agree.
> Read the live one and reconcile the other two against it:
>
> ```bash
> systemctl show ringmaster -p User
> ls -l "$(grep -oP '(?<=^GAME_SSH_KEY=).*' /opt/ringmaster/.env.local)"
> ```
>
> The console now checks this itself at startup and writes both numbers to the
> journal — `journalctl -u ringmaster | grep '\[dispatch\]'` — so the next
> occurrence is a log line rather than an hour. It does **not** refuse to boot
> over it: a console that will not start because it cannot reach the game box is
> one you cannot use to find out why.

```bash
systemctl status ringmaster --no-pager && journalctl -u ringmaster -n 30 --no-pager
```

### Every box installed before this was written has that line in the wrong section

**`StartLimitIntervalSec` sat in `[Service]` in this document for as long as
there have been boxes, so the live unit has it there too — and systemd has been
ignoring it the whole time.** An unknown key is not an error to systemd; it drops
the directive, logs one line at load, and starts the service anyway. So a console
installed from the earlier version has been running under exactly the default the
directive was written to remove: five restarts in ten seconds, then systemd stops
trying and leaves the unit in `failed`, where it stays until a human restarts it.
Nothing looks wrong until the app is crash-looping, which is the one occasion the
setting exists for.

Ask the box rather than guessing:

```bash
systemd-analyze verify /etc/systemd/system/ringmaster.service
```

Silence is the pass. `Unknown key 'StartLimitIntervalSec' in section [Service],
ignoring.` means this box is one of them. Delete the misplaced line, then put it
back above `[Service]`, which is where `[Unit]` ends:

```bash
sudo sed -i '/^StartLimitIntervalSec=/d' /etc/systemd/system/ringmaster.service
```

```bash
sudo sed -i '/^\[Service\]/i StartLimitIntervalSec=0\n' /etc/systemd/system/ringmaster.service
```

```bash
sudo systemctl daemon-reload
```

**No restart.** This changes what systemd does the *next* time the process dies,
not anything about the process running now — restarting would buy an outage and
nothing else.

The `sed` removes the directive and leaves the two comment lines that were above
it stranded in `[Service]`, explaining a line that is no longer under them.
systemd does not care; move them by hand if you do.

```bash
systemd-analyze verify /etc/systemd/system/ringmaster.service && systemctl show ringmaster -p StartLimitIntervalUSec
```

Nothing from the first. From the second, anything except `10s` — `10s` is the
built-in default and means the directive is still not being read.

> **`StartLimitIntervalSec=0` means "never give up", and that is a trade rather
> than a free win.** For something whose job is to hold a connection open and
> reconnect forever it is plainly right. The console is a web app behind Caddy,
> and a unit that can never give up also never reaches `failed` — it restarts
> every five seconds indefinitely and, to anything watching `systemctl is-failed`,
> is indistinguishable from a console that is fine. `failed` is a state a monitor
> could one day alert on; "restarting since Tuesday" is only visible to somebody
> already reading the journal.
>
> This document keeps `0`, because there is no alerting on this box today and an
> unattended recovery at 3am is worth more than a state nobody is watching. If
> alerting ever arrives, revisit it: a finite window such as
> `StartLimitIntervalSec=300` with `StartLimitBurst=10` still rides out a
> transient failure but eventually stops and says so. Both go in `[Unit]` —
> `StartLimitBurst` is the same kind of option and fails the same silent way.

---

## 4. Discord — browser, no box

Discord Developer Portal → your application → **OAuth2** → *Redirects* → add:

```
https://ringmaster.example.com/api/auth/callback/discord
```

Exactly that, matching `AUTH_URL` in `.env.local`. A trailing slash or `http`
instead of `https` will fail with an error that blames the wrong thing.

---

## 5. Ports — CONSOLE box's security group

**This is the CONSOLE box's security group only.** The GAME box's inbound rules
are a different list in a different region, and they are in `docs/aws-setup.md`
§5. Do not merge the two tables in your head: the only thing GAME accepts is SSH
on 22 from the us-west-2 CIDR.

| Port | Open to | Why |
|---|---|---|
| 443 | Cloudflare only | The admin's browser, and the pause-menu frame, via the WAF |
| 3000 | the us-east-2 VPC CIDR only | `br_ringmaster`'s push to `/api/ingest`, and the game server's `/api/handoff/mint` |
| 22 | your own IP | You |

**Port 3000 carries two endpoints now, not one.** The realtime push was always
there; the game *server* also POSTs `/api/handoff/mint` to ask for a sign-in
token when an admin opens the pause menu. Both present the same
`INGEST_SECRET` in the same `x-ringmaster-secret` header, both are excluded from
the session middleware, and **neither is ever called by a game client** — a
client that could mint a token could mint somebody else's.

**Port 3000 must not be open to the internet.** Those endpoints authenticate
with a shared secret over the peered link; the security group is what actually
keeps them private.

> **The pause-menu console reaches this box over 443, not 3000.** It is a
> browser — CEF — loading the public origin through Cloudflare like any other.
> Only the game *server's* two server-to-server calls use the peered link. Do
> not open 3000 wider in an attempt to make the Admin tab work; that is not
> where it is failing.

Restricting 443 to Cloudflare's ranges is worth doing so nobody bypasses the WAF
by hitting the IP:

```bash
curl -s https://www.cloudflare.com/ips-v4
```

---

## 6. `COMMAND_SECRET` — the Discord bot's door — CONSOLE box

**The value is already set on this box**, in `/opt/ringmaster/.env.local`, and
the same string is in `/opt/blitz-bot/.env`. This section is for the day the bot
starts refusing commands, for rotating the value, and for rebuilding either
side — not a step to come back and do later.

`src/lib/env.ts` keeps it optional and the console still starts without it.
Unset, the door is simply shut: the kick the bot relays out of Discord, and both
halves of `/drain`, are refused with a line in the journal naming this variable,
and nothing else about the console changes.

### What it is

The credential `blitz-bot` presents when it asks this console to do something a
bot cannot do itself. There are two such things. **The live kick** is tmux over
SSH and only the CONSOLE box holds that channel. **A maintenance window** is
`POST /api/maintenance` to start one and `POST /api/maintenance/cancel` to call
it off, because `nothingToDeploy`, the branch-eligibility gate and the
already-scheduled refusal live in those routes and nowhere else — and the
maintenance driver deploys any `scheduled` row it finds, so a bot writing that
row straight into DynamoDB would start a restart no gate had looked at.

**Both halves of `/drain`, and it took a bug to get there.** The credential
shipped wired to the kick, the ban and the maintenance POST, and the cancel
route was missed — so `/drain cancel` was answered `Not signed in` while
`/drain start` worked, leaving an admin able to start a window and unable to
stop one. If a future command needs a route that is not in the table below, that
is the symptom it shows.

**It authorises the caller, not the action.** Every check the route already
makes still runs, on the same code, in the same order: the closed-case refusal
on a kick and on a ban, the refusal to ban a license that is already banned,
`nothingToDeploy`, the already-scheduled guard. Holding this secret cannot wave
any of them through, because nothing it does runs after them — the gate hands
back the acting human and stops. It is a second door into the same room, and
never a way around what is in the room.

### How the bot presents it

Two headers, on a POST to one of four paths:

| Header | Carries |
|---|---|
| `x-ringmaster-service` | the value of `COMMAND_SECRET` |
| `x-ringmaster-actor` | the **Discord id of the admin who typed the command** |

| Path | What uses it |
|---|---|
| `POST /api/kick` | the live kick the bot relays when Discord's own `/kick` or `/ban` fires |
| `POST /api/bans` | nothing today — see below |
| `POST /api/maintenance` | `/drain start` |
| `POST /api/maintenance/cancel` | `/drain cancel` |

> **THIS TABLE'S RIGHT-HAND COLUMN USED TO READ `/brkick` AND `/brban`, AND
> NEITHER SLASH COMMAND EXISTS.** Both were designed and then cut, in the owner's
> words: *"we do not need /brkick or /brban if the default discord /kick and /ban
> do the same thing, since we have event listeners"* — a slash command would have
> been a second trigger for the one audit-log listener the bot already runs, so
> either it duplicated the mirror's work or it did nothing the listener was not
> about to do. `blitz-bot`'s registered commands are `/drain`, `/help`,
> `/profile` and `/sticky`, and its only two calls into this console are
> `KICK_PATH` and the two maintenance paths (`src/ringmaster.ts` there).
>
> **So `/api/bans` is open and unused, which is a known state rather than a
> discovery.** The bot writes its ban rows straight to DynamoDB. The path stays
> on the list deliberately: narrowing this credential is the same kind of
> decision as widening it, and belongs to whoever owns the bot's roadmap.
> `src/lib/service.check.ts` says so beside the entry, and fails the build if the
> path is removed from `SERVICE_ROUTES` without that decision being made.

**Nothing else that WRITES.** `/api/maintenance/force` — the button that skips
the drain and restarts the box now — and `/api/bans/lift` are deliberately not on
that list, and the console refuses them whatever the secret says. There is one
read, `GET /api/health`, and it is the subsection below rather than a row in the
table above because nothing about it matches that table: it is a GET, the bot
never calls it, and it takes no `x-ringmaster-actor`. Cancel and force sit
under one path prefix and are opposite actions, which is why the console matches
these paths exactly and never as a prefix. `src/lib/service.check.ts` fails the
build if the routes and the list ever stop agreeing, and names which command
breaks when one of them stops being covered.

### `GET /api/health` — the one read this credential opens

**It is not the bot's, and no `x-ringmaster-actor` goes with it.** It is for an
external uptime check: something outside a browser asking this console how it is
doing, at an hour when nobody is signed in. One header, and that is the whole
request:

| Path | Method | Headers | What uses it |
|---|---|---|---|
| `/api/health` | `GET` | `x-ringmaster-service` only | an external uptime check |

It is guarded for the reason everything on this box is: Caddy sends the whole
public hostname to `127.0.0.1:3000` (§2), so an ungated route here is a route
the internet can read — and what this one hands out is a running commentary on
when the operator's infrastructure is unwell, at whatever cadence the reader
likes.

**It does not go through the gate the four write paths use, and that is
deliberate.** That gate demands the Discord id of the human being attributed,
and there is no human behind a health check. `src/app/api/health/route.ts`
carries the argument at length; `SERVICE_ROUTES` stays a write allowlist.

> **THE CHECKER BECOMES A THIRD HOLDER OF THIS CREDENTIAL, WITH THE FULL BLAST
> RADIUS ABOVE.** Pasting `COMMAND_SECRET` into a hosted uptime monitor's
> custom-header box hands that vendor the string that can ban players and
> restart the game server. Nothing about the health route needs that power and
> nothing stops it: it is one credential. Prefer a checker you run yourself —
> and if this endpoint ever gets a second consumer, that is the moment to split
> a read-only secret out rather than widen this one further.
>
> **It is also a holder the rotation steps below do not know about.** Those name
> two files. A rotation that follows them exactly leaves the checker on the old
> value, which starts answering `401` immediately — see the note in the next
> section.

> **`x-ringmaster-actor` is why the audit log is still worth reading.** The row
> names the admin who ran the command — their license, their name, their Discord
> id — never the bot. A log full of `blitz-bot` would answer a question nobody
> asks. That id is not taken on trust either: the console asks Discord whether
> that account holds `DISCORD_ADMIN_ROLE_ID` **right now**, and refuses on a
> definitive no — not in the guild, or in it without the role.
>
> **An unanswered check is not a no.** If Discord times out, rate-limits, or the
> bot token is unset, the call proceeds and a `discord.unresolved` audit row
> records that it did. That is deliberate: `blitz-bot` does not relay a command
> from somebody it does not believe is an admin, so this is the second opinion
> rather than the first, and a bad minute at Discord must not stop every
> moderation command in the guild. It is the same polarity the session path
> uses, through the same function.

### The value, and keeping the two copies the same

The same string is in two files, both on the CONSOLE box:

| File | Read by |
|---|---|
| `/opt/ringmaster/.env.local` | this console |
| `/opt/blitz-bot/.env` | the bot |

**And in however many places the health check is configured, which is not a
file on this box.** If `GET /api/health` is wired to an external monitor, that
monitor holds a third copy in its own settings, and a rotation that updates only
the two files above leaves it presenting the old value — whereupon it gets
`401`, reports the console down, and the console is fine. Update it in the same
sitting, or the first thing the new secret does is page you.

A new one is generated with:

```bash
openssl rand -base64 32
```

Write it into both files, then restart both services — each reads its
environment once, at start, so a file the running process has not re-read is a
file that is not yet in effect:

```bash
sudo systemctl restart ringmaster blitz-bot
```

### When the two copies disagree

**A mismatch is a `401`, and a `401` looks like anything but a typo.** Every
command from every admin stops working at the same moment, and what the guild
sees is the bot reporting that the console refused it — which reads like an
outage, or Discord, or somebody's permissions, and sends you off to check role
ids and security groups. The journal is what says otherwise:

```bash
journalctl -u ringmaster -n 30 --no-pager | grep '\[service\]'
```

`the presented credential is not blitz-bot's` is a mismatch and nothing else.

Compare the two files without putting either value on your screen or in your
shell history:

```bash
for f in /opt/ringmaster/.env.local /opt/blitz-bot/.env; do sudo grep -m1 '^COMMAND_SECRET=' "$f" | cut -d= -f2- | tr -d '" \r' | sha256sum | cut -c1-12; done
```

Two identical lines mean the copies agree, two different lines mean they do not,
and neither line is the secret — it is twelve characters of a hash of it, so
this is safe on a shared screen and safe to paste into an issue. One line rather
than two means the `grep` matched nothing in one of the files, which is its own
answer.

### If it leaks

Whoever holds this string can ban players and restart the game server. That is
the blast radius, and it is why every refused call **on the four write paths** is
logged at error level rather than passed over quietly.

**`GET /api/health` is the exception and it is on purpose, so do not go looking
for its refusals in the journal.** A wrong secret there logs nothing at all: it
cannot ban anybody or restart anything, and a misconfigured checker hits it every
thirty seconds forever, so a line per refusal would bury the telemetry failure
you would actually be reading that journal to find. The one line it does write is
`[health]`, not `[service]`, and it says `COMMAND_SECRET` is unset — once per
process, not once per request.

**Rotation is generating a new one and restarting both services** — the two
steps above, in that order. There is no revocation list and no second credential
to fall back on; the old value stops working the moment the console restarts.

### It is a different secret from `INGEST_SECRET`, on purpose

`INGEST_SECRET` lives on the **GAME** box. If it also opened this door, then a
compromise of the game host would come with the ability to ban players and
schedule restarts. Two secrets, two blast radii. Do not reuse one for the other.

### Where the bot connects

**Over 443, through Cloudflare, like a browser — not over port 3000.** Port 3000
is the peered link from the GAME box and stays that way; the bot is an ordinary
HTTPS client of the public origin in `AUTH_URL`. It must **not** send an
`Origin` header (the cross-origin guard in `src/middleware.ts` refuses a present,
foreign one and allows an absent one — the same allowance the game box's push
relies on).

### Check it

A call carrying a deliberately wrong credential should be refused without
touching Discord or DynamoDB:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://ringmaster.example.com/api/kick -H 'x-ringmaster-service: definitely-wrong' -H 'content-type: application/json' -d '{}'
```

`401`. And the journal says so, loudly — every refused call does, because this
credential can ban a player and restart the game server:

```bash
journalctl -u ringmaster -n 30 --no-pager | grep '\[service\]'
```

**`503` instead of `401` means `COMMAND_SECRET` is not set on this box**, which
is the one distinction the response deliberately makes: an operator debugging a
silent bot should not have to guess between "stale secret" and "never
configured".

---

## 7. The three console commands the game box must never gate — no box, nothing to run

**This is a constraint on the other machine, written down here because this
console is what breaks when somebody forgets it.** There is no step in this
section to carry out; the two commands in the table below are typed by the
dispatcher, never by a person.

Ringmaster reaches the game box through exactly one channel: the forced-command
SSH link into `tools/dispatch.sh`, which switches on a fixed set of eight verbs
— `status`, `telemetry`, `configreport`, `kick`, `spectate`, `deploy`,
`branches`, `switchref`. Six of those are shell work on the game host: reading
files, listing refs, writing the branch pin, and — for `deploy` alone — starting
the systemd unit that restarts FXServer. None of the six types anything into the
game's console. **Two of them do**, through `tmux send-keys` into the live
FXServer console:

| Ringmaster | dispatcher verb | what is typed into the FXServer console |
|---|---|---|
| the Kick button, and the kick `blitz-bot` relays out of Discord — both via `POST /api/kick` | `kick` | `brkick <license> "<base64 reason>" <command-id>` |
| the Spectate button, `POST /api/spectate` | `spectate` | `brspectate <admin-license> <target-license> <command-id>` |

### Since 2026-09-01 every console command in the gamemode is dev-gated, and exactly three are exempt

The gamemode wraps `RegisterCommand` once, in `br_lib/shared/devgate.lua`
(commit `e8171dd`), so all ~130 console commands in the project — client and
server — refuse unless the box was started with **`br_devMode true`** or
**`sv_devMode true`**, and a command written next month is gated by construction
rather than by anybody remembering to gate it.

**Three verbs pass through ungated, by name, and they are the only three:**

| verb | why it is exempt |
|---|---|
| `brkick` | `dispatch.sh` types it. It **is** this console's Kick button. |
| `brspectate` | `dispatch.sh` types it. It **is** this console's Spectate button. |
| `brring` | the health dump `docs/aws-setup.md` sends an operator to on the live box after an IAM change. Nothing types it for them. |

`tools/verify.sh` in the gamemode parses that exemption list and fails if the set
is anything other than those three, so the constraint is enforced rather than
remembered — but a rule a build checks is still a rule somebody has to know
exists before they argue with it, and that is what this section is for.

> **GATING EITHER OF THE FIRST TWO WOULD BREAK MODERATION IN COMPLETE SILENCE,
> and that is the whole reason this is in a deploy document.** Read the chain:
> the button posts, the route calls `runVerb`, `dispatch.sh` answers `ok`, the
> keystrokes land in the console — and the gate prints its refusal to the game
> box's own stdout, where no part of this console is looking. Every step this
> side can see succeeded.
>
> **This console cannot tell you otherwise, by design.** `src/lib/commandOutcome.ts`
> classifies four outcomes and no more — `not-configured`, `unreachable`,
> `refused`, `dispatched` — and it says out loud that there is deliberately **no
> fifth state for "the player was actually removed"**, because nothing reports one
> back: `/api/ingest` has no handler for a command outcome, so `dispatched`
> carries `confirmed: false` and every `player.kick` audit row stays `pending`.
> The bot's answer is "sent to the server" and never "done". So a gated `brkick`
> reads, everywhere a human can look on this side, exactly like a kick that
> worked — and the player stays where they are.
>
> **The gate fails open on purpose**, which is the other half of the protection:
> if `devgate.lua` ever falls out of a resource's manifest, that resource's
> commands register ungated. Wrong for a security gate, right here — a gate that
> can take `brkick` off the public box by failing to load is worse than one that
> leaves a dev command on it.

### Checking, from this console, whether the live box is in dev mode

The `configreport` verb already reads `br_devMode` and `sv_devMode` off the
deployed `server.cfg`, so the **Config page** (`/config`) shows both without
anybody SSHing in. It also shows `onesync`, which the gamemode requires to be
`on` — `legacy` silently costs a shipped fix, and the game repo's deploy
documentation is the authority on that, not this file.

**Read what that page shows precisely.** `configreport` greps the deployed
`server.cfg` and reports the line it found; a convar the file never mentions
comes back `null` with a source of `default`, which means *nobody wrote it
down*, not *the engine is running the default*. A value set some other way — a
command-line argument, another cfg — will not appear there at all.

---

## Checks

### On the CONSOLE box

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ingest
```

**`200`, and the body is `{"ok":true,"service":"ringmaster-ingest"}`.**
`src/app/api/ingest/route.ts` exports a deliberate `GET` health handler for
exactly this check — it needs no secret and says nothing about the server it
observes, because the only question being asked is "is this listening".

> **This has now been wrong in both directions and is worth reading rather than
> pasting.** The document first said `200`, was corrected to **`405` — and that
> is the pass**, on the reasoning that the route "exports `POST` and nothing
> else". That reasoning was true when written. A `GET` handler was added
> afterwards and the answer went back to `200`, which means anybody following
> the corrected version now goes hunting for a fault that is not there — the
> exact failure the correction was written to prevent.
>
> **What is actually being tested is that a status code comes back at all**,
> which proves the app is listening on 3000 and routing. A connection refused is
> the real failure. If you get a `405` here, you are on a build predating the
> health handler, and that is fine too.

```bash
curl -s -w '\n%{http_code}\n' -H "x-ringmaster-service: $(sudo grep -m1 '^COMMAND_SECRET=' /opt/ringmaster/.env.local | cut -d= -f2- | tr -d '" \r')" http://127.0.0.1:3000/api/health
```

**The body, then `200`** — on a healthy console:

```json
{"ok":true,"ingestAgeMs":1840,"dispatch":"ok","ddb":"connected"}
```

The secret is substituted out of the file rather than typed, for the reason §6
gives for the comparison command there: it keeps the value off your screen and
out of your shell history.

**This is the check to point a monitor at, and it is a different question from
the `/api/ingest` one above** — that proves something is listening; this reports
whether what is listening is well. **Read §6 before wiring it to anything
hosted:** the header carries the credential that can ban players and restart the
game server, so whoever runs the check holds that.

| You get | It means |
|---|---|
| `200`, `"ok":true` | the console is well |
| `401`, body `{"ok":false}` | the header is missing, or the secret does not match `.env.local`. **Nothing is logged** — see §6 |
| `503`, body `{"ok":false,"error":"not-configured"}` | `COMMAND_SECRET` is unset on this box (§6) |
| `503`, body with the three readings | **the console answered and is reporting itself unwell** — read `dispatch` |

**The last row is the one to understand, because a `503` there is a real answer
rather than a failure to answer.** `ok` is derived from the three readings, and
the status code carries that verdict as well as the body does. It has to: a
`HEAD` probe — which Next answers out of this same handler with no body at all
— has nothing but the status to go on, and asserting only `2xx` is the
commonest way a monitor is configured.

`dispatch` is the field that says which machine to open: `key-unreadable` is this
box's filesystem, `rejected` is the game box's `authorized_keys`, `unreachable`
is the network between them, `verb-failed` is `dispatch.sh` on the game box.
Two of the seven words are NOT faults and do not make `ok` false — `unknown`,
which is the first check after a restart before the poll timer has landed a
reading and clears itself within about fifteen seconds, and `unconfigured`,
which means this console was never pointed at a game box over SSH at all.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ringmaster.example.com/login
```

`200` — Cloudflare, the proxy and the app are all in the path.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ringmaster.example.com/
```

`307` — redirected to login, because you have no session. If this returns
`200`, stop: the auth guard is not working. **Note the middleware only enforces
this in production** (`NODE_ENV=production`), which the systemd unit gives you;
running `npm run dev` on this box will return `200` and prove nothing.

### On the GAME box — the only two commands in this file that are

**`[GAME]`** — these run on the FXServer host in us-east-2, not on the box you
have been setting up. Nothing above this line does.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<ringmaster-private-ip>:3000/api/ingest
```

`200`, for the same reason as above — it proves the peered path reaches the app.
Use the **private** IP; the public one would test a route over the internet and
prove nothing about the peering. A hang means the security group; a refusal
means the app is not running.

This is the path both server-to-server calls take, so it covers the pause-menu
handoff as well as the player feed. **It does not cover the Admin tab itself**,
which loads the public origin over 443 from inside the game client — if the feed
works and the pause menu still opens signed out, the peering is not the problem.

```
brring
```

In the **FXServer console** (not a shell), which reports the game box's own side
of things — including a `ddb` line reading `reachable` or `FAILED` — independently
of anything on the CONSOLE box. It is listed here only so that a failure gets
attributed to the right machine: **the console being down does not affect it, and
it does not affect the console.**

> **This said `brddb` until 2026-09-01, and on a production box that command now
> refuses.** Every console command in the gamemode is dev-gated (§7); `brddb` is
> not one of the three exemptions, so on the live server it prints
> `brddb is dev-mode only` and does nothing. Anyone who ran it, saw no lookup and
> concluded the game box had lost its AWS credentials would be chasing a fault
> that is not there.
>
> **`brring` is not the same check and this document should not pretend it is.**
> `brddb` probes DynamoDB *now*; `brring`'s `ddb` line reports what `br_ddb` last
> told `br_ringmaster` — the cached selftest verdict, which is also what the
> console's own DynamoDB card is drawn from. That makes it the right reading for
> "is this machine's story consistent with what the console shows", and the wrong
> one for "is IAM working this second". For the second question, run `brddb` on a
> box started with `br_devMode true`. See `docs/aws-setup.md` §3.

---

## Deploying an update — CONSOLE box

**This updates the console and nothing else.** It does not touch the game
server, and there is no step in it that reaches the other box.

```bash
cd /opt/ringmaster && git pull && npm ci && npm run build && sudo systemctl restart ringmaster
```

Kept as a separate step from running, for the same reason the game server's
deploy is: a restart should relaunch what is on disk, not silently pull new
code — otherwise a crash-restart deploys whatever happened to be on `main` at
that moment.

> **Updating the GAME box is a different thing entirely and is not done from a
> shell.** It runs from the console's Maintenance page, over the forced-command
> SSH channel, against whichever branch that box is actually parked on — which
> is not necessarily `main`. Nothing you type here affects it, and running the
> line above will not deploy a gamemode change.
