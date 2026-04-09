// scripts/auto-score.js
// Runs via GitHub Actions every hour
// 1. Finds matches that should be finished but aren't scored yet
// 2. Fetches scorecard from CricAPI
// 3. Sends to Claude to calculate fantasy points
// 4. Writes results to Supabase

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const CRICAPI_KEY = process.env.CRICAPI_KEY
const LEAGUE_SLUG = 'fantasy-ipl-2026'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Helpers ──────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

// Parse a date string like "Apr 5" into a Date object (2026)
function parseMatchDate(dateStr) {
  return new Date(`${dateStr} 2026`)
}

// Is a match likely finished? (started > 4 hours ago)
function isMatchLikelyFinished(dateStr) {
  const matchDate = parseMatchDate(dateStr)
  // IPL matches start 3:30pm or 7:30pm IST = 10:00 or 14:00 UTC
  // A T20 takes ~3.5 hrs. We assume finished if it's the next day IST (UTC+5:30)
  const now = new Date()
  const nowIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  const matchDateIST = new Date(matchDate.getTime() + 5.5 * 60 * 60 * 1000)

  // Match date in IST — if today is after match date, it's done
  const matchDay = matchDateIST.toDateString()
  const today = nowIST.toDateString()
  const yesterday = new Date(nowIST.getTime() - 24 * 60 * 60 * 1000).toDateString()

  // If match was yesterday or earlier → definitely done
  if (matchDay === yesterday || matchDate < new Date(nowIST.getTime() - 24 * 60 * 60 * 1000)) {
    return true
  }

  // If match is today → check if it's past 11:30pm IST (late enough for both matches to finish)
  if (matchDay === today) {
    return nowIST.getHours() >= 23
  }

  return false
}

// ── CricAPI ──────────────────────────────────────────────────

async function searchCricAPIMatch(homeTeam, awayTeam, dateStr) {
  // Search for the match in CricAPI's current matches
  const url = `https://api.cricapi.com/v1/cricScore?apikey=${CRICAPI_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  if (!data.data) return null

  // Match team names to CricAPI naming
  const teamMap = {
    'RCB': ['Royal Challengers', 'RCB', 'Bengaluru'],
    'SRH': ['Sunrisers', 'SRH', 'Hyderabad'],
    'MI': ['Mumbai Indians', 'MI'],
    'KKR': ['Kolkata Knight Riders', 'KKR', 'Kolkata'],
    'CSK': ['Chennai Super Kings', 'CSK', 'Chennai'],
    'RR': ['Rajasthan Royals', 'RR', 'Rajasthan'],
    'DC': ['Delhi Capitals', 'DC', 'Delhi'],
    'GT': ['Gujarat Titans', 'GT', 'Gujarat'],
    'LSG': ['Lucknow Super Giants', 'LSG', 'Lucknow'],
    'PBKS': ['Punjab Kings', 'PBKS', 'Punjab'],
  }

  const homeNames = teamMap[homeTeam] || [homeTeam]
  const awayNames = teamMap[awayTeam] || [awayTeam]

  for (const match of data.data) {
    const name = (match.name || '').toLowerCase()
    const homeMatch = homeNames.some(n => name.includes(n.toLowerCase()))
    const awayMatch = awayNames.some(n => name.includes(n.toLowerCase()))
    if (homeMatch && awayMatch) return match.id
  }

  return null
}

async function getMatchScorecard(matchId) {
  const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${matchId}`
  const res = await fetch(url)
  const data = await res.json()
  return data.data || null
}

