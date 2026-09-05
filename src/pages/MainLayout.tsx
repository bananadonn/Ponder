import { useNavigate, useParams } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import GalleryPanel from '../components/GalleryPanel'
import Header from '../components/Header'
import MobileTabBar, { type MobileView } from '../components/MobileTabBar'
import RackPanel from '../components/RackPanel'
import SearchReflectPanel from '../components/SearchReflectPanel'
import DockPanel from '../components/dock/DockPanel'
import { useAuth } from '../hooks/useAuth'
import { useDockLayout } from '../hooks/useDockLayout'
import { listEntries } from '../data/entries'
import type { HybridFilters } from '../data/types'

export type ComposerContext = {
  refresh: () => void
  onSaved: (id: string) => void
  showList: () => void
}

// Matches Tailwind's `md` breakpoint. The desktop dock shell and the mobile
// single-pane-at-a-time view are structurally different (floating panels use
// fixed positioning, route Outlet has its own data-fetching side effects) —
// picking one via JS rather than showing/hiding both with CSS keeps exactly
// one copy of the composer/rack/search panels mounted at a time.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

export default function MainLayout() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { layout, popOut, dock, resize, setFloatGeometry } = useDockLayout()
  const isDesktop = useIsDesktop()

  // RackPanel owns its own entry list (filtered independently of the
  // composer) — bump this after a save/delete so it re-fetches without
  // losing its filter UI state, rather than remounting the whole panel.
  const [refreshSignal, setRefreshSignal] = useState(0)
  const refresh = () => setRefreshSignal((t) => t + 1)

  // The Rack's resolved filters, shared down to Reflect so its raw search
  // is constrained by the same emotion/topic/entity/date filters currently
  // active in the Rack (Reflect's own date filter layers on top of these).
  const [rackFilters, setRackFilters] = useState<HybridFilters>({})

  const [mobileView, setMobileView] = useState<MobileView>('list')

  // Which content the Journal panel shows — the active entry's composer, or
  // the Rack's "see every photo in the journal" gallery. Desktop-only state:
  // on mobile the Journal panel is whatever's docked into the 'composer'
  // pane, so `mobileView` alone already covers switching to it.
  const [journalView, setJournalView] = useState<'entry' | 'gallery'>('entry')

  // Land a brand-new journal (no entries yet, no entry selected) straight on
  // the composer instead of an empty list — a one-off check independent of
  // RackPanel's own (possibly filtered) entry list.
  useEffect(() => {
    if (id) return
    listEntries()
      .then((entries) => {
        if (entries.length === 0) setMobileView('composer')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openEntry(entryId: string) {
    navigate(`/entries/${entryId}`)
    setJournalView('entry')
    setMobileView('composer')
  }

  function openNewEntry() {
    navigate('/')
    setJournalView('entry')
    setMobileView('composer')
  }

  function openGallery() {
    setJournalView('gallery')
    setMobileView('composer')
  }

  // Every other way of navigating (tab bar, Gallery's own back button) drops
  // back to the entry view — gallery is a one-off detour, not something that
  // should linger once you've moved on to another tab.
  function selectMobileTab(view: MobileView) {
    setJournalView('entry')
    setMobileView(view)
  }

  function onSaved(newId: string) {
    navigate(`/entries/${newId}`, { replace: true })
    refresh()
  }

  const context: ComposerContext = { refresh, onSaved, showList: () => setMobileView('list') }

  return (
    <div className="flex h-screen flex-col bg-mist-50">
      <Header email={user?.email} />

      <div className="relative flex min-h-0 flex-1">
        {isDesktop ? (
          <>
            <DockPanel
              id="rack"
              title="Rack"
              layout={layout.rack}
              onPopOut={() => popOut('rack')}
              onDock={() => dock('rack')}
              onResize={(w) => resize('rack', w)}
              onFloatGeometryChange={(g) => setFloatGeometry('rack', g)}
              resizeEdge="right"
              minWidth={260}
              maxWidth={520}
              className="border-r border-mist-200 bg-mist-50"
            >
              <RackPanel
                refreshSignal={refreshSignal}
                activeEntryId={id}
                onSelectEntry={openEntry}
                onNewEntry={openNewEntry}
                onOpenGallery={openGallery}
                onFiltersChange={setRackFilters}
              />
            </DockPanel>

            <DockPanel
              id="journal"
              title="Journal"
              layout={layout.journal}
              onPopOut={() => popOut('journal')}
              onDock={() => dock('journal')}
              onFloatGeometryChange={(g) => setFloatGeometry('journal', g)}
              minWidth={360}
              maxWidth={1200}
            >
              {journalView === 'gallery' ? (
                <GalleryPanel onOpenEntry={openEntry} onClose={() => setJournalView('entry')} />
              ) : (
                <Outlet context={context} />
              )}
            </DockPanel>

            <DockPanel
              id="search"
              title="Reflect"
              layout={layout.search}
              onPopOut={() => popOut('search')}
              onDock={() => dock('search')}
              onResize={(w) => resize('search', w)}
              onFloatGeometryChange={(g) => setFloatGeometry('search', g)}
              resizeEdge="left"
              minWidth={260}
              maxWidth={480}
              className="border-l border-mist-200 bg-mist-50"
            >
              <SearchReflectPanel onOpenEntry={openEntry} filters={rackFilters} />
            </DockPanel>
          </>
        ) : (
          <>
            <div className={`${mobileView === 'list' ? 'flex' : 'hidden'} min-h-0 w-full flex-col`}>
              <RackPanel
                refreshSignal={refreshSignal}
                activeEntryId={id}
                onSelectEntry={openEntry}
                onNewEntry={openNewEntry}
                onOpenGallery={openGallery}
                onFiltersChange={setRackFilters}
              />
            </div>
            <div className={`${mobileView === 'composer' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col`}>
              {journalView === 'gallery' ? (
                <GalleryPanel onOpenEntry={openEntry} onClose={() => selectMobileTab('list')} />
              ) : (
                <Outlet context={context} />
              )}
            </div>
            <div className={`${mobileView === 'reflect' ? 'flex' : 'hidden'} min-h-0 w-full flex-col`}>
              <SearchReflectPanel onOpenEntry={openEntry} filters={rackFilters} />
            </div>
          </>
        )}
      </div>

      {!isDesktop && <MobileTabBar active={mobileView} onSelect={selectMobileTab} />}
    </div>
  )
}
