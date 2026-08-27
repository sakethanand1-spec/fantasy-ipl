import { NextResponse } from 'next/server'

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

export async function GET() {
  const cricKey = process.env.CRICAPI_KEY
  if (!cricKey) return NextResponse.json({ error: 'CRICAPI_KEY not set' })

  const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${cricKey}&id=${SERIES_ID}`)
  const data = await res.json()
  const matchList = data?.data?.matchList || []

  // Count matches per team pair
  const pairCounts: Record<string, { count: number; dates: string[] }> = {}
  const unrecognised: any[] = []

  for (const m of matchList) {
    const teams = new Set<string>()
    for (const t of (m.teamInfo || [])) {
      const n1 = normaliseTeam(t.shortname || ''); if (IPL_TEAMS.has(n1)) teams.add(n1)
      const n2 = normaliseTeam(t.name || ''); if (IPL_TEAMS.has(n2)) teams.add(n2)
    }
    for (const t of (m.teams || [])) {
      const n = normaliseTeam(t); if (IPL_TEAMS.has(n)) teams.add(n)
    }
    for (const p of (m.name || '').split(' vs ')) {
      const n = normaliseTeam(p.split(',')[0].trim()); if (IPL_TEAMS.has(n)) teams.add(n)
    }
    const arr = Array.from(teams).slice(0, 2).sort()
    if (arr.length < 2) { unrecognised.push({ name: m.name, teamInfo: m.teamInfo, teams: m.teams }); continue }
    const key = arr.join('|')
    if (!pairCounts[key]) pairCounts[key] = { count: 0, dates: [] }
    pairCounts[key].count++
    pairCounts[key].dates.push(m.date || m.dateTimeGMT || '?')
  }

  const singles = Object.entries(pairCounts).filter(([, v]) => v.count === 1).map(([k, v]) => ({ pair: k, dates: v.dates }))
  const doubles = Object.entries(pairCounts).filter(([, v]) => v.count === 2).map(([k, v]) => ({ pair: k, dates: v.dates }))
  const more = Object.entries(pairCounts).filter(([, v]) => v.count > 2).map(([k, v]) => ({ pair: k, count: v.count, dates: v.dates }))

  return NextResponse.json({
    total: matchList.length,
    singleFixturePairs: singles.length,
    doubleFixturePairs: doubles.length,
    singles,
    doubles,
    moreThanTwo: more,
    unrecognised,
    seriesInfo: { name: data?.data?.info?.name, startDate: data?.data?.info?.startDate, endDate: data?.data?.info?.endDate },
  })
}
