import { FormEvent, useId, useState } from 'react'
import { signInWithMagicLink } from '../data/auth'

const NOISE_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

function MailIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.5C4 5.67 4.67 5 5.5 5h13c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m5 6.5 7 6 7-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const emailId = useId()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      await signInWithMagicLink(email)
      setStatus('sent')
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
        <div className="relative max-w-md">
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
          {status === 'sent' ? (
            <div>
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-ember-50 text-ember-600 ring-1 ring-ember-100">
                <MailIcon />
              </div>
              <h1 className="font-display text-xl font-bold text-mist-900">Check your inbox</h1>
              <p className="mt-2 text-sm leading-relaxed text-mist-600">
                We sent a sign-in link to <span className="font-medium text-mist-800">{email}</span>. Open
                it on this device to continue.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold text-mist-900">Sign in</h1>
              <p className="mt-2 text-sm leading-relaxed text-mist-600">
                We'll email you a link — no password needed.
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
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="w-full rounded-soft bg-mist-900 px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-mist-700 disabled:opacity-50"
                >
                  {status === 'sending' ? 'Sending link…' : 'Send magic link'}
                </button>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
