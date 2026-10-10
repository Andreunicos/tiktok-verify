import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AnalysisResult, Marker, Segment, Suggestion } from '@shared/types'
import { formatTimecode } from '@shared/time'

export interface TimelineProps {
  duration: number
  current: number
  analysis: AnalysisResult | null
  thumbnails: { timeSec: number; url: string }[]
  markers: Marker[]
  suggestions: Suggestion[]
  segments: Segment[]
  selectedId: string | null
  onSeek: (sec: number) => void
  onSelect: (segmentId: string | null) => void
  onRangeChange: (segmentId: string, rangeIndex: number, startSec: number, endSec: number, done: boolean) => void
  onSuggestionClick?: (s: Suggestion) => void
}

const ROW = { thumbs: 44, ruler: 20, wave: 64, sugg: 8, segs: 26 }
const HEIGHT = ROW.thumbs + ROW.ruler + ROW.wave + ROW.sugg + ROW.segs
const HANDLE_PX = 7
const MAX_PPS = 400

type Drag =
  | { kind: 'seek' }
  | { kind: 'handle'; segId: string; idx: number; edge: 'start' | 'end'; start: number; end: number }
  | { kind: 'move'; segId: string; idx: number; grabSec: number; start: number; end: number }

function niceStep(pps: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  return steps.find((s) => s * pps >= 70) ?? 3600
}

