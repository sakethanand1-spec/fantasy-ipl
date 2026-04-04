'use client'
// src/app/login/page.tsx
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    const supabase = createClient()

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      router.push('/standings')
      router.refresh()
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      setMessage('Check your email for a confirmation link.')
      setLoading(false)
    }
  }

  async function handleMagicLink() {
    if (!email) { setError('Enter your email first'); return }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/standings` } })
    if (error) { setError(error.message); setLoading(false); return }
    setMessage('Magic link sent — check your email.')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-navy-800 px-8 py-6">
          <div className="font-condensed font-extrabold text-2xl uppercase tracking-widest text-white">
            Fantasy IPL
          </div>
          <div className="text-navy-300 text-xs tracking-widest font-condensed mt-0.5">2026 · PRIVATE LEAGUE</div>
        </div>

        {/* Form */}
        <div className="px-8 py-6">
          <div className="flex rounded-lg overflow-hidden border border-navy-200 mb-6">
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-condensed font-semibold uppercase tracking-wider transition-colors ${
                  mode === m ? 'bg-navy-800 text-white' : 'text-navy-500 hover:bg-navy-50'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-condensed font-semibold uppercase tracking-wider text-navy-500 mb-1 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input w-full"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="text-xs font-condensed font-semibold uppercase tracking-wider text-navy-500 mb-1 block">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input w-full"
                placeholder="••••••••"
                required
              />
            </div>

            {error && <div className="text-red-600 text-sm">{error}</div>}
            {message && <div className="text-green-700 text-sm">{message}</div>}

            <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5">
              {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-navy-200" />
            <span className="text-xs text-navy-400 font-condensed">OR</span>
            <div className="flex-1 h-px bg-navy-200" />
          </div>

          <button
            onClick={handleMagicLink}
            disabled={loading}
            className="btn btn-secondary w-full mt-4 py-2.5"
          >
            ✉ Send Magic Link
          </button>

          <p className="text-center text-xs text-navy-400 mt-4">
            Invite only — contact your commissioner to join.
          </p>
        </div>
      </div>
    </div>
  )
}
