#!/usr/bin/env node
/**
 * Secret-scanning gate.
 *
 * This repo is PUBLIC, and the whole "public is fine" argument rests on nothing
 * secret ever being in it. That is a promise about every future commit, not
 * just today's, so it gets enforced mechanically rather than remembered.
 *
 * Same reasoning as the gamemode's check-css, which fails the build on a CSS
 * colour function that Chrome 103 cannot render: a dependency bump or a tired
 * evening can introduce the problem with nothing in a typecheck or a test that
 * would notice.
 *
 * Deliberately tuned for FEW FALSE POSITIVES. A gate that cries wolf gets
 * bypassed with --no-verify, and then it protects nothing. Every pattern here
 * matches a specific credential shape, not "a long random-looking string".
 *
 *   node scripts/check-secrets.mjs
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vercel',
])

const SKIP_FILES = new Set([
  'check-secrets.mjs',   // this file describes the patterns it looks for
  'package-lock.json',
  'yarn.lock',
])

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|webm)$/i

/**
 * Placeholders that are supposed to appear in .env.example and docs. Anything
 * matching one of these is a template, not a leak.
 */
const PLACEHOLDER =
  /(REPLACE|CHANGE|YOUR|EXAMPLE|PLACEHOLDER|xxx+|\.\.\.|<[^>]+>|ACCOUNT_ID|\bTODO\b)/i

const RULES = [
  {
    name: 'AWS access key id',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    why: 'Both hosts use EC2 instance roles. There should be no access key at all.',
  },
  {
    name: 'AWS secret access key',
    // Only when it is actually labelled as one -- a bare 40-char string is far
    // too common to flag.
    re: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i,
    why: 'Instance roles, not keys.',
  },
  {
    name: 'private key block',
    re: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
    why: 'The SSH key to the game host lives on the Ringmaster box only.',
  },
  {
    name: 'Discord bot token',
    re: /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}\b/,
    why: 'Discord credentials belong in the environment.',
  },
  {
    name: 'Discord client secret',
    re: /discord_client_secret\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/i,
    why: 'Discord credentials belong in the environment.',
  },
  {
    name: 'auth secret with a value',
    re: /\bAUTH_SECRET\s*[=:]\s*['"]?[A-Za-z0-9/+=_-]{16,}/,
    why: 'Session signing key. Environment only.',
  },
  {
    name: 'rcon password with a value',
    re: /\brcon_password\s+\S+/i,
    why: 'Whoever holds this can run any command on the game server.',
  },
  {
    name: 'ingest secret with a value',
    re: /\bINGEST_SECRET\s*[=:]\s*['"]?[A-Za-z0-9/+=_-]{12,}/,
    why: 'Shared secret for the game server push.',
  },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out)
    } else if (!SKIP_FILES.has(entry) && !BINARY.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * The files git would actually publish: tracked, plus untracked-but-not-ignored.
 *
 * ASKING GIT RATHER THAN WALKING THE DISK IS THE POINT. `.env.local` holds real
 * secrets and is gitignored, so it can never reach the public repo — flagging it
 * would be a false positive on a file git will never see, and false positives
 * are how a gate ends up bypassed with --no-verify. The threat model is "a
 * secret gets committed", and git's own index is the authority on what can be.
 *
 * Falls back to walking the tree if git is unavailable (a tarball, a CI image
 * without git). That direction is deliberate: erring toward scanning too much
 * is a nuisance, erring toward scanning too little is a leak.
 */
function candidates() {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out
      .split('\n')
      .filter(Boolean)
      .map((p) => join(ROOT, p))
      .filter((p) => {
        const name = p.split(sep).pop() ?? ''
        return !SKIP_FILES.has(name) && !BINARY.test(name)
      })
  } catch {
    console.warn('note: git unavailable, scanning the working tree instead')
    return walk(ROOT)
  }
}

let findings = 0
let scanned = 0

for (const file of candidates()) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // unreadable, deleted, or genuinely binary; nothing to scan
  }
  if (text.indexOf(String.fromCharCode(0)) !== -1) continue // binary that slipped past the extension list

  scanned++
  const lines = text.split('\n')

  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!rule.re.test(line)) continue
      if (PLACEHOLDER.test(line)) continue

      const rel = relative(ROOT, file).split(sep).join('/')
      console.error(`\x1b[31mSECRET\x1b[0m ${rel}:${i + 1}  ${rule.name}`)
      console.error(`       ${rule.why}`)
      findings++
    }
  }
}

if (findings > 0) {
  console.error('')
  console.error(`\x1b[31m${findings} possible secret(s) found.\x1b[0m`)
  console.error('This repo is public. Nothing above should ever be committed.')
  console.error('')
  console.error('If it is genuinely a placeholder, make it look like one')
  console.error('(REPLACE_ME, YOUR_..., <angle-brackets>) rather than')
  console.error('weakening a rule.')
  process.exit(1)
}

console.log(`\x1b[32mok\x1b[0m   no secrets found (${scanned} files scanned)`)
