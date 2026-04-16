// scripts/auto-score.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const CRICAPI_KEY = process.env.CRICAPI_KEY
const LEAGUE_SLUG = 'fantasy-ipl-2026'
const IPL_2026_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function parseMatchDate(dateStr) {
  return new Date(`${dateStr} 2026`)
}

function isMatchLikelyFinished(dateStr) {
  const now = new Date()
  const nowIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  const matchDate = parseMatchDate(dateStr)
  const matchDateIST = new Date(matchDate.getTime() + 5.5 * 60 * 60 * 1000)
  const matchDay = matchDateIST.toDateString()
  const today = nowIST.toDateString()
  if (matchDate < new Date(nowIST.getTime() - 24 * 60 * 60 * 1000)) return true
  if (matchDay === today) return nowIST.getHours() >= 23
  return false
}

async function findMatchInSeries(homeTeam, awayTeam, dateStr) {
  const url = `https://api.cricapi.com/v1/series_info?apikey=${CRICAPI_KEY}&id=${IPL_2026_SERIES_ID}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    const matchList = data.data && data.data.matchList ? data.data.matchList : []
    log(`  Series matchList length: ${matchList.length}`)

    if (!matchList.length) return null

    const shortnameMap = {
      'RCB': ['RCB', 'RCBW'], 'SRH': ['SRH'], 'MI': ['MI'], 'KKR': ['KKR'],
      'CSK': ['CSK'], 'RR': ['RR'], 'DC': ['DC'], 'GT': ['GT'],
      'LSG': ['LSG'], 'PBKS': ['PBKS'],
    }

    const matchDate = parseMatchDate(dateStr)
    const targetDate = matchDate.toISOString().split('T')[0]
    const homeNames = shortnameMap[homeTeam] || [homeTeam]
    const awayNames = shortnameMap[awayTeam] || [awayTeam]

    for (const m of matchList) {
      const teams = (m.teamInfo || []).map(t => (t.shortname || '').toUpperCase())
      const hasHome = homeNames.some(n => teams.includes(n))
      const hasAway = awayNames.some(n => teams.includes(n))

      if (hasHome && hasAway) {
        const mDate = (m.dateTimeGMT || m.date || '').slice(0, 10)
        log(`  Candidate: ${m.name} | date=${mDate} | ended=${m.matchEnded}`)
        if (m.matchEnded === true) {
          log(`  Selected: ${m.name} id=${m.id}`)
          return m.id
        }
      }
    }

    log(`  No completed match found for ${homeTeam} vs ${awayTeam}`)
  } catch (e) {
    log(`  Series search error: ${e.message}`)
  }
  return null
}

async function getScorecard(cricMatchId) {
  const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${cricMatchId}`
  const res = await fetch(url)
  const data = await res.json()
  return data.data || null
}

function formatScorecard(scorecard) {
  if (!scorecard) return ''
  let text = 'Match: ' + (scorecard.name || 'IPL 2026') + '\n\n'
  if (scorecard.score) {
    text += 'Scores: ' + scorecard.score.map(function(s) {
      return s.inning + ': ' + s.r + '/' + s.w + ' (' + s.o + ' ov)'
    }).join(', ') + '\n\n'
  }
  if (scorecard.scorecard) {
    for (const innings of scorecard.scorecard) {
      text += '=== ' + innings.inning + ' ===\nBATTING:\n'
      for (const b of (innings.batting || [])) {
        if (b.r !== undefined) {
          text += (b.batsman && b.batsman.name ? b.batsman.name : b.name || '') +
            ': ' + b.r + '(' + b.b + ') ' + (b['4s'] || 0) + 'x4 ' + (b['6s'] || 0) + 'x6 - ' + (b.dismissal || 'not out') + '\n'
        }
      }
      text += '\nBOWLING:\n'
      for (const bw of (innings.bowling || [])) {
        if (bw.o !== undefined) {
          text += (bw.bowler && bw.bowler.name ? bw.bowler.name : bw.name || '') +
            ': ' + bw.o + 'ov ' + bw.r + 'r ' + bw.w + 'wkt\n'
        }
      }
      text += '\n'
    }
  }
  return text
}

