#!/usr/bin/env node
/**
 * Bootstrap or edit an admin's grants, from the box, using the instance role.
 *
 *   node scripts/grant.mjs --license license:abc123 --discord-id 9988... --scopes view,kick
 *   node scripts/grant.mjs --license license:abc123 --show
 *
 * THIS SCRIPT EXISTS BECAUSE OF A CHICKEN-AND-EGG: the admin-management view
 * is `grant`-scoped, so the FIRST grants row cannot be created through the UI
 * — there is no admin to click the button yet. It runs where the credentials
 * already are (the EC2 instance role; nothing credential-shaped is ever on a
 * dev machine) and writes the same shape the app reads.
 *
 * --discord-id is REQUIRED on create, not optional. The game side discovers
 * Discord ids only for players who connect with Discord integration enabled,
 * which is opt-in on the player's side — so the first admin's mapping is
 * entered by hand or nobody can ever log in. Right-click yourself in Discord →
 * Copy User ID (Developer Mode on).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb'

// Keep in step with src/lib/grants.ts — this file cannot import TypeScript.
const SCOPES = [
  'view', 'kick', 'ban', 'moderate', 'spectate',
  'notify', 'config', 'grant', 'process',
]

// .env.local, for the table prefix and region. A ten-line parser rather than a
// dependency: quotes trimmed, comments and blanks skipped, existing env wins.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*("?)(.*)\2\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[3]
  }
} catch {
  /* no .env.local — fine if AWS_REGION/DDB_TABLE_PREFIX are already set */
}

const REGION = process.env.AWS_REGION ?? 'us-east-2'
const TABLE = `${process.env.DDB_TABLE_PREFIX ?? 'ringmaster-'}grants`

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`)
  console.error(`usage:
  node scripts/grant.mjs --license <license:...> --discord-id <id> --scopes <a,b,c> [--note "..."]
  node scripts/grant.mjs --license <license:...> --show

scopes: ${SCOPES.join(', ')}`)
  process.exit(2)
}

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--show') args.show = true
  else if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
  else usage(`unexpected argument: ${a}`)
}

const license = args.license
if (!license) usage('--license is required')
if (!license.startsWith('license:'))
  usage(`licenses are stored QUALIFIED — expected "license:...", got "${license}".
The game keys br_players the same way; an unqualified value here would create
a row nothing else can find.`)

const ddb = DynamoDBDocument.from(new DynamoDBClient({ region: REGION }))

if (args.show) {
  const res = await ddb.get({ TableName: TABLE, Key: { license } })
  console.log(res.Item ? JSON.stringify(res.Item, null, 2) : '(no grants row)')
  process.exit(0)
}

const discordId = args['discord-id']
if (!discordId) usage('--discord-id is required (see the header for why)')
if (!/^\d{15,21}$/.test(discordId))
  usage(`"${discordId}" does not look like a Discord id (a 17-19 digit number)`)

const scopes = (args.scopes ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (scopes.length === 0) usage('--scopes is required, comma-separated')
const unknown = scopes.filter((s) => !SCOPES.includes(s))
if (unknown.length) usage(`unknown scope(s): ${unknown.join(', ')}`)

const existing = await ddb.get({ TableName: TABLE, Key: { license } })
if (existing.Item) {
  console.log('replacing existing row:')
  console.log(JSON.stringify(existing.Item, null, 2))
}

const row = {
  license,
  discordId,
  scopes,
  note: args.note ?? 'bootstrapped via scripts/grant.mjs',
  grantedBy: 'grant.mjs',
  grantedAt: Date.now(),
}

await ddb.put({ TableName: TABLE, Item: row })
console.log(`wrote to ${TABLE} (${REGION}):`)
console.log(JSON.stringify(row, null, 2))
console.log('\nSign out and back in to see it — grants resolve at page load.')
