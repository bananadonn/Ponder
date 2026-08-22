import { Link } from 'react-router-dom'
import { signOut } from '../data/auth'

function CompassIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m14.5 9.5-1.8 4.2a1 1 0 0 1-.52.52L8 16l1.8-4.2a1 1 0 0 1 .52-.52L14.5 9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Header({
  email,
  onReflect,
}: {
  email: string | null | undefined
  onReflect?: () => void
}) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-mist-200 bg-mist-50 px-4 py-3">
      <Link to="/" className="font-display text-lg font-extrabold tracking-tight text-mist-900">
        Ponder
      </Link>
      <div className="flex items-center gap-3">
        {onReflect && (
          <button
            onClick={onReflect}
            aria-label="Reflect"
            title="Reflect"
            className="flex items-center text-mist-500 transition-colors hover:text-mist-900 md:hidden"
          >
            <CompassIcon />
          </button>
        )}
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
