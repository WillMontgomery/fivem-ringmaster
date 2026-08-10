import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/audit" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Audit log"
        milestone="M4"
        intent={"Every action any admin took, including the ones that failed. Written in two phases - intent before dispatch, outcome after - so an action that crashes mid-flight still leaves a trace of who tried what."}
        needs={["Any write path at all to record; Slice 1 has none by design","A command id minted here and echoed back by br_ringmaster, so the two halves of a record can be joined","An unacknowledged state for intents whose outcome never arrives - which is exactly what a crashed FXServer produces"]}
        blocks={[{"h":16,"label":"Filters - admin, action, target, outcome, date"},{"h":70,"label":"Log - time, admin, action, target, outcome, correlation id"}]}
      />
    </AppShell>
  )
}
