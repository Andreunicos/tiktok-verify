import { FEATURE_LABELS } from '@shared/suggest'
import { formatTimecode } from '@shared/time'
import type { Suggestion, SuggestionFeatures, SuggestionOptions } from '@shared/types'
import { Field, Progress, Toggle } from '../lib/ui'

interface Props {
  hasAnalysis: boolean
  analyzing: { ratio: number; label: string } | null
  suggestions: Suggestion[]
  options: SuggestionOptions
  scenes: boolean
  onScenes: (v: boolean) => void
  onOptions: (o: SuggestionOptions) => void
  onAnalyze: () => void
  onCancel: () => void
  onSuggest: () => void
  onApprove: (s: Suggestion) => void
  onReject: (s: Suggestion) => void
  onPreview: (s: Suggestion) => void
}

export function SuggestionsPanel(p: Props) {
  return (
    <div className="suggestions">
      <p className="muted small">
        As sugestões combinam sinais da gravação: energia e picos do áudio, fala contínua, mudanças de cena, gancho no início e cortes em pausas. A
        nota é uma estimativa editorial, <strong>não uma previsão de viralização</strong>. Aprovar ou rejeitar ensina o app o seu gosto.
      </p>
      {p.analyzing ? (
        <div className="card-inline">
          <div className="row between">
            <span>{p.analyzing.label}…</span>
            <button className="small" onClick={p.onCancel}>
              Cancelar
            </button>
          </div>
          <Progress ratio={p.analyzing.ratio} label={p.analyzing.label} />
        </div>
      ) : (
        <div className="row wrap">
          <button className={p.hasAnalysis ? '' : 'primary'} onClick={p.onAnalyze}>
            {p.hasAnalysis ? 'Analisar de novo' : 'Analisar vídeo'}
          </button>
          <Toggle checked={p.scenes} onChange={p.onScenes} label="Detectar cenas" hint="Mais lento em vídeos longos." />
        </div>
      )}
      <div className="three">
        <Field label="Mín. (s)">
          <input type="number" min={5} max={p.options.maxSec} value={p.options.minSec} onChange={(e) => p.onOptions({ ...p.options, minSec: Number(e.target.value) })} />
        </Field>
        <Field label="Máx. (s)">
          <input type="number" min={p.options.minSec} max={600} value={p.options.maxSec} onChange={(e) => p.onOptions({ ...p.options, maxSec: Number(e.target.value) })} />
        </Field>
        <Field label="Quantas">
          <input type="number" min={1} max={50} value={p.options.count} onChange={(e) => p.onOptions({ ...p.options, count: Number(e.target.value) })} />
        </Field>
      </div>
      <button onClick={p.onSuggest} disabled={!p.hasAnalysis || !!p.analyzing}>
        Gerar sugestões
      </button>
      <ul className="sugg-list">
        {p.suggestions.map((s) => (
          <li key={s.id} className={`sugg ${s.status ?? ''}`}>
            <div className="row between">
              <button className="link" onClick={() => p.onPreview(s)} title="Tocar este trecho">
                ▶ {formatTimecode(s.startSec)} – {formatTimecode(s.endSec)} <span className="muted">({Math.round(s.endSec - s.startSec)}s)</span>
              </button>
              <span className="score" title="Nota editorial (0–100)">
                {s.score}
              </span>
            </div>
            <div className="sugg-title">{s.title}</div>
            <ul className="reasons">
              {s.reasons.map((r) => (
                <li key={r} className={r.startsWith('⚠') ? 'warn' : ''}>
                  {r}
                </li>
              ))}
            </ul>
            <div className="features">
              {(Object.keys(s.features) as (keyof SuggestionFeatures)[]).map((k) => (
                <span key={k} title={`${FEATURE_LABELS[k]}: ${Math.round(s.features[k] * 100)}%`}>
                  <i style={{ height: `${Math.max(2, s.features[k] * 18)}px` }} />
                  <small>{FEATURE_LABELS[k].slice(0, 6)}</small>
                </span>
              ))}
            </div>
            <div className="row">
              <button className="small primary" onClick={() => p.onApprove(s)} disabled={s.status === 'aprovada'}>
                {s.status === 'aprovada' ? '✓ Aprovada' : '✓ Aprovar e criar trecho'}
              </button>
              <button className="small" onClick={() => p.onReject(s)} disabled={s.status === 'rejeitada'}>
                ✕ Rejeitar
              </button>
            </div>
          </li>
        ))}
      </ul>
      {p.hasAnalysis && p.suggestions.length === 0 && <p className="muted">Nenhuma sugestão ainda. Ajuste a duração e clique em “Gerar sugestões”.</p>}
    </div>
  )
}
