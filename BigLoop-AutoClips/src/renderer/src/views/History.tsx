import type { AutoRun } from '@shared/types'

interface Props {
  runs: AutoRun[]
  onOpen: (id: string) => void
  onQueue: () => void
  onRemove: (id: string) => void
}

export function History({ runs, onOpen, onQueue, onRemove }: Props) {
  const api = window.bigloop
  return (
    <main className="history">
      <div className="row between">
        <h1>Meus cortes</h1>
        <button className="link" onClick={onQueue}>
          Fila de exportação (avançado)
        </button>
      </div>
      {runs.length === 0 && <p className="muted">Ainda não há cortes. Volte em “Criar cortes” e solte um vídeo.</p>}
      <ul className="history-list">
        {runs.map((r) => {
          const ready = r.clips.filter((c) => c.status === 'concluído')
          const thumb = r.clips.find((c) => c.thumbnail)?.thumbnail
          return (
            <li key={r.id}>
              <button className="history-item" onClick={() => onOpen(r.id)}>
                {thumb ? <img src={api.mediaUrl(thumb)} alt="" /> : <span className="history-thumb">🎬</span>}
                <span className="grow">
                  <strong>{r.fileName}</strong>
                  <span className="muted small block">
                    {new Date(r.createdAt).toLocaleString('pt-BR')} ·{' '}
                    {r.state === 'rodando' ? 'gerando…' : r.state === 'concluído' ? `${ready.length} cortes prontos` : r.state === 'cancelado' ? 'cancelado' : 'erro'}
                  </span>
                </span>
                <span className={`badge ${r.state}`}>{r.state}</span>
              </button>
              <div className="row">
                {r.outputDir && r.state === 'concluído' && (
                  <button className="small" onClick={() => api.openFolder(r.outputDir!)}>
                    Abrir pasta
                  </button>
                )}
                <button className="ghost small" title="Tira do histórico (os arquivos continuam na pasta)" onClick={() => onRemove(r.id)}>
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
