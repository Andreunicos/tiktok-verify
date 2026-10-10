import { useEffect, useState } from 'react'
import type { ToolStatus } from '@shared/types'
import { newId, Progress, useToast } from '../lib/ui'

interface Props {
  tools: ToolStatus | null
  onInstalled: () => Promise<void>
  /** compacto = só mostra o que falta, numa linha. */
  compact?: boolean
}

/** Instala FFmpeg e legendas automáticas com um clique (Windows). */
export function SetupCard({ tools, onInstalled, compact }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState<{ id: string; label: string; ratio: number; what: 'ffmpeg' | 'whisper' } | null>(null)
  const [model, setModel] = useState<'small' | 'base'>('small')
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('bigloop.setup.whisper.dismiss') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => window.bigloop.onTaskProgress((t) => setBusy((b) => (b && b.id === t.taskId ? { ...b, label: t.label, ratio: t.ratio } : b))), [])

  if (!tools) return null
  const needFfmpeg = !!(tools.ffmpeg.error || tools.ffprobe.error)
  const needWhisper = !!tools.whisper.error
  if (!needFfmpeg && (!needWhisper || (compact && hidden)) && !busy) return null

  const install = async (what: 'ffmpeg' | 'whisper') => {
    const id = newId()
    setBusy({ id, label: 'Preparando…', ratio: 0, what })
    const res = what === 'ffmpeg' ? await window.bigloop.installFfmpeg(id) : await window.bigloop.installWhisper(id, model)
    setBusy(null)
    if (!res.ok) return toast(res.error, 'erro')
    toast(what === 'ffmpeg' ? 'FFmpeg instalado!' : 'Legendas automáticas ativadas! Os próximos cortes já saem legendados.', 'ok')
    await onInstalled()
  }

  return (
    <section className={`setup ${compact ? 'compact' : ''}`}>
      {busy ? (
        <div className="setup-row">
          <span className="setup-icon spin">◌</span>
          <div className="grow">
            <strong>{busy.what === 'ffmpeg' ? 'Instalando o FFmpeg' : 'Ativando legendas automáticas'}</strong>
            <div className="muted small">{busy.label}</div>
            <Progress ratio={busy.ratio} label={busy.label} />
          </div>
          <button className="small" onClick={() => window.bigloop.cancelTask(busy.id)}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          {needFfmpeg && (
            <div className="setup-row warn-row">
              <span className="setup-icon">⚠</span>
              <div className="grow">
                <strong>Falta o FFmpeg</strong>
                <div className="muted small">É o motor que corta os vídeos. Gratuito, instala em 1 minuto.</div>
              </div>
              <button className="primary" onClick={() => install('ffmpeg')}>
                Instalar agora
              </button>
            </div>
          )}
          {needWhisper && !(compact && hidden) && (
            <div className="setup-row">
              <span className="setup-icon">💬</span>
              <div className="grow">
                <strong>Legendas automáticas</strong>
                <div className="muted small">
                  Transcreve a fala no seu PC (grátis, sem internet depois) e coloca legendas estilo TikTok. Download único.
                </div>
                {!compact && (
                  <select value={model} onChange={(e) => setModel(e.target.value as 'small' | 'base')} aria-label="Qualidade da transcrição">
                    <option value="small">Mais precisa (~470 MB) — recomendado</option>
                    <option value="base">Mais rápida (~150 MB)</option>
                  </select>
                )}
              </div>
              <button className="primary" onClick={() => install('whisper')}>
                Ativar
              </button>
              {compact && (
                <button
                  className="ghost small"
                  onClick={() => {
                    setHidden(true)
                    try {
                      localStorage.setItem('bigloop.setup.whisper.dismiss', '1')
                    } catch {
                      /* ignora */
                    }
                  }}
                >
                  Agora não
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
