interface Props {
  duration: number
  current: number
  start: number | null
  end: number | null
  onSeek: (sec: number) => void
}

/** Barra de tempo: mostra o trecho selecionado e a posição atual; clique para buscar. */
export function Timeline({ duration, current, start, end, onSeek }: Props) {
  const pct = (s: number) => `${duration > 0 ? Math.min(100, Math.max(0, (s / duration) * 100)) : 0}%`
  const hasRange = start !== null && end !== null && end > start
  return (
    <div
      className="timeline"
      role="slider"
      aria-label="Linha do tempo"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={current}
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - rect.left) / rect.width) * duration)
      }}
    >
      {hasRange && <div className="timeline-range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />}
      {start !== null && <div className="timeline-mark start" style={{ left: pct(start) }} />}
      {end !== null && <div className="timeline-mark end" style={{ left: pct(end) }} />}
      <div className="timeline-head" style={{ left: pct(current) }} />
    </div>
  )
}
