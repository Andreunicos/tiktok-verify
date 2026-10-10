import type { Segment } from './types'

export interface InterchangeSource {
  path: string
  fileName: string
  durationSec: number
  width: number
  height: number
  fps: number | null
  audioChannels: number | null
  sampleRate: number | null
}

/** Taxa de quadros no formato FCP: timebase inteiro + flag NTSC (29,97 → 30 + TRUE). */
export function fcpRate(fps: number | null): { timebase: number; ntsc: boolean } {
  const f = fps && fps > 0 ? fps : 30
  const rounded = Math.round(f)
  const ntsc = Math.abs(f - (rounded * 1000) / 1001) < 0.01 && rounded % 6 === 0
  return { timebase: rounded, ntsc }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Caminho local → pathurl do FCP XML (file://localhost/C:/pasta/arquivo.mp4). */
export function toPathUrl(path: string): string {
  const unix = path.replace(/\\/g, '/')
  const parts = unix.split('/').map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p)))
  const joined = parts.join('/')
  return `file://localhost${joined.startsWith('/') ? '' : '/'}${joined}`
}

/**
 * Gera um FCP 7 XML (xmeml v4), que o Premiere Pro e o DaVinci Resolve importam
 * (Arquivo → Importar). A sequência referencia a gravação ORIGINAL, com cada trecho
 * em sequência e um marcador com o nome; assim dá para refinar os cortes com folga.
 */
export function buildFcpXml(sequenceName: string, src: InterchangeSource, segments: Segment[]): string {
  const { timebase, ntsc } = fcpRate(src.fps)
  const fps = ntsc ? (timebase * 1000) / 1001 : timebase
  const fr = (sec: number) => Math.round(sec * fps)
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
  const srcFrames = fr(src.durationSec)
  const channels = Math.max(1, Math.min(2, src.audioChannels ?? 2))
  const hasAudio = src.audioChannels !== null
  const fileFull = `<file id="file-1"><name>${xml(src.fileName)}</name><pathurl>${xml(toPathUrl(src.path))}</pathurl>${rate}<duration>${srcFrames}</duration><media><video><samplecharacteristics>${rate}<width>${src.width}</width><height>${src.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>${hasAudio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${src.sampleRate ?? 48000}</samplerate></samplecharacteristics><channelcount>${channels}</channelcount></audio>` : ''}</media></file>`

  const vItems: string[] = []
  const aItems: string[][] = Array.from({ length: channels }, () => [])
  const markers: string[] = []
  let cursor = 0
  let n = 0
  for (const seg of segments) {
    markers.push(`<marker><name>${xml(seg.name)}</name><comment>BigLoop AutoClips</comment><in>${cursor}</in><out>-1</out></marker>`)
    for (const r of seg.ranges) {
      n++
      const len = fr(r.endSec) - fr(r.startSec)
      if (len <= 0) continue
      const common = `<name>${xml(seg.name)}</name><enabled>TRUE</enabled><duration>${srcFrames}</duration>${rate}<start>${cursor}</start><end>${cursor + len}</end><in>${fr(r.startSec)}</in><out>${fr(r.endSec)}</out>`
      const links = [`<link><linkclipref>clip-${n}-v</linkclipref><mediatype>video</mediatype></link>`, ...aItems.map((_, c) => `<link><linkclipref>clip-${n}-a${c + 1}</linkclipref><mediatype>audio</mediatype><trackindex>${c + 1}</trackindex></link>`)].join('')
      vItems.push(`<clipitem id="clip-${n}-v">${common}${vItems.length === 0 ? fileFull : '<file id="file-1"/>'}${hasAudio ? links : ''}</clipitem>`)
      if (hasAudio)
        aItems.forEach((items, c) =>
          items.push(`<clipitem id="clip-${n}-a${c + 1}">${common}<file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>${c + 1}</trackindex></sourcetrack>${links}</clipitem>`)
        )
      cursor += len
    }
  }
  const format = `<format><samplecharacteristics>${rate}<width>${src.width}</width><height>${src.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>`
  const audio = hasAudio ? `<audio><numOutputChannels>${channels}</numOutputChannels>${aItems.map((items) => `<track>${items.join('')}</track>`).join('')}</audio>` : ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    `<sequence id="sequence-1"><name>${xml(sequenceName)}</name><duration>${cursor}</duration>${rate}`,
    `<media><video>${format}<track>${vItems.join('')}</track></video>${audio}</media>`,
    `${markers.join('')}`,
    '</sequence>',
    '</xmeml>',
    ''
  ].join('\n')
}

/** Timecode HH:MM:SS:FF (sem drop-frame). */
export function smpte(sec: number, fps: number): string {
  const total = Math.round(sec * fps)
  const f = total % fps
  const s = Math.floor(total / fps)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`
}

/** EDL CMX3600 (DaVinci Resolve, Premiere, Avid). Começa em 01:00:00:00. */
export function buildEdl(title: string, src: InterchangeSource, segments: Segment[]): string {
  const fps = Math.round(src.fps && src.fps > 0 ? src.fps : 30)
  const lines = [`TITLE: ${title.replace(/[\r\n]/g, ' ').slice(0, 70)}`, 'FCM: NON-DROP FRAME', '']
  let rec = 3600
  let n = 0
  for (const seg of segments)
    for (const r of seg.ranges) {
      n++
      const len = Math.round((r.endSec - r.startSec) * fps) / fps
      lines.push(`${String(n).padStart(3, '0')}  AX       AA/V  C        ${smpte(r.startSec, fps)} ${smpte(r.startSec + len, fps)} ${smpte(rec, fps)} ${smpte(rec + len, fps)}`)
      lines.push(`* FROM CLIP NAME: ${src.fileName}`)
      lines.push(`* COMMENT: ${seg.name}`)
      lines.push('')
      rec += len
    }
  return lines.join('\n')
}
