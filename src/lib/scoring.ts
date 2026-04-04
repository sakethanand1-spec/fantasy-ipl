// src/lib/scoring.ts
// Fantasy points calculation — identical logic to the HTML app

export function calcBatting(
  runs: number, balls: number, fours: number, sixes: number,
  duck: boolean, matchSR: number
) {
  if (duck && runs === 0) return { base: -2, final: -2, sr: 0 }

  let base = runs + fours + sixes * 2
  if (runs >= 10) base += Math.floor((runs - 10) / 10) * 2

  const sr = balls > 0 ? (runs / balls) * 100 : 0
  const final = (runs >= 10 || balls >= 5) ? base * (sr / matchSR) : base

  return { base: +base.toFixed(1), final: +final.toFixed(1), sr: +sr.toFixed(1) }
}

export function calcBowling(
  wkts: number, overs: number, runs: number,
  dots: number, singles: number, maidens: number,
  matchER: number
) {
  let base = 0
  if (wkts > 0) base += wkts * 25 + (wkts - 1) * 5
  base += dots * 3 + maidens * 10 - singles

  const er = overs > 0 ? runs / overs : 0
  const final = (overs >= 1 && er > 0) ? base * (matchER / er) : base

  return { base: +base.toFixed(1), final: +final.toFixed(1), er: +er.toFixed(1) }
}

export function calcFielding(catches: number, stumpings: number, runouts: number) {
  return (catches + stumpings + runouts) * 8
}

export function calcMatchStats(totalRuns: number, totalBalls: number, totalOvers: number) {
  const matchSR = totalBalls > 0 ? (totalRuns / totalBalls) * 100 : 0
  const matchER = totalOvers > 0 ? totalRuns / totalOvers : 0
  return { matchSR: +matchSR.toFixed(1), matchER: +matchER.toFixed(2) }
}

// Auto-XI: top 11 players by points for a given week
export function getAutoXI(
  playerPoints: Record<string, number>,  // playerId → weekPts
  squadPlayerIds: string[]
): string[] {
  return squadPlayerIds
    .map(id => ({ id, pts: playerPoints[id] || 0 }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 11)
    .map(p => p.id)
}
