import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWhisperArgs, parseWhisperJson, parseWhisperProgress } from '../../shared/whisper'
import type { Transcript } from '../../shared/types'
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
    const cut = opts.range ? ['-ss', opts.range.startSec.toFixed(3), '-to', opts.range.endSec.toFixed(3)] : []
    await runSimple(opts.ffmpegPath, [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...cut, '-i', input,
      '-map', `0:a:${opts.audioTrack ?? 0}`, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav
    ])
    if (opts.signal?.aborted) throw new Error('Transcrição cancelada.')
    opts.onProgress?.('transcrevendo', 0)
    const outBase = join(work, 'saida')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(opts.whisperPath, buildWhisperArgs(opts.modelPath, wav, outBase, opts.language, opts.threads), { windowsHide: true })
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
    const json = await readFile(`${outBase}.json`, 'utf8').catch(() => {
      throw new Error('whisper.cpp terminou sem gerar o arquivo JSON. Verifique a versão (precisa suportar -oj).')
    })
    const transcript = parseWhisperJson(json)
    if (opts.range) {
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
