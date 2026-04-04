// src/app/standings/page.tsx
import { getLeague, getStandings, getMatches } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 30 // revalidate every 30 seconds

export default async function StandingsPage() {
  const league = await getLeague()
  if (!league) return <div className="text-navy-400">League not found.</div>

  const standings = await getStandings(league.id)

  // Get week points — weeks 1-3 shown in table
  const supabase = createClient()
  const { data: weekData } = await supabase.rpc('get_week_standings', { p_league_id: league.id })

  return (
    <div>
      <div className="page-title">Standings</div>
      <div className="page-subtitle">FANTASY IPL 2026 · SEASON LEADERBOARD</div>

      <div className="card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3 text-left w-10">#</th>
              <th className="px-4 py-3 text-left">Team</th>
              <th className="px-4 py-3 text-right">Total Pts</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Wk 1</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Wk 2</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Wk 3</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row: any, i: number) => {
              const rankColors = ['bg-navy-800 text-white', 'bg-gray-400 text-white', 'bg-amber-600 text-white', 'bg-navy-100 text-navy-500']
              const rankClass = rankColors[Math.min(i, 3)]
              return (
                <tr key={row.team_id} className="hover:bg-navy-50 transition-colors cursor-pointer">
                  <td className="table-cell">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold font-condensed ${rankClass}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="table-cell">
                    <Link href={`/teams/${row.team_id}`}>
                      <div className="font-condensed font-bold text-base text-navy-950 hover:text-navy-700">
                        {row.team_name}
                      </div>
                      <div className="text-navy-400 text-xs">{row.manager_name}</div>
                    </Link>
                  </td>
                  <td className="table-cell text-right font-display font-bold text-lg text-navy-800">
                    {(+row.total_points).toFixed(1)}
                  </td>
                  <td className="table-cell text-right text-navy-500 text-sm hidden sm:table-cell">—</td>
                  <td className="table-cell text-right text-navy-500 text-sm hidden sm:table-cell">—</td>
                  <td className="table-cell text-right text-navy-500 text-sm hidden sm:table-cell">—</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
