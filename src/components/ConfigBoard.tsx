import { AlertTriangle, GitBranch, Info } from 'lucide-react'
import Link from 'next/link'

import { LocalTime } from '@/components/LocalTime'
import { Card } from '@/components/ui/card'
import { isParkedOffMain, type HostConfig, type HostConvar } from '@/lib/ssh'

/**
 * Live config — a DEV-BRANCH surface, not an everyday one (#20), now showing
 * what the server is actually configured with (#21).
 *
 * A COMPONENT OVER PLAIN DATA, deliberately, and for the same reason
 * `MaintenancePanel` takes `initialDeployedRef`: it never asks the host
 * anything, so the same tree renders from a live SSH read and from a fixture.
 * Every shape here needs a real game box in a particular state to produce — one
 * parked on a branch, one stale, one with no Lua interpreter — which is exactly
 * the kind of thing that ships broken. `/preview/config` renders all of them
 * without a game host.
 *
 * WHY IT IS GATED ON THE BRANCH AT ALL. This is a page for a box you are
 * testing on. The nav entry is absent on a server running main, and this says
 * why rather than 404ing — somebody following an old bookmark should learn the
 * rule, not conclude the console is broken.
 *
 * `isParkedOffMain` RATHER THAN `!isOnMain`: a dispatcher too old to report its
 * ref answers neither question, and folding that silence in with "off main"
 * would show a dev-only page on every host the console has not reached. Wrong
 * direction for something a human reads. See both functions in `lib/ssh.ts`.
 *
 * ===========================================================================
 * NOTHING ON THIS SIDE FILTERS ANYTHING, AND IT MUST NOT START.
 * ===========================================================================
 *
 * The protection against leaking `sv_licenseKey` onto this page is the
 * allowlist of convar NAMES in the game repo's `tools/dispatch.sh`, checked by
 * its `verify.sh`. By the time a value reaches this component it has already
 * crossed the network and been written to an audit log, so a filter here would
 * be theatre — it would hide the evidence of a leak that had already happened
 * while looking like it prevented one. If something is not safe to show, it
 * must not be safe to SEND, and the fix belongs in the game repo.
 */
export function ConfigBoard({
  /** What the host says it is running. `null` is a host that has not answered. */
  deployedRef,
  /** The report, or null when there is none — see `error`. */
  report = null,
  /** Why there is no report. Rendered verbatim; it is written for an operator. */
  error = null,
}: {
  deployedRef: string | null
  report?: HostConfig | null
  error?: string | null
}) {
  if (!isParkedOffMain({ deployedRef: deployedRef ?? undefined })) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Live config</h1>
        <Card className="surface-edge mt-4 gap-0 px-5 py-6">
          <div className="flex items-start gap-3">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-sm">
                This page only opens when the game server is parked on a branch
                other than{' '}
                <code className="font-mono text-muted-foreground">main</code>.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {deployedRef
                  ? `The server is running ${deployedRef}.`
                  : 'The game host has not said which branch it is running — the SSH channel may be unconfigured or unreachable.'}{' '}
                Reading the live configuration is a thing you do to a box you
                are testing on, so it is not offered here.
              </p>
              <p className="text-sm text-muted-foreground">
                Park the server on a branch from the{' '}
                <Link
                  href="/maintenance"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Maintenance page
                </Link>
                , and this page comes back on its own.
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Live config</h1>
        <p className="text-sm text-muted-foreground">
          What the game server is actually configured with, read from the box
          running <code className="font-mono">{deployedRef}</code>. Read-only —
          nothing on this page changes anything.
        </p>
      </div>

      {error ? <ErrorCard error={error} /> : null}
      {report ? <Report report={report} /> : null}
    </div>
  )
}

function ErrorCard({ error }: { error: string }) {
  return (
    <Card className="surface-edge gap-0 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="space-y-1">
          <p className="text-sm">The game host did not answer.</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {error}
          </p>
        </div>
      </div>
    </Card>
  )
}

