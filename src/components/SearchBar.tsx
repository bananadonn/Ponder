interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchBar({ value, onChange, placeholder = 'Find entries…' }: SearchBarProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-soft border border-mist-200 bg-white px-3 py-2 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
    />
  )
}
