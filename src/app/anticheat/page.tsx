import { AppShell } from '@/components/AppShell'
import { Wireframe } from '@/components/Wireframe'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

export default function Page() {
  return (
    <AppShell active="/anticheat" user={DEMO_USER} badges={DEMO_BADGES}>
      <Wireframe
        title="Anticheat"
        milestone="M5"
        intent={"Every refusalAction firing, searchable, with the player, count, reason breakdown, match and time. This is the whole output surface of the damage validator - the point is being able to see that one player has tripped it in nine separate matches, which no console scrollback will ever tell you."}
        needs={["The event channel delivering refusal events through BR.Outbox","Durable storage - in-memory is fine for a live list and useless for \"nine matches ago\"","The second escalation tier, which is what turns repeated firings into one incident"]}
        blocks={[{"h":20,"label":"Firings per hour, by reason"},{"h":16,"label":"Filters - reason, player, match, window"},{"h":60,"label":"Firing log - player, count, reasons, match, time"}]}
      />
    </AppShell>
  )
}
