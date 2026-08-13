import { Link } from 'react-router-dom'
import { signOut } from '../data/auth'

export default function Header({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-mist-200 bg-mist-50 px-4 py-3">
      <Link to="/" className="font-display text-lg font-extrabold tracking-tight text-mist-900">
        Ponder
      </Link>
      <div className="flex items-center gap-3">
        {email && <span className="hidden text-sm text-mist-500 sm:inline">{email}</span>}
        <button
          onClick={() => signOut().catch(console.error)}
          className="text-sm font-medium text-mist-500 transition-colors hover:text-mist-900"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
