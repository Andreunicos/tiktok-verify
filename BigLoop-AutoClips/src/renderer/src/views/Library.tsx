import { useEffect, useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { ProjectSummary } from '@shared/types'
import { useToast } from '../lib/ui'

interface Props {
  libraryKey: number
  onOpen: (projectId: string) => void
  onImport: () => void
}

const ORIGIN = { manual: 'importado', pasta: 'pasta', obs: 'OBS' } as const

/** Entrada do editor avançado: abrir um vídeo para cortar à mão. */
export function Library(p: Props) {
  const toast = useToast()
  const [list, setList] = useState<ProjectSummary[]>([])
  const [q, setQ] = useState('')
  useEffect(() => {
    void window.bigloop.listProjects().then(setList)
  }, [p.libraryKey])
  const shown = list.filter((x) => x.fileName.toLowerCase().includes(q.toLowerCase()))

  return (
    <main className="library-view">
      <div className="row between">
        <div>
          <h1>Editor avançado</h1>
          <p className="muted small">Para cortar à mão: linha do tempo, trechos, transcrição, legendas e opções de exportação. Para o jeito rápido, use “Criar cortes”.</p>
        </div>
        <button className="primary" onClick={p.onImport}>
          Abrir vídeo…
        </button>
      </div>
      <div className="row between">
        <h2>Vídeos abertos antes</h2>
        {list.length > 3 && <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na biblioteca" />}
      </div>
      {list.length === 0 && <p className="muted">Nenhum vídeo ainda.</p>}
      <ul className="project-list">
        {shown.map((x) => (
          <li key={x.id} className={x.missing ? 'missing' : ''}>
            <button className="project" onClick={() => (x.missing ? toast('O arquivo não está mais nesse local.', 'erro') : p.onOpen(x.id))} title={x.path}>
              <strong>{x.fileName}</strong>
              <span className="muted small">
                {formatTimecode(x.durationSec)} · {x.segments} trecho(s) · {ORIGIN[x.origin]} · {new Date(x.updatedAt).toLocaleString('pt-BR')}
              </span>
              {x.missing && <span className="error small">arquivo não encontrado</span>}
            </button>
            <button
              className="ghost small"
              aria-label={`Remover ${x.fileName} da biblioteca`}
              title="Remove da lista (o vídeo não é apagado)"
              onClick={async () => {
                await window.bigloop.removeProject(x.id)
                setList(await window.bigloop.listProjects())
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