/** A caption. The console's one small-label style; see the note in #21. */
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function Report({ report }: { report: HostConfig }) {
  /**
   * Voice split out from the rest, PURELY PRESENTATIONALLY — the prefix is read
   * here, not sent by the host, and no value is dropped by either bucket.
   *
   * It earns the split because of what it is for. #150 cost a round to an
   * assumption about `voice_useNativeAudio`, and the answer that would have
   * settled it in seconds — none of these are set on this box — only reads that
   * way when the five of them are together and every row says "default".
   */
  const voice = report.convars.filter((c) => c.name.startsWith('voice_'))
  const server = report.convars.filter((c) => !c.name.startsWith('voice_'))

  /**
   * The host already grouped the gamemode values and named the file each came
   * from, so this preserves ITS order rather than sorting. The order is the
   * order somebody chose in `tools/config_report.lua` — match, then storm, then
   * loot, then payouts — which is roughly how you would explain the gamemode.
   * Sorting alphabetically would scatter that for no gain.
   */
  const groups: { name: string; file: string; rows: HostConfig['game']['values'] }[] = []
  for (const v of report.game.values) {
    const last = groups[groups.length - 1]
    if (last && last.name === v.group) last.rows.push(v)
    else groups.push({ name: v.group, file: v.file, rows: [v] })
  }

  return (
    <div className="space-y-5">
      {report.staleSinceStart ? <StaleCard report={report} /> : null}

      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            This is a fixed list of settings chosen in the game repo, not
            everything the server has. Passwords, licence keys and the ingest
            secret are never asked for and cannot appear here — the game host
            answers with named values only, so a new secret in{' '}
            <code className="font-mono">server.cfg</code> stays invisible to
            this page unless somebody adds its name on purpose.
          </p>
        </div>
      </Card>

      {/* ---- engine convars ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Engine settings
          </h2>
          <p className="text-sm text-muted-foreground">
            FXServer&rsquo;s own settings. &ldquo;
            <span className="font-mono">server.cfg</span>&rdquo; means the line
            number given is where it is set; &ldquo;default&rdquo; means it
            appears nowhere in{' '}
            <code className="font-mono">server.cfg</code>, so FXServer&rsquo;s
            built-in value is in effect.
          </p>
        </div>

        <Card className="surface-edge gap-0 overflow-hidden py-0">
          <ConvarGroup title="Voice" rows={voice} />
          <ConvarGroup title="Server" rows={server} border />
        </Card>
      </section>

      {/* ---- gamemode config ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Gamemode tuning
          </h2>
          <p className="text-sm text-muted-foreground">
            The numbers being tuned in playtests, read from the config files the
            running server was built from. Each group names the file it came
            from, so a value you want to change has an address.
          </p>
        </div>

        {report.game.ok ? null : (
          <Card className="surface-edge gap-0 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="space-y-1">
                <p className="text-sm">
                  The game host could not read the gamemode config.
                </p>
                {report.game.loadErrors.map((e) => (
                  <p
                    key={e}
                    className="font-mono text-xs leading-relaxed break-all text-muted-foreground"
                  >
                    {e}
                  </p>
                ))}
              </div>
            </div>
          </Card>
        )}

        {groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map((g) => (
              <Card key={g.name} className="surface-edge gap-0 overflow-hidden py-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3">
                  <Caption>{g.name}</Caption>
                  <code className="font-mono text-xs text-muted-foreground/70">
                    {g.file}
                  </code>
                </div>
                <dl className="divide-y divide-border/60">
                  {g.rows.map((r) => (
                    <div
                      key={r.key}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-2"
                    >
                      <dt className="w-56 shrink-0 font-mono text-sm">
                        {r.key}
                      </dt>
                      <dd className="min-w-0 flex-1 text-sm text-muted-foreground">
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        ) : null}
      </section>

      <Provenance report={report} />
    </div>
  )
}

function ConvarGroup({
  title,
  rows,
  border,
}: {
  title: string
  rows: HostConvar[]
  border?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <div className={border ? 'border-t border-border' : undefined}>
      <div className="border-b border-border px-5 py-3">
        <Caption>{title}</Caption>
      </div>
      <dl className="divide-y divide-border/60">
        {rows.map((c) => (
          <div
            key={c.name}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-2"
          >
            <dt className="w-64 shrink-0 font-mono text-sm">{c.name}</dt>
            <dd className="min-w-0 flex-1 font-mono text-sm">
              {/*
                UNSET IS RENDERED AS WORDS, NOT AS AN EMPTY CELL. A blank here
                reads as "the console failed to fetch this", which is the
                opposite of the truth — "nobody has set it" is a definite and
                useful answer, and it is the answer this page exists to give
                about the voice convars.
              */}
              {c.value === null ? (
                <span className="text-muted-foreground/70 italic">not set</span>
              ) : c.value === '' ? (
                <span className="text-muted-foreground/70 italic">
                  set to an empty value
                </span>
              ) : (
                c.value
              )}
            </dd>
            <dd className="shrink-0 text-xs text-muted-foreground">
              {c.source === 'server.cfg' ? (
                <>
                  server.cfg<span className="text-muted-foreground/60">
                    {' '}line {c.line}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/70">engine default</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The one warning this page owes the reader.
 *
 * The report describes the FILES. If they have been edited since FXServer read
 * them, the running server is on older values and every number below is a
 * statement about the next restart rather than about the current match. That is
 * the only way this page can actively mislead, so it is said at the top, in
 * words, rather than left to be inferred from two timestamps.
 */
function StaleCard({ report }: { report: HostConfig }) {
  return (
    <Card className="surface-edge gap-0 border-warn/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="space-y-1">
          <p className="text-sm">
            The running server has not read these values yet.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A config file changed at{' '}
            <LocalTime ms={report.configMtime} />, after FXServer started at{' '}
            <LocalTime ms={report.startedAt} />. What is below is what the
            server would load if it restarted now — the match in progress is
            still running the older numbers.
          </p>
        </div>
      </div>
    </Card>
  )
}

function Provenance({ report }: { report: HostConfig }) {
  return (
    <div className="space-y-1 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        Read from the game host at <LocalTime ms={report.at} />
        {report.startedAt > 0 ? (
          <>
            {' '}
            &middot; FXServer started <LocalTime ms={report.startedAt} />
          </>
        ) : (
          ' · FXServer is not running'
        )}
        .
      </p>
      <p className="font-mono text-xs break-all text-muted-foreground/60">
        {report.serverCfg}
      </p>
      <p className="font-mono text-xs break-all text-muted-foreground/60">
        {report.libDir}
      </p>
    </div>
  )
}
