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

Create nine tables. For every one of them:

- **Capacity mode: On-demand.** The load is bursty and tiny between matches.
  Provisioned capacity would mean guessing a number and paying for it while
  nobody is playing.
- Leave encryption, TTL and everything else at defaults unless noted.

| Table name | Partition key | Sort key | Notes |
|---|---|---|---|
| `ringmaster-grants` | `license` (String) | — | Who can do what. **Needs a secondary index — see below.** Ringmaster writes; the game server only reads. |
| `ringmaster-bans` | `license` (String) | — | Active and lifted bans. Ringmaster writes; the game server only reads. |
| `ringmaster-audit` | `pk` (String) | `ts` (Number) | Every admin action. **Ringmaster only.** |
| `ringmaster-incidents` | `incidentId` (String) | — | Reports and anticheat escalations. The game appends; both sides read. |
| `ringmaster-sessions` | `pk` (String) | `sk` (String) | Auth.js writes this. **Needs a secondary index *and* TTL — see below** |
| `ringmaster-telemetry` | `host` (String) | `ts` (Number) | **Add a TTL attribute named `expires`.** Provisioned, and nothing writes it yet — see the note below. |
| `ringmaster-maintenance` | `id` (String) | — | The scheduled maintenance window. **One item, `id = "current"`.** The game reads it for the drain gate. |
| `ringmaster-players` | `license` (String) | — | This console's own player registry: identity, sessions, playtime |
| `ringmaster-player-ids` | `id` (String) | — | Reverse index, identifier → the licenses that presented it. Answers "has this Discord account been here under another license", which a license-keyed table cannot. |

> **Three of those nine were missing from this document until 2026-08-18**, and
> the omission was not cosmetic: `ringmaster-maintenance`, `ringmaster-players`
> and `ringmaster-player-ids` are all live in `src/lib/dynamo.ts`, and a stack
> built from the old list gives you a console that signs you in and then throws
> `ResourceNotFoundException` on the Host page, on every profile, and on the
> identifier check that runs at connect. **If you created the tables before this
> date, create these three now.**
>
> The list above is transcribed from `src/lib/dynamo.ts`, which is the only
> place table names are constructed. Nothing asserts that this table and that
> file agree — so when they disagree, the file is right.

> **`ringmaster-telemetry` is provisioned and unwritten.** Host CPU/memory/
> network is polled over SSH and held in memory on the Ringmaster box
> (`src/lib/telemetry.ts`), so the graphs are lost on restart and the durable
> record is an M3b follow-up that has not landed. Create the table and the TTL
> anyway — provisioning it later is the same work plus a migration. **The game
> box never writes it**, and never did; see the 2026-08-09 note in section 3.

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

### The secondary index on `ringmaster-grants`

**Added 2026-08-09. If you created the tables before this date, this one is
missing and nobody can log in.**

Discord tells us *who* is logged in; every grant, ban and audit row keys on the
**license**. Something has to bridge them, and `ringmaster-grants` is keyed by
`license` with `discordId` as a plain attribute — which answers "what can this
license do?" but not "which license is this Discord account?", and login needs
the second one.

Open `ringmaster-grants` → *Indexes* → *Create index*:

- **Partition key**: `discordId` (String)
- No sort key
- **Index name**: `discordId-index`
- Attribute projections: **All**

> Worth understanding rather than pasting, because it constrains a real
> behaviour: the `discordId` on a grants row is written **by hand when the admin
> is granted**, not discovered automatically. FiveM only reports a `discord:`
> identifier when the connecting player has Discord's activity integration
> enabled on their end, which is opt-in. So an admin who has never connected
> with it on has no discovered mapping — and without a manually-set `discordId`,
> **they cannot log in at all.** That includes, awkwardly, the first admin.
> `scripts/grant.mjs` therefore takes `--discord-id` explicitly.

### TTL, on the two tables that need it

TTL makes DynamoDB delete expired rows for free, which is how sessions expire
and how telemetry stops growing forever.

For `ringmaster-sessions` and `ringmaster-telemetry`: open the table → *Additional
settings* → *Time to Live* → *Enable* → attribute name **`expires`**.

> Spelling matters — `expires`, lowercase. Auth.js writes that exact attribute.
> A typo here fails silently: rows simply never expire, and you find out months
> later from the bill.

### The game's own table, which Ringmaster reads

**This section used to say the game's tables "are not needed for Ringmaster and
are not listed here". That has not been true since the profile page shipped.**

The game side keeps everything of its own in **one** table, `br-players`,
partition key `pk` (String) and sort key `sk` (String) — `sk = profile` for the
career aggregate, `sk = purchases` for owned cosmetics, and one
`sk = match#<endedAt>#<matchId>` row per match played. **You do not create it
here**; it belongs to the game repo's deploy, which is where its definition
lives.

