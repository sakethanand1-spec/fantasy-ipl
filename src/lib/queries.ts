// src/lib/queries.ts
// All Supabase data fetching functions

import { createClient } from './supabase/server'

const LEAGUE_SLUG = 'fantasy-ipl-2026' // your league's slug

export async function getLeague() {
  const supabase = createClient()
  const { data } = await supabase
    .from('leagues')
    .select('*')
    .eq('slug', LEAGUE_SLUG)
    .single()
  return data
}

export async function getTeams(leagueId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('teams')
    .select('*')
    .eq('league_id', leagueId)
    .order('created_at')
  return data || []
}

export async function getStandings(leagueId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('team_points')
    .select('*')
    .eq('league_id', leagueId)
    .order('total_points', { ascending: false })
  return data || []
}

export async function getTeamSquad(teamId: string, week?: number) {
  const supabase = createClient()
  let query = supabase
    .from('squads')
    .select(`*, player:players(*)`)
    .eq('team_id', teamId)
    .is('effective_to_week', null) // active players

  if (week) {
    query = supabase
      .from('squads')
      .select(`*, player:players(*)`)
      .eq('team_id', teamId)
      .lte('effective_from_week', week)
      .or(`effective_to_week.is.null,effective_to_week.gte.${week}`)
  }

  const { data } = await query
  return data || []
}

export async function getMatches(leagueId: string, week?: number) {
  const supabase = createClient()
  let query = supabase
    .from('matches')
    .select('*')
    .eq('league_id', leagueId)
    .order('week')
    .order('match_num')

  if (week) query = query.eq('week', week)

  const { data } = await query
  return data || []
}

export async function getPlayerPoints(matchId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_points')
    .select(`*, player:players(*)`)
    .eq('match_id', matchId)
  return data || []
}

export async function getPlayerTotalPoints(playerId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_points')
    .select('total')
    .eq('player_id', playerId)
  return (data || []).reduce((sum, row) => sum + (row.total || 0), 0)
}

export async function getTeamWeekPoints(teamId: string, week: number) {
  const supabase = createClient()
  // Get squad for this week
  const squad = await getTeamSquad(teamId, week)
  const playerIds = squad.map((s: any) => s.player_id)
  if (!playerIds.length) return { total: 0, xi: [] }

  // Get match IDs for this week
  const league = await getLeague()
  if (!league) return { total: 0, xi: [] }

  const matches = await getMatches(league.id, week)
  const matchIds = matches.map((m: any) => m.id)
  if (!matchIds.length) return { total: 0, xi: [] }

  // Get points for all squad players in those matches
  const { data: points } = await supabase
    .from('player_points')
    .select('player_id, total')
    .in('player_id', playerIds)
    .in('match_id', matchIds)

  // Sum per player
  const ptsByPlayer: Record<string, number> = {}
  for (const row of (points || [])) {
    ptsByPlayer[row.player_id] = (ptsByPlayer[row.player_id] || 0) + row.total
  }

  // Auto-XI: top 11
  const sorted = playerIds
    .map((id: string) => ({ id, pts: ptsByPlayer[id] || 0 }))
    .sort((a: any, b: any) => b.pts - a.pts)

  const xi = sorted.slice(0, 11).map((p: any) => p.id)
  const total = xi.reduce((sum: number, id: string) => sum + (ptsByPlayer[id] || 0), 0)

  return { total: +total.toFixed(1), xi }
}

export async function getTransfers(leagueId: string, teamId?: string) {
  const supabase = createClient()
  let query = supabase
    .from('transfers')
    .select(`*, team:teams(name, manager_name), player_out:players!player_out_id(name), player_in:players!player_in_id(name)`)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })

  if (teamId) query = query.eq('team_id', teamId)

  const { data } = await query
  return data || []
}

export async function getActiveWaiverBids(leagueId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('waiver_bids')
    .select(`
      *,
      team:teams(name, manager_name, budget_remaining),
      player_in:players!player_in_id(name, ipl_team, role),
      drop_player:players!drop_player_id(name),
      history:waiver_bid_history(*, team:teams(name))
    `)
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .order('placed_at', { ascending: false })
  return data || []
}

export async function getFreeAgents(leagueId: string) {
  const supabase = createClient()
  // Players not in any active squad in this league
  const teams = await getTeams(leagueId)
  const teamIds = teams.map((t: any) => t.id)

  const { data: activeSquadPlayerIds } = await supabase
    .from('squads')
    .select('player_id')
    .in('team_id', teamIds)
    .is('effective_to_week', null)

  const draftedIds = (activeSquadPlayerIds || []).map((s: any) => s.player_id)

  const { data } = await supabase
    .from('players')
    .select('*')
    .not('id', 'in', `(${draftedIds.join(',')})`)
    .order('name')

  return data || []
}

export async function getCurrentUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getUserTeam(leagueId: string, userId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('teams')
    .select('*')
    .eq('league_id', leagueId)
    .eq('manager_id', userId)
    .single()
  return data
}
