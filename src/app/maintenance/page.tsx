import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/maintenance" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Maintenance windows"
        milestone="M6"
        intent={"Schedule a restart nobody has to be told about twice. At T-30 the server stops accepting queue joins and stops forming new matches; matches already running finish normally. Once the last one ends it deploys from main and restarts. No player is ever disconnected to make a window happen - if the drain overruns it takes a grace period, then abandons and reopens the queue."}
        needs={["A drain flag in br_core - a third gate in BR.Lobby.join, and a maintenance reason from BR.Match.startBlocker, which already returns a reason and already surfaces it to players","dispatch.sh gaining update_check and restart_process, both Slice 4 verbs","The Discord webhook, which is how an abandoned window announces itself","One DynamoDB record per window, so a Ringmaster restart does not forget one is in progress"]}
        blocks={[{"h":26,"label":"Next window - countdown, target commit, current phase"},{"h":34,"label":"Drain progress - matches still running, players left, which match is blocking","cols":2},{"h":22,"label":"Schedule a window - time, target commit, grace period"},{"h":40,"label":"History - completed and abandoned windows"}]}
      />
    </AppShell>
  )
}
