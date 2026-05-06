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

async function getScorecard(homeTeam: string, awayTeam: string, dateStr: string): Promise<string> {
  const cricKey = process.env.CRICAPI_KEY
  if (!cricKey) return ''
  try {
    const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${cricKey}&id=${SERIES_ID}`)
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
    if (!bestId) return ''

    const scRes = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${cricKey}&id=${bestId}`)
    const scData = await scRes.json()
    const sc = scData?.data
    if (!sc) return ''

    const lines: string[] = [`Match: ${sc.name || ''}`]
    if (Array.isArray(sc.score)) {
      lines.push('Scores: ' + sc.score.map((s: any) => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(', '))
    }
    for (const inn of (sc.scorecard || [])) {
      lines.push(`=== ${inn.inning} ===\nBATTING:`)
      for (const b of (inn.batting || [])) {
        const name = b.batsman?.name || b.name || ''
        if (!name || b.r === undefined) continue
        lines.push(`${name}: ${b.r}(${b.b}) ${b['4s'] || 0}x4 ${b['6s'] || 0}x6 - ${b.dismissal || 'not out'}`)
      }
      lines.push('BOWLING:')
      for (const bw of (inn.bowling || [])) {
        const name = bw.bowler?.name || bw.name || ''
        if (!name || bw.o === undefined) continue
        let line = `${name}: ${bw.o}ov ${bw.r}r ${bw.w}wkt`
        if (bw.m != null) line += ` ${bw.m}maiden`
        if (bw.wd != null) line += ` ${bw.wd}wd`
        if (bw.nb != null) line += ` ${bw.nb}nb`
        if (bw['0s'] != null) line += ` ${bw['0s']}dots`
        lines.push(line)
      }
    }
    const text = lines.join('\n')
    return text.length >= 300 ? text : ''
  } catch {
    return ''
  }
}

async function scoreWithClaude(scorecardText: string): Promise<any> {
  const prompt = `Calculate fantasy points for this IPL 2026 match.\n\n${scorecardText}\n\n` +
    `BATTING: +1/run, +1/four, +2/six, +2 per full 10 runs beyond 10 (10-19=+2, 20-29=+4 etc), -2 duck.\n` +
    `SR BOOSTER: FinalBat = BaseBat * (BatterSR / MatchSR) if >=10r or >=5b. BatterSR=runs/balls (ratio e.g. 1.5), MatchSR=totalRuns/totalBalls (ratio e.g. 1.75).\n` +
    `BOWLING BASE (always >=0): n wickets = (n*25)+(n-1)*5 so 1=25,2=55,3=85,4=115,5=145. +3/dot, +10/maiden, +1/single conceded. bowl.base must be >=0.\n` +
    `ECO BOOSTER: FinalBowl = BaseBowl * (MatchER / BowlerER) if >=1 over. MatchER=totalRuns/totalOvers. bowl.final must be >=0.\n` +
    `FIELDING: +8 catch, +8 stumping, +8 run-out.\n\n` +
    `IMPORTANT: matchSR is a ratio (runs/balls) e.g. 1.75. matchER is runs per over e.g. 10.5.\n\n` +
    `Return ONLY: {"result":"TEAM1 Score beat TEAM2 Score","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: 'You are a cricket fantasy scoring calculator. Respond with ONLY a valid JSON object.',
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const raw = '{' + (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const clean = raw.replace(/```(?:json)?/gi, '').trim()
  try { return JSON.parse(clean) } catch {}
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
  if (s !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1))
  throw new Error('Could not parse Claude response')
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
      let scorecardText = await getScorecard(match.home_team, match.away_team, match.date)
      if (!scorecardText) {
        scorecardText = `Match: ${match.home_team} vs ${match.away_team}, ${match.date} 2026, ${match.venue}. IPL 2026 match. Use your knowledge of this specific 2026 match only.`
      }

      const parsed = await scoreWithClaude(scorecardText)
      const playerNames = Object.keys(parsed?.players || {})
      const { data: players } = await supabase.from('players').select('id, name').in('name', playerNames)
      const nameToId: Record<string, string> = {}
      for (const p of (players || [])) nameToId[p.name] = p.id

      const rows = playerNames.filter(n => nameToId[n]).map(name => {
        const pp = parsed.players[name]
        const bowlFinal = pp.breakdown?.bowl?.final != null ? Math.max(0, pp.breakdown.bowl.final) : null
        const bowlBase = pp.breakdown?.bowl?.base != null ? Math.max(0, pp.breakdown.bowl.base) : null
        const batFinal = pp.breakdown?.bat?.final ?? 0
        const fieldPts = pp.breakdown?.field?.pts ?? 0
        return {
          match_id: match.id,
          player_id: nameToId[name],
          total: batFinal + (bowlFinal ?? 0) + fieldPts,
          bat_base: pp.breakdown?.bat?.base ?? null,
          bat_final: batFinal,
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
          result: parsed.result || 'Scored',
          match_sr: parsed.matchSR,
          match_er: parsed.matchER,
        }).eq('id', match.id)
      }

      results.push(`${label}: ${rows.length} players scored`)
    } catch (err: any) {
      results.push(`${label}: ERROR - ${err.message}`)
    }
  }

  return NextResponse.json({ scored: toScore.length, results })
}
