import { useEffect, useState } from 'react'
import type { AppSettings, ToolStatus } from '@shared/types'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => Promise<void>
}

export function SettingsPanel({ settings, onChange }: Props) {
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [ffmpegPath, setFfmpegPath] = useState(settings.ffmpegPath)
  const [ffprobePath, setFfprobePath] = useState(settings.ffprobePath)

  const refresh = () => window.bigloop.toolStatus().then(setStatus)
  useEffect(() => {
    void refresh()
  }, [])

  const save = async () => {
    await onChange({ ffmpegPath: ffmpegPath.trim(), ffprobePath: ffprobePath.trim() })
    await refresh()
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Pasta de saída</h2>
        <div className="row">
          <code className="path">{settings.outputDir}</code>
          <button
            onClick={async () => {
              const dir = await window.bigloop.chooseOutputDir()
              if (dir) await onChange({ outputDir: dir })
            }}
          >
            Alterar…
          </button>
        </div>
      </section>

      <section className="card">
        <h2>FFmpeg</h2>
        <p className="muted small">
          Deixe em branco para detectar automaticamente (variáveis BIGLOOP_FFMPEG/BIGLOOP_FFPROBE, pasta empacotada ou PATH).
        </p>
        <label className="field">
          <span>Caminho do ffmpeg.exe</span>
          <input value={ffmpegPath} onChange={(e) => setFfmpegPath(e.target.value)} placeholder="C:\ffmpeg\bin\ffmpeg.exe" />
        </label>
        <label className="field">
          <span>Caminho do ffprobe.exe</span>
          <input value={ffprobePath} onChange={(e) => setFfprobePath(e.target.value)} placeholder="C:\ffmpeg\bin\ffprobe.exe" />
        </label>
        <div className="row">
          <button className="primary" onClick={save}>
            Salvar e testar
          </button>
        </div>
        {status && (
          <dl className="meta tools">
            {(['ffmpeg', 'ffprobe'] as const).map((tool) => (
              <div key={tool}>
                <dt>{tool}</dt>
                <dd className={status[tool].error ? 'error' : 'ok'} title={status[tool].path ?? ''}>
                  {status[tool].error ? `✗ ${status[tool].error}` : `✓ ${status[tool].version}`}
                  {status[tool].path && <div className="muted small">{status[tool].path}</div>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="card">
        <h2>Modo de corte padrão</h2>
        <ModeSelector value={settings.defaultMode} onChange={(defaultMode) => onChange({ defaultMode })} />
      </section>
    </div>
  )
}

export function ModeSelector({
  value,
  onChange
}: {
  value: AppSettings['defaultMode']
  onChange: (v: AppSettings['defaultMode']) => void
}) {
  return (
    <div className="modes">
      <label className={value === 'precise' ? 'selected' : ''}>
        <input type="radio" checked={value === 'precise'} onChange={() => onChange('precise')} />
        <strong>Preciso</strong>
        <span className="muted small">Reencoda em H.264/AAC. Corta no frame exato. Mais lento.</span>
      </label>
      <label className={value === 'fast' ? 'selected' : ''}>
        <input type="radio" checked={value === 'fast'} onChange={() => onChange('fast')} />
        <strong>Rápido</strong>
        <span className="muted small">Copia os streams sem reencodar. Pode começar no keyframe anterior.</span>
      </label>
    </div>
  )
}
