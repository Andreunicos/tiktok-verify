import { forwardRef, useRef } from 'react'
import { outputSize } from '@shared/presets'
import type { ExportOptions } from '@shared/types'

interface Props {
  src: string
  width: number
  height: number
  options: ExportOptions
  onTime: (t: number) => void
  onCropX: (x: number) => void
  onEnded?: () => void
}

/** Player com o quadro do recorte (9:16, 1:1…) desenhado por cima e arrastável. */
export const Player = forwardRef<HTMLVideoElement, Props>(function Player(p, ref) {
  const boxRef = useRef<HTMLDivElement>(null)
  const showCrop = p.options.aspect !== 'original' && p.options.fit === 'crop' && (p.options.format === 'mp4' || p.options.format === 'gif') && p.width > 0
  let crop: { left: string; width: string } | null = null
  if (showCrop) {
    const [W, H] = outputSize(p.options.aspect, p.width, p.height)
    const scale = Math.max(W / p.width, H / p.height)
    const visibleW = W / scale / p.width // fração da largura original
    const visibleH = H / scale / p.height
    if (visibleW < 0.999) crop = { left: `${(1 - visibleW) * p.options.cropX * 100}%`, width: `${visibleW * 100}%` }
    else if (visibleH < 0.999) crop = null
  }
  const drag = (e: React.PointerEvent) => {
    const box = boxRef.current
    if (!box || !crop) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const rect = box.getBoundingClientRect()
    const visible = parseFloat(crop.width) / 100
    const move = (ev: PointerEvent) => {
      const center = (ev.clientX - rect.left) / rect.width
      const left = center - visible / 2
      p.onCropX(Math.min(1, Math.max(0, left / (1 - visible))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="player">
      <div className="player-box" ref={boxRef} style={{ aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : '16 / 9' }}>
        <video ref={ref} src={p.src} controls onTimeUpdate={(e) => p.onTime(e.currentTarget.currentTime)} onSeeked={(e) => p.onTime(e.currentTarget.currentTime)} onEnded={p.onEnded} />
        {crop && (
          <div className="crop-overlay" aria-hidden>
            <div className="crop-shade" style={{ left: 0, width: crop.left }} />
            <div className="crop-frame" style={{ left: crop.left, width: crop.width }} onPointerDown={drag} title="Arraste para escolher o que aparece no vertical" />
            <div className="crop-shade" style={{ left: `calc(${crop.left} + ${crop.width})`, right: 0 }} />
          </div>
        )}
      </div>
    </div>
  )
})
