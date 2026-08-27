import { NextResponse } from 'next/server'

const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'

export async function GET() {
  const cricKey = process.env.CRICAPI_KEY
  if (!cricKey) return NextResponse.json({ error: 'CRICAPI_KEY not set' })

  const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${cricKey}&id=${SERIES_ID}`)
  const data = await res.json()
  const matchList = data?.data?.matchList || []

  const summary = matchList.map((m: any) => ({
    name: m.name,
    date: m.date,
    dateTimeGMT: m.dateTimeGMT,
    teams: m.teams,
    teamShortnames: (m.teamInfo || []).map((t: any) => t.shortname),
    teamNames: (m.teamInfo || []).map((t: any) => t.name),
  }))

  return NextResponse.json({ total: matchList.length, matches: summary })
}
