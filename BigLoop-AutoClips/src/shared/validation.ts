import type { CutRequest, Range } from './types'

export const MIN_CUT_SECONDS = 0.1
export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

/** Valida um intervalo de corte. Retorna mensagem de erro em português ou null. */
export function validateCutRange(startSec: number, endSec: number, durationSec: number): string | null {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 'Início e fim precisam ser tempos válidos.'
  if (startSec < 0) return 'O início não pode ser negativo.'
  if (endSec <= startSec) return 'O fim precisa ser maior que o início.'
  if (endSec - startSec < MIN_CUT_SECONDS) return `O corte precisa ter pelo menos ${MIN_CUT_SECONDS}s.`
  if (durationSec > 0 && startSec >= durationSec) return 'O início está depois do fim do vídeo.'
  if (durationSec > 0 && endSec > durationSec + 0.05) return 'O fim está depois do fim do vídeo.'
  return null
}

export function validateRanges(ranges: Range[], durationSec: number): string | null {
  if (ranges.length === 0) return 'Adicione pelo menos um intervalo.'
  for (let i = 0; i < ranges.length; i++) {
    const err = validateCutRange(ranges[i].startSec, ranges[i].endSec, durationSec)
    if (err) return ranges.length > 1 ? `Intervalo ${i + 1}: ${err}` : err
  }
  return null
}

/** Motivo pelo qual o modo rápido (cópia de stream) não pode ser usado, ou null se pode. */
export function fastModeBlocker(req: Pick<CutRequest, 'ranges' | 'options'> & Partial<Pick<CutRequest, 'audioExtras'>>): string | null {
  const o = req.options
  if (o.format !== 'mp4') return 'O modo rápido só gera MP4.'
  if (req.ranges.length !== 1) return 'O modo rápido não une vários intervalos.'
  if (o.aspect !== 'original') return 'O modo rápido não muda o formato da tela.'
  if (o.speed !== 1) return 'O modo rápido não muda a velocidade.'
  if (o.fadeInSec > 0 || o.fadeOutSec > 0) return 'O modo rápido não aplica fades.'
  if (o.normalizeAudio) return 'O modo rápido não normaliza o áudio.'
  if (o.subtitles === 'burn' || o.subtitles === 'both') return 'O modo rápido não grava legendas no vídeo.'
  if (o.audioTrack === 'mix') return 'O modo rápido não mistura faixas de áudio.'
  if (o.maxSizeMB) return 'O modo rápido não controla o tamanho do arquivo.'
  if (req.audioExtras?.music || req.audioExtras?.effects?.length) return 'O modo rápido não coloca música nem efeitos.'
  return null
}

export function validateRequest(req: CutRequest): string | null {
  const rangeErr = validateRanges(req.ranges, req.source.durationSec)
  if (rangeErr) return rangeErr
  const o = req.options
  if (!(o.speed >= MIN_SPEED && o.speed <= MAX_SPEED)) return `A velocidade precisa estar entre ${MIN_SPEED}x e ${MAX_SPEED}x.`
  if (o.fadeInSec < 0 || o.fadeOutSec < 0) return 'Fades não podem ser negativos.'
  const total = req.ranges.reduce((s, r) => s + r.endSec - r.startSec, 0) / o.speed
  if (o.fadeInSec + o.fadeOutSec > total) return 'Os fades somados são maiores que o corte.'
  if (o.maxSizeMB !== null && !(o.maxSizeMB > 0)) return 'O limite de tamanho precisa ser positivo.'
  const hasExtras = !!req.audioExtras?.music || !!req.audioExtras?.effects?.length
  if ((o.format === 'mp3' || o.format === 'wav') && req.source.audioTracks === 0 && !hasExtras) return 'O vídeo não tem áudio para exportar.'
  if (o.format === 'mp3' || o.format === 'wav') {
    if (!o.includeAudio && !hasExtras) return 'Exportar só áudio requer "Incluir áudio".'
  } else if (req.source.width === 0) {
    if (o.format === 'gif') return 'O arquivo não tem vídeo para gerar GIF.'
    return 'O arquivo não tem vídeo. Exporte como MP3 ou WAV.'
  }
  if (o.mode === 'fast') return fastModeBlocker(req)
  return null
}
