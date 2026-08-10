import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/host" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Host"
        milestone="M3a"
        intent={"CPU, memory and network for the game box, plus whether FXServer is actually running and which commit it is on. Polled over SSH every 15-30 seconds - the game host runs no agent and opens no port for this."}
        needs={["VPC peering and the security group rule allowing SSH from us-west-2 only","An SSH keypair whose authorized_keys entry is pinned to command=\"/opt/royale/dispatch.sh\"","dispatch.sh with its read-only verbs: status and telemetry, and deliberately nothing else in Slice 1"]}
        blocks={[{"h":22,"label":"Process status - running, uptime, current commit, update available"},{"h":40,"label":"CPU / memory / network, last hour","cols":3},{"h":30,"label":"Player count over time, against slot capacity"}]}
      />
    </AppShell>
  )
}
