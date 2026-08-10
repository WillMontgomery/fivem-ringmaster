# Deploying Ringmaster

Setting up the us-west-2 box. Everything here runs **on that box**, not on the
game server.

Nothing in this document touches the game host. The only thing that ever will
is an outbound SSH connection, and that comes later.

---

## 1. Node

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

> **Do not install Node on the game server.** It does not need one and the
> gamemode's deploy explicitly avoids requiring it. Only this box runs Node.

### Get the code

```bash
sudo mkdir -p /opt/ringmaster && sudo chown "$USER:$USER" /opt/ringmaster
```

```bash
git clone https://github.com/WillMontgomery/fivem-ringmaster.git /opt/ringmaster
```

```bash
cd /opt/ringmaster && npm ci && npm run build
```

`npm ci` rather than `npm install`: it installs exactly what `package-lock.json`
pins and fails if the lockfile and `package.json` disagree, instead of quietly
resolving something newer than what was tested.

### Environment

```bash
cp .env.example .env.local && nano .env.local
```

Fill in every value. `AUTH_URL` must be the **public** origin
(`https://your-domain`), because Auth.js builds the OAuth redirect URI from it
and Discord rejects a mismatch.

```bash
chmod 600 .env.local
```

This file holds the Discord secret, the session signing key and the ingest
secret. It is gitignored, and the secret-scanning gate would fail the build if
it ever were not.

---

## 2. Why a reverse proxy

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

## 3. The app as a service

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

## 4. Discord

Discord Developer Portal → your application → **OAuth2** → *Redirects* → add:

```
https://ringmaster.example.com/api/auth/callback/discord
```

Exactly that, matching `AUTH_URL` in `.env.local`. A trailing slash or `http`
instead of `https` will fail with an error that blames the wrong thing.

---

## 5. Ports

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

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ingest
```

`200` — the app is up locally.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ringmaster.example.com/login
```

`200` — Cloudflare, the proxy and the app are all in the path.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ringmaster.example.com/
```

`307` — redirected to login, because you have no session. If this returns
`200`, stop: the auth guard is not working.

From the **game** box, checking the ingest path is reachable over peering:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<ringmaster-private-ip>:3000/api/ingest
```

`200`. A hang means the security group; a refusal means the app is not running.

---

## Deploying an update

```bash
cd /opt/ringmaster && git pull && npm ci && npm run build && sudo systemctl restart ringmaster
```

Kept as a separate step from running, for the same reason the game server's
deploy is: a restart should relaunch what is on disk, not silently pull new
code — otherwise a crash-restart deploys whatever happened to be on `main` at
that moment.
