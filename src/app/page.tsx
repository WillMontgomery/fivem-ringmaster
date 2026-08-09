import { auth } from '@/auth'

/**
 * M0 placeholder. The real dashboard arrives in M2 ("Observe"), once there is
 * a live player list to show. Until then this exists to prove the stack boots
 * and that auth resolves.
 */
export default async function Home() {
  const session = await auth()

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Ringmaster</h1>
      <p className="mt-2 text-slate-400">
        Admin console for FiveM Royale.
      </p>

      <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-sm text-slate-400">
          {session?.user
            ? `Signed in as ${session.user.name ?? session.user.id}`
            : 'Not signed in.'}
        </p>
      </div>

      <p className="mt-8 text-xs text-slate-500">
        M0 — foundations. Views land from M2 onward.
      </p>
    </main>
  )
}
