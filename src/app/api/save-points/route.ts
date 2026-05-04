import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
  const { matchId, rows, result, matchSR, matchER } = await req.json()

  const { error: ppError } = await supabase
    .from('player_points')
    .upsert(rows, { onConflict: 'match_id,player_id' })

  if (ppError) return NextResponse.json({ error: ppError.message }, { status: 500 })

  const { error: mError } = await supabase
    .from('matches')
    .update({ scored: true, result, match_sr: matchSR, match_er: matchER })
    .eq('id', matchId)

  if (mError) return NextResponse.json({ error: mError.message }, { status: 500 })

  return NextResponse.json({ saved: rows.length })
}