async function searchMatchInSeries(homeTeam, awayTeam, dateStr) {
  // Search CricAPI matches list for IPL 2026
  const url = `https://api.cricapi.com/v1/matches?apikey=${CRICAPI_KEY}&offset=0`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (!data.data) return null

    const teamMap = {
      'RCB': 'royal challengers', 'SRH': 'sunrisers', 'MI': 'mumbai indians',
      'KKR': 'kolkata knight riders', 'CSK': 'chennai super kings',
      'RR': 'rajasthan royals', 'DC': 'delhi capitals', 'GT': 'gujarat titans',
      'LSG': 'lucknow super giants', 'PBKS': 'punjab kings',
    }

    const matchDate = parseMatchDate(dateStr)
    const dateStr8601 = matchDate.toISOString().split('T')[0]

    for (const m of data.data) {
      if (!(m.series || '').toLowerCase().includes('indian premier league')) continue
      const name = (m.name || '').toLowerCase()
      const homeOk = (teamMap[homeTeam] || homeTeam.toLowerCase()).split(' ').some(w => w.length > 3 && name.includes(w))
      const awayOk = (teamMap[awayTeam] || awayTeam.toLowerCase()).split(' ').some(w => w.length > 3 && name.includes(w))
      const dateOk = (m.date || '').startsWith(dateStr8601)
      if (homeOk && awayOk) {
        log(`  Series match found: ${m.name} (date match: ${dateOk})`)
        return m.id
      }
    }
  } catch (e) {
    log(`Series search error: ${e.message}`)
  }
  return null
}

// ── Claude scoring ────────────────────────────────────────────

function formatScorecardForClaude(scorecard) {
  // Convert CricAPI scorecard to readable text for Claude
  if (!scorecard) return ''

  let text = `Match: ${scorecard.name || 'IPL 2026'}\n\n`

  if (scorecard.score) {
    text += `Scores: ${scorecard.score.map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(', ')}\n\n`
  }

  if (scorecard.scorecard) {
    for (const innings of scorecard.scorecard) {
      text += `=== ${innings.inning} ===\n`
      text += `BATTING:\n`
      for (const b of (innings.batting || [])) {
        if (b.r !== undefined) {
          text += `${b.batsman?.name || b.name}: ${b.r}(${b.b}) ${b['4s']}x4 ${b['6s']}x6 - ${b.dismissal || 'not out'}\n`
        }
      }
      text += `\nBOWLING:\n`
      for (const bw of (innings.bowling || [])) {
        if (bw.o !== undefined) {
          text += `${bw.bowler?.name || bw.name}: ${bw.o}ov ${bw.r}r ${bw.w}wkt ${bw.wd || 0}wd ${bw.nb || 0}nb\n`
        }
      }
      text += '\n'
    }
  }

  return text
}

