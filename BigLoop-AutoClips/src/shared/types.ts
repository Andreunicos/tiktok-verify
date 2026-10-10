// ───────────── Mídia ─────────────
export interface VideoStreamInfo {
  codec: string
  width: number
  height: number
  fps: number | null
}

export interface AudioStreamInfo {
  index: number
  codec: string
  sampleRate: number | null
  channels: number | null
  title: string | null
  language: string | null
}

export interface MediaMetadata {
  path: string
  fileName: string
  sizeBytes: number
  durationSec: number
  formatName: string
  bitRate: number | null
  video: VideoStreamInfo | null
  /** Primeira faixa de áudio (compatibilidade). */
  audio: AudioStreamInfo | null
  audioTracks: AudioStreamInfo[]
}

// ───────────── Trechos e transcrição ─────────────
export interface Range {
  startSec: number
  endSec: number
}

export interface Segment {
  id: string
  name: string
  /** Um ou mais intervalos do vídeo de origem, unidos na ordem. */
  ranges: Range[]
  createdAt: number
  /** Origem do trecho, para aprendizado. */
  origin?: 'manual' | 'suggestion' | 'transcript' | 'marker'
  suggestionId?: string
}

export interface Word {
  startSec: number
  endSec: number
  text: string
  confidence?: number
}

export interface Cue {
  id: string
  startSec: number
  endSec: number
  text: string
  words?: Word[]
}

export interface Transcript {
  language: string | null
  engine: string
  createdAt: number
  cues: Cue[]
}

// ───────────── Exportação ─────────────
export type CutMode = 'precise' | 'fast'
export type AspectRatio = 'original' | '9:16' | '16:9' | '1:1' | '4:5'
export type FitMode = 'crop' | 'blur' | 'pad'
export type Quality = 'high' | 'medium' | 'small'
export type OutputFormat = 'mp4' | 'mp3' | 'wav' | 'gif'
export type VideoEncoder = 'libx264' | 'libx265' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_qsv' | 'hevc_qsv' | 'h264_amf' | 'hevc_amf'
export type SubtitleMode = 'none' | 'srt' | 'burn' | 'both'
/** 'mix' mistura todas as faixas; número = índice da faixa de áudio (0, 1, …). */
export type AudioTrackChoice = number | 'mix'

export interface SubtitleStyle {
  font: string
  fontSize: number
  /** Cores em #RRGGBB */
  textColor: string
  highlightColor: string
  outlineColor: string
  outline: number
  position: 'bottom' | 'middle' | 'top'
  maxCharsPerLine: number
  maxLines: number
  uppercase: boolean
  /** Destaca a palavra falada (estilo TikTok). Requer tempos por palavra. */
  wordHighlight: boolean
  emojis: boolean
}

export interface ExportOptions {
  format: OutputFormat
  mode: CutMode
  aspect: AspectRatio
  fit: FitMode
  /** Posição horizontal do recorte 0 (esquerda) … 1 (direita). */
  cropX: number
  cropY: number
  quality: Quality
  encoder: VideoEncoder
  /** Limite de tamanho do arquivo; null = sem limite. */
  maxSizeMB: number | null
  fadeInSec: number
  fadeOutSec: number
  normalizeAudio: boolean
  includeAudio: boolean
  audioTrack: AudioTrackChoice
  speed: number
  thumbnail: boolean
  subtitles: SubtitleMode
  subtitleStyle: SubtitleStyle
  /** Ex.: "{nome}_{trecho}_{inicio}". Ver naming.ts. */
  nameTemplate: string
  subfolderPerSource: boolean
}

export interface CutRequest {
  inputPath: string
  outputDir: string
  ranges: Range[]
  options: ExportOptions
  /** Nome base opcional (sem extensão); se vazio usa o modelo. */
  baseName?: string
  segmentName?: string
  presetName?: string
  /** Legendas no tempo do vídeo de origem (usadas se options.subtitles != 'none'). */
  cues?: Cue[]
  /** Informações da origem (de MediaMetadata). */
  source: { durationSec: number; width: number; height: number; fps: number | null; audioTracks: number }
  /** Número sequencial para {n} no modelo de nome. */
  sequence?: number
}

