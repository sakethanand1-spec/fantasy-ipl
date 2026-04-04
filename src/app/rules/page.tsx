// src/app/rules/page.tsx
export default function RulesPage() {
  return (
    <div>
      <div className="page-title">Scoring Rules</div>
      <div className="page-subtitle">FULL SYSTEM DOCUMENTATION</div>

      {[
        { title: '⚡ Batting', rows: [
          ['Per run scored', '+1'],
          ['Per four hit', '+1'],
          ['Per six hit', '+2'],
          ['Milestone bonus — +2 per full 10 runs beyond 10', '+2/10r'],
          ['Duck (0 runs, dismissed)', '−2'],
          ['SR Booster: Final = Base × (BatterSR ÷ MatchSR)', 'if ≥10r or ≥5b'],
        ]},
        { title: '🎳 Bowling', rows: [
          ['1 wicket', '+25'],
          ['2 wickets', '+55'],
          ['3 wickets', '+90'],
          ['4 wickets', '+130'],
          ['5 wickets', '+175'],
          ['Per dot ball', '+3'],
          ['Per maiden over', '+10'],
          ['Per single conceded', '−1'],
          ['Economy Booster: Final = Base × (MatchER ÷ BowlerER)', 'if ≥1 over'],
        ]},
        { title: '🧤 Fielding', rows: [
          ['Catch', '+8'],
          ['Stumping', '+8'],
          ['Run out', '+8'],
        ]},
        { title: '🏏 League Format', rows: [
          ['Managers', '8'],
          ['Squad size', '15'],
          ['Playing XI', 'Auto (top 11 by week pts)'],
          ['Draft', 'Auction'],
          ['League games', '70'],
          ['Matchweeks', '14 + Playoffs'],
          ['Season', 'Mar 28 – May 24, 2026'],
          ['Waiver boost', '+15cr after each gameweek'],
        ]},
      ].map(section => (
        <div key={section.title} className="mb-6">
          <div className="font-condensed font-bold text-lg uppercase tracking-wider text-navy-700 mb-3 flex items-center gap-3">
            {section.title}
            <div className="flex-1 h-px bg-navy-200" />
          </div>
          <div className="card divide-y divide-navy-100">
            {section.rows.map(([label, val]) => (
              <div key={label} className="flex items-center gap-4 px-5 py-3">
                <span className="flex-1 text-navy-600 text-sm">{label}</span>
                <span className="font-display font-bold text-navy-800 text-base">{val}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
