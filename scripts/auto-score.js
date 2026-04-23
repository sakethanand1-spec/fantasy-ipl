// scripts/auto-score.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const CRICAPI_KEY = process.env.CRICAPI_KEY
const LEAGUE_SLUG = 'fantasy-ipl-2026'
const IPL_2026_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'
const BATCH_SIZE = 5

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

async function findMatchInSeries(homeTeam, awayTeam) {
  const url = 'https://api.cricapi.com/v1/series_info?apikey=' + CRICAPI_KEY + '&id=' + IPL_2026_SERIES_ID
  try {
    const res = await fetch(url)
    const data = await res.json()
    const matchList = data.data && data.data.matchList ? data.data.matchList : []
    log('  Series matchList length: ' + matchList.length)

    const shortnameMap = {
      'RCB': ['RCB'], 'SRH': ['SRH'], 'MI': ['MI'], 'KKR': ['KKR'],
      'CSK': ['CSK'], 'RR': ['RR'], 'DC': ['DC'], 'GT': ['GT'],
      'LSG': ['LSG'], 'PBKS': ['PBKS'],
    }

    const homeNames = shortnameMap[homeTeam] || [homeTeam]
    const awayNames = shortnameMap[awayTeam] || [awayTeam]

    for (const m of matchList) {
      const teams = (m.teamInfo || []).map(function(t) { return (t.shortname || '').toUpperCase() })
      const hasHome = homeNames.some(function(n) { return teams.includes(n) })
      const hasAway = awayNames.some(function(n) { return teams.includes(n) })
      if (hasHome && hasAway) {
        log('  Candidate: ' + m.name + ' | ended=' + m.matchEnded)
        if (m.matchEnded === true) {
          log('  Selected: ' + m.name + ' id=' + m.id)
          return m.id
        }
      }
    }
    log('  No completed match found for ' + homeTeam + ' vs ' + awayTeam)
  } catch (e) {
    log('  Series search error: ' + e.message)
  }
  return null
}

async function getScorecard(cricMatchId) {
  const url = 'https://api.cricapi.com/v1/match_scorecard?apikey=' + CRICAPI_KEY + '&id=' + cricMatchId
  const res = await fetch(url)
  const data = await res.json()
  return data.data || null
}

function formatScorecard(scorecard) {
  if (!scorecard) return ''
  var text = 'Match: ' + (scorecard.name || 'IPL 2026') + '\n\n'
  if (scorecard.score) {
    text += 'Scores: ' + scorecard.score.map(function(s) {
      return s.inning + ': ' + s.r + '/' + s.w + ' (' + s.o + ' ov)'
    }).join(', ') + '\n\n'
  }
  if (scorecard.scorecard) {
    for (var i = 0; i < scorecard.scorecard.length; i++) {
      var innings = scorecard.scorecard[i]
      text += '=== ' + innings.inning + ' ===\nBATTING:\n'
      for (var j = 0; j < (innings.batting || []).length; j++) {
        var b = innings.batting[j]
        if (b.r !== undefined) {
          var bname = b.batsman && b.batsman.name ? b.batsman.name : (b.name || '')
          text += bname + ': ' + b.r + '(' + b.b + ') ' + (b['4s'] || 0) + 'x4 ' + (b['6s'] || 0) + 'x6 - ' + (b.dismissal || 'not out') + '\n'
        }
      }
      text += '\nBOWLING:\n'
      for (var k = 0; k < (innings.bowling || []).length; k++) {
        var bw = innings.bowling[k]
        if (bw.o !== undefined) {
          var bwname = bw.bowler && bw.bowler.name ? bw.bowler.name : (bw.name || '')
          text += bwname + ': ' + bw.o + 'ov ' + bw.r + 'r ' + bw.w + 'wkt\n'
        }
      }
      text += '\n'
    }
  }
  return text
}

async function calculatePoints(scorecardText) {
  var system = 'You are a cricket fantasy scoring calculator. Respond with ONLY a valid JSON object. No text before or after. Start with { and end with }.'

  var prompt = 'Calculate fantasy points for this IPL 2026 match.\n\n' + scorecardText + '\n\n' +
    'BATTING: +1/run, +1/four, +2/six, +2 per full 10 runs beyond 10 (so 10-19=+2, 20-29=+4 etc), -2 duck.\n' +
    'SR BOOSTER: FinalBat = BaseBat * (BatterSR / MatchSR) if >=10r or >=5b. Where BatterSR = runs/balls (ratio, e.g. 1.5 not 150) and MatchSR = totalRuns/totalBalls (ratio, e.g. 1.75 not 175).\n' +
    'BOWLING: 1wkt=25, each additional wicket adds 20 (so 2=45, 3=65, 4=85, 5=105). +3/dot, +10/maiden, -1/single conceded.\n' +
    'ECO BOOSTER: FinalBowl = BaseBowl * (MatchER / BowlerER) if >=1 over. MatchER = totalRuns/totalOvers (runs per over).\n' +
    'FIELDING: +8 catch, +8 stumping, +8 run-out.\n\n' +
    'IMPORTANT: matchSR must be stored as a RATIO (runs/balls), e.g. 1.75 not 175. matchER is runs per over, e.g. 10.5.\n\n' +
    'Return ONLY: {"result":"TEAM1 score beat TEAM2","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}'

  var res = await fetch('https://api.anthropic.com/v1/messages', {
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
      var cricMatchId = await findMatchInSeries(match.home_team, match.away_team)
      var scorecardText = ''

      if (cricMatchId) {
        log('  Found in CricAPI: ' + cricMatchId)
        var scorecard = await getScorecard(cricMatchId)
        if (scorecard) {
          scorecardText = formatScorecard(scorecard)
          log('  Scorecard fetched (' + scorecardText.length + ' chars)')
        }
      }

      if (!scorecardText) {
        log('  Using Claude memory fallback')
        scorecardText = 'Match: ' + match.home_team + ' vs ' + match.away_team + ', ' + match.date + ', ' + match.venue + '. Use your knowledge of this IPL 2026 match.'
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