export interface CutProgress {
  jobId: string
  ratio: number
  processedSec: number
  etaSec: number | null
}

export interface CutResult {
  jobId: string
  outputPath: string
  extraFiles: string[]
  durationSec: number
  elapsedMs: number
}

// ───────────── Fila ─────────────
export type JobStatus = 'aguardando' | 'processando' | 'concluído' | 'erro' | 'cancelado'

export interface Job {
  id: string
  request: CutRequest
  status: JobStatus
  priority: 'alta' | 'normal' | 'baixa'
  ratio: number
  etaSec: number | null
  createdAt: number
  startedAt?: number
  finishedAt?: number
  outputPath?: string
  extraFiles?: string[]
  error?: string
  attempts: number
}

export interface QueueState {
  jobs: Job[]
  paused: boolean
  concurrency: number
}

// ───────────── Análise e sugestões ─────────────
export interface AnalysisResult {
  durationSec: number
  /** Picos 0..1 (um por bucket). */
  peaks: number[]
  bucketSec: number
  /** Energia RMS em dBFS por segundo. */
  rmsDb: number[]
  silences: Range[]
  scenes: number[]
  hasAudio: boolean
  createdAt: number
}

export interface SuggestionFeatures {
  energy: number
  peak: number
  speech: number
  scenes: number
  hook: number
  cleanStart: number
  cleanEnd: number
}

export interface Suggestion {
  id: string
  startSec: number
  endSec: number
  score: number
  features: SuggestionFeatures
  reasons: string[]
  title: string
  status?: 'aprovada' | 'rejeitada'
}

export interface SuggestionOptions {
  minSec: number
  maxSec: number
  count: number
}

// ───────────── Projetos / biblioteca ─────────────
export interface Marker {
  id: string
  timeSec: number
  label: string
  source: 'obs' | 'manual'
}

export interface Project {
  id: string
  path: string
  fileName: string
  durationSec: number
  addedAt: number
  updatedAt: number
  origin: 'manual' | 'pasta' | 'obs'
  segments: Segment[]
  markers: Marker[]
  transcript: Transcript | null
  suggestions: Suggestion[]
  hasAnalysis: boolean
}

export type ProjectSummary = Pick<Project, 'id' | 'path' | 'fileName' | 'durationSec' | 'addedAt' | 'updatedAt' | 'origin'> & {
  segments: number
  missing: boolean
}

// ───────────── Configurações e integrações ─────────────
export type Theme = 'system' | 'dark' | 'light'

export interface AppSettings {
  outputDir: string
  ffmpegPath: string
  ffprobePath: string
  defaultMode: CutMode
  exportDefaults: ExportOptions
  concurrency: number
  lowPriority: boolean
  notifyOnDone: boolean
  minimizeToTray: boolean
  theme: Theme
  lastImportDir: string
  // Transcrição (whisper.cpp)
  whisperPath: string
  whisperModelPath: string
  whisperLanguage: string
  whisperThreads: number
  // Monitoramento
  watchEnabled: boolean
  watchDir: string
  watchAutoAnalyze: boolean
  // OBS
  obsEnabled: boolean
  obsHost: string
  obsPort: number
  /** Senha criptografada com safeStorage (base64). Nunca em texto puro. */
  obsPasswordEnc: string
  markerShortcut: string
  // Sugestões
  suggestion: SuggestionOptions
  learnedWeights: Record<keyof SuggestionFeatures, number> | null
  // IA externa opcional
  aiEnabled: boolean
  aiKeyEnc: string
  aiModel: string
  onboardingDone: boolean
}

export interface ToolInfo {
  path: string | null
  version: string | null
  error: string | null
}

export interface ToolStatus {
  ffmpeg: ToolInfo
  ffprobe: ToolInfo
  whisper: ToolInfo
  hardwareEncoders: VideoEncoder[]
}

export interface WatchStatus {
  enabled: boolean
  dir: string
  pending: string[]
  lastImported: string | null
  error: string | null
}

export interface ObsStatus {
  state: 'desligado' | 'conectando' | 'conectado' | 'erro'
  version: string | null
  recording: boolean
  recordDir: string | null
  error: string | null
  pendingMarkers: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  logPath: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
