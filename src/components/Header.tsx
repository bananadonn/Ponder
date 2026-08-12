import { Link } from 'react-router-dom'
import { signOut } from '../data/auth'

export default function Header({ email }: { email: string | null | undefined }) {
  return (
    <header className="mb-6 flex items-center justify-between">
      <Link to="/" className="text-lg font-semibold text-stone-900">
        Ponder
      </Link>
      <div className="flex items-center gap-3">
        {email && <span className="text-sm text-stone-500">{email}</span>}
        <button onClick={() => signOut().catch(console.error)} className="text-sm text-stone-500 hover:text-stone-900">
          Sign out
        </button>
      </div>
    </header>
  )
}
