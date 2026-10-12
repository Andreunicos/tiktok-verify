import { useState } from 'react'
import type { AutoRun } from '@shared/types'
import { Modal, useToast } from '../lib/ui'

const toLocalInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const tomorrowAt = (h: number) => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d.getTime()
}

/** Agenda todos os cortes prontos: 1 a cada N horas, TikTok (rascunho) e/ou YouTube. */
export function ScheduleModal({ run, tiktokOn, youtubeOn, onClose }: { run: AutoRun; tiktokOn: boolean; youtubeOn: boolean; onClose: () => void }) {
  const api = window.bigloop
  const toast = useToast()
  const ready = run.clips.filter((c) => c.status === 'concluído' && c.outputPath)
  const [start, setStart] = useState(toLocalInput(tomorrowAt(18)))
  const [every, setEvery] = useState(24)
  const [tt, setTt] = useState(tiktokOn)
  const [yt, setYt] = useState(youtubeOn)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const res = await api.scheduleRun(run.id, { startAt: new Date(start).getTime(), everyHours: every, tiktok: tt, youtube: yt })
    setBusy(false)
    if (!res.ok) return toast(res.error, 'erro')
    toast(
      `Agendado: ${ready.length} cortes, de ${new Date(res.value.first).toLocaleString('pt-BR')} até ${new Date(res.value.last).toLocaleString('pt-BR')}.` +
        (res.value.tiktok ? ' No TikTok eles vão para os rascunhos na hora (deixe o app aberto ou abra depois).' : ''),
      'ok'
    )
    onClose()
  }
  return (
    <Modal title={`Agendar ${ready.length} cortes`} onClose={onClose}>
      <div className="edit-clip">
        <label className="field">
          <span className="group-label">Primeiro post</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <div className="choices-group">
          <span className="group-label">Um a cada</span>
          <div className="choices">
            {[6, 12, 24, 48].map((h) => (
              <button key={h} type="button" className={`choice ${every === h ? 'on' : ''}`} onClick={() => setEvery(h)}>
                <strong>{h < 24 ? `${h} h` : h === 24 ? '1 dia' : '2 dias'}</strong>
              </button>
            ))}
          </div>
        </div>
        <label className={`switch ${!tiktokOn ? 'disabled' : ''}`}>
          <input type="checkbox" checked={tt} disabled={!tiktokOn} onChange={(e) => setTt(e.target.checked)} />
          <span>TikTok (vai para os rascunhos na hora){!tiktokOn ? ' — conecte em Configurações → Contas' : ''}</span>
        </label>
        <label className={`switch ${!youtubeOn ? 'disabled' : ''}`}>
          <input type="checkbox" checked={yt} disabled={!youtubeOn} onChange={(e) => setYt(e.target.checked)} />
          <span>YouTube Shorts (publica sozinho na hora){!youtubeOn ? ' — conecte em Configurações → Contas' : ''}</span>
        </label>
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || (!tt && !yt)} onClick={go}>
            {busy ? 'Agendando…' : 'Agendar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
