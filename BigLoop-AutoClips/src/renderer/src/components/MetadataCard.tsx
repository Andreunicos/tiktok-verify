import type { MediaMetadata } from '@shared/types'
import { formatBytes, formatTimecode } from '@shared/time'

export function MetadataCard({ meta }: { meta: MediaMetadata }) {
  const rows: [string, string][] = [
    ['Arquivo', meta.fileName],
    ['Duração', formatTimecode(meta.durationSec, true)],
    ['Tamanho', formatBytes(meta.sizeBytes)],
    ['Formato', meta.formatName || '—'],
    [
      'Vídeo',
      meta.video
        ? `${meta.video.codec} · ${meta.video.width}×${meta.video.height}${meta.video.fps ? ` · ${meta.video.fps} fps` : ''}`
        : 'sem vídeo'
    ],
    [
      'Áudio',
      meta.audio
        ? `${meta.audio.codec}${meta.audio.sampleRate ? ` · ${meta.audio.sampleRate / 1000} kHz` : ''}${
            meta.audio.channels ? ` · ${meta.audio.channels} canal(is)` : ''
          }`
        : 'sem áudio'
    ],
    ['Bitrate', meta.bitRate ? `${Math.round(meta.bitRate / 1000)} kb/s` : '—']
  ]
  return (
    <section className="card">
      <h2>Metadados</h2>
      <dl className="meta">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
