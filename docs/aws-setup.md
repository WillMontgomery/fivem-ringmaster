# AWS setup for Ringmaster

Everything the admin console needs on the AWS side, in the order to do it.

**Read this first:** you can stop after any numbered section and come back. The
sections are ordered so that each one works on its own — nothing later breaks
something earlier. **Sections 1–3 are the ones that unblock development.**
Sections 4–6 are networking and can wait until there is something to deploy.

**No step here creates an access key.** If you find yourself downloading a
`.csv` of credentials, stop — something has gone wrong. Both servers get their
permissions from an *instance role*, which the AWS SDK picks up automatically.

| | |
|---|---|
| **Game server** | existing box, **us-east-2** |
| **Ringmaster** | reserved instance, **us-west-2** |
| **DynamoDB** | **us-east-2**, co-located with the game server (the far higher-volume writer) |

---

## 1. Create the DynamoDB tables

Console → **DynamoDB** → make sure the region selector says **us-east-2 (Ohio)**
→ *Tables* → *Create table*.

Create six tables. For every one of them:

- **Capacity mode: On-demand.** The load is bursty and tiny between matches.
  Provisioned capacity would mean guessing a number and paying for it while
  nobody is playing.
- Leave encryption, TTL and everything else at defaults unless noted.

| Table name | Partition key | Sort key | Notes |
|---|---|---|---|
| `ringmaster-grants` | `license` (String) | — | Who can do what. **Ringmaster writes; the game server must never touch this.** |
| `ringmaster-bans` | `license` (String) | — | Active and lifted bans |
| `ringmaster-audit` | `pk` (String) | `ts` (Number) | Every admin action. **Ringmaster only.** |
| `ringmaster-incidents` | `incidentId` (String) | — | Reports and anticheat escalations |
| `ringmaster-sessions` | `pk` (String) | `sk` (String) | Auth.js writes this. **Needs a secondary index *and* TTL — see below** |
| `ringmaster-telemetry` | `host` (String) | `ts` (Number) | Host CPU/memory/network. **Add a TTL attribute named `expires`** |

### The secondary index on `ringmaster-sessions`

Auth.js's DynamoDB adapter uses a single table with one global secondary index,
and **it will not work without it**. Create the table as above, then open it →
*Indexes* → *Create index*:

- **Partition key**: `GSI1PK` (String)
- **Sort key**: `GSI1SK` (String)
- **Index name**: `GSI1` — exactly this, it is what the adapter looks for
- Attribute projections: **All**

> This one is worth double-checking before moving on. Every other part of login
> can be correct and it will still fail, with an error naming the index rather
> than anything you touched — which is a confusing place to start debugging.
>
> Confirm the exact key names against the adapter's own docs when you install
> it (`@auth/dynamodb-adapter`), in case they have changed since this was
> written.

### TTL, on the two tables that need it

TTL makes DynamoDB delete expired rows for free, which is how sessions expire
and how telemetry stops growing forever.

For `ringmaster-sessions` and `ringmaster-telemetry`: open the table → *Additional
settings* → *Time to Live* → *Enable* → attribute name **`expires`**.

> Spelling matters — `expires`, lowercase. Auth.js writes that exact attribute.
> A typo here fails silently: rows simply never expire, and you find out months
> later from the bill.

### Stats tables

`br_stats` (the game side) will define its own tables when M7b lands. They are
not needed for Ringmaster and are not listed here.

---

## 2. IAM role for the **Ringmaster** box (us-west-2)

Console → **IAM** → *Roles* → *Create role* → **AWS service** → **EC2** → *Next*.

