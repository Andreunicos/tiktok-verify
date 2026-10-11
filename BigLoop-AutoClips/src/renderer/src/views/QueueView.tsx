import { useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { AppSettings, Job, QueueState } from '@shared/types'
import { Modal, Progress } from '../lib/ui'

interface Props {
  queue: QueueState
  settings: AppSettings
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const STATUS_LABEL: Record<Job['status'], string> = { aguardando: 'aguardando', processando: 'processando', concluído: 'concluído', erro: 'erro', cancelado: 'cancelado' }
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export default function QueueView({ queue, settings, onSettings }: Props) {
  const api = window.bigloop
  const [preview, setPreview] = useState<string | null>(null)
  const done = queue.jobs.filter((j) => j.status === 'concluído' && j.outputPath)
  const active = queue.jobs.filter((j) => j.status !== 'concluído')

  return (
    <main className="queue-view">
      <div className="row between">
        <h1>Fila de exportação</h1>
        <div className="row wrap">
          {queue.paused ? (
            <button className="primary" onClick={() => api.queueControl('resume')}>
              ▶ Retomar fila
            </button>
          ) : (
            <button onClick={() => api.queueControl('pause')}>⏸ Pausar fila</button>
          )}
          <label className="row small">
            Ao mesmo tempo:
            <select value={queue.concurrency} onChange={(e) => onSettings({ concurrency: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button onClick={() => api.openFolder(settings.outputDir)}>Abrir pasta de saída</button>
          <button className="ghost" onClick={() => api.queueControl('clearFinished')}>
            Limpar finalizados
          </button>
        </div>
      </div>
      {queue.paused && <p className="warn">Fila pausada: nenhum corte novo começa até você retomar.</p>}

      <section>
        <h2>Em andamento e na fila ({active.length})</h2>
        {active.length === 0 && <p className="muted">Nada na fila.</p>}
        <ul className="jobs">
          {active.map((j, i) => (
            <li key={j.id} className={`job ${j.status}`}>
              <div className="row">
                <span className={`badge ${j.status}`}>{STATUS_LABEL[j.status]}</span>
                <span className="job-name">
                  {j.request.segmentName ?? fileName(j.request.inputPath)} <span className="muted small">· {fileName(j.request.inputPath)}</span>
                </span>
                <span className="muted small mono">
                  {formatTimecode(j.request.ranges[0].startSec)}→{formatTimecode(j.request.ranges[j.request.ranges.length - 1].endSec)} · {j.request.options.format.toUpperCase()}
                  {j.request.options.aspect !== 'original' ? ` ${j.request.options.aspect}` : ''}
                </span>
                <span className="spacer" />
                {j.status === 'aguardando' && (
                  <>
                    <select value={j.priority} aria-label="Prioridade" onChange={(e) => api.queueAction(e.target.value as Job['priority'], j.id)}>
                      <option value="alta">alta</option>
                      <option value="normal">normal</option>
                      <option value="baixa">baixa</option>
                    </select>
                    <button className="ghost small" disabled={i === 0} onClick={() => api.queueAction('up', j.id)} aria-label="Subir">
                      ↑
                    </button>
                    <button className="ghost small" disabled={i === active.length - 1} onClick={() => api.queueAction('down', j.id)} aria-label="Descer">
                      ↓
                    </button>
                  </>
                )}
                {(j.status === 'aguardando' || j.status === 'processando') && (
                  <button className="small" onClick={() => api.queueAction('cancel', j.id)}>
                    Cancelar
                  </button>
                )}
                {(j.status === 'erro' || j.status === 'cancelado') && (
                  <>
                    <button className="small" onClick={() => api.queueAction('retry', j.id)}>
                      Tentar de novo
                    </button>
                    <button className="ghost small" onClick={() => api.queueAction('remove', j.id)} aria-label="Remover da lista">
                      ✕
                    </button>
                  </>
                )}
              </div>
              {j.status === 'processando' && (
                <div className="row">
                  <Progress ratio={j.ratio} label="Progresso" />
                  <span className="muted small mono">
                    {Math.round(j.ratio * 100)}%{j.etaSec !== null && j.etaSec > 0 ? ` · faltam ~${formatTimecode(j.etaSec).replace(/\.\d+$/, '')}` : ''}
                  </span>
                </div>
              )}
              {j.error && <p className="error small">{j.error}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Prontos ({done.length})</h2>
        {done.length === 0 && <p className="muted">Os cortes prontos aparecem aqui para conferir, abrir ou arrastar para outro programa.</p>}
        <ul className="gallery">
          {done.map((j) => {
            const thumb = j.extraFiles?.find((f) => f.endsWith('.jpg'))
            return (
              <li key={j.id} className="gallery-item" draggable onDragStart={(e) => (e.preventDefault(), api.startDrag(j.outputPath!))} title="Arraste para o navegador, Premiere ou pasta">
                <button className="thumb" onClick={() => setPreview(j.outputPath!)} aria-label={`Ver ${fileName(j.outputPath!)}`}>
                  {thumb ? <img src={api.mediaUrl(thumb)} alt="" /> : <span className="thumb-placeholder">{j.request.options.format.toUpperCase()}</span>}
                  <span className="play">▶</span>
                </button>
                <div className="gallery-meta">
                  <strong title={j.outputPath}>{fileName(j.outputPath!)}</strong>
                  <span className="muted small">
                    {j.finishedAt && j.startedAt ? `${((j.finishedAt - j.startedAt) / 1000).toFixed(1)}s para gerar` : ''}
                    {j.extraFiles?.some((f) => f.endsWith('.srt')) ? ' · + SRT' : ''}
                  </span>
                  <div className="row">
                    <button className="small" onClick={() => api.showInFolder(j.outputPath!)}>
                      Mostrar na pasta
                    </button>
                    <button className="ghost small" onClick={() => api.queueAction('remove', j.id)} aria-label="Remover da lista">
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      {preview && (
        <Modal title={fileName(preview)} onClose={() => setPreview(null)} wide>
          {/\.(mp3|wav)$/i.test(preview) ? <audio src={api.mediaUrl(preview)} controls autoPlay /> : /\.gif$/i.test(preview) ? <img className="preview-media" src={api.mediaUrl(preview)} alt="" /> : <video className="preview-media" src={api.mediaUrl(preview)} controls autoPlay />}
        </Modal>
      )}
    </main>
  )
}
