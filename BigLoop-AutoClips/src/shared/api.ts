import type {
  AnalysisResult,
  AutoOptions,
  AutoRun,
  Mood,
  OpenverseResult,
  SoundItem,
  SoundKind,
  TikTokCreator,
  TikTokPostRequest,
  TikTokStatus,
  AppInfo,
  AppSettings,
  CutRequest,
  Job,
  MediaMetadata,
  ObsStatus,
  Project,
  ProjectSummary,
  QueueState,
  Result,
  Segment,
  Suggestion,
  SuggestionOptions,
  ToolStatus,
  Transcript,
  UpdateStatus,
  WatchStatus
} from './types'

export interface TaskProgress {
  taskId: string
  label: string
  ratio: number
}

export interface SocialCopy {
  title: string
  description: string
  hashtags: string[]
}

export type FileKind = 'video' | 'subtitle' | 'executable' | 'model'

/** API exposta ao renderer pelo preload (window.bigloop). */
export interface BigLoopApi {
  // Arquivos e mídia
  pickFile(kind: FileKind): Promise<string | null>
  pickDir(title: string, current?: string): Promise<string | null>
  pathForFile(file: File): string
  openMedia(path: string): Promise<Result<{ meta: MediaMetadata; project: Project }>>
  mediaUrl(path: string): string
  // Biblioteca
  listProjects(): Promise<ProjectSummary[]>
  getProject(id: string): Promise<Project | null>
  updateProject(id: string, patch: Partial<Pick<Project, 'segments' | 'markers' | 'transcript' | 'suggestions'>>): Promise<Project | null>
  removeProject(id: string): Promise<void>
  // Análise e sugestões (tarefas longas emitem onTaskProgress)
  analyze(projectId: string, taskId: string, opts: { audioTrack: number; scenes: boolean }): Promise<Result<AnalysisResult>>
  getAnalysis(projectId: string): Promise<AnalysisResult | null>
  thumbnails(projectId: string, count: number): Promise<Result<{ timeSec: number; url: string }[]>>
  cancelTask(taskId: string): Promise<void>
  suggest(projectId: string, opts: SuggestionOptions): Promise<Result<Suggestion[]>>
  rateSuggestion(projectId: string, suggestionId: string, approved: boolean): Promise<Result<Project>>
  // Transcrição e legendas
  transcribe(projectId: string, taskId: string, opts: { audioTrack: number; range?: { startSec: number; endSec: number } }): Promise<Result<Transcript>>
  importSubtitles(projectId: string): Promise<Result<Transcript | null>>
  exportSubtitles(projectId: string, format: 'srt' | 'vtt'): Promise<Result<string | null>>
  removeFillers(projectId: string, segmentId: string): Promise<Result<{ segment: Segment; removedSec: number; removedWords: number }>>
  // Exportação e fila
  enqueue(requests: CutRequest[], priority?: Job['priority']): Promise<Result<string[]>>
  queueState(): Promise<QueueState>
  queueAction(action: 'cancel' | 'retry' | 'remove' | 'up' | 'down' | 'alta' | 'normal' | 'baixa', jobId: string): Promise<void>
  queueControl(action: 'pause' | 'resume' | 'clearFinished' | 'cancelAll'): Promise<void>
  startDrag(path: string): void
  exportInterchange(projectId: string, kind: 'fcpxml' | 'edl', segmentIds?: string[]): Promise<Result<string>>
  // IA (opcional, paga, desligada por padrão)
  aiSocial(projectId: string, segmentId: string, platform: string): Promise<Result<SocialCopy>>
  aiTranslate(projectId: string, language: string): Promise<Result<Transcript>>
  // Modo automático (2 cliques)
  autoStart(path: string, options: AutoOptions): Promise<Result<AutoRun>>
  autoList(): Promise<AutoRun[]>
  autoCancel(id: string): Promise<void>
  autoRemove(id: string): Promise<void>
  onAuto(cb: (run: AutoRun) => void): () => void
  // Biblioteca de sons
  soundsList(kind?: SoundKind): Promise<SoundItem[]>
  soundsSearch(query: string, kind: SoundKind, allowAttribution: boolean): Promise<Result<OpenverseResult[]>>
  soundsDownload(result: OpenverseResult, kind: SoundKind, mood: Mood | null): Promise<Result<SoundItem>>
  soundsImport(kind: SoundKind, mood: Mood | null): Promise<Result<SoundItem | null>>
  soundsUpdate(id: string, patch: { title?: string; mood?: Mood | null }): Promise<SoundItem | undefined>
  soundsRemove(id: string): Promise<void>
  // TikTok
  tiktokStatus(): Promise<TikTokStatus>
  tiktokSaveApp(clientKey: string, clientSecret: string | null, redirectUri: string): Promise<Result<TikTokStatus>>
  tiktokConnect(): Promise<Result<TikTokStatus>>
  tiktokDisconnect(): Promise<TikTokStatus>
  tiktokCreator(): Promise<Result<TikTokCreator>>
  tiktokSend(req: TikTokPostRequest, taskId: string): Promise<Result<{ publishId: string; status: string }>>
  // Instalação de ferramentas com 1 clique (Windows)
  installWhisper(taskId: string, model: 'base' | 'small'): Promise<Result<{ whisperPath: string; modelPath: string }>>
  installFfmpeg(taskId: string): Promise<Result<{ ffmpegPath: string; ffprobePath: string }>>
  // Configurações e ferramentas
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  setSecret(kind: 'obs' | 'ai', value: string): Promise<Result<boolean>>
  toolStatus(refresh?: boolean): Promise<ToolStatus>
  // OBS e monitoramento
  obsStatus(): Promise<ObsStatus>
  obsTest(host: string, port: number, password?: string): Promise<Result<string>>
  obsMarker(): Promise<Result<number>>
  watchStatus(): Promise<WatchStatus>
  // App
  appInfo(): Promise<AppInfo>
  openFolder(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  diagnostics(): Promise<string>
  // Atualizações
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<boolean>
  // Eventos
  onQueue(cb: (s: QueueState) => void): () => void
  onJobProgress(cb: (j: Job) => void): () => void
  onTaskProgress(cb: (p: TaskProgress) => void): () => void
  onObsStatus(cb: (s: ObsStatus) => void): () => void
  onWatchStatus(cb: (s: WatchStatus) => void): () => void
  onLibraryChanged(cb: (info: { projectId: string; reason: 'pasta' | 'obs' | 'marcador' }) => void): () => void
  onShortcut(cb: (action: 'marker') => void): () => void
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  /** Avisos do processo principal (ex.: pasta de saída trocada). */
  onNotice(cb: (n: { kind: 'info' | 'ok' | 'erro'; text: string }) => void): () => void
}
