import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { FFPROBE_ARGS, parseProbeOutput } from '../../shared/ffmpeg'
import type { MediaMetadata } from '../../shared/types'

export async function probeMedia(ffprobePath: string, filePath: string): Promise<MediaMetadata> {
  const info = await stat(filePath).catch(() => null)
  if (!info) throw new Error(`Arquivo não encontrado: ${filePath}`)
  if (!info.isFile()) throw new Error('O caminho selecionado não é um arquivo.')
  if (info.size === 0) throw new Error('O arquivo está vazio.')

  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(ffprobePath, [...FFPROBE_ARGS, filePath], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (err) => reject(new Error(`Não foi possível executar o ffprobe: ${err.message}`)))
      child.on('close', (code) => resolve({ stdout, stderr, code }))
    }
  )
  if (code !== 0) {
    const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ')
    throw new Error(`O ffprobe não conseguiu ler o arquivo (talvez corrompido ou formato não suportado). ${detail}`.trim())
  }
  return parseProbeOutput(stdout, filePath, basename(filePath), info.size)
}
