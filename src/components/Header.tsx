import { Link } from 'react-router-dom'
import { signOut } from '../data/auth'
import PonderMark from './PonderMark'

export default function Header({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-mist-200 bg-mist-50 px-4 py-3">
      <Link to="/" className="flex items-center gap-2 text-mist-900">
        <PonderMark className="h-5 w-auto" />
        <span className="font-display text-lg font-extrabold tracking-tight">Ponder</span>
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
