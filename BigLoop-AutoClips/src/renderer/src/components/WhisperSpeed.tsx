import { useEffect, useState } from 'react'
import type { AppSettings, ToolStatus } from '@shared/types'
import { newId, Progress, useToast } from '../lib/ui'

interface Props {
  settings: AppSettings
  tools: ToolStatus | null
  onSettings: (patch: Partial<AppSettings>) => Promise<unknown>
}

/** Velocidade da transcrição: só as partes promissoras em lives longas + placa de vídeo NVIDIA. */
export function WhisperSpeed({ settings: s, tools, onSettings }: Props) {
  const api = window.bigloop
  const toast = useToast()
  const [busy, setBusy] = useState<{ id: string; label: string; ratio: number } | null>(null)
  useEffect(() => api.onTaskProgress((t) => setBusy((b) => (b && b.id === t.taskId ? { ...b, label: t.label, ratio: t.ratio } : b))), [])
  const nvidia = !!tools?.hardwareEncoders.some((e) => e.includes('nvenc'))
  const install = async () => {
    const id = newId()
    setBusy({ id, label: 'Preparando…', ratio: 0 })
    const res = await api.installWhisperGpu(id)
    setBusy(null)
    if (!res.ok) toast(res.error, 'erro')
    else {
      await onSettings({ whisperGpuPath: res.value, whisperUseGpu: true })
      toast('Pronto! A transcrição agora usa a placa de vídeo.', 'ok')
    }
  }
  return (
    <div className="whisper-speed">
      <label className="switch">
        <input type="checkbox" checked={s.fastTranscribe !== false} onChange={(e) => onSettings({ fastTranscribe: e.target.checked })} />
        <span>
          Lives longas (mais de 20 min): transcrever só as partes promissoras <small className="muted">— bem mais rápido; o resto do vídeo fica sem legenda</small>
        </span>
      </label>
      {s.whisperGpuPath ? (
        <label className="switch">
          <input type="checkbox" checked={s.whisperUseGpu} onChange={(e) => onSettings({ whisperUseGpu: e.target.checked })} />
          <span>Usar a placa de vídeo NVIDIA na transcrição <small className="muted">— se falhar, usa o processador sozinho</small></span>
        </label>
      ) : nvidia && !tools?.whisper.error ? (
        <div className="note">
          <p className="small">
            ⚡ Placa NVIDIA encontrada. Dá para transcrever várias vezes mais rápido com ela (download único de ~500 MB).
          </p>
          {busy ? (
            <>
              <span className="muted small">{busy.label}</span>
              <Progress ratio={busy.ratio} label={busy.label} />
            </>
          ) : (
            <button className="small" onClick={install}>
              Usar a placa de vídeo
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