export function Timeline(p: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const [pps, setPps] = useState(0) // 0 = encaixar no vídeo inteiro
  const [scroll, setScroll] = useState(0)
  const drag = useRef<Drag | null>(null)
  const images = useRef(new Map<string, HTMLImageElement>())
  const [, force] = useState(0)

  const fitPps = width / Math.max(1, p.duration)
  const effPps = pps === 0 ? fitPps : Math.max(fitPps, pps)
  const total = p.duration * effPps
  const t2x = useCallback((t: number) => t * effPps - scroll, [effPps, scroll])
  const x2t = useCallback((x: number) => Math.max(0, Math.min(p.duration, (x + scroll) / effPps)), [effPps, scroll, p.duration])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Carrega miniaturas
  useEffect(() => {
    for (const t of p.thumbnails) {
      if (images.current.has(t.url)) continue
      const img = new Image()
      img.onload = () => force((n) => n + 1)
      img.src = t.url
      images.current.set(t.url, img)
    }
  }, [p.thumbnails])

  // Segue a agulha durante a reprodução
  useEffect(() => {
    const el = scrollRef.current
    if (!el || drag.current) return
    const x = p.current * effPps
    if (x < el.scrollLeft || x > el.scrollLeft + width - 20) el.scrollLeft = Math.max(0, x - width * 0.2)
  }, [p.current, effPps, width])

  const zoomAt = useCallback(
    (factor: number, anchorX: number) => {
      const el = scrollRef.current
      if (!el) return
      const anchorT = (anchorX + el.scrollLeft) / effPps
      const next = Math.min(MAX_PPS, Math.max(fitPps, effPps * factor))
      setPps(next <= fitPps * 1.001 ? 0 : next)
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, anchorT * next - anchorX)
      })
    },
    [effPps, fitPps]
  )

  // Roda do mouse: Ctrl = zoom; vertical = rolagem horizontal. Listener nativo para poder usar preventDefault.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - el.getBoundingClientRect().left)
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (e.key === '+' || e.key === '=') zoomAt(1.5, width / 2)
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.5, width / 2)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomAt, width])

  // Desenho
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(HEIGHT * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(c)
    const v = (n: string) => css.getPropertyValue(n).trim() || '#888'
    const col = {
      bg: v('--tl-bg'),
      wave: v('--tl-wave'),
      silence: v('--tl-silence'),
      text: v('--muted'),
      grid: v('--border'),
      seg: v('--accent'),
      segSel: v('--accent-2'),
      marker: v('--warn'),
      scene: v('--muted'),
      head: v('--text'),
      ok: v('--ok')
    }
    g.clearRect(0, 0, width, HEIGHT)
    g.fillStyle = col.bg
    g.fillRect(0, 0, width, HEIGHT)
    const t0 = x2t(0)
    const t1 = x2t(width)

    // Miniaturas
    if (p.thumbnails.length) {
      const span = p.duration / p.thumbnails.length
      for (const t of p.thumbnails) {
        const img = images.current.get(t.url)
        const x = t2x(t.timeSec - span / 2)
        const w = span * effPps
        if (x + w < 0 || x > width || !img?.complete || !img.naturalWidth) continue
        const h = ROW.thumbs - 4
        const iw = Math.min(w, (img.naturalWidth / img.naturalHeight) * h)
        for (let xx = x; xx < x + w; xx += iw) g.drawImage(img, xx, 2, Math.min(iw, x + w - xx), h)
      }
    }

    // Régua
    const ry = ROW.thumbs
    const step = niceStep(effPps)
    g.font = '10px system-ui, sans-serif'
    g.fillStyle = col.text
    g.strokeStyle = col.grid
    g.lineWidth = 1
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = Math.round(t2x(t)) + 0.5
      g.beginPath()
      g.moveTo(x, ry + 12)
      g.lineTo(x, ry + ROW.ruler)
      g.stroke()
      g.fillText(formatTimecode(t).replace(/\.000$/, ''), x + 3, ry + 10)
    }

    // Forma de onda + silêncios
    const wy = ry + ROW.ruler
    const mid = wy + ROW.wave / 2
    if (p.analysis) {
      g.fillStyle = col.silence
      for (const s of p.analysis.silences) {
        if (s.endSec < t0 || s.startSec > t1) continue
        g.fillRect(t2x(s.startSec), wy, (s.endSec - s.startSec) * effPps, ROW.wave)
      }
      const peaks = p.analysis.peaks
      const bs = p.analysis.bucketSec
      g.fillStyle = col.wave
      for (let x = 0; x < width; x++) {
        const a = Math.max(0, Math.floor(x2t(x) / bs))
        const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil(x2t(x + 1) / bs)))
        let m = 0
        for (let i = a; i < b; i++) if (peaks[i] > m) m = peaks[i]
        const h = Math.max(1, m * (ROW.wave / 2 - 2))
        g.fillRect(x, mid - h, 1, h * 2)
      }
      g.strokeStyle = col.scene
      g.setLineDash([2, 3])
      for (const s of p.analysis.scenes) {
        if (s < t0 || s > t1) continue
        const x = Math.round(t2x(s)) + 0.5
        g.beginPath()
        g.moveTo(x, wy)
        g.lineTo(x, wy + ROW.wave)
        g.stroke()
      }
      g.setLineDash([])
    } else {
      g.fillStyle = col.text
      g.fillText('Analise o vídeo para ver a forma de onda, pausas e cenas.', 8, mid + 3)
    }

    // Sugestões
    const sy = wy + ROW.wave
    for (const s of p.suggestions) {
      if (s.endSec < t0 || s.startSec > t1) continue
      g.globalAlpha = s.status === 'rejeitada' ? 0.15 : 0.35 + (s.score / 100) * 0.6
      g.fillStyle = s.status === 'aprovada' ? col.ok : col.marker
      g.fillRect(t2x(s.startSec), sy + 1, (s.endSec - s.startSec) * effPps, ROW.sugg - 2)
    }
    g.globalAlpha = 1

    // Trechos
    const gy = sy + ROW.sugg
    for (const seg of p.segments) {
      const sel = seg.id === p.selectedId
      seg.ranges.forEach((r, i) => {
        if (r.endSec < t0 || r.startSec > t1) return
        const x = t2x(r.startSec)
        const w = Math.max(2, (r.endSec - r.startSec) * effPps)
        g.fillStyle = sel ? col.segSel : col.seg
        g.globalAlpha = sel ? 0.9 : 0.55
        g.fillRect(x, gy + 3, w, ROW.segs - 6)
        g.globalAlpha = 1
        if (sel) {
          g.fillStyle = col.head
          g.fillRect(x - 1, gy + 1, 3, ROW.segs - 2)
          g.fillRect(x + w - 2, gy + 1, 3, ROW.segs - 2)
        }
        if (w > 40) {
          g.fillStyle = '#fff'
          g.fillText(`${seg.name}${seg.ranges.length > 1 ? ` (${i + 1})` : ''}`, x + 5, gy + ROW.segs / 2 + 3, w - 8)
        }
      })
    }

    // Marcadores
    for (const m of p.markers) {
      if (m.timeSec < t0 || m.timeSec > t1) continue
      const x = Math.round(t2x(m.timeSec)) + 0.5
      g.strokeStyle = col.marker
      g.beginPath()
      g.moveTo(x, ry)
      g.lineTo(x, HEIGHT)
      g.stroke()
      g.fillStyle = col.marker
      g.beginPath()
      g.moveTo(x, ry)
      g.lineTo(x + 8, ry + 4)
      g.lineTo(x, ry + 8)
      g.fill()
    }

    // Agulha
    const hx = Math.round(t2x(p.current)) + 0.5
    g.strokeStyle = col.head
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(hx, 0)
    g.lineTo(hx, HEIGHT)
    g.stroke()
  }, [p, width, effPps, scroll, t2x, x2t, images.current.size])

  const hitSegment = (x: number, y: number): Exclude<Drag, { kind: 'seek' }> | null => {
    const gy = ROW.thumbs + ROW.ruler + ROW.wave + ROW.sugg
    if (y < gy) return null
    const t = x2t(x)
    const ordered = [...p.segments].sort((a) => (a.id === p.selectedId ? -1 : 1))
    for (const seg of ordered) {
      for (let i = 0; i < seg.ranges.length; i++) {
        const r = seg.ranges[i]
        const xs = t2x(r.startSec)
        const xe = t2x(r.endSec)
        if (seg.id === p.selectedId) {
          if (Math.abs(x - xs) <= HANDLE_PX) return { kind: 'handle', segId: seg.id, idx: i, edge: 'start', start: r.startSec, end: r.endSec }
          if (Math.abs(x - xe) <= HANDLE_PX) return { kind: 'handle', segId: seg.id, idx: i, edge: 'end', start: r.startSec, end: r.endSec }
        }
        if (t >= r.startSec && t <= r.endSec) return { kind: 'move', segId: seg.id, idx: i, grabSec: t, start: r.startSec, end: r.endSec }
      }
    }
    return null
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const { x, y } = local(e)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const hit = hitSegment(x, y)
    if (hit) {
      if (hit.segId !== p.selectedId) p.onSelect(hit.segId)
      drag.current = hit
      return
    }
    // clique numa sugestão
    const sy = ROW.thumbs + ROW.ruler + ROW.wave
    if (y >= sy && y < sy + ROW.sugg && p.onSuggestionClick) {
      const t = x2t(x)
      const s = p.suggestions.find((q) => t >= q.startSec && t <= q.endSec)
      if (s) return p.onSuggestionClick(s)
    }
    drag.current = { kind: 'seek' }
    p.onSeek(x2t(x))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    const d = drag.current
    const c = canvasRef.current!
    if (!d) {
      const hit = hitSegment(x, y)
      c.style.cursor = hit?.kind === 'handle' ? 'ew-resize' : hit ? 'grab' : 'pointer'
      return
    }
    const t = x2t(x)
    if (d.kind === 'seek') p.onSeek(t)
    else if (d.kind === 'handle') {
      if (d.edge === 'start') p.onRangeChange(d.segId, d.idx, Math.min(t, d.end - 0.1), d.end, false)
      else p.onRangeChange(d.segId, d.idx, d.start, Math.max(t, d.start + 0.1), false)
      p.onSeek(t)
    } else {
      const len = d.end - d.start
      const ns = Math.max(0, Math.min(p.duration - len, d.start + (t - d.grabSec)))
      p.onRangeChange(d.segId, d.idx, ns, ns + len, false)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.kind === 'seek') return
    const { segId, idx } = d
    const seg = p.segments.find((s) => s.id === segId)
    const r = seg?.ranges[idx]
    if (r) p.onRangeChange(segId, idx, r.startSec, r.endSec, true)
    void e
  }

  return (
    <div className="timeline-wrap">
      <div className="timeline-tools">
        <button className="ghost small" onClick={() => zoomAt(1 / 1.5, width / 2)} aria-label="Diminuir zoom" title="Diminuir zoom (−)">
          −
        </button>
        <button className="ghost small" onClick={() => setPps(0)} title="Mostrar o vídeo inteiro">
          Encaixar
        </button>
        <button className="ghost small" onClick={() => zoomAt(1.5, Math.max(0, Math.min(width, p.current * effPps - scroll)))} aria-label="Aumentar zoom" title="Aumentar zoom (+)">
          +
        </button>
        <span className="muted small">
          {effPps >= 1 ? `${Math.round(effPps)} px/s` : `${(1 / effPps).toFixed(1)} s/px`}
        </span>
        <span className="legend">
          <i className="lg wave" /> áudio <i className="lg silence" /> pausa <i className="lg scene" /> cena <i className="lg marker" /> marcador <i className="lg sugg" /> sugestão
        </span>
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
      >
        <div style={{ width: Math.max(width, total), height: HEIGHT }} />
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          style={{ width, height: HEIGHT, left: scroll }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="slider"
          aria-label="Linha do tempo"
          aria-valuemin={0}
          aria-valuemax={p.duration}
          aria-valuenow={p.current}
          tabIndex={0}
        />
      </div>
    </div>
  )
}
