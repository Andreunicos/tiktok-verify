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
/** crop = preenche cortando; blur = vídeo inteiro com fundo desfocado; pad = barras pretas; game = jogo ampliado no meio (corta um pouco das laterais) com fundo desfocado. */
export type FitMode = 'crop' | 'blur' | 'pad' | 'game'
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
  /** Karaokê: o texto "enche" de cor conforme é falado. Requer tempos por palavra. */
  karaoke?: boolean
  /** Caixa escura atrás do texto. */
  box?: boolean
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
  /** Música de fundo e efeitos sonoros (tempos no corte final). */
  audioExtras?: AudioExtras
  /** Edição visual automática (tempos no corte final). */
  visual?: VisualExtras
}

export interface VisualExtras {
  /** Zooms rápidos ("punch-in"). */
  zooms?: { atSec: number; durSec: number; scale: number }[]
  /** Posição do recorte ao longo do tempo (0 = esquerda, 1 = direita); só no modo "Preencher a tela". */
  track?: { t: number; x: number }[]
  /** Barra de progresso no rodapé. */
  progressBar?: boolean
  /** Título grande no topo nos primeiros segundos. */
  title?: string
  /** Palavras que ganham destaque (cor e tamanho) na legenda. */
  keywords?: string[]
  /** Emojis coloridos (imagens) sobre o vídeo. Preenchido na exportação a partir das legendas. */
  emojis?: { file: string; startSec: number; endSec: number }[]
  /** Kit da marca: @ do canal no canto, logo/marca d'água e chamada no final. */
  handle?: string
  logo?: { file: string; position: 'tl' | 'tr' | 'bl' | 'br' }
  cta?: string
}

export interface AudioExtras {
  music?: {
    file: string
    /** 0..1 em relação ao volume original da música (0,15–0,25 costuma ficar bom sob voz). */
    volume: number
    /** Abaixa a música quando há fala (sidechain). */
    duck: boolean
    /** Crédito exigido pela licença, para os textos do post. */
    attribution?: string | null
  }
  effects?: { file: string; atSec: number; volume: number }[]
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
  /** Movimento da imagem por segundo (diferença média entre quadros; análises antigas não têm). */
  motion?: number[]
  /** Empolgação do chat por segundo (0..1), quando há chat da live junto do vídeo. */
  chatHype?: number[]
  /** Eventos sonoros do jogo (tiros, explosões, impactos) detectados no áudio. */
  gameEvents?: { t: number; kind: 'tiro' | 'explosao' | 'impacto' }[]
  /** Risadas e gritos detectados no áudio (análises antigas não têm). */
  reactions?: { startSec: number; endSec: number; kind: 'risada' | 'grito' }[]
}

