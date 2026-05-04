// scripts/auto-score.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const CRICAPI_KEY = process.env.CRICAPI_KEY
const LEAGUE_SLUG = 'fantasy-ipl-2026'
const IPL_2026_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'
const BATCH_SIZE = 5
const IPL_2026_START = new Date('2026-03-28')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg)
}

function parseMatchDate(dateStr) {
  return new Date(dateStr + ' 2026')
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

function normaliseTeam(name) {
  if (!name) return ''
  name = name.toUpperCase()
  if (name.includes('ROYAL CHALLENGERS') || name === 'RCB') return 'RCB'
  if (name.includes('SUNRISERS') || name === 'SRH') return 'SRH'
  if (name.includes('MUMBAI') || name === 'MI') return 'MI'
  if (name.includes('KOLKATA') || name === 'KKR') return 'KKR'
  if (name.includes('CHENNAI') || name === 'CSK') return 'CSK'
  if (name.includes('RAJASTHAN') || name === 'RR') return 'RR'
  if (name.includes('DELHI') || name === 'DC') return 'DC'
  if (name.includes('GUJARAT') || name === 'GT') return 'GT'
  if (name.includes('LUCKNOW') || name === 'LSG') return 'LSG'
  if (name.includes('PUNJAB') || name === 'PBKS') return 'PBKS'
  return name
}

async function findMatchInSeries(homeTeam, awayTeam, matchDateStr) {
  const url = 'https://api.cricapi.com/v1/series_info?apikey=' + CRICAPI_KEY + '&id=' + IPL_2026_SERIES_ID
  try {
    const res = await fetch(url)
    const text = await res.text()
    const data = JSON.parse(text)
    const matchList = data.data && data.data.matchList ? data.data.matchList : []
    log('  Series matchList length: ' + matchList.length)

    const expectedDate = parseMatchDate(matchDateStr)
    const candidates = []

    for (const m of matchList) {
      const teamInfoNames = (m.teamInfo || []).map(function(t) { return normaliseTeam(t.shortname || t.name || '') })
      const nameParts = (m.name || '').split(' vs ').map(function(p) { return normaliseTeam(p.split(',')[0].trim()) })
      const teams = []
      const seen = {}
      for (const t of [...teamInfoNames, ...nameParts]) {
        if (t && !seen[t]) { teams.push(t); seen[t] = true }
      }

      const hasHome = teams.includes(normaliseTeam(homeTeam))
      const hasAway = teams.includes(normaliseTeam(awayTeam))
      if (!hasHome || !hasAway) continue

      const cricDate = new Date(m.dateTimeGMT || m.date || '')
      if (isNaN(cricDate.getTime())) continue

      if (cricDate < IPL_2026_START || cricDate > new Date('2026-06-01')) {
        log('  Skipping ' + m.name + ' - outside 2026 window')
        continue
      }

      const dayDiff = Math.abs(cricDate.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24)
      if (dayDiff > 2) {
        log('  Skipping ' + m.name + ' - date too far off (' + cricDate.toDateString() + ' vs expected ' + expectedDate.toDateString() + ')')
        continue
      }

      log('  Candidate: ' + m.name + ' | date=' + cricDate.toDateString() + ' | ended=' + m.matchEnded)
      candidates.push({ m: m, dayDiff: dayDiff })
    }

    candidates.sort(function(a, b) { return a.dayDiff - b.dayDiff })

    if (candidates.length > 0) {
      const best = candidates[0].m
      log('  Selected: ' + best.name + ' id=' + best.id)
      return best.id
    }

    log('  No matching 2026 match found for ' + homeTeam + ' vs ' + awayTeam)
  } catch (e) {
    log('  Series search error: ' + e.message)
  }
  return null
}

async function getScorecard(cricMatchId) {
  const url = 'https://api.cricapi.com/v1/match_scorecard?apikey=' + CRICAPI_KEY + '&id=' + cricMatchId
  try {
    const res = await fetch(url)
    const text = await res.text()
    if (text.length > 500000) {
      log('  Scorecard response too large: ' + text.length + ' chars')
      return null
    }
    const data = JSON.parse(text)
    return data.data || null
  } catch (e) {
    log('  getScorecard error: ' + e.message)
    return null
  }
}

function formatScorecard(scorecard) {
  if (!scorecard) return ''
  try {
    var lines = []
    lines.push('Match: ' + String(scorecard.name || 'IPL 2026'))

    if (Array.isArray(scorecard.score)) {
      var scores = scorecard.score.map(function(s) {
        return String(s.inning || '') + ': ' + String(s.r || 0) + '/' + String(s.w || 0) + ' (' + String(s.o || 0) + ' ov)'
      })
      lines.push('Scores: ' + scores.join(', '))
    }

    if (Array.isArray(scorecard.scorecard)) {
      for (var i = 0; i < scorecard.scorecard.length; i++) {
        var innings = scorecard.scorecard[i]
        if (!innings || typeof innings !== 'object') continue
        lines.push('=== ' + String(innings.inning || '') + ' ===')
        lines.push('BATTING:')

        if (Array.isArray(innings.batting)) {
          for (var j = 0; j < innings.batting.length; j++) {
            var b = innings.batting[j]
            if (!b || typeof b !== 'object') continue
            var bname = ''
            if (b.batsman && b.batsman.name) bname = b.batsman.name
            else if (b.name) bname = b.name
            else continue
            if (b.r === undefined) continue
            lines.push(String(bname) + ': ' + String(b.r || 0) + '(' + String(b.b || 0) + ') ' + String(b['4s'] || 0) + 'x4 ' + String(b['6s'] || 0) + 'x6 - ' + String(b.dismissal || 'not out'))
          }
        }

        lines.push('BOWLING:')
        if (Array.isArray(innings.bowling)) {
          for (var k = 0; k < innings.bowling.length; k++) {
            var bw = innings.bowling[k]
            if (!bw || typeof bw !== 'object') continue
            if (bw.o === undefined) continue
            var bwname = ''
            if (bw.bowler && bw.bowler.name) bwname = bw.bowler.name
            else if (bw.name) bwname = bw.name
            else continue
            lines.push(String(bwname) + ': ' + String(bw.o || 0) + 'ov ' + String(bw.r || 0) + 'r ' + String(bw.w || 0) + 'wkt')
          }
        }
        lines.push('')
      }
    }

    var result = lines.join('\n')
    log('  Scorecard formatted: ' + result.length + ' chars, ' + (scorecard.scorecard || []).length + ' innings')
    return result
  } catch (e) {
    log('  formatScorecard error: ' + e.message)
    return ''
  }
}

async function calculatePoints(scorecardText) {
  var system = 'You are a cricket fantasy scoring calculator. Respond with ONLY a valid JSON object. No text before or after. Start with { and end with }.'

  var prompt = 'Calculate fantasy points for this IPL 2026 match.\n\n' + scorecardText + '\n\n' +
    'BATTING: +1/run, +1/four, +2/six, +2 per full 10 runs beyond 10 (so 10-19=+2, 20-29=+4 etc), -2 duck.\n' +
    'SR BOOSTER: FinalBat = BaseBat * (BatterSR / MatchSR) if >=10r or >=5b. Where BatterSR = runs/balls (ratio, e.g. 1.5 not 150) and MatchSR = totalRuns/totalBalls (ratio, e.g. 1.75 not 175).\n' +
    'BOWLING: n wickets = (n*25)+(n-1)*5 so 1=25,2=55,3=85,4=115,5=145. +3/dot, +10/maiden, +1/single conceded. No negative bowling scoring.\n' +
    'ECO BOOSTER: FinalBowl = BaseBowl * (MatchER / BowlerER) if >=1 over. MatchER = totalRuns/totalOvers (runs per over).\n' +
    'FIELDING: +8 catch, +8 stumping, +8 run-out.\n\n' +
    'IMPORTANT: matchSR must be stored as a RATIO (runs/balls), e.g. 1.75 not 175. matchER is runs per over, e.g. 10.5.\n\n' +
    'Return ONLY: {"result":"TEAM1 ActualCricketScore beat TEAM2 ActualCricketScore (e.g. RCB 203/4 beat SRH 201/9)","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}'

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      system: system,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    }),
  })

  var data = await res.json()
  if (data.error) throw new Error(data.error.message)

  var raw = '{' + (data.content || []).filter(function(c) { return c.type === 'text' }).map(function(c) { return c.text }).join('')
  var clean = raw.replace(/```(?:json)?/gi, '').trim()
  try { return JSON.parse(clean) } catch (e) {}
  var start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(clean.slice(start, end + 1))
  throw new Error('Could not parse Claude response as JSON')
}

async function savePoints(matchId, parsed) {
  if (!parsed || !parsed.players || !Object.keys(parsed.players).length) {
    log('No players in response for match ' + matchId)
    return 0
  }

  var playerNames = Object.keys(parsed.players)
  var playersRes = await supabase.from('players').select('id, name').in('name', playerNames)
  var nameToId = {}
  for (var p of (playersRes.data || [])) nameToId[p.name] = p.id

  var rows = playerNames.filter(function(name) { return nameToId[name] }).map(function(name) {
    var pp = parsed.players[name]
    var bowlBase = pp.breakdown && pp.breakdown.bowl && pp.breakdown.bowl.base != null ? Math.max(0, pp.breakdown.bowl.base) : null
    var bowlFinal = pp.breakdown && pp.breakdown.bowl && pp.breakdown.bowl.final != null ? Math.max(0, pp.breakdown.bowl.final) : null
    var batFinal = pp.breakdown && pp.breakdown.bat ? (pp.breakdown.bat.final || 0) : 0
    var fieldPts = pp.breakdown && pp.breakdown.field ? (pp.breakdown.field.pts || 0) : 0
    return {
      match_id: matchId,
      player_id: nameToId[name],
      total: batFinal + (bowlFinal || 0) + fieldPts,
      bat_base: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.base : null,
      bat_final: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.final : null,
      bat_sr: pp.breakdown && pp.breakdown.bat ? pp.breakdown.bat.sr : null,
      bowl_base: bowlBase,
      bowl_final: bowlFinal,
      bowl_er: pp.breakdown && pp.breakdown.bowl ? pp.breakdown.bowl.er : null,
      field_pts: pp.breakdown && pp.breakdown.field ? pp.breakdown.field.pts : null,
    }
  })

  if (rows.length) {
    var upsertRes = await supabase.from('player_points').upsert(rows, { onConflict: 'match_id,player_id' })
    if (upsertRes.error) throw new Error('Supabase error: ' + upsertRes.error.message)
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

  var leagueRes = await supabase.from('leagues').select('id').eq('slug', LEAGUE_SLUG).single()
  if (!leagueRes.data) { log('League not found'); process.exit(1) }
  var league = leagueRes.data

  var matchesRes = await supabase.from('matches').select('*')
    .eq('league_id', league.id).eq('scored', false).order('week').order('match_num')

  var matches = matchesRes.data || []
  if (!matches.length) { log('No unscored matches'); return }

  var toScore = matches.filter(function(m) { return isMatchLikelyFinished(m.date) })
  var batch = toScore.slice(0, BATCH_SIZE)
  log('Found ' + toScore.length + ' to score, processing batch of ' + batch.length)

  for (var i = 0; i < batch.length; i++) {
    var match = batch[i]
    var label = match.home_team + ' vs ' + match.away_team + ' (' + match.date + ')'
    log('Processing: ' + label)

    try {
      var cricMatchId = await findMatchInSeries(match.home_team, match.away_team, match.date)
      var scorecardText = ''

      if (cricMatchId) {
        log('  Found in CricAPI: ' + cricMatchId)
        var scorecard = await getScorecard(cricMatchId)
        if (scorecard) {
          scorecardText = formatScorecard(scorecard)
          if (scorecardText.length < 300) {
            log('  Scorecard too short, using Claude memory fallback')
            scorecardText = ''
          }
        }
      }

      if (!scorecardText) {
        log('  Using Claude memory fallback for: ' + label)
        scorecardText = 'Match: ' + match.home_team + ' vs ' + match.away_team + ', ' + match.date + ' 2026, ' + match.venue + '. This is an IPL 2026 match. Use your knowledge of this specific 2026 match only.'
      }

      var parsed = await calculatePoints(scorecardText)
      log('  Claude returned ' + Object.keys(parsed.players || {}).length + ' players')

      var saved = await savePoints(match.id, parsed)
      log('  Saved ' + saved + ' rows for ' + label)

      await new Promise(function(r) { setTimeout(r, 2000) })
    } catch (err) {
      log('  Error: ' + err.message)
    }
  }

  log('Auto-scorer complete')
}

main().catch(function(err) { console.error(err); process.exit(1) })
