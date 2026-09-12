import { notFound, redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { MatchView } from '@/components/MatchView'
import { matchLedgerFor } from '@/lib/matchLedger'
import { matchFromTag } from '@/lib/matchTag'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

/**
 * One match (#51).
 *
 * ═══ KEYED ON THE HEX TAG, NOT THE DECIMAL ID ═══
 *
 * The URL segment is the same five characters the game server prints into its
 * own console, so a match id copied out of a server log pastes straight into the
 * address bar and a URL pasted into Discord reads as the thing people are talking
 * about. A decimal route would have reintroduced the two-names-for-one-match
 * problem in the single place an id gets copied most. `matchFromTag` parses it as
 * base 16 and strictly — see `lib/matchTag`, and note that a digits-only tag like
 * `0019c` is hex, which is exactly the case a lenient parse gets silently wrong.
 *
 * NOT IN THE SIDE NAVBAR, per #51 in as many words: "This page does not need to
 * be in the side navbar." `AppShell`'s `active` is therefore the live board,
 * which is where the reader most likely came from.
 *
 * ═══ THE THREE WAYS THIS PAGE HAS NOTHING TO SHOW, AND THEY ARE DIFFERENT ═══
 *
 * 1. THE TAG IS NOT A TAG — a typo, a truncated paste. 404, before any read.
 *
 * 2. THE MATCH IS RUNNING RIGHT NOW, so no rows exist yet: `br_stats` writes one
 *    history row per participant when a match ENDS, which means for the whole
 *    duration of a live match this page has nothing and the LIVE BOARD has
 *    everything — the full roster, grouped by squad, updating every two seconds.
 *    So the reader is sent there rather than shown an empty page about a match
 *    that is being played. This matters because #51 puts a link to here ON the
 *    live players page, so a mid-match click is the common case and not an edge
 *    one. It is a redirect rather than a copy of `MatchCard` because two
 *    renderings of a live match is how two pages start disagreeing about one.
 *
 * 3. NO ROWS AND NOT RUNNING — a match from before #153, when nothing was
 *    recorded per player, or a tag for a match that never existed. 404, which is
 *    the truthful answer: this console has no such match.
 *
 * AND A FOURTH THAT IS NOT AN ABSENCE: the read FAILED. See `lib/matchLedger` —
 * the likeliest cause is `dynamodb:Scan` on `br-players` not being granted, which
 * `docs/aws-setup.md` flags as an open decision. That must not 404: a 404 says
 * "no such match", and answering it for a console that cannot read its own tables
 * is how a broken permission gets mistaken for a missing match. It throws, the
 * cause is already in the log, and `journalctl -u ringmaster` is where
 * `aws-setup.md` says to look.
 */
export default async function MatchPage({
  params,
}: {
  params: Promise<{ tag: string }>
}) {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const { tag: raw } = await params
  const id = matchFromTag(decodeURIComponent(raw))
  if (id === null) notFound()

  const now = Date.now()
  const view = liveView(now)

  const lookup = await matchLedgerFor(id)

  if (lookup.status === 'unreadable') {
    throw new Error(
      `match ${raw} could not be read from br-players. This is a read failure, ` +
        `not a missing match — see lib/matchLedger and the IAM flag in ` +
        `docs/aws-setup.md section 2.`,
    )
  }

  if (lookup.status === 'none') {
    // Case 2 above: it is being played right now, and the live board has it.
    if (view.matches.some((m) => m.id === id)) redirect('/')
    notFound()
  }

  return (
    <AppShell
      active="/"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      feed={{
        lastPushAt: view.lastPushAt,
        bootEpoch: view.bootEpoch,
        now,
        live: true,
      }}
    >
      <MatchView ledger={lookup.ledger} />
    </AppShell>
  )
}
