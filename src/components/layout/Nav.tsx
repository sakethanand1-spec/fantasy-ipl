'use client'
// src/components/layout/Nav.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_LINKS = [
  { href: '/standings', label: 'Standings' },
  { href: '/weeks',     label: 'Weeks' },
  { href: '/teams',     label: 'Teams' },
  { href: '/transfers', label: 'Transfers' },
  { href: '/waivers',   label: 'Waivers' },
  { href: '/rules',     label: 'Rules' },
]

export default function Nav({ managerName }: { managerName?: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 bg-navy-800 border-b border-navy-900 shadow-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-6">
        {/* Logo */}
        <Link href="/standings" className="flex-shrink-0">
          <span className="font-condensed font-extrabold text-xl uppercase tracking-wider text-white">
            Fantasy IPL
          </span>
          <span className="font-condensed text-navy-300 text-xs tracking-widest ml-2">2026</span>
        </Link>

        {/* Nav links */}
        <nav className="flex gap-1 flex-1 overflow-x-auto">
          {NAV_LINKS.map(link => {
            const active = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  font-condensed font-semibold text-sm tracking-wider uppercase px-3 py-1.5 rounded-md
                  transition-all whitespace-nowrap
                  ${active
                    ? 'bg-white/15 text-white border border-white/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                  }
                `}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        {/* User info + sign out */}
        {managerName && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-white/60 text-xs font-condensed tracking-wider hidden sm:block">
              {managerName}
            </span>
            <button onClick={signOut} className="btn btn-sm bg-white/10 text-white/80 hover:bg-white/20 border border-white/20">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
