import { useEffect, useState } from 'react'
import type { AppInfo, AppSettings, ToolStatus, UpdateStatus } from '@shared/types'
import { SHORTCUTS } from '../lib/keys'
import { Toggle } from '../lib/ui'

const UPDATE_TEXT: Record<UpdateStatus['state'], string> = {
  desativado: 'Desativada',
  parado: 'Ainda não verificado',
  verificando: 'Verificando…',
  baixando: 'Baixando…',
  pronta: 'Atualização baixada — reinicie para instalar',
  atualizado: 'Você está na versão mais recente',
  erro: 'Erro'
}

interface Props {
  tools: ToolStatus | null
  autoUpdate: boolean
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export default function About({ tools, autoUpdate, onSettings }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.bigloop.appInfo().then(setInfo)
    void window.bigloop.updateStatus().then(setUpd)
    return window.bigloop.onUpdate(setUpd)
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
        <h2>Atualizações</h2>
        <p>
          Versão instalada: <strong>{upd?.currentVersion ?? info?.version}</strong>
          {upd?.newVersion && upd.state !== 'atualizado' ? ` · nova: v${upd.newVersion}` : ''}
        </p>
        <p className={upd?.state === 'erro' ? 'warn' : 'muted'}>
          {upd ? `${UPDATE_TEXT[upd.state]}${upd.state === 'baixando' ? ` ${upd.percent}%` : ''}${upd.error ? ` — ${upd.error}` : ''}` : ''}
          {upd?.checkedAt ? ` · última verificação ${new Date(upd.checkedAt).toLocaleString('pt-BR')}` : ''}
        </p>
        <div className="row wrap">
          <button onClick={async () => setUpd(await window.bigloop.checkUpdates())} disabled={upd?.state === 'desativado' || upd?.state === 'verificando' || upd?.state === 'baixando'}>
            Verificar agora
          </button>
          {upd?.state === 'pronta' && (
            <button className="primary" onClick={() => void window.bigloop.installUpdate()}>
              Reiniciar e atualizar
            </button>
          )}
          <button className="link" onClick={() => window.bigloop.openExternal('https://github.com/Andreunicos/tiktok-verify/releases')}>
            Ver versões no GitHub
          </button>
        </div>
        <Toggle
          checked={autoUpdate}
          onChange={(v) => void onSettings({ autoUpdate: v })}
          label="Atualizar sozinho"
          hint="Ao abrir o app (e a cada 4 horas) procura uma versão nova, baixa em segundo plano e reinicia para instalar quando não há cortes em andamento."
        />
      </section>
      <section className="card">
        <h2>Privacidade</h2>
        <ul>
          <li>Vídeos, áudio e transcrição são processados no seu computador.</li>
          <li>Nada é publicado nem apagado automaticamente. O vídeo original nunca é alterado.</li>
          <li>A verificação de atualizações consulta só a página de versões do projeto no GitHub; nenhum dado seu é enviado.</li>
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
