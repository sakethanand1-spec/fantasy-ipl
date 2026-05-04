import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/layout/Nav'
import { getLeague, getUserTeam } from '@/lib/queries'

export default async function PlayersLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const league = await getLeague()
  const team = league ? await getUserTeam(league.id, user.id) : null

  return (
    <div>
      <Nav managerName={team?.manager_name} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  )
}
