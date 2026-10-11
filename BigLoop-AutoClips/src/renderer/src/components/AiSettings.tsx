import { useState } from 'react'
import type { AppSettings, SecretKind } from '@shared/types'
import { Field, useToast } from '../lib/ui'

interface Props {
  settings: AppSettings
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const FREE: { kind: SecretKind & ('groq' | 'cerebras' | 'openrouter'); label: string; url: string; field: keyof AppSettings; hint: string }[] = [
  { kind: 'groq', label: 'Groq (principal)', url: 'https://console.groq.com/keys', field: 'groqKeyEnc', hint: 'gsk_…' },
  { kind: 'cerebras', label: 'Cerebras (reserva)', url: 'https://cloud.cerebras.ai/', field: 'cerebrasKeyEnc', hint: 'csk-…' },
  { kind: 'openrouter', label: 'OpenRouter (reserva)', url: 'https://openrouter.ai/keys', field: 'openrouterKeyEnc', hint: 'sk-or-…' }
]

function KeyRow(p: { label: string; saved: boolean; placeholder: string; onSave: (v: string) => Promise<void>; onClear: () => Promise<void>; link?: () => void }) {
  const [v, setV] = useState('')
  return (
    <Field label={`${p.label} ${p.saved ? '✓ salva' : ''}`}>
      <div className="row">
        <input type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder={p.saved ? '••••••••' : p.placeholder} autoComplete="off" />
        <button
          disabled={!v.trim()}
          onClick={async () => {
            await p.onSave(v.trim())
            setV('')
          }}
        >
          Salvar
        </button>
        {p.saved && (
          <button className="ghost" onClick={p.onClear}>
            Apagar
          </button>
        )}
        {p.link && (
          <button className="link" onClick={p.link}>
            Criar chave grátis
          </button>
        )}
      </div>
    </Field>
  )
}

export function AiSettings({ settings: s, onSettings }: Props) {
  const api = window.bigloop
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const save = async (kind: SecretKind, value: string) => {
    const res = await api.setSecret(kind, value)
    await onSettings({})
    if (!res.ok) toast(res.error, 'erro')
    else toast(value ? 'Chave salva com criptografia do Windows.' : 'Chave apagada.', value ? 'ok' : 'info')
  }
  const provider = s.aiProvider ?? 'gratis'
  const choose = (aiProvider: AppSettings['aiProvider']) => onSettings({ aiProvider, aiEnabled: aiProvider === 'claude' })

  return (
    <div className="ai-settings">
      <p className="muted small">
        A IA lê <strong>só o texto</strong> do que é falado (nunca o vídeo ou o áudio) para escolher os trechos com história completa, achar a frase de
        gancho, destacar palavras e escrever título, descrição e hashtags. Sem IA, o app usa as regras locais e funciona do mesmo jeito.
      </p>
      <div className="choices">
        <button className={`choice ${provider === 'gratis' ? 'on' : ''}`} onClick={() => choose('gratis')}>
          <strong>IA grátis</strong>
          <small>Groq/Cerebras/OpenRouter</small>
        </button>
        <button className={`choice ${provider === 'claude' ? 'on' : ''}`} onClick={() => choose('claude')}>
          <strong>Claude</strong>
          <small>pago, mais esperto</small>
        </button>
        <button className={`choice ${provider === 'desligada' ? 'on' : ''}`} onClick={() => choose('desligada')}>
          <strong>Desligada</strong>
          <small>só regras locais</small>
        </button>
      </div>

      {provider === 'gratis' && (
        <>
          <ol className="muted small">
            <li>
              Clique em <strong>Criar chave grátis</strong> no Groq, entre com o Google e clique em “Create API Key”.
            </li>
            <li>Copie a chave e cole aqui. Pronto: sem cartão de crédito e com limite grátis bem acima do que o app usa.</li>
            <li>Opcional: cole também uma chave do Cerebras ou do OpenRouter. Se o Groq falhar ou bater o limite, o app usa a reserva sozinho.</li>
          </ol>
          {FREE.map((f) => (
            <KeyRow
              key={f.kind}
              label={f.label}
              saved={!!s[f.field]}
              placeholder={f.hint}
              onSave={(v) => save(f.kind, v)}
              onClear={() => save(f.kind, '')}
              link={() => api.openExternal(f.url)}
            />
          ))}
          <p className="muted small">
            Em planos grátis, o serviço pode usar o texto enviado para melhorar os modelos. Não use com conversas confidenciais.
          </p>
        </>
      )}

      {provider === 'claude' && (
        <>
          <p className="muted small">Cada uso gera cobrança na sua conta da Anthropic.</p>
          <KeyRow label="Chave da API Anthropic" saved={!!s.aiKeyEnc} placeholder="sk-ant-…" onSave={(v) => save('ai', v)} onClear={() => save('ai', '')} />
          <Field label="Modelo" hint="Em branco usa o padrão (claude-opus-5-5).">
            <input value={s.aiModel} onChange={(e) => onSettings({ aiModel: e.target.value.trim() })} placeholder="claude-opus-5-5" />
          </Field>
        </>
      )}

      {provider !== 'desligada' && (
        <div className="row">
          <button
            disabled={testing}
            onClick={async () => {
              setTesting(true)
              const res = await api.aiTest()
              setTesting(false)
              toast(res.ok ? `IA funcionando: ${res.value}` : res.error, res.ok ? 'ok' : 'erro')
            }}
          >
            {testing ? 'Testando…' : 'Testar IA'}
          </button>
        </div>
      )}
    </div>
  )
}
