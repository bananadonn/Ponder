import { useCallback, useEffect, useState } from 'react'

export type PanelId = 'rack' | 'journal' | 'search'

export interface FloatGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface PanelLayout {
  floating: boolean
  dockedWidth?: number
  float?: FloatGeometry
}

export type LayoutState = Record<PanelId, PanelLayout>

const STORAGE_KEY = 'ponder:dock-layout'

const DEFAULT_LAYOUT: LayoutState = {
  rack: { floating: false, dockedWidth: 340 },
  journal: { floating: false },
  search: { floating: false, dockedWidth: 320 },
}

// Used the first time a panel pops out, before it has a remembered geometry
// of its own. Staggered so all three don't stack exactly on top of each
// other if popped out in sequence.
const INITIAL_FLOAT: Record<PanelId, FloatGeometry> = {
  rack: { x: 40, y: 96, width: 340, height: 460 },
  journal: { x: 140, y: 120, width: 640, height: 520 },
  search: { x: 260, y: 144, width: 360, height: 500 },
}

function readLayout(): LayoutState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_LAYOUT
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutState>
    return {
      rack: { ...DEFAULT_LAYOUT.rack, ...parsed.rack },
      journal: { ...DEFAULT_LAYOUT.journal, ...parsed.journal },
      search: { ...DEFAULT_LAYOUT.search, ...parsed.search },
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function writeLayout(layout: LayoutState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
}

export function useDockLayout() {
  const [layout, setLayout] = useState<LayoutState>(readLayout)

  useEffect(() => {
    writeLayout(layout)
  }, [layout])

  const popOut = useCallback((id: PanelId) => {
    setLayout((prev) => ({
      ...prev,
      [id]: { ...prev[id], floating: true, float: prev[id].float ?? INITIAL_FLOAT[id] },
    }))
  }, [])

  const dock = useCallback((id: PanelId) => {
    setLayout((prev) => ({ ...prev, [id]: { ...prev[id], floating: false } }))
  }, [])

  const resize = useCallback((id: PanelId, width: number) => {
    setLayout((prev) => ({ ...prev, [id]: { ...prev[id], dockedWidth: width } }))
  }, [])

  const setFloatGeometry = useCallback((id: PanelId, geometry: FloatGeometry) => {
    setLayout((prev) => ({ ...prev, [id]: { ...prev[id], float: geometry } }))
  }, [])

  return { layout, popOut, dock, resize, setFloatGeometry }
}