async function calculatePointsWithClaude(scorecardText, matchLabel) {
  const system = `You are a cricket fantasy scoring calculator. You must respond with ONLY a valid JSON object. Do not include any text before or after the JSON. Do not use markdown. Your entire response must start with { and end with }.`

  const prompt = `Calculate fantasy points for this IPL 2026 match.

${scorecardText}

BATTING: +1/run, +1/four, +2/six, +2 per full 10 runs beyond 10 (10-19=+2, 20-29=+4...), -2 duck. SR BOOSTER: FinalBat=BaseBat×(BatterSR/MatchSR) if ≥10r or ≥5b. MatchSR=(totalRuns/totalBalls)×100
BOWLING: 1wkt=25,2=55,3=90,4=130,5=175, +3/dot,+10/maiden,-1/single. ECONOMY BOOSTER: FinalBowl=BaseBowl×(MatchER/BowlerER) if ≥1 over. MatchER=totalRuns/totalOvers
FIELDING: +8 catch/stumping/run-out

Respond with ONLY this JSON structure, nothing else:
{"result":"TEAM1 score beat TEAM2 score","matchSR":0.0,"matchER":0.0,"players":{"Player Name":{"total":0.0,"breakdown":{"bat":{"base":0.0,"final":0.0,"sr":0.0},"bowl":{"base":0.0,"final":0.0,"er":0.0},"field":{"pts":0}}}}}`

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
      system,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' }, // prefill to force JSON
      ],
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  // Prepend the { we used as prefill
  const raw = '{' + (data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '')
  const clean = raw.replace(/```(?:json)?/gi, '').trim()
  try { return JSON.parse(clean) } catch {}
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(clean.slice(start, end + 1))

  throw new Error('Could not parse Claude response as JSON')
}

// ── Save to Supabase ──────────────────────────────────────────

async function savePoints(matchId, parsed) {
  if (!parsed?.players || !Object.keys(parsed.players).length) {
    log(`No players in response for match ${matchId}`)
    return 0
  }

  const playerNames = Object.keys(parsed.players)
  const { data: players } = await supabase
    .from('players')
    .select('id, name')
    .in('name', playerNames)

  const nameToId = {}
  for (const p of (players || [])) nameToId[p.name] = p.id

  const rows = playerNames
    .filter(name => nameToId[name])
    .map(name => {
      const pp = parsed.players[name]
      return {
        match_id: matchId,
        player_id: nameToId[name],
        total: pp.total || 0,
        bat_base: pp.breakdown?.bat?.base ?? null,
        bat_final: pp.breakdown?.bat?.final ?? null,
        bat_sr: pp.breakdown?.bat?.sr ?? null,
        bowl_base: pp.breakdown?.bowl?.base ?? null,
        bowl_final: pp.breakdown?.bowl?.final ?? null,
        bowl_er: pp.breakdown?.bowl?.er ?? null,
        field_pts: pp.breakdown?.field?.pts ?? null,
      }
    })

  if (rows.length) {
    const { error } = await supabase
      .from('player_points')
      .upsert(rows, { onConflict: 'match_id,player_id' })
    if (error) throw new Error(`Supabase upsert error: ${error.message}`)

    await supabase
      .from('matches')
      .update({
        scored: true,
        result: parsed.result || 'Scored',
        match_sr: parsed.matchSR,
        match_er: parsed.matchER,
      })
      .eq('id', matchId)
  }

  return rows.length
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  log('Auto-scorer starting...')

  // Get league
  const { data: league } = await supabase
    .from('leagues')
    .select('id')
    .eq('slug', LEAGUE_SLUG)
    .single()

  if (!league) { log('League not found'); process.exit(1) }

  // Get unscored matches that should be finished
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .eq('league_id', league.id)
    .eq('scored', false)
    .order('week')
    .order('match_num')

  if (!matches?.length) { log('No unscored matches found'); return }

  const toScore = matches.filter(m => isMatchLikelyFinished(m.date))
  log(`Found ${toScore.length} matches to score out of ${matches.length} unscored`)

  for (const match of toScore) {
    const label = `${match.home_team} vs ${match.away_team} (${match.date})`
    log(`Processing: ${label}`)

    try {
      // Try to find match in CricAPI
      let cricMatchId = await searchCricAPIMatch(match.home_team, match.away_team, match.date)
      if (!cricMatchId) {
        cricMatchId = await searchMatchInSeries(match.home_team, match.away_team, match.date)
      }

      let scorecardText = ''

      if (cricMatchId) {
        log(`  Found in CricAPI: ${cricMatchId}`)
        const scorecard = await getMatchScorecard(cricMatchId)
        if (scorecard) {
          scorecardText = formatScorecardForClaude(scorecard)
          log(`  Scorecard fetched (${scorecardText.length} chars)`)
        }
      } else {
        log(`  Not found in CricAPI, asking Claude from memory`)
        scorecardText = `Match: ${match.home_team} vs ${match.away_team}, ${match.date}, ${match.venue}\nPlease use your knowledge of this IPL 2026 match.`
      }

      // Calculate points with Claude
      const parsed = await calculatePointsWithClaude(scorecardText, label)
      log(`  Claude returned ${Object.keys(parsed.players || {}).length} players`)

      // Save to Supabase
      const saved = await savePoints(match.id, parsed)
      log(`  ✓ Saved ${saved} player point rows for ${label}`)

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 2000))

    } catch (err) {
      log(`  ✗ Error scoring ${label}: ${err.message}`)
    }
  }

  log('Auto-scorer complete')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})