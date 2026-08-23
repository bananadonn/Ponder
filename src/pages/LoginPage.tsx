import { FormEvent, useId, useState } from 'react'
import { signInWithPassword, signUpWithPassword } from '../data/auth'
import PonderMark from '../components/PonderMark'

const NOISE_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

const MIN_PASSWORD_LENGTH = 6

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const emailId = useId()
  const passwordId = useId()
  const confirmPasswordId = useId()

  function switchMode(next: 'signin' | 'signup') {
    setMode(next)
    setStatus('idle')
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'signup' && password !== confirmPassword) {
      setStatus('error')
      setError('Passwords don’t match')
      return
    }

    setStatus('working')
    setError(null)
    try {
      // No further action needed on success -- App re-renders into
      // MainLayout once useAuth's onAuthStateChange listener picks up the
      // new session.
      if (mode === 'signin') {
        await signInWithPassword(email, password)
      } else {
        await signUpWithPassword(email, password)
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-mist-50 md:flex-row">
      <div className="relative flex min-h-[34vh] w-full items-end overflow-hidden px-8 py-10 md:min-h-screen md:w-[58%] md:items-center md:px-16 md:py-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 15% 8%, #454d55 0%, #2f353b 42%, #1c2024 100%), linear-gradient(165deg, #1c2024 0%, #2f353b 60%, #454d55 100%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{ backgroundImage: NOISE_BG }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-1/2"
          style={{
            background: 'linear-gradient(to top, rgba(28,32,36,0.55), transparent)',
          }}
        />
        <PonderMark className="pointer-events-none absolute -bottom-10 -right-16 h-64 w-auto text-mist-50 opacity-[0.06] md:h-80" />
        <div className="relative max-w-md">
          <PonderMark className="mb-4 h-7 w-auto text-mist-300 md:h-8" />
          <p className="font-display text-3xl font-extrabold tracking-tight text-mist-50 md:text-4xl">
            Ponder
          </p>
          <p className="mt-4 text-base leading-relaxed text-mist-300 md:text-lg">
            A private place to write, and to look back.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12 md:px-12">
        <div className="w-full max-w-sm rounded-card bg-white px-8 py-10 shadow-rest md:px-10 md:py-12">
          <h1 className="font-display text-xl font-bold text-mist-900">
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-mist-600">
            {mode === 'signin' ? 'Welcome back.' : 'Just an email and a password — no confirmation email either.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-mist-700">
                Email
              </label>
              <input
                id={emailId}
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-soft border border-mist-200 px-3.5 py-2.5 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
              />
            </div>
            <div>
              <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-mist-700">
                Password
              </label>
              <input
                id={passwordId}
                type="password"
                required
                minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-soft border border-mist-200 px-3.5 py-2.5 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
              />
            </div>
            {mode === 'signup' && (
              <div>
                <label htmlFor={confirmPasswordId} className="mb-1.5 block text-sm font-medium text-mist-700">
                  Confirm password
                </label>
                <input
                  id={confirmPasswordId}
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-soft border border-mist-200 px-3.5 py-2.5 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={status === 'working'}
              className="w-full rounded-soft bg-mist-900 px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-mist-700 disabled:opacity-50"
            >
              {status === 'working'
                ? mode === 'signin'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>

          <button
            type="button"
            onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
            className="mt-5 text-sm font-medium text-mist-500 transition-colors hover:text-mist-900"
          >
            {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
