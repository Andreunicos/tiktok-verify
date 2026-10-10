import { formatTimecode, parseTimecode } from '@shared/time'
import type { Segment } from '@shared/types'
import { useState } from 'react'

interface Props {
  segments: Segment[]
  selectedId: string | null
  checked: Set<string>
  duration: number
  onSelect: (id: string) => void
  onToggleCheck: (id: string) => void
  onCheckAll: (all: boolean) => void
  onChange: (seg: Segment) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onAddRange: (id: string) => void
  onRemoveFillers: (id: string) => void
  onPreview: (id: string) => void
  canRemoveFillers: boolean
}

const segDuration = (s: Segment) => s.ranges.reduce((t, r) => t + r.endSec - r.startSec, 0)

export function SegmentList(p: Props) {
  if (p.segments.length === 0)
    return (
      <p className="muted empty-hint">
        Nenhum trecho ainda. Pressione <kbd>I</kbd> para marcar o início e <kbd>O</kbd> para o fim, aprove uma sugestão ou selecione falas na transcrição.
      </p>
    )
  const allChecked = p.segments.every((s) => p.checked.has(s.id))
  return (
    <div className="segments">
      <div className="row between">
        <label className="check">
          <input type="checkbox" checked={allChecked} onChange={(e) => p.onCheckAll(e.target.checked)} />
          <span>
            {p.checked.size} de {p.segments.length} marcados para exportar
          </span>
        </label>
      </div>
      <ul>
        {p.segments.map((s) => (
          <SegmentRow key={s.id} seg={s} {...p} />
        ))}
      </ul>
    </div>
  )
}

function SegmentRow({ seg, ...p }: Props & { seg: Segment }) {
  const selected = p.selectedId === seg.id
  return (
    <li className={`segment ${selected ? 'selected' : ''}`} onClick={() => p.onSelect(seg.id)}>
      <div className="row">
        <input type="checkbox" aria-label={`Exportar ${seg.name}`} checked={p.checked.has(seg.id)} onChange={() => p.onToggleCheck(seg.id)} onClick={(e) => e.stopPropagation()} />
        <input className="seg-name" value={seg.name} aria-label="Nome do trecho" onChange={(e) => p.onChange({ ...seg, name: e.target.value })} />
        <span className="mono muted">{formatTimecode(segDuration(seg))}</span>
        {seg.origin === 'suggestion' && <span className="badge">sugestão</span>}
      </div>
      {selected && (
        <div className="seg-detail" onClick={(e) => e.stopPropagation()}>
          {seg.ranges.map((r, i) => (
            <RangeRow
              key={i}
              index={i}
              total={seg.ranges.length}
              start={r.startSec}
              end={r.endSec}
              duration={p.duration}
              onChange={(a, b) => p.onChange({ ...seg, ranges: seg.ranges.map((x, k) => (k === i ? { startSec: a, endSec: b } : x)) })}
              onRemove={() => p.onChange({ ...seg, ranges: seg.ranges.filter((_, k) => k !== i) })}
            />
          ))}
          <div className="row wrap">
            <button className="small" onClick={() => p.onPreview(seg.id)} title="Atalho: P">
              ▶ Prévia
            </button>
            <button className="small" onClick={() => p.onAddRange(seg.id)} title="Une outro pedaço do vídeo a este trecho">
              + Unir outro pedaço
            </button>
            <button className="small" onClick={() => p.onRemoveFillers(seg.id)} disabled={!p.canRemoveFillers} title={p.canRemoveFillers ? 'Tira "éé", "hum" e pausas longas' : 'Precisa de transcrição com tempo por palavra'}>
              ✂ Tirar “éé” e pausas
            </button>
            <button className="small" onClick={() => p.onDuplicate(seg.id)}>
              Duplicar
            </button>
            <button className="small danger" onClick={() => p.onDelete(seg.id)}>
              Apagar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function RangeRow(props: { index: number; total: number; start: number; end: number; duration: number; onChange: (a: number, b: number) => void; onRemove: () => void }) {
  const [a, setA] = useState<string | null>(null)
  const [b, setB] = useState<string | null>(null)
  const commit = (sa: string | null, sb: string | null) => {
    const s = sa === null ? props.start : parseTimecode(sa)
    const e = sb === null ? props.end : parseTimecode(sb)
    if (s !== null && e !== null && e > s && s >= 0 && e <= props.duration + 0.05) props.onChange(s, e)
    setA(null)
    setB(null)
  }
  const nudge = (which: 'a' | 'b', delta: number) => {
    if (which === 'a') props.onChange(Math.max(0, Math.min(props.end - 0.1, props.start + delta)), props.end)
    else props.onChange(props.start, Math.min(props.duration, Math.max(props.start + 0.1, props.end + delta)))
  }
  return (
    <div className="range-row">
      {props.total > 1 && <span className="muted small">{props.index + 1}.</span>}
      <div className="nudge">
        <button className="ghost small" onClick={() => nudge('a', -0.1)} aria-label="Início −0,1 s">
          ‹
        </button>
        <input
          className="mono"
          aria-label="Início"
          value={a ?? formatTimecode(props.start)}
          onChange={(e) => setA(e.target.value)}
          onBlur={() => commit(a, null)}
          onKeyDown={(e) => e.key === 'Enter' && commit(a, null)}
        />
        <button className="ghost small" onClick={() => nudge('a', 0.1)} aria-label="Início +0,1 s">
          ›
        </button>
      </div>
      <span className="muted">→</span>
      <div className="nudge">
        <button className="ghost small" onClick={() => nudge('b', -0.1)} aria-label="Fim −0,1 s">
          ‹
        </button>
        <input
          className="mono"
          aria-label="Fim"
          value={b ?? formatTimecode(props.end)}
          onChange={(e) => setB(e.target.value)}
          onBlur={() => commit(null, b)}
          onKeyDown={(e) => e.key === 'Enter' && commit(null, b)}
        />
        <button className="ghost small" onClick={() => nudge('b', 0.1)} aria-label="Fim +0,1 s">
          ›
        </button>
      </div>
      {props.total > 1 && (
        <button className="ghost small" onClick={props.onRemove} aria-label="Remover pedaço">
          ✕
        </button>
      )}
    </div>
  )
}
