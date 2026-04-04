// src/types/index.ts
// Full type definitions matching the Supabase schema

export interface League {
  id: string
  name: string
  slug: string
  created_at: string
  commissioner_id: string
}

export interface Team {
  id: string
  league_id: string
  manager_id: string
  name: string
  manager_name: string
  budget_remaining: number
  created_at: string
}

export interface Player {
  id: string
  name: string
  ipl_team: string
  role: 'BAT' | 'BOWL' | 'AR' | 'WK'
}

export interface Squad {
  id: string
  team_id: string
  player_id: string
  effective_from_week: number
  effective_to_week: number | null
  player?: Player
}

export interface Match {
  id: string
  league_id: string
  week: number
  match_num: number
  home_team: string
  away_team: string
  date: string
  venue: string
  scored: boolean
  result: string | null
  match_sr: number | null
  match_er: number | null
}

export interface PlayerPoints {
  id: string
  match_id: string
  player_id: string
  total: number
  bat_base: number | null
  bat_final: number | null
  bat_sr: number | null
  bowl_base: number | null
  bowl_final: number | null
  bowl_er: number | null
  field_pts: number | null
  player?: Player
  match?: Match
}

export interface Transfer {
  id: string
  league_id: string
  team_id: string
  player_out_id: string
  player_in_id: string
  cost_cr: number
  effective_week: number
  note: string | null
  created_at: string
  team?: Team
  player_out?: Player
  player_in?: Player
}

export interface WaiverBid {
  id: string
  league_id: string
  team_id: string
  player_in_id: string
  drop_player_id: string | null
  amount: number
  week: number
  placed_at: string
  last_bid_at: string
  status: 'active' | 'resolved' | 'cancelled' | 'outbid'
  resolved_at: string | null
  team?: Team
  player_in?: Player
  drop_player?: Player
  history?: WaiverBidHistory[]
}

export interface WaiverBidHistory {
  id: string
  bid_id: string
  team_id: string
  amount: number
  created_at: string
  team?: Team
}

export interface BudgetBoost {
  id: string
  league_id: string
  week: number
  amount: number
  applied_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

// Computed types used in UI
export interface StandingsRow {
  team: Team
  total_points: number
  week_points: Record<number, number>
  rank: number
}

export interface TeamWithSquad extends Team {
  squad: (Squad & { player: Player; total_points: number })[]
}
