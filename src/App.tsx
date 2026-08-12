import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import EntriesPage from './pages/EntriesPage'
import EntryEditorPage from './pages/EntryEditorPage'
import DebugChunksPage from './pages/DebugChunksPage'
import DebugSearchPage from './pages/DebugSearchPage'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-stone-500">Loading…</div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<EntriesPage />} />
      <Route path="/entries/new" element={<EntryEditorPage />} />
      <Route path="/entries/:id" element={<EntryEditorPage />} />
      <Route path="/debug/chunks" element={<DebugChunksPage />} />
      <Route path="/debug/search" element={<DebugSearchPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
