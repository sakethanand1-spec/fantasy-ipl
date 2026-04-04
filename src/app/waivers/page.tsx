'use client'
// src/app/waivers/page.tsx
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function WaiversPage() {
  const [league, setLeague] = useState<any>(null)
  const [teams, setTeams] = useState<any[]>([])
  const [activeBids, setActiveBids] = useState<any[]>([])
  const [freeAgents, setFreeAgents] = useState<any[]>([])
  const [userTeam, setUserTeam] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [franchise, setFranchise] = useState('')
  const [loading, setLoading] = useState(true)
  const [bidModal, setBidModal] = useState<any>(null)
  const [bidTeamId, setBidTeamId] = useState('')
  const [bidAmount, setBidAmount] = useState(1)
  const [dropPlayerId, setDropPlayerId] = useState('')
  const [bidding, setBidding] = useState(false)
  const [confirmClose, setConfirmClose] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)

  const IPL_TEAMS = ['CSK','DC','GT','KKR','LSG','MI','PBKS','RCB','RR','SRH']

  useEffect(() => { loadData() }, [])

  // Real-time subscription for bid updates
  useEffect(() => {
    if (!league) return
    const supabase = createClient()
    const channel = supabase
      .channel('waiver-bids')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiver_bids', filter: `league_id=eq.${league.id}` }, () => loadBids(league.id))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [league])

  async function loadData() {
    const supabase = createClient()
    const { data: l } = await supabase.from('leagues').select('id').eq('slug', 'fantasy-ipl-2026').single()
    if (!l) { setLoading(false); return }
    setLeague(l)

    const { data: t } = await supabase.from('teams').select('*').eq('league_id', l.id)
    setTeams(t || [])

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const ut = (t || []).find((x: any) => x.manager_id === user.id)
      setUserTeam(ut || null)
    }

    await loadBids(l.id)
    await loadFreeAgents(l.id, t || [])
    setLoading(false)
  }

  async function loadBids(leagueId: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('waiver_bids')
      .select(`*, team:teams(name,manager_name,budget_remaining), player_in:players!player_in_id(name,ipl_team,role), drop_player:players!drop_player_id(name), history:waiver_bid_history(*, team:teams(name))`)
      .eq('league_id', leagueId).eq('status', 'active').order('placed_at', { ascending: false })
    setActiveBids(data || [])
  }

  async function loadFreeAgents(leagueId: string, teamList: any[]) {
    const supabase = createClient()
    const teamIds = teamList.map((t: any) => t.id)
    const { data: active } = await supabase.from('squads').select('player_id').in('team_id', teamIds).is('effective_to_week', null)
    const drafted = (active || []).map((s: any) => s.player_id)
    const { data: players } = await supabase.from('players').select('*').not('id', 'in', drafted.length ? `(${drafted.join(',')})` : '(null)').order('name')
    setFreeAgents(players || [])
  }

  async function placeBid() {
    if (!bidModal || !bidTeamId || bidAmount < 1) return
    const team = teams.find((t: any) => t.id === bidTeamId)
    if (!team || bidAmount > team.budget_remaining) return
    const squad = await getSquad(bidTeamId)
    if (squad.length >= 15 && !dropPlayerId) return

    setBidding(true)
    const supabase = createClient()

    // Mark any existing bid on this player as outbid
    const existing = activeBids.find((b: any) => b.player_in?.id === bidModal.id || b.player_in_id === bidModal.id)
    if (existing) await supabase.from('waiver_bids').update({ status: 'outbid' }).eq('id', existing.id)

    const currentWeek = getCurrentWeek()
    const { data: bid } = await supabase.from('waiver_bids').insert({
      league_id: league.id, team_id: bidTeamId, player_in_id: bidModal.id,
      drop_player_id: dropPlayerId || null, amount: bidAmount,
      week: currentWeek, status: 'active',
    }).select().single()

    if (bid) {
      await supabase.from('waiver_bid_history').insert({ bid_id: bid.id, team_id: bidTeamId, amount: bidAmount })
    }

    setBidding(false)
    setBidModal(null)
    setBidTeamId('')
    setBidAmount(1)
    setDropPlayerId('')
    loadBids(league.id)
  }

  async function raiseBid(bidId: string, newTeamId: string, newAmount: number, newDropId: string) {
    const supabase = createClient()
    await supabase.from('waiver_bids').update({ team_id: newTeamId, amount: newAmount, drop_player_id: newDropId || null, last_bid_at: new Date().toISOString() }).eq('id', bidId)
    await supabase.from('waiver_bid_history').insert({ bid_id: bidId, team_id: newTeamId, amount: newAmount })
    loadBids(league.id)
  }

  async function confirmBid(bidId: string) {
    const bid = activeBids.find((b: any) => b.id === bidId)
    if (!bid) return
    const supabase = createClient()

    // Add player to squad
    await supabase.from('squads').insert({ team_id: bid.team_id, player_id: bid.player_in_id, effective_from_week: getCurrentWeek() + 1 })

    // Remove dropped player
    if (bid.drop_player_id) {
      await supabase.from('squads').update({ effective_to_week: getCurrentWeek() }).eq('team_id', bid.team_id).eq('player_id', bid.drop_player_id).is('effective_to_week', null)
    }

    // Deduct budget
    await supabase.from('teams').update({ budget_remaining: Math.max(0, (bid.team?.budget_remaining || 0) - bid.amount) }).eq('id', bid.team_id)

    // Log transfer
    const { data: pIn } = await supabase.from('players').select('id').eq('name', bid.player_in?.name).single()
    await supabase.from('transfers').insert({ league_id: league.id, team_id: bid.team_id, player_in_id: bid.player_in_id, player_out_id: bid.drop_player_id, cost_cr: bid.amount, effective_week: getCurrentWeek() + 1, note: `Waiver · ${bid.amount}cr · commissioner confirmed` })

    // Close bid
    await supabase.from('waiver_bids').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', bidId)

    setConfirmClose(null)
    loadBids(league.id)
    loadFreeAgents(league.id, teams)
  }

  async function cancelBid(bidId: string) {
    const supabase = createClient()
    await supabase.from('waiver_bids').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', bidId)
    setConfirmCancel(null)
    loadBids(league.id)
  }

  async function getSquad(teamId: string) {
    const supabase = createClient()
    const { data } = await supabase.from('squads').select('player_id, player:players(id,name,ipl_team)').eq('team_id', teamId).is('effective_to_week', null)
    return data || []
  }

  function getCurrentWeek() {
    const now = new Date()
    const weekStarts = [new Date('2026-03-28'), new Date('2026-04-02'), new Date('2026-04-05'), new Date('2026-04-07')]
    for (let i = weekStarts.length - 1; i >= 0; i--) { if (now >= weekStarts[i]) return i + 1 }
    return 1
  }

  function formatCountdown(lastBidAt: string) {
    const deadline = new Date(new Date(lastBidAt).getTime() + 24 * 3600 * 1000)
    const ms = deadline.getTime() - Date.now()
    if (ms <= 0) return 'Expired'
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const filteredAgents = freeAgents.filter((p: any) => {
    if (franchise && p.ipl_team !== franchise) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeBidPlayerIds = new Set(activeBids.map((b: any) => b.player_in_id))

  if (loading) return <div className="text-navy-400 text-sm">Loading...</div>

  return (
    <div>
      <div className="page-title">Waivers</div>
      <div className="page-subtitle">BIDDING · CLAIM FREE AGENTS WITH YOUR BUDGET</div>

      {/* Budget chips */}
      <div className="section-title mb-3">Team Budgets</div>
      <div className="flex flex-wrap gap-2 mb-6">
        {teams.map((t: any) => (
          <div key={t.id} className={`card px-4 py-2.5 min-w-[100px] ${t.budget_remaining === 0 ? 'opacity-40' : ''}`}>
            <div className="text-navy-400 text-xs font-condensed uppercase tracking-wider">{t.manager_name}</div>
            <div className={`font-display font-bold text-xl ${t.budget_remaining > 0 ? 'text-green-700' : 'text-navy-300'}`}>{t.budget_remaining}cr</div>
          </div>
        ))}
      </div>

      {/* Active bids */}
      <div className="section-title mb-3">Active Bids {activeBids.length > 0 && <span className="text-navy-400 font-normal normal-case text-sm ml-1">({activeBids.length} live)</span>}</div>
      <div className="space-y-3 mb-8">
        {activeBids.length === 0 ? (
          <div className="card p-8 text-center text-navy-400 text-sm">No active bids. Place one below.</div>
        ) : activeBids.map((bid: any) => (
          <div key={bid.id} className="card border-l-4 border-l-navy-800 p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <div className="font-condensed font-bold text-lg text-navy-950">{bid.player_in?.name}</div>
                <div className="text-navy-400 text-xs">{bid.player_in?.ipl_team} · {bid.player_in?.role}</div>
              </div>
              <div className="text-right">
                <div className="font-display font-bold text-2xl text-navy-800">{bid.amount}cr</div>
                <div className="text-navy-400 text-xs">Leading bid</div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm flex-wrap mb-3">
              <span className="text-navy-600">Leader: <strong>{bid.team?.name}</strong></span>
              {bid.drop_player && <span className="text-red-600">↓ {bid.drop_player.name}</span>}
              <span className={`ml-auto font-display font-semibold ${new Date(bid.last_bid_at).getTime() + 22*3600000 < Date.now() ? 'text-orange-600' : 'text-navy-400'}`}>
                ⏱ {formatCountdown(bid.last_bid_at)}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary btn-sm" onClick={() => alert('Raise bid UI — coming soon')}>🔨 Raise Bid</button>
              {confirmClose === bid.id ? (
                <><button className="btn btn-success btn-sm" onClick={() => confirmBid(bid.id)}>✓ Yes, confirm</button><button className="btn btn-secondary btn-sm" onClick={() => setConfirmClose(null)}>Nevermind</button></>
              ) : (
                <button className="btn btn-success btn-sm" onClick={() => setConfirmClose(bid.id)}>✓ Confirm</button>
              )}
              {confirmCancel === bid.id ? (
                <><button className="btn btn-danger btn-sm" onClick={() => cancelBid(bid.id)}>✕ Yes, cancel</button><button className="btn btn-secondary btn-sm" onClick={() => setConfirmCancel(null)}>Nevermind</button></>
              ) : (
                <button className="btn btn-danger btn-sm" onClick={() => setConfirmCancel(bid.id)}>✕ Cancel</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Free agents */}
      <div className="section-title mb-3">
        Free Agents
        <span className="float-right flex gap-2">
          <input className="input text-xs py-1.5 w-36" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select text-xs py-1.5" value={franchise} onChange={e => setFranchise(e.target.value)}>
            <option value="">All Teams</option>
            {IPL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </span>
      </div>
      <div className="card">
        {filteredAgents.length === 0 ? (
          <div className="p-8 text-center text-navy-400 text-sm">No free agents match your filters.</div>
        ) : filteredAgents.map((p: any) => {
          const hasBid = activeBidPlayerIds.has(p.id)
          const bid = hasBid ? activeBids.find((b: any) => b.player_in_id === p.id) : null
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-navy-100 last:border-0 hover:bg-navy-50">
              <span className="flex-1 text-sm font-medium text-navy-950">{p.name}</span>
              <span className="text-navy-400 text-xs font-condensed w-10">{p.ipl_team}</span>
              <span className={`text-xs font-condensed font-semibold px-2 py-0.5 rounded ${p.role === 'BAT' ? 'badge-bat' : p.role === 'BOWL' ? 'badge-bowl' : p.role === 'WK' ? 'badge-wk' : 'badge-ar'}`}>{p.role}</span>
              <span className={`text-xs w-16 text-right font-semibold ${hasBid ? 'text-navy-700' : 'text-navy-300'}`}>{hasBid ? `🔨 ${bid?.amount}cr` : '—'}</span>
              <button
                className={`btn btn-sm ${hasBid ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => { setBidModal(p); setBidAmount(hasBid ? bid.amount + 1 : 1) }}
              >
                {hasBid ? 'Raise' : '+ Claim'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Bid modal */}
      {bidModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setBidModal(null) }}>
          <div className="bg-white rounded-2xl border-t-4 border-t-navy-800 w-full max-w-md shadow-2xl">
            <div className="flex items-start justify-between px-6 py-4 border-b border-navy-100 bg-navy-50">
              <div>
                <div className="font-condensed font-extrabold text-xl text-navy-950">{bidModal.name}</div>
                <div className="text-navy-400 text-xs">{bidModal.ipl_team} · {bidModal.role}</div>
              </div>
              <button onClick={() => setBidModal(null)} className="text-navy-300 hover:text-navy-700 text-xl leading-none mt-1">✕</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <div className="text-xs font-condensed font-semibold uppercase tracking-wider text-navy-500 mb-2">Select your team</div>
                <div className="grid grid-cols-2 gap-2">
                  {teams.map((t: any) => (
                    <button key={t.id} onClick={() => setBidTeamId(t.id)} disabled={t.budget_remaining < 1}
                      className={`p-2.5 rounded-lg border text-left transition-all ${bidTeamId === t.id ? 'border-navy-800 bg-navy-50' : 'border-navy-200 hover:border-navy-400'} ${t.budget_remaining < 1 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <div className="font-condensed font-bold text-sm text-navy-950 leading-tight">{t.name}</div>
                      <div className={`text-xs font-semibold mt-0.5 ${t.budget_remaining > 0 ? 'text-green-700' : 'text-navy-300'}`}>{t.budget_remaining}cr remaining</div>
                    </button>
                  ))}
                </div>
              </div>

              {bidTeamId && (
                <div>
                  <div className="text-xs font-condensed font-semibold uppercase tracking-wider text-navy-500 mb-2">Bid amount (min 1cr)</div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setBidAmount(a => Math.max(1, a - 1))} className="btn btn-secondary btn-sm w-8 h-8 p-0">−</button>
                    <input type="number" min={1} value={bidAmount} onChange={e => setBidAmount(+e.target.value)} className="input w-24 text-center font-display font-bold text-xl" />
                    <button onClick={() => setBidAmount(a => a + 1)} className="btn btn-secondary btn-sm w-8 h-8 p-0">+</button>
                    <span className="text-navy-400 text-sm">cr</span>
                  </div>
                  {bidAmount > (teams.find((t: any) => t.id === bidTeamId)?.budget_remaining || 0) && (
                    <div className="text-red-600 text-xs mt-1">⚠ Over budget</div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={placeBid} disabled={bidding || !bidTeamId || bidAmount < 1} className="btn btn-primary flex-1 py-2.5">
                  {bidding ? 'Placing...' : '🔨 Place Bid'}
                </button>
                <button onClick={() => setBidModal(null)} className="btn btn-secondary px-5">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
