import { useEffect, useState } from 'react'
import type { AppInfo, ToolStatus } from '@shared/types'
import { SHORTCUTS } from '../lib/keys'

export default function About({ tools }: { tools: ToolStatus | null }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.bigloop.appInfo().then(setInfo)
  }, [])
  const link = (url: string, label: string) => (
    <button className="link" onClick={() => window.bigloop.openExternal(url)}>
      {label}
    </button>
  )
  return (
    <main className="about">
      <section className="card">
        <h1>BigLoop AutoClips</h1>
        <p className="muted">Transforma gravações longas em cortes curtos, legendados e prontos para redes sociais. Processamento local com FFmpeg.</p>
        {info && (
          <dl className="meta">
            {(
              [
                ['Versão', info.version],
                ['Electron', info.electron],
                ['Chromium', info.chrome],
                ['Node', info.node],
                ['Sistema', info.platform],
                ['FFmpeg', tools?.ffmpeg.version ?? '—'],
                ['Dados do app', info.userData],
                ['Log', info.logPath]
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="card">
        <h2>Privacidade</h2>
        <ul>
          <li>Vídeos, áudio e transcrição são processados no seu computador.</li>
          <li>Nada é publicado nem apagado automaticamente. O vídeo original nunca é alterado.</li>
          <li>A IA (opcional, desligada por padrão) envia só o texto da transcrição do trecho, com a sua chave.</li>
          <li>Senhas e chaves ficam criptografadas pelo sistema (DPAPI no Windows) e nunca vão para o log.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Atalhos de teclado</h2>
        <div className="shortcuts">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <h3>{g.group}</h3>
              <dl>
                {g.items.map((s) => (
                  <div key={s.keys}>
                    <dt>
                      <kbd>{s.keys}</kbd>
                    </dt>
                    <dd>{s.action}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Ajuda e referências</h2>
        <ul>
          <li>{link('https://ffmpeg.org/documentation.html', 'Documentação do FFmpeg')}</li>
          <li>{link('https://obsproject.com/kb/remote-control-guide', 'OBS: controle remoto (WebSocket)')}</li>
          <li>{link('https://github.com/ggml-org/whisper.cpp', 'whisper.cpp')}</li>
          <li>{link('https://helpx.adobe.com/premiere-pro/using/importing-xml-project-files.html', 'Premiere: importar XML')}</li>
        </ul>
      </section>
    </main>
  )
}
