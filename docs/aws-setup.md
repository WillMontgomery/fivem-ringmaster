# AWS setup for Ringmaster

Everything the admin console needs on the AWS side, in the order to do it.

**Read this first:** you can stop after any numbered section and come back. The
sections are ordered so that each one works on its own — nothing later breaks
something earlier. **Sections 1–3 are the ones that unblock development.**
Sections 4 and 5 are networking and can wait until there is something to deploy.

> **Section 6 is not networking and is not optional.** It used to be a bucket to
> build later, and this line used to sweep it in with the networking; it now
> holds a live S3 bucket and **the game box's only S3 statement**,
> which section 3 does not contain. A role built from 1–3 alone files incidents
> correctly and then fails every screenshot upload, silently.

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

Create ten tables. For every one of them:

- **Capacity mode: On-demand.** The load is bursty and tiny between matches.
  Provisioned capacity would mean guessing a number and paying for it while
  nobody is playing.
- Leave encryption, TTL and everything else at defaults unless noted.

| Table name | Partition key | Sort key | Notes |
|---|---|---|---|
| `ringmaster-grants` | `license` (String) | — | Maps a Discord account to a game license. **Needs a secondary index — see below.** The game server reads its `scopes` attribute for in-game admin powers; **Ringmaster no longer does** — it has no permission levels. The game box can also **write** this table under the deployed policy (§3), which is what fivem-br-gamemode#305 is about. |
| `ringmaster-bans` | `license` (String) | — | Active and lifted bans. **The key is a qualified identifier, normally a license** — blitz-bot files a `discord:<snowflake>` placeholder for somebody the game has never seen. Ringmaster and blitz-bot write; the game server reads two keys per connect and writes nothing. |
| `ringmaster-audit` | `pk` (String) | `ts` (Number) | Every admin action. **Ringmaster only.** |
| `ringmaster-incidents` | `incidentId` (String) | — | Reports and anticheat escalations. The game appends and updates seven named attributes at match end; both sides read. Verdicts are written only by Ringmaster. |
| `ringmaster-sessions` | `pk` (String) | `sk` (String) | Auth.js writes this. **Needs a secondary index *and* TTL — see below** |
| `ringmaster-telemetry` | `host` (String) | `ts` (Number) | **Add a TTL attribute named `expires`.** Provisioned, and nothing writes it yet — see the note below. |
| `ringmaster-maintenance` | `id` (String) | — | The scheduled maintenance window. **One item, `id = "current"`.** The game reads it for the drain gate. |
| `ringmaster-players` | `license` (String) | — | This console's own player registry: identity, sessions, playtime |
| `ringmaster-player-ids` | `id` (String) | — | Reverse index, identifier → the licenses that presented it. Answers "has this Discord account been here under another license", which a license-keyed table cannot. |
| `ringmaster-handoff` | `discordId` (String) | — | Pause-menu handoff tokens (#23). **Add a TTL attribute named `expires`.** One short-lived row per admin. **Ringmaster only** — the game box needs nothing here; see the note below. |

> **`ringmaster-handoff` is new (2026-08-20) and the console will not create it
> for you.** Without it, the pause-menu handoff answers every mint with a 503
> and every redeem with a bounce to the login page — which is the safe failure,
> but it fails on every attempt and the cause is only visible as a
> `ResourceNotFoundException` in `journalctl -u ringmaster`. Everything else in
> the console is unaffected.
>
> **The TTL attribute is not optional.** These rows are created on every
> pause-menu open that needs one and are normally deleted by being spent, but a
> token that is minted and never redeemed — the admin changed their mind, the
> frame never opened — has nothing to delete it. Without TTL they accumulate
> forever. **The TTL is a janitor and not a security control**: DynamoDB deletes
> expired items *typically* within 48 hours, so `src/lib/handoff.ts` enforces the
> 90-second expiry itself and never trusts the row's presence to mean it is
> live.
>
> **Why it is its own table rather than a corner of `ringmaster-sessions`**,
> which already has TTL on `expires` and would have cost you nothing: if the
> minting is ever moved to the game box, that box needs `PutItem` on wherever
> these rows live — and on `ringmaster-sessions` the same grant would let it
> write an Auth.js session row directly, forging an admin session without a
> token at all. The split is what keeps that grant expressible as something
> safe.

> **Three of the ten were missing from this document until 2026-08-18**, and
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

> **`ringmaster-telemetry` is provisioned, unwritten, and RESERVED — not
> vestigial.** The owner has earmarked it for FXServer telemetry feeding a
> planned server analytics page (2026-08-19). Do not delete it in a cleanup
> pass, and do not repurpose it.
>
> Host CPU/memory/network is a **different** thing and is not stored here: it is
> polled over SSH every 15s (`src/lib/telemetry.ts` via `dispatch.sh`'s
> `do_telemetry`) and held in memory, which the owner has confirmed is fine for
> the Host page — its charts show what this console has observed since it last
> started, by design. Create the table and the TTL anyway; provisioning it later
> is the same work plus a migration. **The game box never writes it**, and never
> did; see the 2026-08-09 note in section 3.

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

Discord tells us *who* is logged in; every ban and audit row keys on the
**license**. Something has to bridge them, and `ringmaster-grants` is keyed by
`license` with `discordId` as a plain attribute — so it cannot answer "which
license is this Discord account?" without an index, and that is the only question
Ringmaster asks of this table.

> **This index is still required, but it no longer gates logging in.** Ringmaster
> has no permission levels: whoever holds the Discord admin role is a full admin,
> and a signed-in account with **no grants row at all** is normal and fully
> privileged. What the lookup buys is *attribution* — the acting admin's license
> on every audit row — and Spectate, which needs a character in the world to put
> the camera behind. Without the index the query throws and `currentAdmin()`
> fails, so it is not optional; but an admin who has simply never joined the game
> server has no row, and that is not an error.

Open `ringmaster-grants` → *Indexes* → *Create index*:

- **Partition key**: `discordId` (String)
- No sort key
- **Index name**: `discordId-index`
- Attribute projections: **All**

> Worth understanding rather than pasting, because it constrains a real
> behaviour: the `discordId` on a grants row is written **by hand when the admin
> is granted**, not discovered automatically. FiveM only reports a `discord:`
> identifier when the connecting player has Discord's activity integration
> enabled on their end, which is opt-in. That is why `scripts/grant.mjs` takes
> `--discord-id` explicitly, and why the first admin's row has to be created
> from the box before anybody can be attributed.

> **ATTRIBUTION NO LONGER DEPENDS ON THIS TABLE ALONE**, and it had to stop
> depending on it. Once the scopes went, an admin could be made an admin purely
> in Discord — nobody runs `grant.mjs` for them — and every audit row they wrote
> was signed `actorLicense: null`: their name unlinked in `/audit`, and their own
> actions missing from their profile. So `currentAdmin()` falls back to
> `ringmaster-player-ids` — the reverse index `/api/ingest` maintains from the
> game's own connect events — and takes the license from there when it is
> unambiguous. The grants row still wins when it exists, and several licenses
> behind one Discord account still resolve to null rather than to a guess. **No
> new IAM grant**: the console already reads and writes that table on ingest.
> See `licenseForDiscordId` in `src/lib/grants.ts`.

### TTL, on the three tables that need it

TTL makes DynamoDB delete expired rows for free, which is how sessions expire,
how telemetry stops growing forever, and how unspent handoff tokens age out.

For `ringmaster-sessions`, `ringmaster-telemetry` and `ringmaster-handoff`: open
the table → *Additional settings* → *Time to Live* → *Enable* → attribute name
**`expires`**.

> Spelling matters — `expires`, lowercase. Auth.js writes that exact attribute,
> and `src/lib/handoff.ts` writes the same one so there is one name to remember
> rather than three. A typo here fails silently: rows simply never expire, and
> you find out months later from the bill.

### The game box needs NO new IAM for the pause-menu handoff

**Worth stating explicitly, because an earlier sketch of #23 needed one and
somebody will come looking for it.** The console mints these tokens itself, in
answer to an authenticated request from the game server over the existing
peered link — the game box never reads or writes `ringmaster-handoff`, so
`FiveMGameServerRole` is unchanged. The broad `ringmaster-*` grant in section 3
already covers this table for read and write, so **there is no statement to add
here and none to look for**. The row stores a **sha256 of the token and never
the token**, and there is no `Scan` in the game's grant and nothing to
enumerate.

**If the minting is ever moved to the game box**, the move is in the code, not
in the IAM. Today that decision is made on the Ringmaster box, where the Discord
role check lives, and moving it is a real change in where authority sits rather
than a refactor.

The Ringmaster box needs nothing new either — `RingmasterTableAccess` in
section 2 already covers `ringmaster-*`.

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

> **`dynamodb:DeleteItem` on `ringmaster-bans` has a caller now, and it is the
> only one.** `bans.reconcileDiscordBan` moves a `discord:`-keyed placeholder ban
> onto the license it turns out to belong to and then deletes the placeholder —
> the owner's ruling, and the one exception to `src/lib/bans.ts`'s first rule
> that a ban is a record rather than a deletion. Nothing is lost: the delete
> happens only after the same ban has been written to the license row, carrying
> its original `at`, issuer, reason and expiry, and it is conditional on the row
> still being the one that was read. **No action was added to this policy** —
> `DeleteItem` was already in it. See the gamemode's `docs/ban-contract.md`.

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
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-*",
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-stats-*"
      ]
    },
    {
      "Sid": "GameOwnsItsData",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/br-*"
      ]
    }
  ]
}
```

**Those two statements are the base, and together they reach every
`ringmaster-*` table and everything under `br-*`.** `GameServerWritesOnly`
grants read and write on all of `ringmaster-*`; `GameOwnsItsData` covers the
game's own tables, `br-players` and `br-matches` included. Neither statement
carries `Query` or `Scan` on `ringmaster-*`, and neither carries `DeleteItem`,
though `BatchWriteItem` can delete rows through `DeleteRequest`.

**The breadth is intentional.** The owner, 2026-09-13: "I wrote the policy
intentionally broad as I'm confident in the integrity and security of the box
we've built, and it future-proofs the IAM so I don't have to mess with it." A
table added later needs no IAM change, which is the point of writing it this way.

**Two consequences, so that nobody reasons from the narrower statements
described below:** `ringmaster-grants`, `ringmaster-bans` and
`ringmaster-incidents` are writable by the game box, and the
`dynamodb:Attributes` condition on `GameServerCloseIncidentTimeline` is
redundant while this grant stands.

**The rest of the deployed role**, beyond those two:

- `GameServerCloseIncidentTimeline`: attribute-scoped `UpdateItem` on
  `ringmaster-incidents`, described below.
- `GameServerWritesMatches`: `PutItem` on `br-matches`.
- `GameServerWritesArtifacts`: `s3:PutObject` on
  `royale-incidents-bucket/incidents/*`. **That one is in §6, not here**, and a
  role built from §1 to §3 alone files incidents correctly and then fails every
  screenshot upload, on the subject's own client, with nothing on screen to say
  so. If you are rebuilding this role, §6 is not optional reading.
- `PublishOnlyIntoOurOwnNamespace`: `cloudwatch:PutMetricData` in the `Blitz`
  namespace.
- `ReadOurOwnInstanceTags`: `ec2:DescribeTags`.
- `WriteTheDiagnosticLogLine`: CloudWatch Logs on `/blitz/metrics`.
- `ReadTheDiscordWebhook`: `ssm:GetParameter` on
  `/blitz/discord/maintenance-webhook`, with `DecryptThatSecureString` for the
  `kms:Decrypt` that SecureString needs.

**`AmazonSSMManagedInstanceCore` is attached as a managed policy**, and a second
inline policy, **`blitz-host-patch`**, carries the maintenance row, the same
webhook parameter and the same KMS decrypt.

The sections below describe the grants the game code actually uses. All of them
are subsumed by the two statements above.

> **Revised 2026-08-09.** Host telemetry is polled by Ringmaster over SSH and
> written by Ringmaster, so `br_ddb` never touches `ringmaster-telemetry`. The
> deployed `ringmaster-*` grant covers that table along with the rest of the
> prefix; this is a fact about the code, not about the policy.

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
same check against a license you care about, and
`brban <license> discord:<id>` — or `brban - discord:<id>` for somebody with no
license at all — is the two-key check the gate now actually performs (#38).

> **⚠ BOTH OF THOSE ARE DEV-ONLY SINCE 2026-09-01, so on a production box they
> print a refusal and do nothing.** The gamemode now wraps `RegisterCommand`
> itself (`br_lib/shared/devgate.lua`, gamemode commit `e8171dd`), so every
> console command in the project — client and server, roughly a hundred and
> thirty of them — is gated behind one switch and a new one is gated by
> construction rather than by anybody remembering. The switch is either
> **`br_devMode true`** or **`sv_devMode true`** in the game box's `server.cfg`,
> and a refused command says exactly that on the server console rather than
> failing silently.
>
> **Three verbs are exempt, by name, and they are the only three**: **`brkick`**,
> **`brspectate`** and **`brring`**. The first two are Ringmaster's Kick and
> Spectate buttons — `tools/dispatch.sh` types them into the FXServer console
> over `tmux send-keys` — and `brring` is the health dump this document sends you
> to after an IAM change. `docs/deploy.md` §7 has the constraint that keeps them
> exempt.
>
> **So the checks in this section are dev-box checks now.** On the live box the
> reading you can still get is `brring`, whose `ddb` line reports `reachable` or
> `FAILED` from `br_ddb`'s last selftest — which is what the game is *telling the
> console*, not a fresh probe, and `br_ddb/server/debug.lua`'s own comment draws
> that distinction. To run `brddb` or `brban` against real credentials, run them
> on a box started with the switch on.

**Why the reads are shaped the way they are.** The statement above is what
`br_ddb` uses, and it is worth understanding rather than pasting:

- **`GetItem` only, on named tables.** Enough to answer "is *this* identifier
  banned?", "what scopes does *this* license hold?" and "are we draining?" —
  each about one specific key the box already has in hand. (A `PutItem` was
  added alongside it on 2026-08-14, a fourth table on 2026-08-17 and an
  attribute-scoped `UpdateItem` on 2026-08-21; all three are the sections
  below.)

  **The connect gate asks that first question twice per connect since #38, and
  this statement did not change.** `ringmaster-bans` is keyed on a *qualified
  identifier*, and blitz-bot files a ban under `discord:<snowflake>` for
  somebody an admin banned in Discord whom the game has never met. The gate now
  looks up the connecting license **and** the `discord:` identifier FiveM
  reported on the same connection — two point lookups on two keys it was handed,
  issued together, on the table it already reads. **No action and no ARN was
  added**, which is the property to check when reviewing this: a verb learned a
  second argument, the policy did not widen. See the gamemode's
  `docs/ban-contract.md`.
- **`br_ddb` never names `ringmaster-audit`.** The audit log is the record of
  what admins did, and nothing on the game side reads or writes it. **That
  separation lives in the code**: the deployed policy reaches that table like
  every other `ringmaster-*` one.
- **No `Query` and no `Scan` anywhere in `br_ddb` — and that is now the load-
  bearing guarantee, not the table list.** Verified by reading
  `js-src/br_ddb/src/index.js`: the only commands it imports from
  `@aws-sdk/client-dynamodb` are `GetItemCommand`, `PutItemCommand`,
  `UpdateItemCommand` and `BatchWriteItemCommand`. `QueryCommand` and
  `ScanCommand` appear nowhere in the resource's source. So a compromised game
  server cannot enumerate who is banned, who the admins are, or which cases are
  open — it can only confirm or deny a key it was already given.

  **Re-verified 2026-08-21, and the import list has grown by one:**
  `PutObjectCommand` from `@aws-sdk/client-s3`, for artifact uploads (§6).
  There is no `ListObjectsV2Command` and no `GetObjectCommand` beside it, so the
  same sentence holds on the bucket: the game box can add a frame and cannot
  enumerate or read one back.

  **Say it that way round on purpose.** The *grant* is far broader than the
  code, so "it can only touch these ARNs" is not a statement this policy makes.
  What the deployed policy does still enforce is the enumeration line: it
  carries no `Query` and no `Scan` on `ringmaster-*`, so nothing on the game box
  can list who is banned, who the admins are or which cases are open. `Query` on
  `br-*` is granted, by `GameOwnsItsData`.
- **`br_ddb` writes nothing that decides authority.** It does not lift a ban and
  does not grant a scope. Those writes are made in the console, where each one
  goes through the Discord role check and lands in the audit log. The deployed
  policy permits them from the game box; the code is what does not make them.
- **No `DeleteItem` anywhere, and nothing on the game side ever needs to destroy
  a row.** `BatchWriteItem` is granted and carries `DeleteRequest`, so the
  absence of the `DeleteItem` verb is not the absence of deletion.

> **Why `ringmaster-grants` is readable here at all**, having previously been
> excluded: admin actions are moving in-game as well as in the console, and the
> game needs a permission source for them. The alternative — a grants cache
> pushed down and invalidated out of band — is a whole subsystem whose failure
> mode is a stale permission, which is worse than a read. The read is narrow:
> one license, no enumeration. The write is available to the game box under the
> deployed policy and is not made by `br_ddb`; see fivem-br-gamemode#305.

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
side, so `br_ddb` adds a case and does not overwrite one. That condition is in
the code, not in the policy. What the policy still withholds is enumeration: no
`Query` and no `Scan` on `ringmaster-*`, so nothing on the game box can list
open cases, who is banned or who the admins are.

> **This section used to end by saying there was "no read of any kind on this
> table", and used to close the verdict question with "Neither is done."** Both
> sentences were true when written and neither is true now. They are named here
> rather than deleted because they were load-bearing: `br_ddb`'s own header
> comment cites them, and anyone who read this file between 2026-08-14 and
> 2026-08-17 came away with the opposite of the current answer.

### The update it gained — closing a match timeline, 2026-08-21

**Added because this file did not have it and the code already needed it.** The
game writes an incident's match timeline at match end, through an `UpdateItem`
in `js-src/br_ddb/src/close.js`. That verb was never documented here, which is
the failure mode this file warns about at the top of the incident section: a
role rebuilt from an older copy would file cases perfectly and then fail every
close, silently, leaving every case reading "end never reported".

```json
{
  "Sid": "GameServerCloseIncidentTimeline",
  "Effect": "Allow",
  "Action": ["dynamodb:UpdateItem"],
  "Resource": ["arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/ringmaster-incidents"],
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:Attributes": [
        "incidentId", "matchEndedAt", "matchStartedAt", "matchEndsBy",
        "matchTimeline", "matchTimelineComplete", "matchKillsSeen"
      ]
    },
    "StringEquals": { "dynamodb:ReturnValues": "NONE" }
  }
}
```

**THE ATTRIBUTE LIST IS WHAT THIS STATEMENT CONTROLS.** On its own it holds the
game box to the fields it actually writes instead of letting it rewrite `state`,
`verdict` or `resolvedBy` on any case whose id it holds, and `ReturnValues:
NONE` stops the same request reading a verdict back out.

**It is redundant as deployed.** `GameServerWritesOnly` allows `UpdateItem` on
every `ringmaster-*` table with no condition attached, and one unconditional
Allow is enough, so a close falling outside this allowlist is permitted by the
broad statement anyway. Two things follow: `close.js` can name an attribute the
allowlist does not, without producing AccessDenied at match end, and
`BR.Ring.incidentStats().closeFailed`, which `brring` prints in the FXServer
console, is no longer a reading on this allowlist.

**The seven names above are the deployed list, and they are the seven `close.js`
writes.** `matchStartedAt` and `matchEndsBy` landed in the code on 2026-08-22
and are in the deployed condition, so a case filed during warmup gains a start
and a deadline when the match ends:

```js
if (startedAt !== null) sets.push('matchStartedAt = :start')
if (endsBy   !== null) sets.push('matchEndsBy = :endsBy')
```

**The timeline offsets do not depend on them.** They used to: the `+2:14`
column was drawn only inside `[matchStartedAt, matchEndedAt ?? matchEndsBy]`, so
a warmup-filed case had no column at all and a backfilled one had a column that
began partway down the list. `matchOffset` counts from `openedAt` and consults
no match attribute now, so the two names buy context rather than a readable
timeline. Both already exist on the incident row: `incident.js` writes them on
the original `PutItem`.

> **This section is late.** The grant was applied by the owner on 2026-08-20 and
> written down here on 2026-08-21. In between, this document said the game box
> had exactly three added statements and that an append on incidents was the only
> write it held — which would have been an accurate description of a role that
> could not close a single case.


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
| `ringmaster-incidents` | `GetItem` + `PutItem` + attribute-scoped `UpdateItem` | file a case, read its verdict, close its match timeline |

**There is no separate statement for this read on the deployed role.** It was
folded into `GameServerWritesOnly`, whose `GetItem` on `ringmaster-*` covers it
along with the rest of the prefix, so do not go looking for a
`GameServerReadIncidentVerdict` in the console. The breadth is the owner's
deliberate choice, in §3.

**The table above is still what `br_ddb` uses**, transcribed from
`js-src/br_ddb/src/index.js`, which names each table exactly once.

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
game box can see the verdicts on cases it filed. The resolve path lives entirely
in the console, and `br_ddb` writes nothing but the timeline attributes; the
deployed policy does not hold it to that.

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

### The game box's two Discord convars are NOT in this document, deliberately

**Named here so nobody comes looking for them under an IAM heading.** Since
2026-08-31 the game box reads two convars of its own — **`br_discord_bot_token`**
and **`br_discord_guild_id`** — which decide whether the in-game Discord card is
hidden from players Discord itself says are already in the guild
(`br_core/server/guild.lua`). With neither set the feature is simply off, and a
token with no guild id, or a guild id with no token, is off as well: there is
deliberately no half-configured state.

They are **not AWS**. They need **no IAM statement, no table and no bucket**, and
nothing in this file changes because of them, which is why the setup steps live
in the game repo's `server.cfg.example` and in Infradocs rather than being copied
here — a second copy of a credential's setup instructions is a second thing to
get out of date. **The token is a real credential**: it belongs in `server.cfg`,
which is gitignored for exactly that reason, and **no value of it goes into any
document, this one included.**

**They are separate from Ringmaster's own `DISCORD_BOT_TOKEN`** (`docs/deploy.md`
§1), which is worth saying because the two may well hold the same string and are
still two settings on two machines. The game asks Discord directly rather than
asking this console — the console may depend on the game and never the reverse.

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

**The bucket exists and is in use.** The operator created it on 2026-08-20 and
configured IAM on both roles; the code landed the same day. **This section used
to say "the code does not use it yet — see #34 (Artifacts)", which was true for
about a day and is quoted here because it is the sentence that makes a reader
skip the section.** Do not skip it: this is the fifth statement on
`FiveMGameServerRole`, and §3 does not contain it.

| | |
|---|---|
| **Bucket** | `royale-incidents-bucket` |
| **Region** | us-east-2 (co-located with the game box, which is the writer) |
| **Public access** | Blocked |
| **Lifecycle** | 180-day expiry — see below |
| **Keys** | `incidents/<incident-uuid>/01..09.webp` |

The name is fixed and may be hard-coded (operator, 2026-08-20). It is not a
secret: the bucket blocks public access, so knowing the name grants nothing
without credentials, and `check-secrets` has no reason to object. It is a single
named constant on each side rather than a literal repeated at each call site —
`ARTIFACT_BUCKET` in `src/lib/artifactStore.ts` — which is the one thing that
would make a future rename expensive.

**Direction of access, which the IAM already reflects:**

- **Game box** (`FiveMGameServerRole`) — `s3:PutObject` only, **scoped to the
  `incidents/` prefix**. It writes evidence and can neither read it back nor
  erase it. `js-src/br_ddb/src/artifacts.js` builds every key from that prefix
  and states this policy as the reason, so a key that does not start there is
  refused by IAM rather than by the resource.

  ```json
  {
    "Sid": "GameServerWritesArtifacts",
    "Effect": "Allow",
    "Action": ["s3:PutObject"],
    "Resource": ["arn:aws:s3:::royale-incidents-bucket/incidents/*"]
  }
  ```

- **Ringmaster** (`RingmasterAppRole`) — `s3:GetObject` only, and **no
  `ListBucket`**.

  ```json
  {
    "Sid": "RingmasterReadArtifact",
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": ["arn:aws:s3:::royale-incidents-bucket/incidents/*"]
  }
  ```

> **The game block is read back off the live role; the Ringmaster block is
> transcribed from what the shipped code assumes.** Read the real role before
> changing either, and if it disagrees with this, *this* is the stale copy.

**Nine keys, and the console finds them by guessing.** Nothing in DynamoDB says
which frames a case has: `br_ddb` does not append a capture key after the fact,
and no code on either side reads one. So the key
format is fixed and enumerable **on purpose**: `incidents/<uuid>/01.webp`
through `09.webp`, three timed frames plus six corroborations. The console
issues nine `HEAD`s and keeps the ones that answer. **That is what buys the
missing `ListBucket`**, and it is why the key format is a contract rather than an
implementation detail: change the padding, the extension or the ceiling on one
side and the other silently finds nothing. `npm run check:artifacts` asserts the
two ceilings against each other.

Images reach the browser through **60-second presigned GETs** issued by the
console, never public reads — the URL is the target of a redirect the browser
follows immediately, so its whole life is one round trip.

> **The frames transit the game box, and the IAM is shaped for that.** The
> capture runs on the subject's own client, which uploads to `screenshot-basic`'s
> HTTP endpoint **on the game server**; the file lands in a spool directory
> there, `br_ddb` `PutObject`s it, and a sweeper deletes the local copy. There is
> no presigned PUT and no path from a game client to this bucket, so nothing
> here needs a credential to reach a player's machine.

**180-day expiry lifecycle rule** (decided 2026-08-20 by the operator, and it
reverses what this section said before — the reversal is deliberate, not drift).

The earlier position, kept here because the reasoning is still true and someone
will hit it: an incident whose evidence has silently evaporated is worse than
useless — you open a report from eighteen months ago during an appeal or a
pattern investigation and half of it is gone, with nothing to say why. The
alternative offered was a storage class rather than a deletion (Glacier Instant
Retrieval at roughly a fifth of the price, everything still readable).

The operator chose expiry anyway. **What that means in practice, so nobody is
surprised by it:**

- **Bans are permanent and verdicts cannot be changed.** An appeal or a pattern
  investigation opened more than 180 days after the incident will find the
  artifacts gone. The verdict, the audit rows and the resolution text survive —
  only the images go.
- The console must therefore never present a missing artifact as meaningful.
  The sentence this was always argued from — *"EMPTY IS NORMAL AND IS NOT
  EVIDENCE OF ANYTHING"* — was the comment on `Incident.captureKeys`. **That
  field has been deleted** (owner, 2026-08-20: "yeah let's not have captureKeys
  if we don't need it"); nothing populates it, because `br_ddb` writes the
  incident row once and then touches only the timeline attributes, none of which
  is a capture key. The
  sentence moved to `src/lib/artifacts.ts`, which is where the console now
  decides what an empty set means. An old case with no frames is an old case,
  not an innocent one.
- **The page does not say which of the four it was**, and does not work it out.
  The owner ruled the distinction unnecessary on 2026-08-20 — "we don't need
  helper text to convey that. it's assumed" — so an aged-out case and a case
  that was never captured render identically, and there is deliberately no age
  arithmetic in the console to tell them apart.
- The upside, and it is real: this is the only thing in the system that
  automatically stops holding pictures of players' screens. Retention that
  expires is easier to defend than retention that does not.

> **A paragraph directly contradicting all of the above stood here until
> 2026-08-21**, and it is named rather than silently dropped because it is the
> half a skimming reader would have taken away. It read: *"Worth knowing what
> this trades away: screenshots of players' screens are then retained
> indefinitely. If a player ever asks for their data to be deleted, that is a
> manual job against this bucket, and there is no automated process that would
> have done it for you."*
>
> That was written to argue **against** a lifecycle rule, and it survived the
> operator choosing one — sitting underneath the decision it was arguing with,
> asserting the exact opposite of the line above it. **The 180-day expiry is the
> live configuration.** Frames age out on their own, and a deletion request
> inside that window is still a manual job.

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
