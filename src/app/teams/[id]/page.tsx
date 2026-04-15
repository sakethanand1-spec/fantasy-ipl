'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const ROLE_CLASS: Record<string, string> = {
  BAT: 'badge-bat', BOWL: 'badge-bowl', AR: 'badge-ar', WK: 'badge-wk'
}

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export default function TeamDetailPage({ params }: { params: { id: string } }) {
  const [team, setTeam] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [transfers, setTransfers] = useState<any[]>([])
  const [weekPts, setWeekPts] = useState<Record<number, Record<string, any>>>({})
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const [scoredWeeks, setScoredWeeks] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadTeam() }, [params.id])

  async function loadTeam() {
    setLoading(true)
    const supabase = createClient()

    const { data: t } = await supabase.from('teams').select('*').eq('id', params.id).single()
    if (!t) { setLoading(false); return }
    setTeam(t)

    // Active squad
    const { data: squad } = await supabase
      .from('squads').select('*, player:players(*)')
      .eq('team_id', params.id).is('effective_to_week', null)

    // All player points for this team's players
    const playerIds = (squad || []).map((s: any) => s.player_id)
    const { data: allPts } = await supabase
      .from('player_points')
      .select('*, match:matches(id, week, home_team, away_team, date, match_sr, match_er)')
      .in('player_id', playerIds)

    // Get league for match lookup
    const { data: league } = await supabase.from('leagues').select('id').eq('slug', 'fantasy-ipl-2026').single()

    // Get all scored matches grouped by week
    const { data: matches } = await supabase
      .from('matches').select('id, week, home_team, away_team, date')
      .eq('league_id', league?.id || '').eq('scored', true)

    const matchesByWeek: Record<number, string[]> = {}
    for (const m of (matches || [])) {
      if (!matchesByWeek[m.week]) matchesByWeek[m.week] = []
      matchesByWeek[m.week].push(m.id)
    }
    const sw = Object.keys(matchesByWeek).map(Number).sort((a, b) => a - b)
    setScoredWeeks(sw)
    if (sw.length > 0) setSelectedWeek(sw[sw.length - 1])

    // Build week-by-week point breakdown per player
    const wpts: Record<number, Record<string, any>> = {}
    for (const week of sw) {
      wpts[week] = {}
      const weekMatchIds = matchesByWeek[week] || []

      // Get squad for this week
      const { data: weekSquad } = await supabase
        .from('squads').select('player_id')
        .eq('team_id', params.id)
        .lte('effective_from_week', week)
        .or(`effective_to_week.is.null,effective_to_week.gte.${week}`)

      const weekPlayerIds = new Set((weekSquad || []).map((s: any) => s.player_id))

      for (const pt of (allPts || [])) {
        if (!weekPlayerIds.has(pt.player_id)) continue
        if (!weekMatchIds.includes(pt.match_id)) continue

        if (!wpts[week][pt.player_id]) {
          wpts[week][pt.player_id] = { total: 0, matches: [] }
        }
        wpts[week][pt.player_id].total += pt.total
        wpts[week][pt.player_id].matches.push({
          matchId: pt.match_id,
          matchLabel: pt.match ? pt.match.home_team + ' vs ' + pt.match.away_team : '',
          matchDate: pt.match?.date || '',
          total: pt.total,
          bat_base: pt.bat_base,
          bat_final: pt.bat_final,
          bat_sr: pt.bat_sr,
          bowl_base: pt.bowl_base,
          bowl_final: pt.bowl_final,
          bowl_er: pt.bowl_er,
          field_pts: pt.field_pts,
          match_sr: pt.match?.match_sr,
          match_er: pt.match?.match_er,
        })
      }
    }
    setWeekPts(wpts)

    // Total points per player (all time)
    const ptsByPlayer: Record<string, number> = {}
    for (const p of (allPts || [])) ptsByPlayer[p.player_id] = (ptsByPlayer[p.player_id] || 0) + p.total

    const ps = (squad || [])
      .map((s: any) => ({ ...s.player, pts: ptsByPlayer[s.player_id] || 0 }))
      .sort((a: any, b: any) => b.pts - a.pts)
    setPlayers(ps)

    // Transfers
    const { data: tr } = await supabase
      .from('transfers')
      .select('*, player_out:players!player_out_id(name), player_in:players!player_in_id(name)')
      .eq('team_id', params.id).order('created_at', { ascending: false })
    setTransfers(tr || [])

    setLoading(false)
  }

  if (loading) return <div className="text-navy-400 text-sm p-6">Loading...</div>
  if (!team) return <div className="text-navy-400 p-6">Team not found.</div>

  const currentWeekData = selectedWeek ? weekPts[selectedWeek] || {} : {}
  const totalPts = players.reduce((s, p) => s + p.pts, 0)

  // Get players for selected week (week-aware squad)
  const weekPlayers = players.filter(p => currentWeekData[p.id] !== undefined)
    .map(p => ({ ...p, weekPts: currentWeekData[p.id]?.total || 0, matches: currentWeekData[p.id]?.matches || [] }))
    .sort((a, b) => b.weekPts - a.weekPts)

  // Auto-XI for selected week
  const xi = new Set(weekPlayers.slice(0, 11).map((p: any) => p.id))
  const weekTotal = weekPlayers.filter((p: any) => xi.has(p.id)).reduce((s, p) => s + p.weekPts, 0)

  return (
    <div>
      <Link href="/teams" className="inline-flex items-center gap-2 text-navy-400 text-xs font-condensed uppercase tracking-wider hover:text-navy-700 mb-5">
        ← Back to Teams
      </Link>

      <div className="page-title">{team.name}</div>
      <div className="page-subtitle">{team.manager_name.toUpperCase()} · MANAGER</div>

      {/* Stats */}
      <div className="flex gap-4 mb-6 flex-wrap">
        {[
          { label: 'Total Points', value: totalPts.toFixed(1), color: 'text-navy-800' },
          { label: 'Squad Size', value: players.length, color: 'text-navy-950' },
          { label: 'Budget', value: team.budget_remaining + 'cr', color: team.budget_remaining > 0 ? 'text-green-700' : 'text-navy-400' },
        ].map(stat => (
          <div key={stat.label} className="card px-5 py-3">
            <div className="text-navy-400 text-xs font-condensed uppercase tracking-wider mb-0.5">{stat.label}</div>
            <div className={`font-display font-bold text-3xl ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Week selector */}
      {scoredWeeks.length > 0 && (
        <div className="mb-6">
          <div className="section-title mb-3">Weekly Breakdown</div>
          <div className="flex gap-2 flex-wrap mb-4">
            {scoredWeeks.map(w => (
              <button
                key={w}
                onClick={() => { setSelectedWeek(w); setExpandedPlayer(null) }}
                className={`px-3 py-1.5 rounded font-condensed font-bold text-sm transition-colors ${selectedWeek === w ? 'bg-navy-800 text-white' : 'bg-navy-100 text-navy-600 hover:bg-navy-200'}`}
              >
                Wk {w}
              </button>
            ))}
          </div>

          {selectedWeek && (
            <div className="card mb-6">
              <div className="flex items-center justify-between px-4 py-3 border-b border-navy-100 bg-navy-50">
                <div className="font-condensed font-bold text-navy-700 text-sm uppercase tracking-wider">
                  Week {selectedWeek} · Auto-XI Score
                </div>
                <div className="font-display font-bold text-2xl text-navy-800">{weekTotal.toFixed(1)}</div>
              </div>
              {weekPlayers.map((p: any, i: number) => {
                const inXI = xi.has(p.id)
                const isExpanded = expandedPlayer === p.id + '-' + selectedWeek
                return (
                  <div key={p.id}>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 border-b border-navy-100 last:border-0 cursor-pointer transition-colors ${i % 2 === 1 ? 'bg-navy-50/50' : ''} ${isExpanded ? 'bg-navy-100' : 'hover:bg-navy-50'} ${!inXI ? 'opacity-50' : ''}`}
                      onClick={() => setExpandedPlayer(isExpanded ? null : p.id + '-' + selectedWeek)}
                    >
                      <div className="w-5 text-center">
                        {inXI ? <span className="text-green-600 text-xs font-bold">XI</span> : <span className="text-navy-300 text-xs">—</span>}
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-navy-950 text-sm">{p.name}</span>
                        <span className="text-navy-400 text-xs ml-2">{p.ipl_team}</span>
                      </div>
                      <span className={ROLE_CLASS[p.role] || 'badge-ar'}>{p.role}</span>
                      <div className="font-display font-bold text-navy-700 w-16 text-right">
                        {p.weekPts > 0 ? p.weekPts.toFixed(1) : '—'}
                      </div>
                      <div className="text-navy-300 text-xs ml-1">{isExpanded ? '▲' : '▼'}</div>
                    </div>

                    {/* Expanded breakdown */}
                    {isExpanded && p.matches.length > 0 && (
                      <div className="bg-navy-950 text-white px-4 py-3 border-b border-navy-800">
                        {p.matches.map((m: any, mi: number) => (
                          <div key={mi} className="mb-3 last:mb-0">
                            <div className="text-navy-300 text-xs font-condensed font-bold mb-2 uppercase tracking-wider">
                              {m.matchLabel} · {m.matchDate}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              {/* Batting */}
                              {(m.bat_final !== null || m.bat_base !== null) && (
                                <div className="bg-navy-800 rounded p-2">
                                  <div className="text-navy-400 text-xs mb-1 font-condensed uppercase">Batting</div>
                                  <div className="font-display font-bold text-lg text-amber-400">{m.bat_final?.toFixed(1) ?? '—'}</div>
                                  {m.bat_base !== null && (
                                    <div className="text-navy-400 text-xs mt-1">
                                      Base: {m.bat_base?.toFixed(1)}
                                      {m.bat_sr !== null && m.match_sr !== null && (
                                        <span className="ml-1">· SR: {m.bat_sr?.toFixed(0)} vs {m.match_sr?.toFixed(0)}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Bowling */}
                              {(m.bowl_final !== null || m.bowl_base !== null) && (
                                <div className="bg-navy-800 rounded p-2">
                                  <div className="text-navy-400 text-xs mb-1 font-condensed uppercase">Bowling</div>
                                  <div className="font-display font-bold text-lg text-blue-400">{m.bowl_final?.toFixed(1) ?? '—'}</div>
                                  {m.bowl_base !== null && (
                                    <div className="text-navy-400 text-xs mt-1">
                                      Base: {m.bowl_base?.toFixed(1)}
                                      {m.bowl_er !== null && m.match_er !== null && (
                                        <span className="ml-1">· ER: {m.bowl_er?.toFixed(2)} vs {m.match_er?.toFixed(2)}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Fielding */}
                              {m.field_pts !== null && m.field_pts > 0 && (
                                <div className="bg-navy-800 rounded p-2">
                                  <div className="text-navy-400 text-xs mb-1 font-condensed uppercase">Fielding</div>
                                  <div className="font-display font-bold text-lg text-green-400">+{m.field_pts}</div>
                                  <div className="text-navy-400 text-xs mt-1">{m.field_pts / 8} dismissal{m.field_pts > 8 ? 's' : ''}</div>
                                </div>
                              )}
                              {/* Total */}
                              <div className="bg-navy-700 rounded p-2 col-span-3 flex items-center justify-between">
                                <span className="text-navy-300 font-condensed text-xs uppercase">Total this match</span>
                                <span className="font-display font-bold text-white text-xl">{m.total?.toFixed(1)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {weekPlayers.length === 0 && (
                <div className="px-4 py-6 text-center text-navy-400 text-sm">No scored players this week yet.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Full squad table */}
      <div className="section-title mb-3">Full Squad (Season Total)</div>
      <div className="card mb-6">
        <table className="w-full border-collapse">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2.5 text-left">Player</th>
              <th className="px-4 py-2.5 text-left hidden sm:table-cell">IPL Team</th>
              <th className="px-4 py-2.5 text-left">Role</th>
              <th className="px-4 py-2.5 text-right">Season Pts</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p: any, i: number) => (
              <tr key={p.id} className={`border-b border-navy-100 last:border-0 ${i % 2 === 1 ? 'bg-navy-50' : ''}`}>
                <td className="px-4 py-2.5"><span className="font-medium text-navy-950 text-sm">{p.name}</span></td>
                <td className="px-4 py-2.5 hidden sm:table-cell"><span className="text-navy-400 text-xs font-condensed">{p.ipl_team}</span></td>
                <td className="px-4 py-2.5"><span className={ROLE_CLASS[p.role] || 'badge-ar'}>{p.role}</span></td>
                <td className="px-4 py-2.5 text-right font-display font-bold text-navy-700">{p.pts > 0 ? p.pts.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transfers */}
      {transfers.length > 0 && (
        <>
          <div className="section-title mb-3">Transactions</div>
          <div className="card">
            {transfers.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3 border-b border-navy-100 last:border-0 text-sm">
                <div className="bg-navy-100 text-navy-600 font-condensed font-bold text-xs px-2 py-1 rounded whitespace-nowrap mt-0.5">Wk {t.effective_week}</div>
                <div className="flex-1">
                  <div className="text-green-700 font-medium">↑ {t.player_in?.name}{t.cost_cr > 0 && <span className="text-navy-400 text-xs font-normal"> · {t.cost_cr}cr</span>}</div>
                  {t.player_out?.name && <div className="text-red-600">↓ {t.player_out?.name}</div>}
                  {t.note && <div className="text-navy-400 text-xs mt-0.5">{t.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
