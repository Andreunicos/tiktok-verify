import { useEffect, useState } from 'react'
import type { AutoClip, TikTokCreator } from '@shared/types'
import { Modal, newId, Progress, useToast } from '../lib/ui'

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores mútuos)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu'
}

/**
 * Postagem direta no TikTok seguindo as regras de UX do TikTok: mostra a conta, a pessoa escolhe
 * a privacidade (sem padrão), interações começam desligadas, divulgação de conteúdo comercial e
 * consentimento explícito antes de enviar.
 */
export function PostModal({ clip, runId, onClose }: { clip: AutoClip; runId: string; onClose: () => void }) {
  const toast = useToast()
  const api = window.bigloop
  const [creator, setCreator] = useState<TikTokCreator | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState([clip.title, clip.description, clip.hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200))
  const [privacy, setPrivacy] = useState('')
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [commercial, setCommercial] = useState(false)
  const [ownBrand, setOwnBrand] = useState(false)
  const [branded, setBranded] = useState(false)
  const [sending, setSending] = useState<{ id: string; ratio: number } | null>(null)

  useEffect(() => {
    void api.tiktokCreator().then((r) => (r.ok ? setCreator(r.value) : setError(r.error)))
    return api.onTaskProgress((t) => setSending((s) => (s && s.id === t.taskId ? { ...s, ratio: t.ratio } : s)))
  }, [])

  const tooLong = creator ? clip.durationSec > creator.maxDurationSec : false
  const privacyOptions = (creator?.privacyOptions ?? []).filter((p) => !(branded && p === 'SELF_ONLY'))
  const ready = !!creator && !!privacy && !tooLong && (!commercial || ownBrand || branded) && !sending

  const post = async () => {
    const id = newId()
    setSending({ id, ratio: 0 })
    const res = await api.tiktokSend(
      {
        file: clip.outputPath!,
        mode: 'direto',
        runId,
        segmentId: clip.segmentId,
        post: { title, privacyLevel: privacy, disableComment: !allowComment, disableDuet: !allowDuet, disableStitch: !allowStitch, brandContent: branded, brandOrganic: ownBrand }
      },
      id
    )
    setSending(null)
    if (!res.ok) return setError(res.error)
    toast(res.value.status === 'PUBLISH_COMPLETE' ? 'Publicado no TikTok! 🎉' : 'Enviado! O TikTok ainda está processando; pode levar alguns minutos para aparecer no perfil.', 'ok')
    onClose()
  }

  return (
    <Modal title="Postar no TikTok" onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {!creator && !error && <p className="muted">Carregando sua conta do TikTok…</p>}
      {creator && (
        <div className="post-form">
          <div className="row">
            {creator.avatarUrl && <img className="avatar" src={creator.avatarUrl} alt="" />}
            <div>
              <strong>{creator.nickname}</strong> <span className="muted">@{creator.username}</span>
            </div>
          </div>
          {tooLong && <p className="error">O corte tem {Math.round(clip.durationSec)} s e esta conta aceita até {creator.maxDurationSec} s.</p>}
          <label className="field">
            <span>Legenda do post ({title.length}/2200)</span>
            <textarea rows={5} value={title} maxLength={2200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Quem pode ver este vídeo</span>
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
              <option value="" disabled>
                Escolha…
              </option>
              {privacyOptions.map((p) => (
                <option key={p} value={p}>
                  {PRIVACY_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="subgroup">
            <legend>Permitir que outras pessoas</legend>
            <label className="check">
              <input type="checkbox" checked={allowComment} disabled={creator.commentDisabled} onChange={(e) => setAllowComment(e.target.checked)} />
              <span>Comentem{creator.commentDisabled ? ' (desligado nas configurações da conta)' : ''}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={allowDuet} disabled={creator.duetDisabled} onChange={(e) => setAllowDuet(e.target.checked)} />
              <span>Façam dueto{creator.duetDisabled ? ' (desligado nas configurações da conta)' : ''}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={allowStitch} disabled={creator.stitchDisabled} onChange={(e) => setAllowStitch(e.target.checked)} />
              <span>Usem em costura (stitch){creator.stitchDisabled ? ' (desligado nas configurações da conta)' : ''}</span>
            </label>
          </fieldset>
          <fieldset className="subgroup">
            <legend>Divulgação de conteúdo</legend>
            <label className="check">
              <input type="checkbox" checked={commercial} onChange={(e) => (setCommercial(e.target.checked), setOwnBrand(false), setBranded(false))} />
              <span>Este vídeo promove uma marca, produto ou serviço</span>
            </label>
            {commercial && (
              <>
                <label className="check">
                  <input type="checkbox" checked={ownBrand} onChange={(e) => setOwnBrand(e.target.checked)} />
                  <span>Sua marca — aparece como “Conteúdo promocional”</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={branded} onChange={(e) => (setBranded(e.target.checked), privacy === 'SELF_ONLY' && setPrivacy(''))} />
                  <span>Conteúdo de marca (parceria paga) — aparece como “Parceria paga”</span>
                </label>
                {!ownBrand && !branded && <p className="warn small">Marque pelo menos uma opção.</p>}
              </>
            )}
          </fieldset>
          <p className="muted small">
            Ao postar, você concorda com a{' '}
            <button className="link" onClick={() => api.openExternal('https://www.tiktok.com/legal/page/global/music-usage-confirmation/en')}>
              Confirmação de Uso de Música do TikTok
            </button>
            {branded && (
              <>
                {' '}e com a{' '}
                <button className="link" onClick={() => api.openExternal('https://www.tiktok.com/legal/page/global/bc-policy/en')}>
                  Política de Conteúdo de Marca
                </button>
              </>
            )}
            .
          </p>
          {sending ? (
            <div>
              <span className="muted small">Enviando… {Math.round(sending.ratio * 100)}%</span>
              <Progress ratio={sending.ratio} label="Envio ao TikTok" />
            </div>
          ) : (
            <div className="row">
              <button className="primary" disabled={!ready} onClick={post}>
                Postar no TikTok
              </button>
              <button className="ghost" onClick={onClose}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