export interface SuggestionFeatures {
  energy: number
  peak: number
  speech: number
  scenes: number
  hook: number
  cleanStart: number
  cleanEnd: number
  /** Risada ou grito dentro do trecho. */
  reaction?: number
  /** Muita ação na imagem (movimento acima do normal do vídeo). */
  action?: number
  /** Chat da live empolgado no trecho. */
  chat?: number
  /** Tiros/explosões/impactos do jogo no trecho. */
  gameEvents?: number
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
  /** whisper-cli da placa de vídeo NVIDIA ('' = não instalado). */
  whisperGpuPath: string
  /** Usar a placa de vídeo quando instalada (volta para o processador se falhar). */
  whisperUseGpu: boolean
  /** Lives longas: transcrever só os trechos promissores. */
  fastTranscribe: boolean
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
  /** Qual IA usar: grátis na nuvem (padrão), Claude (pago) ou nenhuma. */
  aiProvider: 'gratis' | 'claude' | 'desligada'
  groqKeyEnc: string
  cerebrasKeyEnc: string
  openrouterKeyEnc: string
  /** IA grátis sem chave (Pollinations) quando não há chave ou as outras falham. */
  keylessAi: boolean
  youtubeClientId: string
  youtubeClientSecretEnc: string
  youtubeTokensEnc: string
  youtubeChannel: string
  youtubeCallbackPort: number
  /** Pede ao TikTok o escopo video.list para ler visualizações (precisa estar aprovado no app do TikTok). */
  tiktokWithStats: boolean
  /** Kit da marca aplicado nos cortes do modo automático. */
  brand: { enabled: boolean; handle: string; logoPath: string; logoPosition: 'tl' | 'tr' | 'bl' | 'br'; cta: string; color: string }
  /** Gosto aprendido com 👍/👎 (títulos/motivos), enviado para a IA. */
  taste: { liked: string[]; disliked: string[] }
  /** Já aplicou os novos padrões do modo automático (enquadramento inteligente e edição turbinada). */
  smartDefaultsV1: boolean
  onboardingDone: boolean
  /** Verifica e instala atualizações sozinho ao abrir o app. */
  autoUpdate: boolean
  /** Últimas escolhas do modo automático. */
  auto: AutoOptions
  /** Gerar cortes sozinho quando chega gravação nova (OBS ou pasta). */
  autoOnNewRecording: boolean
  // TikTok (app do próprio usuário no developers.tiktok.com)
  tiktokClientKey: string
  tiktokClientSecretEnc: string
  tiktokTokensEnc: string
  tiktokRedirectUri: string
  tiktokCallbackPort: number
  tiktokDisplayName: string
  /** Enviar sozinho para os rascunhos do TikTok quando os cortes ficarem prontos. */
  tiktokAutoDrafts: boolean
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
  state: 'desligado' | 'conectando' | 'aguardando' | 'conectado' | 'erro'
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

// ───────────── Biblioteca de sons ─────────────
export type SoundKind = 'musica' | 'efeito'
export type Mood = 'animada' | 'calma' | 'epica' | 'lofi' | 'engracada'

export interface SoundItem {
  id: string
  kind: SoundKind
  title: string
  file: string
  durationSec: number
  mood: Mood | null
  tags: string[]
  /** Ex.: "CC0", "PDM", "CC BY 4.0", "Gerado pelo app (CC0)", "Arquivo próprio". */
  license: string
  licenseUrl: string | null
  creator: string | null
  sourceUrl: string | null
  /** Texto de crédito exigido pela licença (vazio para CC0/domínio público). */
  attribution: string | null
  origin: 'gerado' | 'openverse' | 'importado'
  addedAt: number
}

export interface OpenverseResult {
  id: string
  title: string
  creator: string | null
  license: string
  licenseVersion: string | null
  licenseUrl: string | null
  url: string
  landingUrl: string | null
  durationSec: number | null
  filetype: string | null
  attribution: string | null
  tags: string[]
  provider: string | null
}

// ───────────── Piloto automático (2 cliques) ─────────────
export type AutoPlatform = 'tiktok' | 'reels' | 'shorts' | 'youtube'
export type AutoLength = 'curto' | 'medio' | 'longo'

export interface AutoOptions {
  platform: AutoPlatform
  count: number
  length: AutoLength
  /** Legendas gravadas no vídeo (precisa de transcrição). */
  subtitles: boolean
  /** Tira "éé", "hum" e pausas longas (precisa de transcrição com tempo por palavra). */
  cleanSpeech: boolean
  /** auto = segue a pessoa quando ela aparece grande, senão vídeo inteiro; blur = vídeo inteiro com fundo desfocado; crop = preenche a tela. */
  framing: 'auto' | 'game' | 'blur' | 'crop'
  /** Música de fundo pelo clima, ou nenhuma. */
  music: Mood | 'nenhuma'
  /** Efeitos sonoros nos momentos certos (entrada, palavras de destaque, picos). */
  effects: boolean
  /** Edição turbinada: gancho no começo, zooms nos picos, título na tela e barra de progresso. Padrão: ligado. */
  smartEdit?: boolean
  /** Pedido escrito pela pessoa ("5 cortes de 30 s dos momentos engraçados"). Vai também para a IA. */
  instructions?: string
  /** Duração pedida no texto (substitui o tamanho padrão). */
  customSec?: { min: number; max: number }
  /** Estilo da legenda. */
  captionStyle?: 'tiktok' | 'mrbeast' | 'hormozi' | 'karaoke' | 'caixa' | 'minimal'
  /** Série: uma história contínua dividida em Parte 1, 2, 3… (com "Parte 2 no perfil" no fim). */
  series?: boolean
  /** Teste A/B: cada corte sai também numa versão B (outro gancho, outro título na tela, outra legenda). */
  abTest?: boolean
}

export type AutoStepKey = 'ler' | 'analisar' | 'transcrever' | 'escolher' | 'limpar' | 'trilha' | 'editar' | 'exportar'

export interface AutoStep {
  key: AutoStepKey
  label: string
  state: 'pendente' | 'rodando' | 'ok' | 'pulado' | 'erro'
  detail?: string
  ratio?: number
}

export interface AutoClip {
  segmentId: string
  index: number
  title: string
  description: string
  hashtags: string[]
  startSec: number
  endSec: number
  durationSec: number
  score: number
  reasons: string[]
  /** Características da nota (para aprender com 👍/👎). */
  features?: SuggestionFeatures
  /** O que a pessoa achou do corte. */
  feedback?: 'up' | 'down'
  /** Teste A/B: versão do corte (a B é a alternativa da A com o mesmo número). */
  variant?: 'A' | 'B'
  /** Série: parte k de n. */
  part?: { k: number; n: number }
  /** Pedido de exportação usado (sem as legendas, que vêm do projeto) — para editar e refazer. */
  request?: Omit<CutRequest, 'cues'> & { withCues: boolean }
  jobId?: string
  status: JobStatus | 'pendente'
  ratio: number
  outputPath?: string
  thumbnail?: string
  error?: string
  posts?: ClipPost[]
}

export interface ClipPost {
  platform: 'tiktok' | 'youtube'
  mode: 'rascunho' | 'direto'
  status: 'agendado' | 'enviando' | 'processando' | 'enviado' | 'publicado' | 'erro'
  progress?: number
  error?: string
  publishId?: string
  /** Id do vídeo publicado (TikTok/YouTube), para buscar as visualizações. */
  postId?: string
  /** Quando vai sair (agendado). */
  scheduledAt?: number
  stats?: { views: number; likes: number; comments: number; shares?: number; at: number }
  /** Já usado para o app aprender (não conta duas vezes). */
  learned?: boolean
  at: number
}

export interface YouTubeStatus {
  configured: boolean
  connected: boolean
  channel: string | null
}

export interface YouTubePostRequest {
  file: string
  title: string
  description: string
  tags: string[]
  privacy: 'public' | 'unlisted' | 'private'
  /** epoch ms: o YouTube publica sozinho nessa hora. */
  publishAt?: number
  runId?: string
  segmentId?: string
}

/** Envio agendado que o app faz na hora certa (TikTok; o YouTube agenda no próprio YouTube). */
export interface ScheduledPost {
  id: string
  at: number
  platform: 'tiktok'
  file: string
  runId?: string
  segmentId?: string
  mode: 'rascunho' | 'direto'
  post?: TikTokPostRequest['post']
  status: 'aguardando' | 'enviando' | 'feito' | 'erro'
  error?: string
}

export interface TikTokStatus {
  configured: boolean
  connected: boolean
  displayName: string | null
  avatarUrl: string | null
  redirectUri: string
  autoDrafts: boolean
}

export interface TikTokCreator {
  username: string
  nickname: string
  avatarUrl: string | null
  privacyOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}

export interface TikTokPostRequest {
  /** Atualiza este registro de envio (ex.: o "agendado") em vez de criar outro. */
  trackAt?: number
  file: string
  mode: 'rascunho' | 'direto'
  /** Para associar ao corte no histórico (opcional). */
  runId?: string
  segmentId?: string
  post?: {
    title: string
    privacyLevel: string
    disableComment: boolean
    disableDuet: boolean
    disableStitch: boolean
    brandContent: boolean
    brandOrganic: boolean
  }
}

export interface AutoRun {
  id: string
  projectId: string
  path: string
  fileName: string
  origin: Project['origin']
  options: AutoOptions
  state: 'rodando' | 'concluído' | 'erro' | 'cancelado'
  steps: AutoStep[]
  clips: AutoClip[]
  error?: string
  notes: string[]
  outputDir?: string
  textsFile?: string
  createdAt: number
  finishedAt?: number
}

export interface UpdateStatus {
  state: 'desativado' | 'parado' | 'verificando' | 'baixando' | 'pronta' | 'atualizado' | 'erro'
  currentVersion: string
  newVersion: string | null
  percent: number
  error: string | null
  checkedAt: number | null
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type SecretKind = 'obs' | 'ai' | 'groq' | 'cerebras' | 'openrouter'

/** Ajustes ao refazer um corte do modo automático. */
export interface ClipEdits {
  title?: string
  /** Texto de gancho na tela (vazio = sem texto). */
  overlay?: string
  /** Segundos a somar no começo/fim (negativo = começa antes / termina antes). */
  trimStart?: number
  trimEnd?: number
  music?: boolean
  captions?: boolean
}
