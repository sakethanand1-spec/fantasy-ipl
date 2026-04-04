// src/app/transfers/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getLeague } from '@/lib/queries'

export const revalidate = 30

export default async function TransfersPage() {
  const league = await getLeague()
  if (!league) return <div className="text-navy-400">League not found.</div>

  const supabase = createClient()
  const { data: transfers } = await supabase
    .from('transfers')
    .select(`*, team:teams(name, manager_name), player_out:players!player_out_id(name), player_in:players!player_in_id(name)`)
    .eq('league_id', league.id)
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="page-title">Transfers</div>
      <div className="page-subtitle">ALL WAIVER ACTIVITY · SEASON LOG</div>

      <div className="card">
        {(!transfers || transfers.length === 0) ? (
          <div className="p-10 text-center text-navy-400 text-sm">No transfers logged yet.</div>
        ) : (
          transfers.map((t: any) => (
            <div key={t.id} className="flex items-start gap-3 px-4 py-3.5 border-b border-navy-100 last:border-0 text-sm hover:bg-navy-50">
              <div className="bg-navy-100 text-navy-700 font-condensed font-bold text-xs px-2 py-1 rounded whitespace-nowrap mt-0.5 min-w-[48px] text-center">
                Wk {t.effective_week}
              </div>
              <div className="w-36 flex-shrink-0">
                <div className="font-condensed font-semibold text-navy-950">{t.team?.name}</div>
                <div className="text-navy-400 text-xs">{t.team?.manager_name}</div>
              </div>
              <div className="flex-1">
                <div className="text-green-700 font-medium">↑ {t.player_in?.name}{t.cost_cr > 0 && <span className="text-navy-400 text-xs font-normal ml-1">· {t.cost_cr}cr</span>}</div>
                <div className="text-red-600">↓ {t.player_out?.name}</div>
                {t.note && <div className="text-navy-400 text-xs mt-0.5">{t.note}</div>}
              </div>
              <div className="text-navy-300 text-xs whitespace-nowrap mt-0.5">
                {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
