import { useEffect, useState } from 'react'
import type { AutoClip } from '@shared/types'
import { Modal, newId, Progress, useToast } from '../lib/ui'

const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** Enviar um corte para o YouTube Shorts (agora ou agendado). */
export function YouTubePostModal({ clip, runId, onClose }: { clip: AutoClip; runId: string; onClose: () => void }) {
  const api = window.bigloop
  const toast = useToast()
  const [title, setTitle] = useState(clip.title)
  const [description, setDescription] = useState([clip.description, clip.hashtags.join(' ')].filter(Boolean).join('\n\n'))
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')
  const [schedule, setSchedule] = useState(false)
  const [when, setWhen] = useState(toLocalInput(Date.now() + 24 * 3600_000))
  const [sending, setSending] = useState<{ id: string; ratio: number } | null>(null)
  useEffect(() => api.onTaskProgress((t) => setSending((s) => (s && s.id === t.taskId ? { ...s, ratio: t.ratio } : s))), [])

  const send = async () => {
    const id = newId()
    setSending({ id, ratio: 0 })
    const publishAt = schedule ? new Date(when).getTime() : undefined
    if (publishAt && publishAt < Date.now() + 15 * 60_000) {
      setSending(null)
      return toast('Agende para daqui a pelo menos 15 minutos.', 'erro')
    }
    const res = await api.youtubeSend({ file: clip.outputPath!, title, description, tags: clip.hashtags, privacy, publishAt, runId, segmentId: clip.segmentId }, id)
    setSending(null)
    if (!res.ok) return toast(res.error, 'erro')
    toast(publishAt ? `Agendado no YouTube para ${new Date(publishAt).toLocaleString('pt-BR')}.` : 'Enviado ao YouTube!', 'ok')
    onClose()
  }

  return (
    <Modal title="Enviar para o YouTube Shorts" onClose={onClose}>
      <div className="edit-clip">
        <label className="field">
          <span className="group-label">Título (o app coloca #Shorts)</span>
          <input value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="group-label">Descrição</span>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="choices">
          {(
            [
              ['public', 'Público'],
              ['unlisted', 'Não listado'],
              ['private', 'Privado']
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" className={`choice ${privacy === v ? 'on' : ''}`} onClick={() => setPrivacy(v)} disabled={schedule && v !== 'public'}>
              <strong>{l}</strong>
            </button>
          ))}
        </div>
        <label className="switch">
          <input type="checkbox" checked={schedule} onChange={(e) => (setSchedule(e.target.checked), e.target.checked && setPrivacy('public'))} />
          <span>Agendar (o YouTube publica sozinho na hora, mesmo com o PC desligado)</span>
        </label>
        {schedule && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e hora" />}
        {sending && <Progress ratio={sending.ratio} label="Enviando ao YouTube" />}
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={!!sending || !title.trim()} onClick={send}>
            {schedule ? 'Agendar' : 'Enviar agora'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
