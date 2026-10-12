import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWhisperArgs, parseWhisperJson, parseWhisperProgress } from '../../shared/whisper'
import { remapTranscript } from '../../shared/regions'
import type { Range, Transcript } from '../../shared/types'
import { runSimple } from './export'

export interface TranscribeOptions {
  ffmpegPath: string
  whisperPath: string
  modelPath: string
  language: string
  threads: number
  audioTrack?: number
  /** Transcrever só um trecho (segundos). */
  range?: { startSec: number; endSec: number }
  /** Transcrever só estes trechos (colados em um áudio só); os tempos voltam para os do vídeo original. */
  ranges?: Range[]
  /** whisper-cli de reserva (ex.: versão para processador se a da placa de vídeo falhar). */
  fallbackWhisperPath?: string
  signal?: AbortSignal
  onProgress?: (stage: 'extraindo áudio' | 'transcrevendo', ratio: number) => void
}

/**
 * Transcreve localmente com whisper.cpp: extrai WAV 16 kHz mono com FFmpeg e roda o whisper-cli.
 * Nada é enviado para a internet.
 */
export async function transcribe(input: string, opts: TranscribeOptions): Promise<Transcript> {
  if (!opts.whisperPath || !existsSync(opts.whisperPath))
    throw new Error('whisper.cpp não encontrado. Configure o caminho do whisper-cli em Configurações → Transcrição.')
  if (!opts.modelPath || !existsSync(opts.modelPath))
    throw new Error('Modelo do Whisper não encontrado. Baixe um arquivo ggml (ex.: ggml-small.bin) e configure em Configurações.')

  const work = await mkdtemp(join(tmpdir(), 'bigloop-whisper-'))
  try {
    opts.onProgress?.('extraindo áudio', 0)
    const wav = join(work, 'audio.wav')
    await runSimple(opts.ffmpegPath, extractArgs(input, wav, opts))
    if (opts.signal?.aborted) throw new Error('Transcrição cancelada.')
    opts.onProgress?.('transcrevendo', 0)
    const outBase = join(work, 'saida')
    const runWhisper = (exe: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(exe, buildWhisperArgs(opts.modelPath, wav, outBase, opts.language, opts.threads), { windowsHide: true })
      const onAbort = () => child.kill()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      let tail = ''
      const onData = (d: Buffer) => {
        const s = d.toString()
        tail = (tail + s).slice(-3000)
        for (const line of s.split('\n')) {
          const p = parseWhisperProgress(line)
          if (p !== null) opts.onProgress?.('transcrevendo', p)
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('error', (e) => reject(new Error(`Não foi possível executar o whisper.cpp: ${e.message}`)))
      child.on('close', (code) => {
        opts.signal?.removeEventListener('abort', onAbort)
        if (opts.signal?.aborted) reject(new Error('Transcrição cancelada.'))
        else if (code === 0) resolve()
        else reject(new Error(`whisper.cpp falhou (código ${code}). ${tail.trim().split('\n').slice(-2).join(' ')}`))
      })
    })
    try {
      await runWhisper(opts.whisperPath)
    } catch (err) {
      const fb = opts.fallbackWhisperPath
      if (opts.signal?.aborted || !fb || fb === opts.whisperPath || !existsSync(fb)) throw err
      opts.onProgress?.('transcrevendo', 0)
      await runWhisper(fb)
    }
    const json = await readFile(`${outBase}.json`, 'utf8').catch(() => {
      throw new Error('whisper.cpp terminou sem gerar o arquivo JSON. Verifique a versão (precisa suportar -oj).')
    })
    let transcript = parseWhisperJson(json)
    if (opts.ranges?.length) transcript = remapTranscript(transcript, opts.ranges)
    else if (opts.range) {
      const off = opts.range.startSec
      for (const c of transcript.cues) {
        c.startSec += off
        c.endSec += off
        c.words?.forEach((w) => ((w.startSec += off), (w.endSec += off)))
      }
    }
    opts.onProgress?.('transcrevendo', 1)
    return transcript
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** FFmpeg: áudio 16 kHz mono do vídeo inteiro, de um trecho, ou de vários trechos colados (busca rápida em cada um). */
export function extractArgs(input: string, wav: string, opts: Pick<TranscribeOptions, 'audioTrack' | 'range' | 'ranges'>): string[] {
  const head = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y']
  const tail = ['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]
  const track = opts.audioTrack ?? 0
  if (opts.ranges?.length) {
    const inputs = opts.ranges.flatMap((r) => ['-ss', r.startSec.toFixed(3), '-t', (r.endSec - r.startSec).toFixed(3), '-i', input])
    const labels = opts.ranges.map((_, i) => `[${i}:a:${track}]`).join('')
    return [...head, ...inputs, '-filter_complex', `${labels}concat=n=${opts.ranges.length}:v=0:a=1[a]`, '-map', '[a]', ...tail]
  }
  const cut = opts.range ? ['-ss', opts.range.startSec.toFixed(3), '-to', opts.range.endSec.toFixed(3)] : []
  return [...head, ...cut, '-i', input, '-map', `0:a:${track}`, ...tail]
}
