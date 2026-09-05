export type MobileView = 'list' | 'composer' | 'reflect'

function EntriesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function JournalIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 19.5V17l11-11 2.5 2.5-11 11H4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m14 7 2.5-2.5L19 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function ReflectIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m14.5 9.5-1.8 4.2a1 1 0 0 1-.52.52L8 16l1.8-4.2a1 1 0 0 1 .52-.52L14.5 9.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const TABS: { view: MobileView; label: string; icon: () => JSX.Element }[] = [
  { view: 'list', label: 'Entries', icon: EntriesIcon },
  { view: 'composer', label: 'Journal', icon: JournalIcon },
  { view: 'reflect', label: 'Reflect', icon: ReflectIcon },
]

// A persistent, always-reachable way to switch between the app's three main
// views on mobile, where only one of Rack/Journal/Reflect is ever on screen
// at a time. Replaces the old header-only compass button, which was easy to
// miss and gave no way back out of Reflect once in it.
export default function MobileTabBar({
  active,
  onSelect,
}: {
  active: MobileView
  onSelect: (view: MobileView) => void
}) {
  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-mist-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ view, label, icon: Icon }) => (
        <button
          key={view}
          type="button"
          onClick={() => onSelect(view)}
          aria-current={active === view}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
            active === view ? 'text-mist-900' : 'text-mist-400 hover:text-mist-600'
          }`}
        >
          <Icon />
          {label}
        </button>
      ))}
    </nav>
  )
}
