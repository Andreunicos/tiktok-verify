import { useEffect, useState } from 'react'
import type { AppSettings, YouTubeStatus } from '@shared/types'
import { Field, Toggle, useToast } from '../lib/ui'

/** Configurações → Contas → YouTube (Shorts) e métricas. */
export function YouTubeAccount({ settings, onSettings }: { settings: AppSettings; onSettings: (p: Partial<AppSettings>) => Promise<void> }) {
  const toast = useToast()
  const api = window.bigloop
  const [st, setSt] = useState<YouTubeStatus | null>(null)
  const [id, setId] = useState(settings.youtubeClientId)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.youtubeStatus().then(setSt)
  }, [])
  if (!st) return null

  return (
    <div className="youtube-account">
      <h3>YouTube Shorts</h3>
      {st.connected ? (
        <div className="setup-row">
          <span className="setup-icon">✓</span>
          <div className="grow">
            <strong>Conectado ao YouTube{st.channel ? ` (${st.channel})` : ''}</strong>
            <div className="muted small">Os cortes podem ir para o YouTube na hora ou agendados (o próprio YouTube publica na hora marcada).</div>
          </div>
          <button className="ghost" onClick={async () => setSt(await api.youtubeDisconnect())}>
            Desconectar
          </button>
        </div>
      ) : (
        <>
          <ol className="muted small">
            <li>
              Entre no{' '}
              <button className="link" onClick={() => api.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com')}>
                Google Cloud
              </button>{' '}
              e ative a “YouTube Data API v3” num projeto seu (grátis).
            </li>
            <li>Em “Tela de consentimento OAuth”, escolha “Externo” e adicione o seu e-mail em “Usuários de teste”.</li>
            <li>Em “Credenciais” → “Criar credenciais” → “ID do cliente OAuth” → tipo “App para computador”. Copie o ID e a chave secreta aqui.</li>
          </ol>
          <Field label="Client ID">
            <input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="123…apps.googleusercontent.com" />
          </Field>
          <Field label={`Client secret ${settings.youtubeClientSecretEnc ? '(salvo)' : ''}`}>
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={settings.youtubeClientSecretEnc ? '••••••••' : 'GOCSPX-…'} autoComplete="off" />
          </Field>
          <div className="row">
            <button
              onClick={async () => {
                const res = await api.youtubeSaveApp(id, secret || null)
                setSecret('')
                if (!res.ok) return toast(res.error, 'erro')
                setSt(res.value)
                await onSettings({})
                toast('Dados do app do Google salvos.', 'ok')
              }}
            >
              Salvar
            </button>
            <button
              className="primary"
              disabled={!st.configured || busy}
              onClick={async () => {
                setBusy(true)
                const res = await api.youtubeConnect()
                setBusy(false)
                if (!res.ok) return toast(res.error, 'erro')
                setSt(res.value)
                toast('YouTube conectado!', 'ok')
              }}
            >
              {busy ? 'Esperando o login no navegador…' : 'Conectar YouTube'}
            </button>
          </div>
          <p className="muted small">Limite do YouTube: cerca de 6 envios por dia no plano grátis da API.</p>
        </>
      )}
      <h3>Aprender com as visualizações</h3>
      <p className="muted small">
        O app lê as visualizações dos seus posts (depois de 48 h) e ensina a IA o que funciona no seu canal. No YouTube funciona direto. No TikTok,
        o seu app precisa ter o escopo <strong>video.list</strong> aprovado; depois de ligar, conecte o TikTok de novo.
      </p>
      <Toggle checked={settings.tiktokWithStats} onChange={(v) => onSettings({ tiktokWithStats: v })} label="Pedir visualizações ao TikTok (video.list)" />
      <div className="row">
        <button
          onClick={async () => {
            const res = await api.statsRefresh()
            toast(res.ok ? `Visualizações atualizadas: ${res.value.updated} posts · aprendi com ${res.value.learned}.` : res.error, res.ok ? 'ok' : 'erro')
          }}
        >
          Atualizar visualizações agora
        </button>
      </div>
    </div>
  )
}
