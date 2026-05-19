import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const LEAGUE_SLUG = 'fantasy-ipl-2026'
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'
const BATCH_SIZE = 3
const IPL_2026_START = new Date('2026-03-28')

function isFinished(dateStr: string): boolean {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const matchDate = new Date(dateStr + ' 2026')
  return (nowIST.getTime() - matchDate.getTime()) / (1000 * 60 * 60) > 4
}

function normaliseTeam(name: string): string {
  const n = (name || '').toUpperCase()
  if (n.includes('ROYAL CHALLENGERS') || n === 'RCB') return 'RCB'
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

function oversToFloat(o: any): number {
  if (o == null) return 0
  const [full, balls] = String(o).split('.')
  return (parseInt(full) || 0) + (parseInt(balls) || 0) / 6
}

// Extract fielder name(s) from a CricAPI dismissal string
function extractFielders(dismissal: string): string[] {
  if (!dismissal) return []
  const d = dismissal.toLowerCase()
  if (d === 'not out' || d.includes('did not bat')) return []
  // caught and bowled — bowler already gets wicket credit, no extra fielding
  if (/c and b|caught and bowled/.test(d)) return []
  // caught [fielder] b [bowler]
  const caught = dismissal.match(/(?:^c |caught )\s*([A-Za-z][A-Za-z '.\\-]+?)(?:\s+b\s+|\s*$)/i)
  if (caught) return [caught[1].trim()]
  // stumped [keeper] b [bowler]
  const stumped = dismissal.match(/(?:^st |stumped )\s*([A-Za-z][A-Za-z '.\\-]+?)(?:\s+b\s+|\s*$)/i)
  if (stumped) return [stumped[1].trim()]
  // run out (fielder) or run out (fielder1/fielder2) — credit first
  const runOut = dismissal.match(/run out\s*\(([^/)]+)/i)
  if (runOut) return [runOut[1].trim()]
  return []
}

interface PlayerStats {
  runs: number; balls: number; fours: number; sixes: number; isDuck: boolean
  wickets: number; runsConceded: number; overs: number; maidens: number; dots: number
  fieldingDismissals: number
}

function newStats(): PlayerStats {
  return {
    runs: 0, balls: 0, fours: 0, sixes: 0, isDuck: false,
    wickets: 0, runsConceded: 0, overs: 0, maidens: 0, dots: 0,
    fieldingDismissals: 0,
  }
}

function calcPoints(s: PlayerStats, matchSR: number, matchER: number) {
  // batting_base = runs + 1/four + 2/six + 2 per full 10 runs beyond 10
  const milestone = s.runs >= 10 ? 2 * Math.floor((s.runs - 10) / 10) : 0
  const batBase = s.runs + s.fours + 2 * s.sixes + milestone
  const batSR = s.balls > 0 ? s.runs / s.balls : 0
  const applyBatMult = s.runs >= 10 || s.balls >= 5
  const batFinal = applyBatMult && matchSR > 0
    ? Math.round(batBase * (batSR / matchSR))
    : batBase

  // bowling_base = wickets formula + 3/dot + 10/maiden (always >= 0)
  const wicketBase = s.wickets > 0 ? s.wickets * 25 + (s.wickets - 1) * 5 : 0
  const bowlBase = Math.max(0, wicketBase + 3 * s.dots + 10 * s.maidens)
  const bowlER = s.overs > 0 ? s.runsConceded / s.overs : 0
  const applyBowlMult = s.overs >= 1 && bowlER > 0
  const bowlFinal = Math.max(0, applyBowlMult
    ? Math.round(bowlBase * (matchER / bowlER))
    : bowlBase)

  const fieldPts = s.fieldingDismissals * 8
  const duckPenalty = s.isDuck ? -2 : 0
  const total = Math.max(0, batFinal + bowlFinal + fieldPts + duckPenalty)

  return { batBase, batFinal, batSR, bowlBase, bowlFinal, bowlER, fieldPts, total }
}

async function fetchScorecard(homeTeam: string, awayTeam: string, dateStr: string): Promise<any> {
  const cricKey = process.env.CRICAPI_KEY
  if (!cricKey) return null
  try {
    const seriesRes = await fetch(
      `https://api.cricapi.com/v1/series_info?apikey=${cricKey}&id=${SERIES_ID}`
    )
    const seriesData = await seriesRes.json()
    const matchList: any[] = seriesData?.data?.matchList || []
    const expectedDate = new Date(dateStr + ' 2026')
    let bestId: string | null = null
    let bestDiff = Infinity
    for (const m of matchList) {
      const teams = [
        ...(m.teamInfo || []).map((t: any) => normaliseTeam(t.shortname || t.name || '')),
        ...(m.name || '').split(' vs ').map((p: string) => normaliseTeam(p.split(',')[0].trim())),
      ]
      if (!teams.includes(normaliseTeam(homeTeam)) || !teams.includes(normaliseTeam(awayTeam))) continue
      const d = new Date(m.dateTimeGMT || m.date || '')
      if (isNaN(d.getTime()) || d < IPL_2026_START || d > new Date('2026-06-01')) continue
      const diff = Math.abs(d.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24)
      if (diff < 2 && diff < bestDiff) { bestDiff = diff; bestId = m.id }
    }
    if (!bestId) return null
    const scRes = await fetch(
      `https://api.cricapi.com/v1/match_scorecard?apikey=${cricKey}&id=${bestId}`
    )
    const scData = await scRes.json()
    return scData?.data ?? null
  } catch { return null }
}

function parseScorecard(sc: any) {
  const players = new Map<string, PlayerStats>()
  const get = (name: string) => {
    if (!players.has(name)) players.set(name, newStats())
    return players.get(name)!
  }

  let totalBatRuns = 0, totalBatBalls = 0, totalBowlRuns = 0, totalBowlOvers = 0

  for (const inn of (sc.scorecard || [])) {
    for (const b of (inn.batting || [])) {
      const name: string = (b.batsman?.name || b.name || '').trim()
      if (!name || b.r === undefined) continue
      const p = get(name)
      p.runs = b.r ?? 0
      p.balls = b.b ?? 0
      p.fours = b['4s'] ?? 0
      p.sixes = b['6s'] ?? 0
      p.isDuck = p.runs === 0 && p.balls > 0
        && !!b.dismissal && !b.dismissal.toLowerCase().includes('not out')
      totalBatRuns += p.runs
      totalBatBalls += p.balls
      for (const fname of extractFielders(b.dismissal || '')) {
        if (fname) get(fname).fieldingDismissals++
      }
    }
    for (const bw of (inn.bowling || [])) {
      const name: string = (bw.bowler?.name || bw.name || '').trim()
      if (!name || bw.o === undefined) continue
      const p = get(name)
      p.wickets = bw.w ?? 0
      p.runsConceded = bw.r ?? 0
      p.overs = oversToFloat(bw.o)
      p.maidens = bw.m ?? 0
      p.dots = bw['0s'] ?? 0
      totalBowlRuns += p.runsConceded
      totalBowlOvers += p.overs
    }
  }

  const matchSR = totalBatBalls > 0 ? totalBatRuns / totalBatBalls : 0
  const matchER = totalBowlOvers > 0 ? totalBowlRuns / totalBowlOvers : 0
  const result = (sc.score || [])
    .map((s: any) => `${s.inning}: ${s.r}/${s.w} (${s.o}ov)`)
    .join(' | ') || 'Scored'

  return { players, matchSR, matchER, result }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  const { data: league } = await supabase.from('leagues').select('id').eq('slug', LEAGUE_SLUG).single()
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const { data: matches } = await supabase.from('matches').select('*')
    .eq('league_id', league.id).eq('scored', false).order('week').order('match_num')

  const toScore = (matches || []).filter((m: any) => isFinished(m.date)).slice(0, BATCH_SIZE)
  const results: string[] = []

  for (const match of toScore) {
    const label = `${match.home_team} vs ${match.away_team} (${match.date})`
    try {
      const sc = await fetchScorecard(match.home_team, match.away_team, match.date)
      if (!sc) { results.push(`${label}: No scorecard from CricAPI`); continue }

      const { players, matchSR, matchER, result } = parseScorecard(sc)
      const playerNames = Array.from(players.keys())
      const { data: dbPlayers } = await supabase
        .from('players').select('id, name').in('name', playerNames)
      const nameToId: Record<string, string> = {}
      for (const p of (dbPlayers || [])) nameToId[p.name] = p.id

      const rows = playerNames.filter(n => nameToId[n]).map(name => {
        const pts = calcPoints(players.get(name)!, matchSR, matchER)
        return {
          match_id: match.id,
          player_id: nameToId[name],
          total: pts.total,
          bat_base: pts.batBase,
          bat_final: pts.batFinal,
          bat_sr: pts.batSR,
          bowl_base: pts.bowlBase,
          bowl_final: pts.bowlFinal,
          bowl_er: pts.bowlER,
          field_pts: pts.fieldPts,
        }
      })

      if (rows.length) {
        await supabase.from('player_points').upsert(rows, { onConflict: 'match_id,player_id' })
        await supabase.from('matches').update({
          scored: true, result, match_sr: matchSR, match_er: matchER,
        }).eq('id', match.id)
      }

      results.push(`${label}: ${rows.length} players scored (SR=${matchSR.toFixed(3)}, ER=${matchER.toFixed(2)})`)
    } catch (err: any) {
      results.push(`${label}: ERROR - ${err.message}`)
    }
  }

  return NextResponse.json({ scored: toScore.length, results })
}