Skip attaching a managed policy — click *Next*, name it
**`RingmasterAppRole`**, create it. Then open it → *Add permissions* → *Create
inline policy* → **JSON** tab → paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RingmasterTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-*",
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-*/index/*"
      ]
    }
  ]
}
```

**Replace `ACCOUNT_ID`** with your 12-digit account number — top-right of the
console under your username, or run `aws sts get-caller-identity`.

Name the policy `RingmasterTableAccess` and save.

---

## 3. IAM role for the **game server** box (us-east-2)

This is the one where the scoping actually matters, so it is worth doing
deliberately rather than copying the role above.

Same path: *Roles* → *Create role* → **EC2** → name it **`FiveMGameServerRole`**
→ inline policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GameServerWrites",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-telemetry",
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-stats-*"
      ]
    },
    {
      "Sid": "GameServerBanCheck",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-bans"
    }
  ]
}
```

**Two statements, on purpose.** The first is what the game server *writes* — its
own stats and telemetry. The second is the single read it genuinely needs: the
ban check that runs when a player connects. Keeping them apart means the read is
visible as a deliberate exception rather than buried in a list of nine actions,
and it stays `GetItem` on one table — **not `Query`, not `Scan`**, so the game
server can answer "is *this* license banned?" and cannot enumerate the ban list.

**Why this policy is shaped the way it is** — this is the single most important
security control in the whole design, so it is worth understanding rather than
pasting:

- **No `ringmaster-grants` and no `ringmaster-audit`, at all.** The game server
  is the box most exposed to the public internet, running software that people
  actively try to exploit. If it were ever compromised, this policy means the
  attacker still cannot grant themselves an admin scope and cannot edit the
  record of what they did.
- **On `ringmaster-bans`, `GetItem` only.** Enough to answer "is *this* license
  banned?" when someone connects. **Not `Query`, not `Scan`** — so a compromised
  game server cannot enumerate who is banned, and **no write actions** — so it
  cannot lift a ban.
- **No `Query` or `Scan` anywhere.** Nothing on the game side has a reason to
  enumerate a table.
- **No `DeleteItem` anywhere.** Nothing on the game side ever needs to destroy a
  row.

### Attach both roles

EC2 → *Instances* → select the instance → *Actions* → *Security* → *Modify IAM
role* → pick the matching role → *Update*. No restart needed.

- Ringmaster box (us-west-2) → `RingmasterAppRole`
- Game server box (us-east-2) → `FiveMGameServerRole`

### Check it worked

SSH into each box and run:

```bash
aws sts get-caller-identity
```

It should print an ARN containing `assumed-role/<the role name>`. If it says
credentials could not be found, the role is not attached — or the AWS CLI is not
installed, which is fine and does not mean the role is missing (the SDK reads it
from instance metadata regardless).

---

## 4. VPC peering, us-west-2 ↔ us-east-2

This is what lets Ringmaster reach the game server privately. **Neither RCON nor
SSH should ever be reachable from the public internet.**

**First, write down both VPC CIDR blocks** (VPC console → *Your VPCs* → the
IPv4 CIDR column) in each region.

> **If both say `172.31.0.0/16`, stop.** That is the AWS default VPC range in
> every region, and **peering cannot connect two VPCs with overlapping CIDRs.**
> You would need a new VPC in one region with a different range (e.g.
> `10.10.0.0/16`) and the instance moved into it — which is real work, not a
> checkbox. Find this out now rather than after three other steps.

1. In **us-west-2** → VPC → *Peering connections* → *Create peering connection*
   - Name: `ringmaster-to-gameserver`
   - **Local VPC**: the us-west-2 VPC
   - Account: *My account*; Region: **Another Region** → **us-east-2**
   - **VPC (Accepter)**: paste the us-east-2 VPC id
2. Switch the console to **us-east-2** → *Peering connections* → select the
   pending request → *Actions* → **Accept request**.
3. **Add routes on both sides** — peering does nothing until you do this, and
   this is the step people miss.
   - us-west-2 → *Route tables* → the one associated with Ringmaster's subnet →
     *Routes* → *Edit* → *Add route*: Destination = **the us-east-2 CIDR**,
     Target = **Peering Connection** → your pcx-…
   - us-east-2 → the game server's subnet's route table → *Add route*:
     Destination = **the us-west-2 CIDR**, Target = the same peering connection.

---

## 5. Security groups

Peering makes the path exist; security groups decide what may cross it.

**On the game server's security group** (us-east-2), add **one** inbound rule.
For *Source*, type the **us-west-2 VPC CIDR** — not a security group id, since
those cannot be referenced across regions.

| Type | Protocol | Port | Source | Why |
|---|---|---|---|---|
| SSH | TCP | `22` | us-west-2 CIDR | `dispatch.sh` forced command — the *only* channel |

> **There is deliberately no RCON rule here**, and this is worth understanding
> because an earlier draft of this plan had one.
>
> FXServer's RCON is not a separate service on a port you can choose. It is an
> out-of-band handler bolted onto **the same UDP socket players connect
> through**, and there is no convar to move or rebind it — so it cannot be
> firewalled apart from gameplay traffic at all. Its authentication is a
> plaintext password compared non-constant-time, rate-limited on a *spoofable*
> UDP source address, and commands execute with full console authority.
>
> So Ringmaster does not use RCON. **Leave `rcon_password` unset in
> `server.cfg`** — that is already the default — and admin commands travel over
> SSH instead, exactly as txAdmin does it (it writes to the FXServer process's
> stdin and contains no RCON code at all).
>
> One channel, on a port that is not open to the world.

**On Ringmaster's security group** (us-west-2), one inbound rule:

| Type | Protocol | Port | Source | Why |
|---|---|---|---|---|
| Custom TCP | TCP | `3000` | us-east-2 CIDR | The ingest endpoint the game server pushes to |

> Do **not** open 3000 to the internet. Public traffic arrives via Cloudflare on
> 443 and is handled by the reverse proxy, which is a separate rule you will add
> when the box is set up.

### Confirm it works

From the Ringmaster box:

```bash
nc -vz <game-server-private-ip> 22
```

Use the **private** IP (the `172.31.x.x` / `10.x.x.x` one), not the public one —
using the public IP would test a path over the internet and prove nothing about
the peering.

---

## 6. S3 bucket for incident screenshots

Not needed until M5. Listed here so it is not a surprise later.

S3 → *Create bucket*, in **us-east-2**:

- Name: something globally unique, e.g. `royale-incidents-<something>`
- **Block all public access: ON.** Images reach the browser through presigned
  URLs, never public reads.

**No expiry lifecycle rule** (decided 2026-08-09). An earlier draft proposed
deleting objects after 90 days on the reasoning that these are pictures of
players' screens. The operator's objection is the stronger one: an incident
whose evidence has silently evaporated is worse than useless — you open a report
from eighteen months ago during an appeal or a pattern investigation and half of
it is gone, with nothing to say why.

If storage cost ever becomes the concern, **the answer is a storage class, not a
deletion**. A lifecycle rule transitioning objects to *Glacier Instant
Retrieval* after 90 days keeps every image readable on demand at roughly a fifth
of the price. That satisfies the cost worry without ever losing evidence.

> Worth knowing what this trades away: screenshots of players' screens are then
> retained indefinitely. If a player ever asks for their data to be deleted, that
> is a manual job against this bucket, and there is no automated process that
> would have done it for you.

---

## What to send back

Nothing secret — none of this is a credential:

1. Your **AWS account id** (12 digits)
2. The **VPC CIDR** in each region, and whether they overlapped
3. The **private IP** of the game server box
4. Confirmation that both roles are attached and `aws sts get-caller-identity`
   shows the right role on each box

---

## Troubleshooting

**`AccessDeniedException` mentioning a table** — the ARN in the inline policy
does not match the real table name. Check the region in the ARN is `us-east-2`
and that `ACCOUNT_ID` was actually replaced.

**`nc` hangs instead of refusing** — that is a security group dropping the
packet (a rule missing or the wrong source). A *refused* connection means the
network path works and nothing is listening, which is a different, better
problem.

**`nc` refused on port 22 but SSH works from your laptop** — you are probably
testing the public IP. Use the private one.

**Peering shows Active but nothing connects** — the route tables. It is almost
always the route tables, and it needs doing on *both* sides.
