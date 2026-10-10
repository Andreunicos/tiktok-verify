export interface VideoStreamInfo {
  codec: string
  width: number
  height: number
  fps: number | null
}

export interface AudioStreamInfo {
  codec: string
  sampleRate: number | null
  channels: number | null
}

export interface MediaMetadata {
  path: string
  fileName: string
  sizeBytes: number
  durationSec: number
  formatName: string
  bitRate: number | null
  video: VideoStreamInfo | null
  audio: AudioStreamInfo | null
}

/** precise = reencoda (H.264/AAC, corte no frame exato); fast = cópia de stream (rápido, corta no keyframe). */
export type CutMode = 'precise' | 'fast'

export interface CutRequest {
  inputPath: string
  outputDir: string
  startSec: number
  endSec: number
  mode: CutMode
  /** Nome base opcional, sem extensão. */
  baseName?: string
  includeAudio: boolean
}

export interface CutProgress {
  jobId: string
  /** 0..1 */
  ratio: number
  processedSec: number
}

export interface CutResult {
  jobId: string
  outputPath: string
  durationSec: number
  elapsedMs: number
}

export interface ToolStatus {
  ffmpeg: { path: string | null; version: string | null; error: string | null }
  ffprobe: { path: string | null; version: string | null; error: string | null }
}

export interface AppSettings {
  outputDir: string
  ffmpegPath: string
  ffprobePath: string
  defaultMode: CutMode
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** API exposta ao renderer pelo preload (window.bigloop). */
export interface BigLoopApi {
  pickVideo(): Promise<string | null>
  pathForFile(file: File): string
  probe(path: string): Promise<Result<MediaMetadata>>
  mediaUrl(path: string): string
  startCut(req: CutRequest): Promise<Result<{ jobId: string }>>
  cancelCut(jobId: string): Promise<void>
  onCutProgress(cb: (p: CutProgress) => void): () => void
  onCutDone(cb: (r: Result<CutResult> & { jobId: string }) => void): () => void
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  chooseOutputDir(): Promise<string | null>
  openFolder(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  toolStatus(): Promise<ToolStatus>
}
