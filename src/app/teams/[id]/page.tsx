// src/app/teams/[id]/page.tsx
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 60

const ROLE_CLASS: Record<string, string> = {
  BAT: 'badge-bat', BOWL: 'badge-bowl', AR: 'badge-ar', WK: 'badge-wk'
}

export default async function TeamDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: team } = await supabase.from('teams').select('*').eq('id', params.id).single()
  if (!team) return <div className="text-navy-400">Team not found.</div>

  // Get squad with player details and total points
  const { data: squad } = await supabase
    .from('squads')
    .select('*, player:players(*)')
    .eq('team_id', params.id)
    .is('effective_to_week', null)

  // Get total points per player
  const playerIds = (squad || []).map((s: any) => s.player_id)
  const { data: allPts } = await supabase
    .from('player_points')
    .select('player_id, total')
    .in('player_id', playerIds)

  const ptsByPlayer: Record<string, number> = {}
  for (const p of (allPts || [])) ptsByPlayer[p.player_id] = (ptsByPlayer[p.player_id] || 0) + p.total

  const totalPts = Object.values(ptsByPlayer).reduce((s, v) => s + v, 0)

  // Get transfers for this team
  const { data: transfers } = await supabase
    .from('transfers')
    .select('*, player_out:players!player_out_id(name), player_in:players!player_in_id(name)')
    .eq('team_id', params.id)
    .order('created_at', { ascending: false })

  const players = (squad || [])
    .map((s: any) => ({ ...s.player, squadId: s.id, pts: ptsByPlayer[s.player_id] || 0 }))
    .sort((a: any, b: any) => b.pts - a.pts)

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
          { label: 'Budget', value: `${team.budget_remaining}cr`, color: team.budget_remaining > 0 ? 'text-green-700' : 'text-navy-400' },
        ].map(stat => (
          <div key={stat.label} className="card px-5 py-3">
            <div className="text-navy-400 text-xs font-condensed uppercase tracking-wider mb-0.5">{stat.label}</div>
            <div className={`font-display font-bold text-3xl ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Squad table */}
      <div className="section-title mb-3">Squad</div>
      <div className="card mb-6">
        <table className="w-full border-collapse">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2.5 text-left">Player</th>
              <th className="px-4 py-2.5 text-left hidden sm:table-cell">IPL Team</th>
              <th className="px-4 py-2.5 text-left">Role</th>
              <th className="px-4 py-2.5 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p: any, i: number) => (
              <tr key={p.id} className={`border-b border-navy-100 last:border-0 ${i % 2 === 1 ? 'bg-navy-50' : ''} hover:bg-navy-100 transition-colors`}>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-navy-950 text-sm">{p.name}</span>
                </td>
                <td className="px-4 py-2.5 hidden sm:table-cell">
                  <span className="text-navy-400 text-xs font-condensed">{p.ipl_team}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={ROLE_CLASS[p.role] || 'badge-ar'}>{p.role}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-display font-bold text-navy-700">
                  {p.pts > 0 ? p.pts.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transfers */}
      {transfers && transfers.length > 0 && (
        <>
          <div className="section-title mb-3">Transactions</div>
          <div className="card">
            {transfers.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3 border-b border-navy-100 last:border-0 text-sm">
                <div className="bg-navy-100 text-navy-600 font-condensed font-bold text-xs px-2 py-1 rounded whitespace-nowrap mt-0.5">Wk {t.effective_week}</div>
                <div className="flex-1">
                  <div className="text-green-700 font-medium">↑ {t.player_in?.name}{t.cost_cr > 0 && <span className="text-navy-400 text-xs font-normal"> · {t.cost_cr}cr</span>}</div>
                  <div className="text-red-600">↓ {t.player_out?.name}</div>
                  {t.note && <div className="text-navy-400 text-xs mt-0.5">{t.note}</div>}
                </div>
                <div className="text-blue-600 text-xs font-condensed font-semibold whitespace-nowrap mt-0.5">Active</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