async function calculatePoints(scorecardText, matchLabel) {
  const system = 'You are a cricket fantasy scoring calculator. Respond with ONLY a valid JSON object. No text before or after. Start with { and end with }.'
  const prompt = 'Calculate fantasy points for this IPL 2026 match.\n\n' + scorecardText + '\n\nBATTING: +1/run,+1/four,+2/six,+2 per full 10r beyond 10,-2 duck. SR BOOSTER: FinalBat=BaseBat*(BatterSR/MatchSR) if >=10r or >=5b. MatchSR=(totalRuns/totalBalls)*100\nBOWLING: 1wkt=25, each additional wicket +20 (2=45,3=65,4=85,5=105),+3/dot,+10/maiden,-1/single. ECO BOOSTER: FinalBowl=BaseBowl*(MatchER/BowlerER) if >=1 over. MatchER=totalRuns/totalOvers\nFIELDING: +8 catch/stumping/run-out\n\nReturn ONLY: {"result":"TEAM1 score beat TEAM2","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: system,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  const raw = '{' + (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
  const clean = raw.replace(/```(?:json)?/gi, '').trim()
  try { return JSON.parse(clean) } catch (e) {}
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(clean.slice(start, end + 1))
  throw new Error('Could not parse Claude response as JSON')
}

async function savePoints(matchId, parsed) {
  if (!parsed || !parsed.players || !Object.keys(parsed.players).length) {
    log('No players in response for match ' + matchId)
    return 0
  }

  const playerNames = Object.keys(parsed.players)
  const { data: players } = await supabase.from('players').select('id, name').in('name', playerNames)
  const nameToId = {}
  for (const p of (players || [])) nameToId[p.name] = p.id

  const rows = playerNames.filter(name => nameToId[name]).map(name => {
    const pp = parsed.players[name]
    return {
      match_id: matchId,
      player_id: nameToId[name],
      total: pp.total || 0,
      bat_base: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.base : null,
      bat_final: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.final : null,
      bat_sr: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.sr : null,
      bowl_base: pp.breakdown && pp.breakdown.bowl ? pp.breakdown.bowl.base : null,
      bowl_final: pp.breakdown && pp.breakdown.bowl ? pp.breakdown.bowl.final : null,
      bowl_er: pp.breakdown && pp.breakdown.bowl ? pp.breakdown.bowl.er : null,
      field_pts: pp.breakdown && pp.breakdown.field ? pp.breakdown.field.pts : null,
    }
  })

  if (rows.length) {
    const { error } = await supabase.from('player_points').upsert(rows, { onConflict: 'match_id,player_id' })
    if (error) throw new Error('Supabase error: ' + error.message)
    await supabase.from('matches').update({
      scored: true,
      result: parsed.result || 'Scored',
      match_sr: parsed.matchSR,
      match_er: parsed.matchER,
    }).eq('id', matchId)
  }
  return rows.length
}

async function main() {
  log('Auto-scorer starting...')

  const { data: league } = await supabase.from('leagues').select('id').eq('slug', LEAGUE_SLUG).single()
  if (!league) { log('League not found'); process.exit(1) }

  const { data: matches } = await supabase.from('matches').select('*')
    .eq('league_id', league.id).eq('scored', false).order('week').order('match_num')

  if (!matches || !matches.length) { log('No unscored matches'); return }

  const toScore = matches.filter(m => isMatchLikelyFinished(m.date))
  log('Found ' + toScore.length + ' matches to score out of ' + matches.length + ' unscored')

// Process max 5 per run to avoid timeout
  const batch = toScore.slice(0, 5)
  log('Processing batch of ' + batch.length)

  for (const match of batch) {
    const label = match.home_team + ' vs ' + match.away_team + ' (' + match.date + ')'
    log('Processing: ' + label)

    try {
      const cricMatchId = await findMatchInSeries(match.home_team, match.away_team, match.date)

      let scorecardText = ''
      if (cricMatchId) {
        log('  Found in CricAPI: ' + cricMatchId)
        const scorecard = await getScorecard(cricMatchId)
        if (scorecard) {
          scorecardText = formatScorecard(scorecard)
          log('  Scorecard fetched (' + scorecardText.length + ' chars)')
        }
      }

      if (!scorecardText) {
        log('  Using Claude memory fallback')
        scorecardText = 'Match: ' + match.home_team + ' vs ' + match.away_team + ', ' + match.date + ', ' + match.venue + '. Use your knowledge of this IPL 2026 match.'
      }

      const parsed = await calculatePoints(scorecardText, label)
      log('  Claude returned ' + Object.keys(parsed.players || {}).length + ' players')

      const saved = await savePoints(match.id, parsed)
      log('  Saved ' + saved + ' rows for ' + label)

      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      log('  Error: ' + err.message)
    }
  }

  log('Auto-scorer complete')
}

main().catch(err => { console.error(err); process.exit(1) })
