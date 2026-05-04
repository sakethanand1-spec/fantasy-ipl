'use client'
// src/app/weeks/page.tsx
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const WEEKS = Array.from({ length: 14 }, (_, i) => i + 1)

export default function WeeksPage() {
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [matches, setMatches] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [scoring, setScoring] = useState<string | null>(null)
  const [scoreMsg, setScoreMsg] = useState<Record<string, string>>({})
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [matchPlayers, setMatchPlayers] = useState<Record<string, any[]>>({})

  useEffect(() => { loadWeek(selectedWeek) }, [selectedWeek])

  async function loadWeek(week: number) {
    setLoading(true)
    const supabase = createClient()
    const { data: league } = await supabase.from('leagues').select('id').eq('slug', 'fantasy-ipl-2026').single()
    if (!league) { setLoading(false); return }

    const { data: m } = await supabase.from('matches').select('*').eq('league_id', league.id).eq('week', week).order('match_num')
    setMatches(m || [])

    const { data: teams } = await supabase.from('teams').select('id, name, manager_name').eq('league_id', league.id)
    if (teams && m?.some((x: any) => x.scored)) {
      const matchIds = (m || []).filter((x: any) => x.scored).map((x: any) => x.id)
      const lb: any[] = []
      for (const team of teams) {
        const { data: squad } = await supabase.from('squads').select('player_id').eq('team_id', team.id).lte('effective_from_week', week).or(`effective_to_week.is.null,effective_to_week.gte.${week}`)
        const pids = (squad || []).map((s: any) => s.player_id)
        if (!pids.length) { lb.push({ ...team, pts: 0 }); continue }
        const { data: pts } = await supabase.from('player_points').select('player_id, total').in('player_id', pids).in('match_id', matchIds)
        const byPlayer: Record<string, number> = {}
        for (const p of (pts || [])) byPlayer[p.player_id] = (byPlayer[p.player_id] || 0) + p.total
        const sorted = pids.map((id: string) => byPlayer[id] || 0).sort((a: number, b: number) => b - a)
        const xiTotal = sorted.slice(0, 11).reduce((s: number, x: number) => s + x, 0)
        lb.push({ ...team, pts: +xiTotal.toFixed(1) })
      }
      lb.sort((a, b) => b.pts - a.pts)
      setLeaderboard(lb)
    } else {
      setLeaderboard([])
    }
    setLoading(false)
  }

  async function loadMatchPlayers(matchId: string) {
    if (matchPlayers[matchId]) {
      setExpandedMatch(expandedMatch === matchId ? null : matchId)
      return
    }
    const supabase = createClient()
    const { data } = await supabase
      .from('player_points')
      .select('total, bat_base, bat_final, bat_sr, bowl_base, bowl_final, bowl_er, field_pts, players(name, ipl_team, role)')
      .eq('match_id', matchId)
      .order('total', { ascending: false })
    setMatchPlayers(prev => ({ ...prev, [matchId]: data || [] }))
    setExpandedMatch(matchId)
  }

  async function runAutoScore(match: any) {
    setScoring(match.id)
    setScoreMsg(prev => ({ ...prev, [match.id]: 'Searching for scorecard...' }))

    const systemPrompt = `You are a cricket fantasy scoring calculator for IPL 2026 (Indian Premier League season starting March 2026). 
You MUST use web search to find the actual scorecard before scoring. 
CRITICAL: Only use data from IPL 2026 matches. IPL 2026 started on 28 March 2026. Do NOT use scorecards from IPL 2025, IPL 2024, or any previous season under any circumstances.
Respond with ONLY a valid JSON object, no markdown, no code fences, no text before or after.`

    const userPrompt = `Search for and score this IPL 2026 match: ${match.home_team} vs ${match.away_team}, ${match.date} 2026, ${match.venue}.

IMPORTANT: This match was played in IPL 2026 (March-May 2026). Search specifically for "IPL 2026 ${match.home_team} vs ${match.away_team} ${match.date} 2026 scorecard". 
If search results show a match from 2025 or earlier, IGNORE them and search again with "Indian Premier League 2026 ${match.home_team} ${match.away_team} scorecard".
Only proceed with scoring once you have confirmed the scorecard is from 2026.

Calculate fantasy points for every player who batted, bowled or fielded in this match.

BATTING: +1/run, +1/four, +2/six, +2 per full 10 runs beyond 10 (10-19=+2, 20-29=+4 etc), -2 duck.
SR BOOSTER: FinalBat = BaseBat × (BatterSR/MatchSR) if ≥10 runs OR ≥5 balls. BatterSR=runs/balls (ratio e.g. 1.5), MatchSR=totalRuns/totalBalls (ratio e.g. 1.75).
BOWLING BASE (always ≥0): n wkts = (n×25)+(n-1)×5 so 1=25,2=55,3=85,4=115,5=145. +3/dot ball, +10/maiden, +1/single conceded. bowl.base must be ≥0.
ECONOMY BOOSTER: FinalBowl = BaseBowl × (MatchER/BowlerER) if ≥1 over. MatchER=totalRuns/totalOvers. bowl.final must be ≥0.
FIELDING: +8 catch, +8 stumping, +8 run-out.

IMPORTANT: matchSR must be a ratio (runs/balls) e.g. 1.75 not 175. matchER is runs per over e.g. 9.5.
Include ALL players who participated — typically 22+ players.

Return ONLY: {"result":"TEAM1 ActualScore beat TEAM2 ActualScore (e.g. RCB 203/4 beat SRH 201/9)","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}`

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setScoreMsg(prev => ({ ...prev, [match.id]: `Error: ${data.error}` }))
        setScoring(null)
        return
      }

      const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      let parsed: any = null
      try {
        const s = text.replace(/```(?:json)?/gi, '').trim()
        parsed = JSON.parse(s)
      } catch {
        const start = text.indexOf('{'), end = text.lastIndexOf('}')
        if (start !== -1 && end > start) try { parsed = JSON.parse(text.slice(start, end + 1)) } catch {}
      }

      if (!parsed?.players || !Object.keys(parsed.players).length) {
        setScoreMsg(prev => ({ ...prev, [match.id]: 'No player data found — match may not be in training data yet.' }))
        setScoring(null)
        return
      }

      const supabase = createClient()
      const { data: league } = await supabase.from('leagues').select('id').eq('slug', 'fantasy-ipl-2026').single()
      if (!league) { setScoring(null); return }

      const playerNames = Object.keys(parsed.players)
      const { data: players } = await supabase.from('players').select('id, name').in('name', playerNames)
      const nameToId: Record<string, string> = {}
      for (const p of (players || [])) nameToId[p.name] = p.id

      const rows = playerNames
        .filter(name => nameToId[name])
        .map(name => {
          const pp = parsed.players[name]
          const bowlBase = pp.breakdown?.bowl?.base != null ? Math.max(0, pp.breakdown.bowl.base) : null
          const bowlFinal = pp.breakdown?.bowl?.final != null ? Math.max(0, pp.breakdown.bowl.final) : null
          const batFinal = pp.breakdown?.bat?.final ?? 0
          const fieldPts = pp.breakdown?.field?.pts ?? 0
          return {
            match_id: match.id,
            player_id: nameToId[name],
            total: batFinal + (bowlFinal ?? 0) + fieldPts,
            bat_base: pp.breakdown?.bat?.base ?? null,
            bat_final: pp.breakdown?.bat?.final ?? null,
            bat_sr: pp.breakdown?.bat?.sr ?? null,
            bowl_base: bowlBase,
            bowl_final: bowlFinal,
            bowl_er: pp.breakdown?.bowl?.er ?? null,
            field_pts: pp.breakdown?.field?.pts ?? null,
          }
        })

      if (rows.length) {
        await supabase.from('player_points').upsert(rows, { onConflict: 'match_id,player_id' })
        await supabase.from('matches').update({
          scored: true,
          result: parsed.result,
          match_sr: parsed.matchSR,
          match_er: parsed.matchER
        }).eq('id', match.id)
      }

      setScoreMsg(prev => ({ ...prev, [match.id]: `✓ ${rows.length} players scored` }))
      setMatchPlayers(prev => { const next = { ...prev }; delete next[match.id]; return next })
      setExpandedMatch(null)
      loadWeek(selectedWeek)
    } catch (e: any) {
      setScoreMsg(prev => ({ ...prev, [match.id]: `Error: ${e.message}` }))
    }
    setScoring(null)
  }

  return (
    <div>
      <div className="page-title">Matchweeks</div>
      <div className="page-subtitle">SELECT WEEK · AUTO-SCORE WITH AI</div>

      <div className="flex items-center gap-3 mb-5">
        <select className="select" value={selectedWeek} onChange={e => setSelectedWeek(+e.target.value)}>
          {WEEKS.map(w => <option key={w} value={w}>Week {w}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-navy-400 text-sm">Loading...</div>
      ) : (
        <>
          <div className="space-y-3 mb-8">
            {matches.map((m: any) => (
              <div key={m.id} className="card border-l-4 border-l-navy-700">
                <div className="p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="font-condensed font-bold text-lg text-navy-950">
                      {m.home_team} <span className="text-navy-400 font-normal text-base">vs</span> {m.away_team}
                    </div>
                    <div className="text-navy-400 text-xs mt-0.5">{m.date} · {m.venue}</div>
                    {m.scored && m.result && (
                      <div className="text-green-700 text-xs mt-1 font-semibold">✓ {m.result}</div>
                    )}
                    {scoreMsg[m.id] && (
                      <div className={`text-xs mt-1 ${scoreMsg[m.id].startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>
                        {scoreMsg[m.id]}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {m.scored && (
                      <button
                        onClick={() => loadMatchPlayers(m.id)}
                        className="btn btn-sm btn-secondary"
                      >
                        {expandedMatch === m.id ? '▲ Hide' : '▼ Players'}
                      </button>
                    )}
                    <button
                      onClick={() => runAutoScore(m)}
                      disabled={scoring === m.id}
                      className={`btn btn-sm ${m.scored ? 'btn-secondary' : 'btn-primary'}`}
                    >
                      {scoring === m.id ? 'Scoring...' : m.scored ? '🔄 Re-score' : '⚡ Auto Score'}
                    </button>
                  </div>
                </div>

                {expandedMatch === m.id && matchPlayers[m.id] && (
                  <div className="border-t border-navy-100 px-4 pb-4">
                    <div className="text-navy-400 text-xs font-semibold mt-3 mb-2">PLAYER POINTS</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-navy-400 text-xs border-b border-navy-100">
                            <th className="text-left py-2 font-semibold">Player</th>
                            <th className="text-left py-2 font-semibold">Team</th>
                            <th className="text-right py-2 font-semibold">Bat</th>
                            <th className="text-right py-2 font-semibold">Bowl</th>
                            <th className="text-right py-2 font-semibold">Field</th>
                            <th className="text-right py-2 font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchPlayers[m.id].map((p: any, i: number) => (
                            <tr key={i} className={`border-b border-navy-50 ${i % 2 === 1 ? 'bg-navy-50/50' : ''}`}>
                              <td className="py-2 font-condensed font-semibold text-navy-900">{p.players?.name}</td>
                              <td className="py-2 text-navy-400 text-xs">{p.players?.ipl_team}</td>
                              <td className="py-2 text-right text-navy-700">{p.bat_final != null ? p.bat_final.toFixed(1) : '—'}</td>
                              <td className="py-2 text-right text-navy-700">{p.bowl_final != null ? p.bowl_final.toFixed(1) : '—'}</td>
                              <td className="py-2 text-right text-navy-700">{p.field_pts != null ? p.field_pts : '—'}</td>
                              <td className="py-2 text-right font-bold text-navy-950">{p.total.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {leaderboard.length > 0 && (
            <>
              <div className="section-title">Week {selectedWeek} Leaderboard</div>
              <div className="card">
                {leaderboard.map((row: any, i: number) => (
                  <div key={row.id} className={`flex items-center gap-3 px-4 py-3 border-b border-navy-100 last:border-0 ${i % 2 === 1 ? 'bg-navy-50' : ''}`}>
                    <div className="font-condensed font-bold text-navy-400 w-6">{i + 1}</div>
                    <div className="flex-1 font-condensed font-semibold text-navy-950">{row.name} <span className="text-navy-400 text-xs font-normal">{row.manager_name}</span></div>
                    <div className="font-display font-bold text-xl text-navy-800">{row.pts.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}