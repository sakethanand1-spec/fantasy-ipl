'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const ROLE_BADGE: Record<string, string> = {
  BAT: 'badge-bat',
  BOWL: 'badge-bowl',
  AR: 'badge-ar',
  WK: 'badge-wk',
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<any[]>([])
  const [ownership, setOwnership] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, any[]>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: league } = await supabase.from('leagues').select('id').eq('slug', 'fantasy-ipl-2026').single()
    if (!league) { setLoading(false); return }

    const [{ data: allPlayers }, { data: teams }] = await Promise.all([
      supabase.from('players').select('*').order('name'),
      supabase.from('teams').select('id, name').eq('league_id', league.id),
    ])

    const teamMap: Record<string, string> = {}
    for (const t of (teams || [])) teamMap[t.id] = t.name

    const teamIds = (teams || []).map((t: any) => t.id)
    const { data: squads } = await supabase
      .from('squads')
      .select('player_id, team_id')
      .is('effective_to_week', null)
      .in('team_id', teamIds)

    const ownerMap: Record<string, string> = {}
    for (const s of (squads || [])) ownerMap[s.player_id] = teamMap[s.team_id]

    setPlayers(allPlayers || [])
    setOwnership(ownerMap)
    setLoading(false)
  }

  async function togglePlayer(player: any) {
    if (expanded === player.id) {
      setExpanded(null)
      return
    }
    setExpanded(player.id)
    if (history[player.id]) return

    setHistoryLoading(player.id)
    const supabase = createClient()
    const { data } = await supabase
      .from('player_points')
      .select('total, bat_final, bowl_final, field_pts, matches(week, home_team, away_team)')
      .eq('player_id', player.id)

    const sorted = (data || []).sort((a: any, b: any) => (a.matches?.week ?? 99) - (b.matches?.week ?? 99))
    setHistory(prev => ({ ...prev, [player.id]: sorted }))
    setHistoryLoading(null)
  }

  const filtered = players.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="page-title">Players</div>
      <div className="page-subtitle">SEARCH · OWNERSHIP · STATS</div>

      <div className="mb-5">
        <input
          className="input w-full max-w-sm"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {loading ? (
        <div className="text-navy-400 text-sm">Loading...</div>
      ) : (
        <div className="card divide-y divide-navy-100">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-navy-400 text-sm text-center">No players found.</div>
          )}
          {filtered.map(player => {
            const fantasyTeam = ownership[player.id]
            const isExpanded = expanded === player.id
            const matches = history[player.id] || []
            const totalPts = matches.reduce((s: number, m: any) => s + (m.total || 0), 0)

            return (
              <div key={player.id}>
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-navy-50 transition-colors"
                  onClick={() => togglePlayer(player)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-condensed font-bold text-navy-950">{player.name}</div>
                    <div className="text-navy-400 text-xs mt-0.5">{player.ipl_team}</div>
                  </div>

                  <span className={ROLE_BADGE[player.role] || 'badge-ar'}>
                    {player.role}
                  </span>

                  <span className={`text-xs font-condensed font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    fantasyTeam
                      ? 'bg-navy-100 text-navy-700'
                      : 'bg-green-50 text-green-700 border border-green-200'
                  }`}>
                    {fantasyTeam || 'Free Agent'}
                  </span>

                  {history[player.id] && (
                    <div className="text-right w-14 flex-shrink-0">
                      <div className="font-bold text-navy-950 text-sm">{totalPts.toFixed(1)}</div>
                      <div className="text-navy-400 text-xs">pts</div>
                    </div>
                  )}

                  <span className="text-navy-400 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div className="bg-navy-50/50 border-t border-navy-100 px-4 pb-4">
                    {historyLoading === player.id ? (
                      <div className="text-navy-400 text-xs py-4">Loading...</div>
                    ) : matches.length === 0 ? (
                      <div className="text-navy-400 text-xs py-4">No scored matches yet.</div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mt-3 mb-2">
                          <div className="text-navy-400 text-xs font-semibold tracking-wider">MATCH HISTORY</div>
                          <div className="font-condensed font-bold text-navy-800">{totalPts.toFixed(1)} pts total</div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-navy-400 text-xs border-b border-navy-200">
                                <th className="text-left py-1.5 font-semibold pr-3">Wk</th>
                                <th className="text-left py-1.5 font-semibold">Match</th>
                                <th className="text-right py-1.5 font-semibold px-2">Bat</th>
                                <th className="text-right py-1.5 font-semibold px-2">Bowl</th>
                                <th className="text-right py-1.5 font-semibold px-2">Field</th>
                                <th className="text-right py-1.5 font-semibold">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matches.map((m: any, i: number) => (
                                <tr key={i} className={`border-b border-navy-100 last:border-0 ${i % 2 === 1 ? 'bg-white/60' : ''}`}>
                                  <td className="py-1.5 text-navy-500 text-xs pr-3">W{m.matches?.week ?? '—'}</td>
                                  <td className="py-1.5 text-navy-600 text-xs">{m.matches?.home_team} vs {m.matches?.away_team}</td>
                                  <td className="py-1.5 text-right text-navy-700 px-2">{m.bat_final != null ? m.bat_final.toFixed(1) : '—'}</td>
                                  <td className="py-1.5 text-right text-navy-700 px-2">{m.bowl_final != null ? m.bowl_final.toFixed(1) : '—'}</td>
                                  <td className="py-1.5 text-right text-navy-700 px-2">{m.field_pts != null ? m.field_pts : '—'}</td>
                                  <td className="py-1.5 text-right font-bold text-navy-950">{(m.total || 0).toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
