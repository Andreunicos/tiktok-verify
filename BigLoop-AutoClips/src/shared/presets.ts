import type { ExportOptions, SubtitleStyle } from './types'

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: 'Arial',
  fontSize: 72,
  textColor: '#FFFFFF',
  highlightColor: '#FFD400',
  outlineColor: '#000000',
  outline: 5,
  position: 'bottom',
  maxCharsPerLine: 22,
  maxLines: 2,
  uppercase: true,
  wordHighlight: true,
  emojis: false
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'mp4',
  mode: 'precise',
  aspect: 'original',
  fit: 'crop',
  cropX: 0.5,
  cropY: 0.5,
  quality: 'high',
  encoder: 'libx264',
  maxSizeMB: null,
  fadeInSec: 0,
  fadeOutSec: 0,
  normalizeAudio: false,
  includeAudio: true,
  audioTrack: 0,
  speed: 1,
  thumbnail: false,
  subtitles: 'none',
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  nameTemplate: '{nome}_corte_{inicio}-{fim}',
  subfolderPerSource: false
}

export interface ExportPreset {
  id: string
  name: string
  description: string
  options: Partial<ExportOptions>
  /** Duração máxima recomendada, só para aviso. */
  maxDurationSec?: number
}

/**
 * Presets por rede. Os limites mudam com frequência — são apenas avisos, não bloqueiam a exportação.
 * Normalização em -14 LUFS é a referência comum das plataformas.
 */
export const PRESETS: ExportPreset[] = [
  {
    id: 'original',
    name: 'Original',
    description: 'Mantém proporção e resolução da gravação.',
    options: { aspect: 'original', fit: 'crop' }
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: '9:16, 1080×1920, legendas grandes, áudio normalizado.',
    options: { aspect: '9:16', fit: 'crop', normalizeAudio: true, quality: 'high', subtitles: 'burn' },
    maxDurationSec: 600
  },
  {
    id: 'reels',
    name: 'Instagram Reels',
    description: '9:16, 1080×1920, áudio normalizado.',
    options: { aspect: '9:16', fit: 'crop', normalizeAudio: true, quality: 'high', subtitles: 'burn' },
    maxDurationSec: 180
  },
  {
    id: 'shorts',
    name: 'YouTube Shorts',
    description: '9:16, 1080×1920, até 3 minutos.',
    options: { aspect: '9:16', fit: 'crop', normalizeAudio: true, quality: 'high', subtitles: 'burn' },
    maxDurationSec: 180
  },
  {
    id: 'feed',
    name: 'Feed 4:5',
    description: '4:5, 1080×1350, com fundo desfocado.',
    options: { aspect: '4:5', fit: 'blur', normalizeAudio: true }
  },
  {
    id: 'square',
    name: 'Quadrado 1:1',
    description: '1080×1080, com fundo desfocado.',
    options: { aspect: '1:1', fit: 'blur', normalizeAudio: true }
  },
  {
    id: 'youtube',
    name: 'YouTube 16:9',
    description: '1920×1080, legendas em arquivo SRT separado.',
    options: { aspect: '16:9', fit: 'pad', normalizeAudio: true, subtitles: 'srt' }
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp (leve)',
    description: '9:16, até 16 MB.',
    options: { aspect: '9:16', fit: 'crop', quality: 'small', maxSizeMB: 16, normalizeAudio: true }
  },
  {
    id: 'podcast',
    name: 'Só áudio (MP3)',
    description: 'MP3 com áudio normalizado.',
    options: { format: 'mp3', normalizeAudio: true }
  },
  {
    id: 'gif',
    name: 'GIF',
    description: 'GIF animado leve, sem som.',
    options: { format: 'gif', aspect: 'original', includeAudio: false }
  }
]

export function applyPreset(base: ExportOptions, presetId: string): ExportOptions {
  const preset = PRESETS.find((p) => p.id === presetId)
  if (!preset) return base
  const reset: Partial<ExportOptions> = {
    format: 'mp4',
    aspect: 'original',
    fit: 'crop',
    maxSizeMB: null,
    subtitles: 'none',
    normalizeAudio: false,
    includeAudio: true
  }
  return { ...base, ...reset, ...preset.options, mode: 'precise' }
}

export const ASPECT_SIZES = {
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350]
} as const

/** Dimensões finais (pares) para um formato e origem. */
export function outputSize(aspect: ExportOptions['aspect'], srcW: number, srcH: number): [number, number] {
  if (aspect === 'original') return [Math.floor(srcW / 2) * 2, Math.floor(srcH / 2) * 2]
  const [w, h] = ASPECT_SIZES[aspect]
  return [w, h]
}
