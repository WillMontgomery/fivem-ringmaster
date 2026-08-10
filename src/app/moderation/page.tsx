import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/moderation" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Kick & ban"
        milestone="M4"
        intent={"Issue, lift and expire bans, with the reason and the admin recorded on both. Never a raw delete: a lifted ban stays a lifted ban, and knowing who lifted it is the point."}
        needs={["The command channel - SSH forced-command to a supervisor owning FXServer stdin","A playerConnecting + deferrals gate, the first in the gamemode, with its own timeout and failing open","br_ddb, so the game host can answer \"is this license banned\" from DynamoDB","Two-phase audit logging: intent written before dispatch, outcome after"]}
        blocks={[{"h":18,"label":"Find a player - by name, license, or recent session"},{"h":34,"label":"Action panel - kick / ban / lift, reason, duration","cols":2},{"h":44,"label":"Active bans"}]}
      />
    </AppShell>
  )
}
