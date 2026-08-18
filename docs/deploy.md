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

Four are genuinely optional and the app starts without them —
`DISCORD_BOT_TOKEN` (without it every player shows a Discord default avatar
rather than their own) and `GAME_HOST` / `GAME_SSH_KEY` / `GAME_SSH_USER`
(without them the Host page says "not configured" rather than erroring).
`src/lib/env.ts` is the authority on which are which: it validates the whole
environment at first use and names **every** missing variable at once rather
than one per restart.

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

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ringmaster
EnvironmentFile=/opt/ringmaster/.env.local
ExecStart=/usr/bin/npm run start

Restart=always
RestartSec=5
# systemd gives up after five restarts in ten seconds by default, which is the
# wrong behaviour for something that should keep trying at 3am.
StartLimitIntervalSec=0

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

```bash
systemctl status ringmaster --no-pager && journalctl -u ringmaster -n 30 --no-pager
```

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
| 443 | Cloudflare only | The admin's browser, via the WAF |
| 3000 | the us-east-2 VPC CIDR only | `br_ringmaster`'s push to `/api/ingest` |
| 22 | your own IP | You |

**Port 3000 must not be open to the internet.** The ingest endpoint
authenticates with a shared secret over the peered link and is deliberately
excluded from the session middleware; the security group is what actually keeps
it private.

Restricting 443 to Cloudflare's ranges is worth doing so nobody bypasses the WAF
by hitting the IP:

```bash
curl -s https://www.cloudflare.com/ips-v4
```

---

## Checks

### On the CONSOLE box

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ingest
```

**`405` — and that is the pass.** `src/app/api/ingest/route.ts` exports `POST`
and nothing else, so Next answers a `GET` with Method Not Allowed. Getting a
status code at all is the thing being tested: it proves the app is listening on
3000 and routing. **This document used to say `200` here**, which sent people
looking for a fault that was not there. A connection refused is the real
failure; anything else means the app is up.

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

`405`, for the same reason as above — it proves the peered path reaches the app.
Use the **private** IP; the public one would test a route over the internet and
prove nothing about the peering. A hang means the security group; a refusal
means the app is not running.

```
brddb
```

In the **FXServer console** (not a shell), which confirms the game box's own
DynamoDB access — credentials, route and IAM permission — independently of
anything on the CONSOLE box. See `docs/aws-setup.md` §3. It is listed here only
so that a failure gets attributed to the right machine: **the console being
down does not affect it, and it does not affect the console.**

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
