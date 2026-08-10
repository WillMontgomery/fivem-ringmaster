import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/incidents" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Incidents"
        milestone="M5"
        intent={"One record shape, two triggers: the anticheat escalating on repeated refusals, and a player pressing Report in game. Both open the same evidence bundle - recent refusals, inventory and position history, and a screenshot from the reported player own client."}
        needs={["The event channel, for both triggers","S3 and presigned upload URLs - screenshot-basic uploads from the client NUI browser directly, so the image never transits either server","The in-game Report button and its rate limit, where a refused-for-rate report is still recorded because spamming reports is itself a signal"]}
        blocks={[{"h":16,"label":"Queue filters - open / reviewed / actioned / dismissed"},{"h":30,"label":"Incident list"},{"h":52,"label":"Detail - evidence bundle, screenshot, refusal history, actions","cols":2}]}
      />
    </AppShell>
  )
}