It is listed here because Ringmaster *reads* it — a `GetItem` for the
progression panel and a `Query` with `begins_with(sk, 'match#')` for match
history, both in `src/lib/gameProfile.ts`. That read is what the policy in
section 2 does not currently grant; see the flag at the end of that section.

The prefixes differ (`br-` versus `ringmaster-`) because the ownership does, and
that is the whole point of the split: it lets an IAM policy say "this box reads
the other side's data and never writes it" as an ARN rather than as a promise.

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

> **⚠ The policy above does not cover everything this box reads, and the gap is
> not written into it here on purpose.**
>
> `src/lib/gameProfile.ts` does a `GetItem` and a `Query` against **`br-players`**
> — the game's table, which does not match `ringmaster-*` and is therefore
> denied by the policy as written. The symptom is the profile page's Progression
> and Match history panels coming back empty with an `AccessDeniedException` in
> `journalctl -u ringmaster`, while every other panel works.
>
> **What the code needs** is `dynamodb:GetItem` and `dynamodb:Query` on
> `arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-players`, and nothing more —
> no write of any kind, which is the property `src/lib/dynamo.ts` describes as
> deliberate ("Ringmaster only ever reads it").
>
> **This document deliberately does not paste that statement into the JSON
> above.** IAM here is administered by hand, and a document that silently
> widens a policy to match today's code is a document that widens it again next
> time without anyone deciding to. Decide it, then write it.

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
      "Sid": "GameServerWritesOnly",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-stats-*"
      ]
    }
  ]
}
```

**This is the starting policy, and the shortest true sentence about it is that
the game box cannot touch a single `ringmaster-*` table.** It writes its own
match data and nothing else. Not the grants table, not the audit log, not the
ban list, not telemetry.

**Three statements have been added to it since, and they are the only three.**
The sections below are them — a read on bans, grants and the maintenance window;
an append on incidents; and, since 2026-08-17, a read back of incident verdicts.
The third one cost a property this document used to advertise, and it is written
down below rather than quietly dropped.

That matters because the game server is the box most exposed to the public
internet, running software people actively try to exploit. If it is ever
compromised, this policy means the attacker cannot grant themselves an admin
scope, cannot edit the record of what they did, and cannot find out who is
banned.

> **⚠ The `Resource` above is `br-stats-*`, and the shipped game code reads and
> writes `br-players`.** Nothing matches `br-stats-*`. This is not a consequence
> of any of the three additions below — it predates all of them.
>
> **What the code needs**, from `js-src/br_ddb/src/index.js` (`TABLE_PREFIX_GAME`
> defaults to `br-`, and every call site names the table `players`):
> `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` and
> `dynamodb:BatchWriteItem` on
> `arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-players`. The `BatchWriteItem`
> is the match-history writer, which fires in batches of 25 at the end of every
> match. There is no `Query` and no `Scan` against it from the game side.
>
> **The JSON above has deliberately not been rewritten to match.** Two live
> possibilities and they need different fixes: either the role in AWS already
> says something other than what is written here — in which case *this file* is
> the stale copy and should be corrected from the real policy — or it says
> exactly this, in which case the game box has been failing every write to
> `br-players` since it shipped and the fix is a policy change somebody makes
> deliberately, having read the paragraph above. **Check the real role before
> changing either one.** A doc that quietly grants a wildcard to make an error
> go away is worse than the error.

> **Revised 2026-08-09** — if you created this role earlier it also granted
> `ringmaster-telemetry`; **delete that ARN.** Host telemetry is polled by
> Ringmaster over SSH and written by Ringmaster, so the game box never touches
> that table. An earlier draft of this file had it in both places, which cannot
> both be right.

### The reads it needs — Slice 2

The game box reads DynamoDB directly through the `br_ddb` resource: the ban gate
checks a connecting player against the ban list, the in-game admin surface reads
its own scopes rather than inventing a second permission source, and the drain
gate reads the maintenance window so the server can refuse connections while it
is draining. All are point lookups on a key the box already holds, and they
share one statement so the exception stays visible rather than buried in a list
of actions:

```json
{
  "Sid": "GameServerReadOnly",
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-bans",
    "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-grants",
    "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-maintenance"
  ]
}
```

> **`ringmaster-maintenance` was added to this list on 2026-08-18**, having been
> read by `br:ddb:maintenance` for as long as the drain gate has existed and
> named in neither the table list above nor this statement. It is one `GetItem`
> on the fixed key `{id: "current"}`.
>
> **Every one of these reads fails OPEN**, and that is the architectural rule
> rather than an implementation detail: an unreachable ban list must not become
> a server nobody can join, and an unreadable maintenance row means no drain
> rather than a locked server. **The game server does not depend on Ringmaster
> being up** — only the reverse. That is why these questions go to DynamoDB
> directly instead of over an HTTP call to the console, and it is a constraint
> to preserve rather than a shortcut taken once.

**This used to say "add it when the ban gate ships, not before". The ban gate
has shipped — add it now.** `br_ddb` is live on the game box and the connect
gate reads through it on every join.

Verify it with **`brddb`** in the game server's console (`brddb` is registered by
`br_ddb/server/debug.lua`). It looks up a license that will never exist, so a
successful lookup returning nothing proves credentials, route and permission
together without depending on any row being present. `brban <license>` is the
same check against a license you care about.

**Why this policy is shaped the way it is** — this is the single most important
security control in the whole design, so it is worth understanding rather than
pasting:

- **`GetItem` only, on named tables.** Enough to answer "is *this* license
  banned?", "what scopes does *this* license hold?" and "are we draining?" —
  each about one specific key the box already has in hand. (A `PutItem` was
  added alongside it on 2026-08-14 and a fourth table on 2026-08-17; both are
  the sections below.)
- **No `ringmaster-audit`, at all.** The audit log is the record of what admins
  did. A compromised game host must not be able to read — still less rewrite —
  the account of its own compromise. **This is the line that does not move**,
  and it is the one line here that survived 2026-08-17 untouched.
- **No `Query` and no `Scan` anywhere in `br_ddb` — and that is now the load-
  bearing guarantee, not the table list.** Verified by reading
  `js-src/br_ddb/src/index.js`: the only commands it imports from
  `@aws-sdk/client-dynamodb` are `GetItemCommand`, `PutItemCommand`,
  `UpdateItemCommand` and `BatchWriteItemCommand`. `QueryCommand` and
  `ScanCommand` appear nowhere in the resource's source. So a compromised game
  server cannot enumerate who is banned, who the admins are, or which cases are
  open — it can only confirm or deny a key it was already given.

  **Say it that way round on purpose.** Since 2026-08-17 the *grant* is broader
  than the code (see below), so "it can only touch these ARNs" is no longer the
  strong statement it used to be. "It cannot enumerate anything" still is, and
  it is enforced by the absence of a verb rather than by an ARN list. If
  `br_ddb` ever needs a `Query`, that is a conversation about this policy — not
  a change to a function.
- **No write action on anything that decides authority.** It cannot lift a ban,
  and it cannot grant itself a scope. `ringmaster-grants`, `ringmaster-bans` and
  `ringmaster-maintenance` stay *writable only by Ringmaster*, where every
  change goes through the console's own scope check and lands in the audit log.
- **No `DeleteItem` anywhere.** Nothing on the game side ever needs to destroy a
  row.

> **Why `ringmaster-grants` is readable here at all**, having previously been
> excluded: admin actions are moving in-game as well as in the console, and the
> game needs a permission source for them. The alternative — a grants cache
> pushed down and invalidated out of band — is a whole subsystem whose failure
> mode is a stale permission, which is worse than a read. The read is narrow
> (one license, no enumeration) and the write side is untouched.

### The one write it needs — incidents, append-only

**Added 2026-08-14, which is why it is worth reading rather than skipping: a
role built from a copy of this file dated earlier than that cannot file an
incident at all.** The game writes incident rows itself, directly
into `ringmaster-incidents`, rather than sending them over the event channel for
Ringmaster to write — that channel drops batches silently after four attempts,
and the evidence buffer behind an incident is discarded at match end, so a case
lost that way is unrecoverable. The event carries only the id; the row is
already durable by the time it arrives. `js-src/br_ddb/src/index.js` in the
gamemode is the authority here and states the grant it assumes.

```json
{
  "Sid": "GameServerFileIncident",
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-incidents"
  ]
}
```

**The write is conditional on `attribute_not_exists(incidentId)`** on the game
side, so it can add a case and cannot overwrite one. Even having since gained a
read (next section), a compromised game box still cannot enumerate open cases,
read who is banned, discover who the admins are, or alter a verdict. Append
without any ability to enumerate is a much smaller blast radius than it first
sounds.

> **This section used to end by saying there was "no read of any kind on this
> table", and used to close the verdict question with "Neither is done."** Both
> sentences were true when written and neither is true now. They are named here
> rather than deleted because they were load-bearing: `br_ddb`'s own header
> comment cites them, and anyone who read this file between 2026-08-14 and
> 2026-08-17 came away with the opposite of the current answer.

### The read it gained — verdicts, decided 2026-08-17

**Settled, deliberately, by the owner: `dynamodb:GetItem` on `ringmaster-*`.**
Their words on the breadth of it were "this is deliberately broad, I know".
fivem-br-gamemode#168 — 250 Volts to a reporter whose report led to an action —
needed the verdict, and of the two options this file used to lay out (widen the
policy, or push verdicts down the SSH dispatcher) the first was chosen. The
second would have added a console→game path that must not lose messages, whose
failure mode is an unpaid reward with nothing recording that it was owed.

**The grant is broad and the code is not, and that difference is the whole
story of this section.** The prefix covers `audit`, `bans`, `grants`,
`incidents`, `maintenance`, `players`, `player-ids`, `sessions` and
`telemetry`. `br_ddb` reads four of them and should read no more:

| Table | Verb | What for |
|---|---|---|
| `ringmaster-bans` | `GetItem` | the connect gate |
| `ringmaster-grants` | `GetItem` | in-game admin scopes |
| `ringmaster-maintenance` | `GetItem` | the drain gate |
| `ringmaster-incidents` | `GetItem` + `PutItem` | file a case, read its verdict |

**What was actually applied**, so this file matches the role rather than
describing an ideal of it:

```json
{
  "Sid": "GameServerReadIncidentVerdict",
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-*"
  ]
}
```

**That wildcard is the owner's deliberate choice and is written here as such —
not as a recommendation.** If you are creating this role fresh and would rather
not carry the breadth, the four ARNs in the table above are sufficient for
everything `br_ddb` does, and substituting them changes no behaviour. **When
somebody comes to tighten the wildcard back to a list, that table is the
answer** — it is transcribed from `js-src/br_ddb/src/index.js`, which names each
table exactly once. Read the real role before editing either.

**What the verdict read actually is**, verified in `br:ddb:incidentVerdict`
(`js-src/br_ddb/src/index.js`, ~line 953) rather than described from memory:

- **One `GetItem`**, keyed on `{incidentId}` alone. The table has no sort key.
- **`ProjectionExpression` of exactly four attributes** — `incidentId`, `state`,
  `verdict`, `resolvedAt`. (`state` is a DynamoDB reserved word and is aliased.)
  **Deliberately not** `resolution` or `resolvedByName` — the moderator's prose
  never crosses onto the game box — and **deliberately not** `reporterLicense`
  or `subjectLicense`, so the read cannot confirm an identity the game did not
  already hold. The evidence, chat log, kill log and capture keys are all on
  that item and none of them are asked for.
- **`ConsistentRead: false`.** A verdict one sweep late is paid one sweep late.
- **By an id the box minted itself.** Every id this verb is called with came
  back from `putIncident` on the same box, so "read back cases whose ids it
  knows" means "read back its own".
- **It fails closed**, unlike the ban gate. An unreadable case answers "not
  settled", the claim stays on the queue, and the next sweep asks again — paying
  on a failed read would credit Volts against a verdict nobody has seen.

**What it cost, stated plainly so nobody has to rediscover it:** a compromised
game box can now see the verdicts on cases it filed. It still cannot alter one —
`ringmaster-incidents` remains write-append-only from that side, and the resolve
path lives entirely in the console.

### The incident rules this policy is built around

Worth having beside the policy, because more than one of the guarantees above
depends on them and they are decisions rather than implementation:

- **An incident has exactly two states, `pending_review` and `resolved`, and it
  cannot be re-opened.** The queue is a strictly-shrinking worklist. If the
  behaviour continues, that is a *new* incident.
- **A verdict cannot be changed after the fact.** It is written by the same
  conditional update that moves the row to `resolved`, and that update refuses
  to run against a row that is already resolved — so there is no window in which
  an incident is resolved without a verdict, and no path that rewrites one.
  There is no second function that takes an id and a verdict, and that absence
  *is* the enforcement.
- **A ban issued from an incident is a standard audit action.** It writes a
  `ban.issue` row exactly like any other ban, plus an `incident.resolve` row for
  the closure. Being reached from a case does not make it a different kind of
  ban or exempt it from the audit log.
- **A verdict only exists if the action did.** `ban` is written after the ban row
  lands; `kick` after the game host accepts the command. Neither is a claim the
  browser gets to make — which is the property that matters when Volts are paid
  against it.
- **Absent is not `none`.** An incident resolved before the field existed, or
  auto-resolved by the system, carries no verdict at all, and that must not be
  read as "no action was taken". It is a claim about a decision nobody made.

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
| SSH | TCP | `22` | us-west-2 CIDR | `dispatch.sh` forced command — the *only* inbound channel |

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

**Still not needed, and worth being precise about why.** Incidents themselves
have shipped — the game files them, the console queues and resolves them — but
the *screenshot* half of M5 has not: nothing in this repo constructs an
`S3Client` or a presigned URL, and no IAM statement anywhere below or above
mentions S3. Create the bucket when the capture path is built, not before.
Listed here so it is not a surprise later.

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
