import { useEffect, useState } from 'react'
import type { AppSettings, TikTokStatus } from '@shared/types'
import { Field, Toggle, useToast } from '../lib/ui'

/** Configurações → Contas → TikTok. */
export function TikTokAccount({ settings, onSettings }: { settings: AppSettings; onSettings: (p: Partial<AppSettings>) => Promise<void> }) {
  const toast = useToast()
  const api = window.bigloop
  const [st, setSt] = useState<TikTokStatus | null>(null)
  const [key, setKey] = useState(settings.tiktokClientKey)
  const [secret, setSecret] = useState('')
  const [redirect, setRedirect] = useState(settings.tiktokRedirectUri)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.tiktokStatus().then(setSt)
  }, [])
  if (!st) return null

  const save = async () => {
    const res = await api.tiktokSaveApp(key, secret || null, redirect)
    setSecret('')
    if (!res.ok) return toast(res.error, 'erro')
    setSt(res.value)
    toast('Dados do app do TikTok salvos.', 'ok')
  }

  return (
    <div className="tiktok-account">
      {st.connected ? (
        <div className="setup-row">
          <span className="setup-icon">✓</span>
          <div className="grow">
            <strong>Conectado ao TikTok{st.displayName ? ` como ${st.displayName}` : ''}</strong>
            <div className="muted small">Os cortes podem ser enviados para os rascunhos ou postados (com confirmação a cada post).</div>
          </div>
          <button className="ghost" onClick={async () => setSt(await api.tiktokDisconnect())}>
            Desconectar
          </button>
        </div>
      ) : (
        <>
          <details open={!st.configured}>
            <summary>Como conectar (uma vez)</summary>
            <ol className="small steps-help">
              <li>
                Entre em{' '}
                <button className="link" onClick={() => api.openExternal('https://developers.tiktok.com/apps')}>
                  developers.tiktok.com
                </button>{' '}
                e abra (ou crie) o seu app.
              </li>
              <li>
                Adicione os produtos <strong>Login Kit</strong> e <strong>Content Posting API</strong> (ative “Direct Post” se quiser postar direto) e as permissões{' '}
                <code>user.info.basic</code>, <code>video.upload</code>, <code>video.publish</code>.
              </li>
              <li>
                Em Login Kit → Redirect URI, cadastre exatamente:
                <div className="row">
                  <code className="path">{redirect}</code>
                  <button className="small" onClick={() => (navigator.clipboard.writeText(redirect), toast('Copiado.', 'ok'))}>
                    Copiar
                  </button>
                </div>
                <span className="muted">
                  Essa página fica no GitHub Pages do seu repositório e só devolve o login para o app. Ela precisa estar publicada (arquivo{' '}
                  <code>tiktok-callback.html</code> na branch principal).
                </span>
              </li>
              <li>Copie o <strong>Client Key</strong> e o <strong>Client Secret</strong> do app para cá e clique em Conectar.</li>
            </ol>
            <p className="muted small">
              Até o TikTok aprovar (auditar) o seu app, a postagem direta só funciona como “Somente eu”. Enviar para os <strong>rascunhos</strong> funciona sempre:
              você termina e posta pelo celular.
            </p>
          </details>
          <div className="two">
            <Field label="Client Key">
              <input value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={`Client Secret ${settings.tiktokClientSecretEnc ? '(salvo)' : ''}`}>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={settings.tiktokClientSecretEnc ? '••••••••' : ''} autoComplete="off" />
            </Field>
          </div>
          <Field label="Redirect URI" hint="Use o mesmo endereço cadastrado no app do TikTok.">
            <input value={redirect} onChange={(e) => setRedirect(e.target.value)} />
          </Field>
          <div className="row">
            <button onClick={save}>Salvar</button>
            <button
              className="primary"
              disabled={busy || !st.configured}
              onClick={async () => {
                setBusy(true)
                toast('Abrindo o TikTok no navegador… autorize e volte para cá.', 'info')
                const res = await api.tiktokConnect()
                setBusy(false)
                if (!res.ok) return toast(res.error, 'erro')
                setSt(res.value)
                toast('TikTok conectado!', 'ok')
              }}
            >
              {busy ? 'Aguardando o login…' : 'Conectar ao TikTok'}
            </button>
          </div>
        </>
      )}
      <Toggle
        checked={settings.tiktokAutoDrafts}
        onChange={(v) => void onSettings({ tiktokAutoDrafts: v })}
        label="Enviar sozinho para os rascunhos do TikTok quando os cortes ficarem prontos"
        hint="Os vídeos ficam na Caixa de entrada do app TikTok; nada é publicado sem você confirmar no celular."
      />
    </div>
  )
}
