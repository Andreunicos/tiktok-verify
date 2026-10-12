import { useEffect, useRef, useState } from 'react'
import type { AutoClip, AutoRun, ClipEdits } from '@shared/types'
import { formatTimecode } from '@shared/time'
import { Modal, useToast } from '../lib/ui'

interface Props {
  run: AutoRun
  clip: AutoClip
  onClose: () => void
}

const STEPS = [-2, -0.5, 0.5, 2]

/** Ajusta um corte pronto e manda refazer: título, texto na tela, começo/fim, música e legenda. */
export function EditClipModal({ run, clip, onClose }: Props) {
  const api = window.bigloop
  const toast = useToast()
  const req = clip.request
  const [title, setTitle] = useState(clip.title)
  const [overlay, setOverlay] = useState(req?.visual?.title ?? '')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [music, setMusic] = useState(!!req?.audioExtras?.music)
  const [captions, setCaptions] = useState(!!req?.withCues)
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const first = req?.ranges[0]
  const last = req?.ranges[req.ranges.length - 1]
  const start = first ? Math.max(0, first.startSec + trimStart) : clip.startSec
  const end = last ? Math.min(req!.source.durationSec, last.endSec + trimEnd) : clip.endSec

  // Prévia: toca o trecho do vídeo original entre o começo e o fim ajustados
  useEffect(() => {
    const v = video.current
    if (!v) return
    const onTime = () => {
      if (v.currentTime >= end) v.pause()
    }
    v.currentTime = start
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [start, end])

  const save = async () => {
    const edits: ClipEdits = { title, overlay, trimStart, trimEnd, music, captions }
    setBusy(true)
    const res = await api.autoRedo(run.id, clip.segmentId, edits)
    setBusy(false)
    if (!res.ok) return toast(res.error, 'erro')
    toast('Refazendo o corte com os ajustes. O arquivo antigo continua na pasta.', 'ok')
    onClose()
  }

  if (!req)
    return (
      <Modal title="Editar corte" onClose={onClose}>
        <p>Esse corte foi feito por uma versão antiga do app. Gere os cortes de novo para poder editar.</p>
      </Modal>
    )

  const Stepper = ({ label, value, set }: { label: string; value: number; set: (v: number) => void }) => (
    <div className="stepper">
      <span className="group-label">
        {label} {value !== 0 && <small className="muted">({value > 0 ? '+' : ''}{value.toFixed(1)} s)</small>}
      </span>
      <div className="row">
        {STEPS.map((d) => (
          <button key={d} className="small" type="button" onClick={() => set(Math.round((value + d) * 10) / 10)}>
            {d > 0 ? `+${d}` : d} s
          </button>
        ))}
        {value !== 0 && (
          <button className="small ghost" type="button" onClick={() => set(0)}>
            zerar
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Modal title={`Editar corte ${clip.index}`} onClose={onClose}>
      <div className="edit-clip">
        <video ref={video} className="edit-preview" src={api.mediaUrl(run.path)} controls preload="metadata" />
        <p className="muted small">
          Trecho do vídeo original: {formatTimecode(start).replace(/\.\d+$/, '')} → {formatTimecode(end).replace(/\.\d+$/, '')} ({Math.round(end - start)} s)
          {req.ranges.length > 1 ? ' · o corte tem mais de um pedaço; o ajuste vale para o começo do primeiro e o fim do último' : ''}
        </p>
        <label className="field">
          <span className="group-label">Título (nome do arquivo e texto para postar)</span>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="group-label">Texto na tela nos primeiros segundos (vazio = sem texto)</span>
          <input value={overlay} maxLength={60} onChange={(e) => setOverlay(e.target.value.toLocaleUpperCase('pt-BR'))} placeholder="ELE NÃO ESPERAVA ISSO" />
        </label>
        <Stepper label="Começo" value={trimStart} set={setTrimStart} />
        <Stepper label="Fim" value={trimEnd} set={setTrimEnd} />
        <div className="toggles">
          <label className="switch">
            <input type="checkbox" checked={music} disabled={!req.audioExtras?.music && !music} onChange={(e) => setMusic(e.target.checked)} />
            <span>Música de fundo{!req.audioExtras?.music ? ' (o corte não tinha)' : ''}</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
            <span>Legenda</span>
          </label>
        </div>
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Enviando…' : 'Refazer corte'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
