import { useEffect, useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { AppSettings, ObsStatus, ProjectSummary, ToolStatus, WatchStatus } from '@shared/types'
import { useToast } from '../lib/ui'

interface Props {
  settings: AppSettings
  tools: ToolStatus | null
  obs: ObsStatus | null
  watch: WatchStatus | null
  libraryKey: number
  onOpen: (projectId: string) => void
  onImport: () => void
  onOpenSettings: (section?: string) => void
  onDismissOnboarding: () => void
}

const ORIGIN = { manual: 'importado', pasta: 'pasta', obs: 'OBS' } as const

export function Home(p: Props) {
  const toast = useToast()
  const [list, setList] = useState<ProjectSummary[]>([])
  const [q, setQ] = useState('')
  useEffect(() => {
    void window.bigloop.listProjects().then(setList)
  }, [p.libraryKey])

  const shown = list.filter((x) => x.fileName.toLowerCase().includes(q.toLowerCase()))
  const ffmpegMissing = p.tools && (p.tools.ffmpeg.error || p.tools.ffprobe.error)

  return (
    <main className="home">
      {ffmpegMissing && (
        <section className="card alert">
          <h2>Falta o FFmpeg</h2>
          <p>O BigLoop usa o FFmpeg (gratuito) para ler e cortar vídeos. Instale e reinicie o app, ou aponte o caminho do ffmpeg.exe.</p>
          <div className="row">
            <button className="primary" onClick={() => p.onOpenSettings('ffmpeg')}>
              Configurar FFmpeg
            </button>
            <button onClick={() => window.bigloop.openExternal('https://ffmpeg.org/download.html')}>Baixar FFmpeg</button>
          </div>
        </section>
      )}
      {!p.settings.onboardingDone && !ffmpegMissing && (
        <section className="card onboarding">
          <h2>Bem-vindo ao BigLoop AutoClips 👋</h2>
          <ol>
            <li>
              <strong>Importe uma gravação</strong> (ou arraste o arquivo para a janela).
            </li>
            <li>
              <strong>Analise</strong> para ver pausas, cenas e sugestões de melhores momentos.
            </li>
            <li>
              <strong>Transcreva</strong> com o whisper.cpp para legendas no estilo TikTok (opcional).
            </li>
            <li>
              <strong>Escolha o preset</strong> (TikTok, Reels, Shorts…) e exporte.
            </li>
            <li>
              Opcional: ligue o <strong>monitoramento do OBS</strong> para importar as gravações sozinho.
            </li>
          </ol>
          <div className="row">
            <button className="primary" onClick={p.onImport}>
              Importar meu primeiro vídeo
            </button>
            <button onClick={() => p.onOpenSettings('obs')}>Configurar OBS</button>
            <button className="ghost" onClick={p.onDismissOnboarding}>
              Não mostrar de novo
            </button>
          </div>
        </section>
      )}

      <section className="dropzone" onClick={p.onImport} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && p.onImport()}>
        <p className="big">Arraste um vídeo aqui ou clique para importar</p>
        <p className="muted">MP4, MKV, MOV, FLV e outros formatos lidos pelo FFmpeg · Ctrl+O</p>
      </section>

      <div className="status-row">
        <StatusCard
          title="OBS"
          state={!p.settings.obsEnabled ? 'off' : p.obs?.state === 'conectado' ? 'ok' : p.obs?.state === 'erro' ? 'err' : 'wait'}
          text={
            !p.settings.obsEnabled
              ? 'Desligado'
              : p.obs?.state === 'conectado'
                ? `Conectado${p.obs.version ? ` (OBS ${p.obs.version})` : ''}${p.obs.recording ? ' · ● gravando' : ''}${p.obs.pendingMarkers ? ` · ${p.obs.pendingMarkers} marcador(es)` : ''}`
                : (p.obs?.error ?? 'Conectando…')
          }
          onClick={() => p.onOpenSettings('obs')}
        />
        <StatusCard
          title="Pasta monitorada"
          state={!p.watch?.enabled ? 'off' : p.watch.error ? 'err' : 'ok'}
          text={
            !p.watch?.enabled
              ? 'Desligado'
              : p.watch.error
                ? p.watch.error
                : `${p.watch.dir}${p.watch.pending.length ? ` · aguardando ${p.watch.pending.length} arquivo(s) terminar de gravar` : ''}`
          }
          onClick={() => p.onOpenSettings('monitoramento')}
        />
      </div>

      <section className="library">
        <div className="row between">
          <h2>Biblioteca</h2>
          {list.length > 3 && <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na biblioteca" />}
        </div>
        {list.length === 0 && <p className="muted">Os vídeos que você abrir aparecem aqui, com os trechos salvos.</p>}
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
                title="Remove da biblioteca (o vídeo não é apagado)"
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
      </section>
    </main>
  )
}

function StatusCard({ title, state, text, onClick }: { title: string; state: 'ok' | 'err' | 'wait' | 'off'; text: string; onClick: () => void }) {
  return (
    <button className={`status-card ${state}`} onClick={onClick}>
      <span className="dot" aria-hidden />
      <span>
        <strong>{title}</strong>
        <span className="muted small block">{text}</span>
      </span>
    </button>
  )
}
