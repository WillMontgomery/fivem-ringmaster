import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/config" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Live config"
        milestone="M6"
        intent={"Change tuning values without a restart, limited to the ones genuinely safe to change live. The split is enforced in code rather than documented and hoped for: a field is hot-reloadable or it is not, and the UI must not offer the ones that are not."}
        needs={["An explicit hot-reloadable allowlist on the game side","The command channel, to carry the change","Audit logging - a config edit is an admin action like any other"]}
        blocks={[{"h":18,"label":"Search settings"},{"h":46,"label":"Combat - the first candidates; /brdamage already proves these flip live"},{"h":34,"label":"Read-only values, shown greyed with why they need a restart"}]}
      />
    </AppShell>
  )
}
