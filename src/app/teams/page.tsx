// src/app/teams/page.tsx
import { getLeague, getTeams } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 60

export default async function TeamsPage() {
  const league = await getLeague()
  if (!league) return <div className="text-navy-400">League not found.</div>

  const teams = await getTeams(league.id)
  const supabase = createClient()

  // Get total points per team
  const { data: standings } = await supabase.from('team_points').select('team_id, total_points').eq('league_id', league.id)
  const ptsByTeam: Record<string, number> = {}
  for (const row of (standings || [])) ptsByTeam[row.team_id] = row.total_points

  // Get squad sizes
  const { data: squadCounts } = await supabase.from('squads').select('team_id').in('team_id', teams.map((t: any) => t.id)).is('effective_to_week', null)
  const countByTeam: Record<string, number> = {}
  for (const row of (squadCounts || [])) countByTeam[row.team_id] = (countByTeam[row.team_id] || 0) + 1

  return (
    <div>
      <div className="page-title">Teams</div>
      <div className="page-subtitle">ALL 8 SQUADS · CLICK TO VIEW DETAILS</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {teams.map((team: any) => (
          <Link key={team.id} href={`/teams/${team.id}`}>
            <div className="card border-t-4 border-t-navy-800 p-5 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
              <div className="text-navy-400 text-xs font-condensed uppercase tracking-wider mb-1">{team.manager_name}</div>
              <div className="font-condensed font-extrabold text-lg text-navy-950 mb-3 leading-tight">{team.name}</div>
              <div className="font-display font-bold text-3xl text-navy-800">{(ptsByTeam[team.id] || 0).toFixed(1)}</div>
              <div className="text-navy-400 text-xs mt-0.5">TOTAL POINTS</div>
              <div className="text-navy-300 text-xs mt-2">{countByTeam[team.id] || 0} players</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
