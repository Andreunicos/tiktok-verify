import { useEffect, useRef, useState } from 'react'
import type { AppSettings, ObsStatus, ToolStatus, WatchStatus } from '@shared/types'
import { SetupCard } from '../components/SetupCard'
import { AiSettings } from '../components/AiSettings'
import { TikTokAccount } from '../components/TikTokAccount'
import { Field, Toggle, useToast } from '../lib/ui'

interface Props {
  settings: AppSettings
  tools: ToolStatus | null
  obs: ObsStatus | null
  watch: WatchStatus | null
  section?: string
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
  onRefreshTools: () => Promise<void>
  onAbout: () => void
}

const SECTIONS = [
  ['geral', 'Geral'],
  ['contas', 'Contas (TikTok)'],
  ['ffmpeg', 'FFmpeg'],
  ['transcricao', 'Transcrição'],
  ['monitoramento', 'Monitoramento'],
  ['obs', 'OBS'],
  ['ia', 'IA'],
  ['diagnostico', 'Diagnóstico'],
  ['sobre', 'Sobre e atualizações']
] as const

export default function SettingsView(p: Props) {
  const s = p.settings
  const toast = useToast()
  const api = window.bigloop
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const [ffmpeg, setFfmpeg] = useState(s.ffmpegPath)
  const [ffprobe, setFfprobe] = useState(s.ffprobePath)
  const [obsPass, setObsPass] = useState('')
  const [obsHost, setObsHost] = useState(s.obsHost)
  const [obsPort, setObsPort] = useState(String(s.obsPort))
  const [shortcut, setShortcut] = useState(s.markerShortcut)

  useEffect(() => {
    if (p.section) refs.current[p.section]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [p.section])

  const pick = async (kind: 'executable' | 'model', apply: (path: string) => Promise<void> | void) => {
    const path = await api.pickFile(kind)
    if (path) await apply(path)
  }
  const sec = (id: string) => (el: HTMLElement | null) => {
    refs.current[id] = el
  }

  return (
    <main className="settings-view">
      <nav className="settings-nav" aria-label="Seções">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className="ghost" onClick={() => (id === 'sobre' ? p.onAbout() : refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        <section className="card" ref={sec('geral')}>
          <h2>Geral</h2>
          <Field label="Pasta de saída dos cortes">
            <div className="row">
              <code className="path">{s.outputDir}</code>
              <button
                onClick={async () => {
                  const d = await api.pickDir('Pasta de saída dos cortes', s.outputDir)
                  if (d) await p.onSettings({ outputDir: d })
                }}
              >
                Alterar…
              </button>
            </div>
          </Field>
          <Field label="Tema">
            <select value={s.theme} onChange={(e) => p.onSettings({ theme: e.target.value as AppSettings['theme'] })}>
              <option value="system">Igual ao Windows</option>
              <option value="dark">Escuro</option>
              <option value="light">Claro</option>
            </select>
          </Field>
          <Field label="Cortes ao mesmo tempo" hint="Mais de 1 só compensa em processadores com muitos núcleos.">
            <select value={s.concurrency} onChange={(e) => p.onSettings({ concurrency: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Toggle checked={s.lowPriority} onChange={(v) => p.onSettings({ lowPriority: v })} label="Prioridade baixa para o FFmpeg" hint="Não trava jogos nem a gravação enquanto exporta." />
          <Toggle checked={s.notifyOnDone} onChange={(v) => p.onSettings({ notifyOnDone: v })} label="Avisar quando um corte terminar" />
          <Toggle checked={s.minimizeToTray} onChange={(v) => p.onSettings({ minimizeToTray: v })} label="Fechar a janela mantém o app na bandeja" hint="A fila e o monitoramento continuam rodando em segundo plano." />
        </section>

        <section className="card" ref={sec('contas')}>
          <h2>Contas — TikTok</h2>
          <TikTokAccount settings={s} onSettings={p.onSettings} />
        </section>

        <section className="card" ref={sec('ffmpeg')}>
          <h2>FFmpeg</h2>
          {p.tools && (p.tools.ffmpeg.error || p.tools.ffprobe.error) && <SetupCard tools={p.tools} onInstalled={p.onRefreshTools} />}
          <p className="muted small">Deixe em branco para detectar sozinho (variáveis BIGLOOP_FFMPEG/BIGLOOP_FFPROBE, pasta do instalador ou PATH).</p>
          <Field label="ffmpeg.exe">
            <div className="row">
              <input value={ffmpeg} onChange={(e) => setFfmpeg(e.target.value)} placeholder="C:\ffmpeg\bin\ffmpeg.exe" />
              <button onClick={() => pick('executable', setFfmpeg)}>Procurar…</button>
            </div>
          </Field>
          <Field label="ffprobe.exe">
            <div className="row">
              <input value={ffprobe} onChange={(e) => setFfprobe(e.target.value)} placeholder="C:\ffmpeg\bin\ffprobe.exe" />
              <button onClick={() => pick('executable', setFfprobe)}>Procurar…</button>
            </div>
          </Field>
          <button
            className="primary"
            onClick={async () => {
              await p.onSettings({ ffmpegPath: ffmpeg.trim(), ffprobePath: ffprobe.trim() })
              await p.onRefreshTools()
            }}
          >
            Salvar e testar
          </button>
          {p.tools && (
            <dl className="meta tools">
              {(['ffmpeg', 'ffprobe'] as const).map((t) => (
                <div key={t}>
                  <dt>{t}</dt>
                  <dd className={p.tools![t].error ? 'error' : 'ok'}>
                    {p.tools![t].error ? `✗ ${p.tools![t].error}` : `✓ ${p.tools![t].version}`}
                    {p.tools![t].path && <small className="muted block">{p.tools![t].path}</small>}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Placa de vídeo</dt>
                <dd>{p.tools.hardwareEncoders.length ? `✓ ${p.tools.hardwareEncoders.join(', ')}` : 'nenhum encoder de placa de vídeo funcionando (usa o processador)'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="card" ref={sec('transcricao')}>
          <h2>Legendas automáticas (transcrição)</h2>
          {p.tools && !p.tools.whisper.error ? (
            <p className="ok">✓ Ativadas · {p.tools.whisper.version}</p>
          ) : (
            <SetupCard tools={p.tools} onInstalled={p.onRefreshTools} />
          )}
          <details>
            <summary className="muted small">Configuração manual (avançado)</summary>
          <p className="muted small">
            Roda 100% no seu computador, sem custo e sem enviar áudio para a internet. Baixe o <strong>whisper.cpp</strong> para Windows (arquivo
            whisper-cli.exe) e um modelo ggml — <code>ggml-small.bin</code> é um bom equilíbrio; <code>ggml-medium.bin</code> erra menos, mas é mais lento.
          </p>
          <div className="row wrap">
            <button className="link" onClick={() => api.openExternal('https://github.com/ggml-org/whisper.cpp/releases')}>
              Baixar whisper.cpp
            </button>
            <button className="link" onClick={() => api.openExternal('https://huggingface.co/ggerganov/whisper.cpp/tree/main')}>
              Baixar modelos
            </button>
          </div>
          <Field label="whisper-cli.exe">
            <div className="row">
              <code className="path">{s.whisperPath || 'não configurado'}</code>
              <button onClick={() => pick('executable', async (path) => (await p.onSettings({ whisperPath: path }), await p.onRefreshTools()))}>Procurar…</button>
            </div>
          </Field>
          <Field label="Modelo (.bin)">
            <div className="row">
              <code className="path">{s.whisperModelPath || 'não configurado'}</code>
              <button onClick={() => pick('model', async (path) => (await p.onSettings({ whisperModelPath: path }), await p.onRefreshTools()))}>Procurar…</button>
            </div>
          </Field>
          <div className="two">
            <Field label="Idioma">
              <select value={s.whisperLanguage} onChange={(e) => p.onSettings({ whisperLanguage: e.target.value })}>
                <option value="pt">Português</option>
                <option value="auto">Detectar automaticamente</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
              </select>
            </Field>
            <Field label="Núcleos do processador">
              <input type="number" min={1} max={32} value={s.whisperThreads} onChange={(e) => p.onSettings({ whisperThreads: Number(e.target.value) })} />
            </Field>
          </div>
          {p.tools && <p className={p.tools.whisper.error ? 'warn small' : 'ok small'}>{p.tools.whisper.error ? `✗ ${p.tools.whisper.error}` : `✓ pronto · ${p.tools.whisper.version}`}</p>}
          </details>
        </section>

        <section className="card" ref={sec('monitoramento')}>
          <h2>Monitorar pasta de gravações</h2>
          <p className="muted small">
            Gravações novas são importadas sozinhas quando terminam de ser gravadas (o app espera o arquivo parar de crescer e ser liberado pelo OBS).
            Nada é apagado nem publicado automaticamente.
          </p>
          <Toggle checked={s.watchEnabled} onChange={(v) => p.onSettings({ watchEnabled: v })} label="Monitorar pasta" />
          <Field label="Pasta" hint="Em branco = usa a pasta de gravação informada pelo OBS (com o OBS conectado).">
            <div className="row">
              <code className="path">{s.watchDir || '(pasta do OBS)'}</code>
              <button
                onClick={async () => {
                  const d = await api.pickDir('Pasta de gravações', s.watchDir || undefined)
                  if (d) await p.onSettings({ watchDir: d })
                }}
              >
                Escolher…
              </button>
              {s.watchDir && (
                <button className="ghost" onClick={() => p.onSettings({ watchDir: '' })}>
                  Usar a do OBS
                </button>
              )}
            </div>
          </Field>
          <Toggle
            checked={s.autoOnNewRecording}
            onChange={(v) => p.onSettings({ autoOnNewRecording: v })}
            label="Gerar os cortes sozinho quando chegar gravação nova"
            hint="Usa as últimas escolhas da tela “Criar cortes” (plataforma, quantidade, tamanho). Vale para o OBS e para a pasta monitorada."
          />
          {!s.autoOnNewRecording && (
            <Toggle checked={s.watchAutoAnalyze} onChange={(v) => p.onSettings({ watchAutoAnalyze: v })} label="Só analisar e sugerir (sem exportar)" />
          )}
          {p.watch && (
            <p className={p.watch.error ? 'warn small' : 'muted small'}>
              {p.watch.error ?? (p.watch.enabled ? `Monitorando ${p.watch.dir}${p.watch.lastImported ? ` · último: ${p.watch.lastImported}` : ''}` : 'Desligado')}
            </p>
          )}
        </section>

        <section className="card" ref={sec('obs')}>
          <h2>OBS Studio</h2>
          <p className="muted small">
            No OBS: Ferramentas → Configurações do servidor WebSocket → Ativar servidor. Use a porta e a senha mostradas lá. O app funciona sem o OBS
            (importação manual).
          </p>
          <Toggle checked={s.obsEnabled} onChange={(v) => p.onSettings({ obsEnabled: v })} label="Conectar ao OBS" />
          <div className="three">
            <Field label="Endereço">
              <input value={obsHost} onChange={(e) => setObsHost(e.target.value)} onBlur={() => p.onSettings({ obsHost: obsHost.trim() || '127.0.0.1' })} />
            </Field>
            <Field label="Porta">
              <input type="number" value={obsPort} onChange={(e) => setObsPort(e.target.value)} onBlur={() => p.onSettings({ obsPort: Number(obsPort) || 4455 })} />
            </Field>
            <Field label={`Senha ${s.obsPasswordEnc ? '(salva)' : ''}`}>
              <input type="password" value={obsPass} onChange={(e) => setObsPass(e.target.value)} placeholder={s.obsPasswordEnc ? '••••••••' : ''} autoComplete="off" />
            </Field>
          </div>
          <div className="row wrap">
            <button
              onClick={async () => {
                const res = await api.obsTest(obsHost, Number(obsPort) || 4455, obsPass || undefined)
                toast(res.ok ? `Conectou: ${res.value}` : res.error, res.ok ? 'ok' : 'erro')
              }}
            >
              Testar conexão
            </button>
            <button
              disabled={!obsPass}
              onClick={async () => {
                const res = await api.setSecret('obs', obsPass)
                setObsPass('')
                toast(res.ok ? 'Senha salva com criptografia do Windows.' : res.error, res.ok ? 'ok' : 'erro')
              }}
            >
              Salvar senha
            </button>
            {s.obsPasswordEnc && (
              <button className="ghost" onClick={async () => (await api.setSecret('obs', ''), toast('Senha apagada.', 'info'))}>
                Apagar senha
              </button>
            )}
          </div>
          <Field label="Atalho global para marcar momentos durante a gravação" hint="Funciona mesmo com o jogo em primeiro plano. Os marcadores aparecem no vídeo quando a gravação termina.">
            <div className="row">
              <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="CommandOrControl+Shift+M" />
              <button onClick={() => p.onSettings({ markerShortcut: shortcut.trim() })}>Aplicar</button>
            </div>
          </Field>
          {p.obs && (
            <p className={p.obs.state === 'erro' ? 'warn small' : 'muted small'}>
              Estado: {p.obs.state}
              {p.obs.version ? ` · OBS ${p.obs.version}` : ''}
              {p.obs.recordDir ? ` · grava em ${p.obs.recordDir}` : ''}
              {p.obs.recording ? ' · ● gravando' : ''}
              {p.obs.error ? ` · ${p.obs.error}` : ''}
            </p>
          )}
        </section>

        <section className="card" ref={sec('ia')}>
          <h2>IA (grátis ou paga)</h2>
          <AiSettings settings={s} onSettings={p.onSettings} />
        </section>

        <section className="card" ref={sec('diagnostico')}>
          <h2>Diagnóstico</h2>
          <p className="muted small">Copia um relatório com versões, configurações e as últimas linhas do log, sem senhas, chaves nem o seu nome de usuário. Útil para pedir ajuda.</p>
          <div className="row">
            <button
              onClick={async () => {
                await api.diagnostics()
                toast('Relatório copiado para a área de transferência.', 'ok')
              }}
            >
              Copiar relatório
            </button>
            <button onClick={async () => api.openFolder((await api.appInfo()).userData)}>Abrir pasta de dados</button>
            <button
              className="ghost"
              onClick={async () => {
                await p.onSettings({ learnedWeights: null })
                toast('Preferências de sugestão zeradas.', 'info')
              }}
            >
              Zerar aprendizado das sugestões
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
