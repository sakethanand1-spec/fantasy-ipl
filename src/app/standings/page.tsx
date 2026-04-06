// src/app/standings/page.tsx
import { getLeague, getStandings } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 30

const SHOW_WEEKS = [1, 2, 3, 4, 5]

export default async function StandingsPage() {
  const league = await getLeague()
  if (!league) return <div className="text-navy-400">League not found.</div>

  const supabase = createClient()
  const standings = await getStandings(league.id)
  const teams = standings.map((r: any) => r.team_id)

  // Get all scored match IDs grouped by week
  const { data: matches } = await supabase
    .from('matches')
    .select('id, week')
    .eq('league_id', league.id)
    .eq('scored', true)

  const matchesByWeek: Record<number, string[]> = {}
  for (const m of (matches || [])) {
    if (!matchesByWeek[m.week]) matchesByWeek[m.week] = []
    matchesByWeek[m.week].push(m.id)
  }

  // Get all points for scored matches
  const { data: allPoints } = await supabase
    .from('player_points')
    .select('player_id, match_id, total')
    .in('match_id', (matches || []).map((m: any) => m.id))

  // Calculate week points per team
  const weekPtsPerTeam: Record<string, Record<number, number>> = {}

  for (const teamId of teams) {
    weekPtsPerTeam[teamId] = {}
    for (const week of SHOW_WEEKS) {
      const weekMatchIds = matchesByWeek[week] || []
      if (!weekMatchIds.length) { weekPtsPerTeam[teamId][week] = 0; continue }

      const { data: squad } = await supabase
        .from('squads')
        .select('player_id')
        .eq('team_id', teamId)
        .lte('effective_from_week', week)
        .or(`effective_to_week.is.null,effective_to_week.gte.${week}`)

      const playerIds = new Set((squad || []).map((s: any) => s.player_id))
      const ptsByPlayer: Record<string, number> = {}
      for (const p of (allPoints || [])) {
        if (playerIds.has(p.player_id) && weekMatchIds.includes(p.match_id)) {
          ptsByPlayer[p.player_id] = (ptsByPlayer[p.player_id] || 0) + p.total
        }
      }
      const sorted = Object.values(ptsByPlayer).sort((a, b) => b - a)
      weekPtsPerTeam[teamId][week] = +sorted.slice(0, 11).reduce((s, v) => s + v, 0).toFixed(1)
    }
  }

  const scoredWeeks = SHOW_WEEKS.filter(w => (matchesByWeek[w] || []).length > 0)

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
              {SHOW_WEEKS.map(w => (
                <th key={w} className="px-4 py-3 text-right hidden sm:table-cell">Wk {w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((row: any, i: number) => {
              const rankColors = ['bg-navy-800 text-white','bg-gray-400 text-white','bg-amber-600 text-white','bg-navy-100 text-navy-500']
              const rankClass = rankColors[Math.min(i, 3)]
              return (
                <tr key={row.team_id} className={`hover:bg-navy-50 transition-colors cursor-pointer ${i % 2 === 1 ? 'bg-navy-50/50' : ''}`}>
                  <td className="table-cell">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold font-condensed ${rankClass}`}>{i + 1}</span>
                  </td>
                  <td className="table-cell">
                    <Link href={`/teams/${row.team_id}`}>
                      <div className="font-condensed font-bold text-base text-navy-950 hover:text-navy-700">{row.team_name}</div>
                      <div className="text-navy-400 text-xs">{row.manager_name}</div>
                    </Link>
                  </td>
                  <td className="table-cell text-right font-display font-bold text-lg text-navy-800">{(+row.total_points).toFixed(1)}</td>
                  {SHOW_WEEKS.map(w => {
                    const pts = weekPtsPerTeam[row.team_id]?.[w] || 0
                    const hasData = scoredWeeks.includes(w) && pts > 0
                    return (
                      <td key={w} className="table-cell text-right hidden sm:table-cell">
                        <span className={hasData ? 'font-display font-semibold text-navy-700' : 'text-navy-300'}>
                          {hasData ? pts.toFixed(1) : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
