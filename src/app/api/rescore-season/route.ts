import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const LEAGUE_SLUG = 'fantasy-ipl-2026'
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'
const IPL_TEAMS = new Set(['RCB','SRH','MI','KKR','CSK','RR','DC','GT','LSG','PBKS'])

function normaliseTeam(name: string): string {
  const n = (name || '').toUpperCase()
  if (n.includes('ROYAL CHALLENGERS') || n === 'RCB' || n === 'RCBW') return 'RCB'
  if (n.includes('SUNRISERS') || n === 'SRH') return 'SRH'
  if (n.includes('MUMBAI') || n === 'MI') return 'MI'
  if (n.includes('KOLKATA') || n === 'KKR') return 'KKR'
  if (n.includes('CHENNAI') || n === 'CSK') return 'CSK'
  if (n.includes('RAJASTHAN') || n === 'RR') return 'RR'
  if (n.includes('DELHI') || n === 'DC') return 'DC'
  if (n.includes('GUJARAT') || n === 'GT') return 'GT'
  if (n.includes('LUCKNOW') || n === 'LSG') return 'LSG'
  if (n.includes('PUNJAB') || n === 'PBKS') return 'PBKS'
  return n
}

function pairKey(a: string, b: string): string {
  return [normaliseTeam(a), normaliseTeam(b)].sort().join('|')
}

function teamsFromMatch(m: any): string[] {
  const seen = new Set<string>()
  const add = (t: string) => { const n = normaliseTeam(t); if (IPL_TEAMS.has(n)) seen.add(n) }
  for (const t of (m.teamInfo || [])) { add(t.shortname || ''); add(t.name || '') }
  for (const t of (m.teams || [])) add(t)
  for (const p of (m.name || '').split(' vs ')) add(p.split(',')[0].trim())
  return Array.from(seen)
}

function oversToFloat(o: any): number {
  if (o == null) return 0
  const [full, balls] = String(o).split('.')
  return (parseInt(full) || 0) + (parseInt(balls) || 0) / 6
}

