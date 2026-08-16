import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { AuditList } from '@/components/AuditList'
import { ModerationLog, type KickRow } from '@/components/ModerationLog'
import { PrefsProvider } from '@/components/PrefsProvider'
import type { AuditRow } from '@/lib/audit'
import { DEMO_USER } from '@/lib/demo'
import type { Prefs } from '@/lib/prefs'

/**
 * The audit log and the kick log, from fixtures. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS: both surfaces render one of three stored outcomes — `ok`,
 * `pending`, `failed` — and only one of the three is now allowed to say
 * anything (#19). Producing the other two for real means making a kick fail
 * against a live game host, or catching the second between dispatch and the
 * outcome event landing. Neither is something anybody will do to check a label,
 * so the states were unreviewable and the wrong one shipped: "unacknowledged",
 * on rows that had almost certainly succeeded.
 *
 * WHAT TO LOOK FOR. Exactly one row in each list says anything about its
 * outcome, and the word is `failed`, in red. No "ok". No "pending". No
 * "unacknowledged". The pending rows are still listed — they are still in the
 * record and still shown — they simply carry no label.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewAuditPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}

const NOW = Date.now()

const PREFS: Prefs = {
  theme: 'system',
  timeZone: 'UTC',
  timeZoneIsSet: false,
  themeIsSet: false,
  locale: 'en-GB',
  shouldPrompt: false,
}

/** One row per stored outcome, so all three are on screen at once. */
const AUDIT_ROWS: AuditRow[] = [
  {
    pk: 'AUDIT',
    ts: NOW - 2 * 60_000,
    commandId: 'cmd-failed',
    action: 'player.kick',
    outcome: 'failed',
    actorLicense: 'license:110000100000001',
    actorName: 'Will',
    actorDiscordId: null,
    targetLicense: 'license:110000100000002',
    targetName: 'Bramble_',
    reason: 'shooting through walls',
    error: 'ssh: connect to host game-host port 22: Connection timed out',
  },
  {
    pk: 'AUDIT',
    ts: NOW - 9 * 60_000,
    commandId: 'cmd-pending',
    action: 'player.kick',
    outcome: 'pending',
    actorLicense: 'license:110000100000001',
    actorName: 'Will',
    actorDiscordId: null,
    targetLicense: 'license:110000100000003',
    targetName: 'nightjar',
    reason: 'abusive in voice chat',
  },
  {
    pk: 'AUDIT',
    ts: NOW - 26 * 60_000,
    commandId: 'cmd-ok',
    action: 'ban.issue',
    outcome: 'ok',
    actorLicense: 'license:110000100000001',
    actorName: 'Will',
    actorDiscordId: null,
    targetLicense: 'license:110000100000004',
    targetName: 'Vandal',
    reason: 'aimbot, third report this week',
  },
  {
    pk: 'AUDIT',
    ts: NOW - 3 * 60 * 60_000,
    commandId: 'cmd-maint',
    action: 'maintenance.deploy',
    outcome: 'ok',
    actorLicense: null,
    actorName: 'system',
    actorDiscordId: null,
    reason: 'a server update',
  },
]

const KICKS: KickRow[] = [
  {
    ts: NOW - 2 * 60_000,
    actorName: 'Will',
    actorLicense: 'license:110000100000001',
    targetName: 'Bramble_',
    targetLicense: 'license:110000100000002',
    reason: 'shooting through walls',
    outcome: 'failed',
  },
  {
    ts: NOW - 9 * 60_000,
    actorName: 'Will',
    actorLicense: 'license:110000100000001',
    targetName: 'nightjar',
    targetLicense: 'license:110000100000003',
    reason: 'abusive in voice chat',
    outcome: 'pending',
  },
  {
    ts: NOW - 41 * 60_000,
    actorName: 'Xeon',
    actorLicense: 'license:110000100000009',
    targetName: 'kettle',
    targetLicense: 'license:110000100000005',
    reason: 'spawn camping the lobby',
    outcome: 'ok',
  },
]

function Preview() {
  return (
    <AppShell active="/audit" user={DEMO_USER}>
      {/* The log formats its own timestamps through the reader's stated zone,
          so it needs the provider the real layout supplies. */}
      <PrefsProvider value={PREFS}>
        <div className="mx-auto max-w-5xl space-y-8">
          <div>
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">
                Audit log
              </h1>
              <p className="text-sm text-muted-foreground">
                Every action any admin took. Anything marked{' '}
                <span className="text-danger">failed</span> did not happen.
              </p>
            </div>
            <AuditList rows={AUDIT_ROWS} prefs={PREFS} />
          </div>

          <div>
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">
                Kick &amp; ban
              </h1>
              <p className="text-sm text-muted-foreground">
                The same three outcomes, on the moderation log.
              </p>
            </div>
            <ModerationLog kicks={KICKS} bans={[]} canBan={false} />
          </div>

          <p className="border-t border-border pt-4 text-xs text-muted-foreground/60">
            Design harness — fixtures only, nothing is read from DynamoDB. Four
            audit rows and three kicks, covering{' '}
            <code className="font-mono">failed</code>,{' '}
            <code className="font-mono">pending</code> and{' '}
            <code className="font-mono">ok</code>. Exactly one of each list
            should carry a word, and that word should be{' '}
            <span className="text-danger">failed</span>. Not reachable in
            production.
          </p>
        </div>
      </PrefsProvider>
    </AppShell>
  )
}
