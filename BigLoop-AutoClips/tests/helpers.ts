import { spawnSync } from 'node:child_process'
import { DEFAULT_EXPORT } from '../src/shared/presets'
import type { CutRequest, ExportOptions } from '../src/shared/types'

export function req(partial: Partial<CutRequest> = {}, options: Partial<ExportOptions> = {}): CutRequest {
  return {
    inputPath: '/in.mp4',
    outputDir: '/out',
    ranges: [{ startSec: 1.5, endSec: 4 }],
    source: { durationSec: 10, width: 1920, height: 1080, fps: 30, audioTracks: 1 },
    ...partial,
    options: { ...DEFAULT_EXPORT, ...options }
  }
}

/** Gera vídeo sintético (testsrc2 + seno). Opcionalmente com 2 faixas de áudio e silêncios. */
export function makeVideo(
  ffmpeg: string,
  path: string,
  seconds: number,
  opts: { size?: string; tracks?: 1 | 2; silenceEvery?: number } = {}
): void {
  const size = opts.size ?? '640x360'
  const tracks = opts.tracks ?? 1
  // Tom de 440 Hz; com silenceEvery, alterna som e silêncio a cada N segundos.
  const vol = opts.silenceEvery ? `,volume='if(lt(mod(t\\,${opts.silenceEvery * 2})\\,${opts.silenceEvery})\\,1\\,0)':eval=frame` : ''
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`]
  args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`)
  if (tracks === 2) args.push('-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${seconds}`)
  args.push('-filter_complex', `[1:a]anull${vol}[a1]`, '-map', '0:v', '-map', '[a1]')
  if (tracks === 2) args.push('-map', '2:a')
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path)
  const r = spawnSync(ffmpeg, args)
  if (r.status !== 0) throw new Error(r.stderr.toString())
}