function extractFielders(dismissal: string): string[] {
  if (!dismissal) return []
  const d = dismissal.toLowerCase()
  if (d === 'not out' || d.includes('did not bat')) return []
  if (/c and b|caught and bowled/.test(d)) return []
  const caught = dismissal.match(/(?:^c |caught )\s*([A-Za-z][A-Za-z '.\\-]+?)(?:\s+b\s+|\s*$)/i)
  if (caught) return [caught[1].trim()]
  const stumped = dismissal.match(/(?:^st |stumped )\s*([A-Za-z][A-Za-z '.\\-]+?)(?:\s+b\s+|\s*$)/i)
  if (stumped) return [stumped[1].trim()]
  const runOut = dismissal.match(/run out\s*\(([^/)]+)/i)
  if (runOut) return [runOut[1].trim()]
  return []
}

interface PlayerStats {
  runs: number; balls: number; fours: number; sixes: number; isDuck: boolean
  wickets: number; runsConceded: number; overs: number; maidens: number; dots: number
  fieldingDismissals: number
}

function calcPoints(s: PlayerStats, matchSR: number, matchER: number) {
  const milestone = s.runs >= 10 ? 2 * Math.floor((s.runs - 10) / 10) : 0
  const batBase = s.runs + s.fours + 2 * s.sixes + milestone
  const batSR = s.balls > 0 ? s.runs / s.balls : 0
  const applyBatMult = s.runs >= 10 || s.balls >= 5
  const batFinal = applyBatMult && matchSR > 0 ? Math.round(batBase * (batSR / matchSR)) : batBase
  const wicketBase = s.wickets > 0 ? s.wickets * 25 + (s.wickets - 1) * 5 : 0
  const bowlBase = Math.max(0, wicketBase + 3 * s.dots + 10 * s.maidens)
  const bowlER = s.overs > 0 ? s.runsConceded / s.overs : 0
  const applyBowlMult = s.overs >= 1 && bowlER > 0
  const bowlFinal = Math.max(0, applyBowlMult ? Math.round(bowlBase * (matchER / bowlER)) : bowlBase)
  const fieldPts = s.fieldingDismissals * 8
  const duckPenalty = s.isDuck ? -2 : 0
  return {
    batBase, batFinal, batSR, bowlBase, bowlFinal, bowlER, fieldPts,
    total: Math.max(0, batFinal + bowlFinal + fieldPts + duckPenalty),
  }
}

function parseScorecard(sc: any) {
  const players = new Map<string, PlayerStats>()
  const get = (name: string) => {
    if (!players.has(name)) players.set(name, {
      runs: 0, balls: 0, fours: 0, sixes: 0, isDuck: false,
      wickets: 0, runsConceded: 0, overs: 0, maidens: 0, dots: 0, fieldingDismissals: 0,
    })
    return players.get(name)!
  }
  let totalBatRuns = 0, totalBatBalls = 0, totalBowlRuns = 0, totalBowlOvers = 0
  for (const inn of (sc.scorecard || [])) {
    for (const b of (inn.batting || [])) {
      const name = (b.batsman?.name || b.name || '').trim()
      if (!name || b.r === undefined) continue
      const p = get(name)
      p.runs = b.r ?? 0; p.balls = b.b ?? 0; p.fours = b['4s'] ?? 0; p.sixes = b['6s'] ?? 0
      p.isDuck = p.runs === 0 && p.balls > 0 && !!b.dismissal && !b.dismissal.toLowerCase().includes('not out')
      totalBatRuns += p.runs; totalBatBalls += p.balls
      for (const fname of extractFielders(b.dismissal || '')) if (fname) get(fname).fieldingDismissals++
    }
    for (const bw of (inn.bowling || [])) {
      const name = (bw.bowler?.name || bw.name || '').trim()
      if (!name || bw.o === undefined) continue
      const p = get(name)
      p.wickets = bw.w ?? 0; p.runsConceded = bw.r ?? 0
      p.overs = oversToFloat(bw.o); p.maidens = bw.m ?? 0; p.dots = bw['0s'] ?? 0
      totalBowlRuns += p.runsConceded; totalBowlOvers += p.overs
    }
  }
  const matchSR = totalBatBalls > 0 ? totalBatRuns / totalBatBalls : 0
  const matchER = totalBowlOvers > 0 ? totalBowlRuns / totalBowlOvers : 0
  const result = (sc.score || []).map((s: any) => `${s.inning}: ${s.r}/${s.w} (${s.o}ov)`).join(' | ') || 'Scored'
  return { players, matchSR, matchER, result }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized — add ?secret=YOUR_CRON_SECRET' }, { status: 401 })
  }

  const cricKey = process.env.CRICAPI_KEY
  if (!cricKey) return NextResponse.json({ error: 'CRICAPI_KEY not set' }, { status: 500 })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
  const { data: league } = await supabase.from('leagues').select('id').eq('slug', LEAGUE_SLUG).single()
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const { data: matches } = await supabase.from('matches').select('*')
    .eq('league_id', league.id).order('week').order('match_num')

  // Fetch series match list once
  const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${cricKey}&id=${SERIES_ID}`)
  const seriesData = await seriesRes.json()
  const matchList: any[] = seriesData?.data?.matchList || []

  // Build index: pairKey → [{id, date}] sorted chronologically
  // No date filter — include all matches so both home+away fixtures for a pair are indexed
  const cricByPair: Record<string, { id: string; date: number }[]> = {}
  for (const m of matchList) {
    const teams = teamsFromMatch(m)
    if (teams.length < 2) continue
    const d = new Date(m.dateTimeGMT || m.date || '').getTime()
    const safeDate = isNaN(d) ? 0 : d
    // Use only first 2 teams to keep key consistent
    const key = teams.slice(0, 2).sort().join('|')
    if (!cricByPair[key]) cricByPair[key] = []
    if (!cricByPair[key].some(x => x.id === m.id)) {
      cricByPair[key].push({ id: m.id, date: safeDate })
    }
  }
  for (const key of Object.keys(cricByPair)) {
    cricByPair[key].sort((a, b) => a.date - b.date)
  }

  // Flat matchList lookup used as date-based fallback
  const allCricMatches = matchList.map((m: any) => ({
    id: m.id as string,
    date: (() => { const d = new Date(m.dateTimeGMT || m.date || '').getTime(); return isNaN(d) ? 0 : d })(),
    teams: teamsFromMatch(m),
  })).filter(m => m.teams.length >= 2)

  // Track how many times each pair has been consumed
  const usageCount: Record<string, number> = {}
  // Track all CricAPI IDs assigned so far (prevents double-assigning in date fallback)
  const globalUsedIds = new Set<string>()

  // Get all DB player names upfront
  const { data: allPlayers } = await supabase.from('players').select('id, name')
  const nameToId: Record<string, string> = {}
  for (const p of (allPlayers || [])) nameToId[p.name] = p.id

  const results: string[] = []

  for (const match of (matches || [])) {
    const label = `W${match.week} ${match.home_team} vs ${match.away_team} (${match.date})`
    const key = pairKey(match.home_team, match.away_team)
    const normHome = normaliseTeam(match.home_team)
    const normAway = normaliseTeam(match.away_team)
    usageCount[key] = usageCount[key] ?? 0
    const cricList = cricByPair[key] || []
    let cricMatch = cricList[usageCount[key]]
    usageCount[key]++

    if (!cricMatch) {
      // Fallback 1: same team pair, any date, excluding already-used IDs
      const usedIds = new Set((cricList.slice(0, usageCount[key] - 1)).map(x => x.id))
      const dbDate = new Date(match.date + ' 2026').getTime()
      let bestFallbackId: string | null = null
      let bestDiff = Infinity
      for (const c of allCricMatches) {
        if (!c.teams.includes(normHome) || !c.teams.includes(normAway)) continue
        if (usedIds.has(c.id)) continue
        const diff = Math.abs(c.date - dbDate)
        if (diff < bestDiff) { bestDiff = diff; bestFallbackId = c.id }
      }

      // Fallback 2: DB has wrong teams — search by date proximity + team overlap
      // Try progressively wider windows: 3 days (overlap≥1), 7 days (overlap≥1), 14 days (any)
      if (!bestFallbackId) {
        const windows = [
          { days: 3, minOverlap: 1 },
          { days: 7, minOverlap: 1 },
          { days: 14, minOverlap: 0 },
        ]
        for (const { days, minOverlap } of windows) {
          if (bestFallbackId) break
          let bestOverlap = -1
          bestDiff = Infinity
          for (const c of allCricMatches) {
            if (globalUsedIds.has(c.id)) continue
            const diff = Math.abs(c.date - dbDate)
            if (diff > days * 24 * 60 * 60 * 1000) continue
            const overlap = (c.teams.includes(normHome) ? 1 : 0) + (c.teams.includes(normAway) ? 1 : 0)
            if (overlap < minOverlap) continue
            if (overlap > bestOverlap || (overlap === bestOverlap && diff < bestDiff)) {
              bestOverlap = overlap; bestDiff = diff; bestFallbackId = c.id
            }
          }
        }
        if (bestFallbackId) {
          const found = allCricMatches.find(c => c.id === bestFallbackId)
          results.push(`${label}: DB teams wrong → matched by date to ${found?.teams.join(' vs ')}`)
          if (found && found.teams.length >= 2) {
            await supabase.from('matches').update({
              home_team: found.teams[0], away_team: found.teams[1],
            }).eq('id', match.id)
          }
        }
      }

      if (!bestFallbackId) {
        results.push(`${label}: no CricAPI match found`)
        continue
      }
      cricMatch = { id: bestFallbackId, date: 0 }
    }
    globalUsedIds.add(cricMatch.id)

    try {
      const scRes = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${cricKey}&id=${cricMatch.id}`)
      const scData = await scRes.json()
      const sc = scData?.data
      if (!sc) { results.push(`${label}: empty scorecard (cricapi id ${cricMatch.id})`); continue }

      const { players, matchSR, matchER, result } = parseScorecard(sc)
      const rows = Array.from(players.keys()).filter(n => nameToId[n]).map(name => {
        const pts = calcPoints(players.get(name)!, matchSR, matchER)
        return {
          match_id: match.id, player_id: nameToId[name],
          total: pts.total, bat_base: pts.batBase, bat_final: pts.batFinal, bat_sr: pts.batSR,
          bowl_base: pts.bowlBase, bowl_final: pts.bowlFinal, bowl_er: pts.bowlER, field_pts: pts.fieldPts,
        }
      })

      if (rows.length) {
        await supabase.from('player_points').upsert(rows, { onConflict: 'match_id,player_id' })
        await supabase.from('matches').update({ scored: true, result, match_sr: matchSR, match_er: matchER }).eq('id', match.id)
      }
      results.push(`${label}: ${rows.length} players ✓`)
    } catch (err: any) {
      results.push(`${label}: ERROR — ${err.message}`)
    }
  }

  return NextResponse.json({ total: (matches || []).length, results })
}
