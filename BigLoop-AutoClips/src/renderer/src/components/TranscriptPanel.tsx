import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { Cue, Transcript } from '@shared/types'
import { searchCues } from '@shared/whisper'
import { Progress } from '../lib/ui'

interface Props {
  transcript: Transcript | null
  current: number
  busy: { ratio: number; label: string } | null
  whisperReady: boolean
  aiEnabled: boolean
  onTranscribe: (onlySelection: boolean) => void
  onCancel: () => void
  onImport: () => void
  onExport: (f: 'srt' | 'vtt') => void
  onTranslate: (lang: string) => void
  onSeek: (t: number) => void
  onEditCue: (cue: Cue) => void
  onCreateSegment: (cues: Cue[]) => void
  onOpenSettings: () => void
  hasSelection: boolean
}

export function TranscriptPanel(p: Props) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<number | null>(null)
  const [lang, setLang] = useState('inglês')
  const listRef = useRef<HTMLUListElement>(null)
  const cues = p.transcript?.cues ?? []
  const shown = useMemo(() => (query.trim() ? searchCues(cues, query) : cues), [cues, query])
  const activeId = cues.find((c) => p.current >= c.startSec && p.current < c.endSec)?.id

  useEffect(() => {
    if (query || !activeId) return
    listRef.current?.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId, query])

  const pick = (idx: number, shift: boolean) => {
    if (shift && anchor !== null) {
      const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)]
      setPicked(shown.slice(a, b + 1).map((c) => c.id))
    } else {
      setAnchor(idx)
      setPicked([shown[idx].id])
    }
  }

  return (
    <div className="transcript">
      {p.busy ? (
        <div className="card-inline">
          <div className="row between">
            <span>{p.busy.label}…</span>
            <button className="small" onClick={p.onCancel}>
              Cancelar
            </button>
          </div>
          <Progress ratio={p.busy.ratio} label={p.busy.label} />
        </div>
      ) : (
        <div className="row wrap">
          <button className={cues.length ? '' : 'primary'} onClick={() => p.onTranscribe(false)} disabled={!p.whisperReady}>
            {cues.length ? 'Transcrever de novo' : 'Transcrever (local)'}
          </button>
          <button onClick={() => p.onTranscribe(true)} disabled={!p.whisperReady || !p.hasSelection} title="Só o trecho selecionado">
            Só o trecho
          </button>
          <button onClick={p.onImport}>Importar SRT/VTT</button>
          {cues.length > 0 && (
            <>
              <button onClick={() => p.onExport('srt')}>Salvar SRT</button>
              <button onClick={() => p.onExport('vtt')}>Salvar VTT</button>
            </>
          )}
        </div>
      )}
      {!p.whisperReady && (
        <p className="muted small">
          A transcrição local usa o <strong>whisper.cpp</strong> (gratuito, roda no seu PC, nada vai para a internet).{' '}
          <button className="link" onClick={p.onOpenSettings}>
            Configurar em Configurações → Transcrição
          </button>
          . Você também pode importar um SRT pronto.
        </p>
      )}
      {p.transcript && (
        <p className="muted small">
          {cues.length} falas · {p.transcript.engine}
          {p.transcript.language ? ` · idioma: ${p.transcript.language}` : ''} · clique para ir ao ponto, Shift+clique para selecionar várias, edite o texto
          direto.
        </p>
      )}
      {cues.length > 0 && (
        <div className="row wrap">
          <input type="search" placeholder="Buscar na fala…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar na transcrição" />
          {query && <span className="muted small">{shown.length} resultado(s)</span>}
        </div>
      )}
      {picked.length > 0 && (
        <div className="row card-inline">
          <span>{picked.length} fala(s) selecionada(s)</span>
          <button className="small primary" onClick={() => p.onCreateSegment(cues.filter((c) => picked.includes(c.id)))}>
            Criar trecho com elas
          </button>
          <button className="small ghost" onClick={() => setPicked([])}>
            Limpar
          </button>
        </div>
      )}
      <ul className="cues" ref={listRef}>
        {shown.map((c, i) => (
          <li key={c.id} data-id={c.id} className={`${c.id === activeId ? 'active' : ''} ${picked.includes(c.id) ? 'picked' : ''}`}>
            <button
              className="link mono"
              onClick={(e) => {
                pick(i, e.shiftKey)
                p.onSeek(c.startSec)
              }}
            >
              {formatTimecode(c.startSec)}
            </button>
            <textarea
              rows={Math.max(1, Math.ceil(c.text.length / 48))}
              value={c.text}
              aria-label={`Fala em ${formatTimecode(c.startSec)}`}
              onChange={(e) => p.onEditCue({ ...c, text: e.target.value, words: undefined })}
            />
          </li>
        ))}
      </ul>
      {p.aiEnabled && cues.length > 0 && (
        <div className="row wrap card-inline">
          <span className="small">Traduzir legendas com IA (paga):</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {['inglês', 'espanhol', 'francês', 'italiano', 'alemão', 'japonês'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <button className="small" onClick={() => p.onTranslate(lang)}>
            Traduzir
          </button>
        </div>
      )}
    </div>
  )
}
