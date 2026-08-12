import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/process" badges={DEMO_BADGES}>
      <Wireframe
        title="Process control"
        milestone="M6"
        intent={"Stop and restart the FXServer OS process. The single most dangerous thing in this console - a bad config edit degrades a match, this ends one for everyone on the box - which is why it is last, behind an audit log, and behind its own grant scope."}
        needs={["A supervisor owning FXServer stdin, which also makes stop and restart honest rather than a kill and a relaunch","Single-flight locking, so a double-click or a retry cannot bounce the server twice","The process grant, kept separate from config precisely because of the blast radius"]}
        blocks={[{"h":24,"label":"Current process - pid, uptime, commit, players online right now"},{"h":30,"label":"Actions - restart, stop, deploy from main, each confirming what it will interrupt"},{"h":40,"label":"Recent process events"}]}
      />
    </AppShell>
  )
}
