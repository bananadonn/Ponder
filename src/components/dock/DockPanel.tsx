import { useRef } from 'react'
import type { FloatGeometry, PanelId, PanelLayout } from '../../hooks/useDockLayout'

// Clamp floating panels below the top app header so they can never be
// dragged out from under it.
const HEADER_HEIGHT = 56

// Floating windows have no upper size limit — this is just a floor so the
// header/resize handle can't shrink to a sliver you can no longer grab.
const FLOAT_MIN_SIZE = 160

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function PopOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface DockPanelProps {
  id: PanelId
  title: string
  layout: PanelLayout
  onPopOut: () => void
  onDock: () => void
  onResize?: (width: number) => void
  onFloatGeometryChange: (geometry: FloatGeometry) => void
  resizeEdge?: 'left' | 'right'
  // Docked-resize bounds only — floating windows are unbounded (see
  // FLOAT_MIN_SIZE).
  minWidth?: number
  maxWidth?: number
  className?: string
  children: React.ReactNode
}

export default function DockPanel({
  id,
  title,
  layout,
  onPopOut,
  onDock,
  onResize,
  onFloatGeometryChange,
  resizeEdge,
  minWidth = 240,
  maxWidth = 640,
  className,
  children,
}: DockPanelProps) {
  const floatRef = useRef(layout.float)
  floatRef.current = layout.float

  function handleDockResizeStart(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = layout.dockedWidth ?? minWidth
    const sign = resizeEdge === 'right' ? 1 : -1

    function onMove(ev: PointerEvent) {
      const next = clamp(startWidth + (ev.clientX - startX) * sign, minWidth, maxWidth)
      onResize?.(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleDragStart(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    if (!floatRef.current) return
    const { x: ox, y: oy, width: ow, height: oh } = floatRef.current
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY

    function onMove(ev: PointerEvent) {
      const nextX = clamp(ox + (ev.clientX - startX), 0, window.innerWidth - ow)
      const nextY = clamp(oy + (ev.clientY - startY), HEADER_HEIGHT, window.innerHeight - 40)
      onFloatGeometryChange({ x: nextX, y: nextY, width: ow, height: oh })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleFloatResizeStart(e: React.PointerEvent) {
    if (!floatRef.current) return
    const { x: ox, y: oy, width: ow, height: oh } = floatRef.current
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY

    function onMove(ev: PointerEvent) {
      // Floating windows are deliberately unbounded above (unlike docked
      // resize, which shares space with the other panels) — only a small
      // floor keeps the header/handle from shrinking to an unrecoverable
      // sliver.
      const width = Math.max(ow + (ev.clientX - startX), FLOAT_MIN_SIZE)
      const height = Math.max(oh + (ev.clientY - startY), FLOAT_MIN_SIZE)
      onFloatGeometryChange({ x: ox, y: oy, width, height })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (layout.floating && layout.float) {
    const float = layout.float
    return (
      // The rounded/clipped card lives in an inner wrapper so the resize
      // handle (an outer sibling) never gets clipped by the corner radius —
      // a handle positioned at the exact corner of an `overflow-hidden`
      // rounded container loses most of its hit area to the curve.
      <div className="fixed z-40" style={{ left: float.x, top: float.y, width: float.width, height: float.height }}>
        <div className="flex h-full w-full flex-col overflow-hidden rounded-card border border-mist-200 bg-white shadow-rest">
          <div
            onPointerDown={handleDragStart}
            className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-mist-200 bg-mist-50 px-3 py-2"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-mist-500">{title}</span>
            <button
              onClick={onDock}
              aria-label={`Dock ${title}`}
              title="Dock"
              className="text-mist-400 transition-colors hover:text-mist-700"
            >
              <DockIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
        <div
          onPointerDown={handleFloatResizeStart}
          aria-label={`Resize ${title}`}
          role="separator"
          className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-mist-400 hover:text-mist-600"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M8 2 2 8M8 6 6 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )
  }

  const isJournal = id === 'journal'

  return (
    <div
      className={`relative flex min-h-0 flex-col ${isJournal ? 'flex-1' : 'shrink-0'} ${className ?? ''}`}
      style={isJournal ? undefined : { width: layout.dockedWidth ?? minWidth }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-mist-200 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-mist-500">{title}</span>
        <button
          onClick={onPopOut}
          aria-label={`Pop out ${title}`}
          title="Pop out"
          className="text-mist-400 transition-colors hover:text-mist-700"
        >
          <PopOutIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {resizeEdge && (
        <div
          onPointerDown={handleDockResizeStart}
          aria-hidden="true"
          // Straddles the panel border with a generous hit area (the visual
          // line only needs to be a hairline, but a 4px hit target is too
          // thin to reliably grab) — offset by half its own width so it's
          // centered on the border rather than sitting entirely inside one
          // panel.
          className={`absolute top-0 z-10 h-full w-2.5 cursor-col-resize hover:bg-mist-300 ${
            resizeEdge === 'right' ? '-right-1' : '-left-1'
          }`}
        />
      )}
    </div>
  )
}
