import { applyPreset, PRESETS } from '@shared/presets'
import type { AspectRatio, AudioTrackChoice, ExportOptions, MediaMetadata, SubtitleStyle, VideoEncoder } from '@shared/types'
import { NAME_TOKENS } from '@shared/naming'
import { Field, Tip, Toggle } from '../lib/ui'

const ENCODER_LABEL: Record<VideoEncoder, string> = {
  libx264: 'H.264 (processador) — compatível com tudo',
  libx265: 'H.265/HEVC (processador) — menor, mais lento',
  h264_nvenc: 'H.264 NVIDIA (placa de vídeo)',
  hevc_nvenc: 'H.265 NVIDIA (placa de vídeo)',
  h264_qsv: 'H.264 Intel Quick Sync',
  hevc_qsv: 'H.265 Intel Quick Sync',
  h264_amf: 'H.264 AMD',
  hevc_amf: 'H.265 AMD'
}

interface Props {
  options: ExportOptions
  onChange: (o: ExportOptions) => void
  meta: MediaMetadata | null
  hwEncoders: VideoEncoder[]
  hasTranscript: boolean
  hasWordTimes: boolean
  presetId: string
  onPreset: (id: string) => void
  compact?: boolean
}

export function ExportPanel({ options: o, onChange, meta, hwEncoders, hasTranscript, hasWordTimes, presetId, onPreset, compact }: Props) {
  const set = (patch: Partial<ExportOptions>) => onChange({ ...o, ...patch })
  const setStyle = (patch: Partial<SubtitleStyle>) => set({ subtitleStyle: { ...o.subtitleStyle, ...patch } })
  const isVideo = o.format === 'mp4' || o.format === 'gif'
  const tracks = meta?.audioTracks ?? []
  const encoders: VideoEncoder[] = ['libx264', 'libx265', ...hwEncoders.filter((e) => e !== 'libx264' && e !== 'libx265')]

  return (
    <div className="export-panel">
      <Field label="Preset">
        <select
          value={presetId}
          onChange={(e) => {
            onPreset(e.target.value)
            onChange(applyPreset(o, e.target.value))
          }}
        >
          <option value="">Personalizado</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {presetId && <small className="muted">{PRESETS.find((p) => p.id === presetId)?.description}</small>}
      </Field>

      <div className="two">
        <Field label="Formato">
          <select value={o.format} onChange={(e) => set({ format: e.target.value as ExportOptions['format'], mode: 'precise' })}>
            <option value="mp4">MP4 (vídeo)</option>
            <option value="mp3">MP3 (só áudio)</option>
            <option value="wav">WAV (só áudio)</option>
            <option value="gif">GIF (sem som)</option>
          </select>
        </Field>
        <Field label="Modo">
          <select value={o.mode} onChange={(e) => set({ mode: e.target.value as ExportOptions['mode'] })} disabled={o.format !== 'mp4'}>
            <option value="precise">Preciso (reencoda)</option>
            <option value="fast">Rápido (cópia)</option>
          </select>
        </Field>
      </div>

      {isVideo && (
        <>
          <div className="two">
            <Field label="Proporção">
              <select value={o.aspect} onChange={(e) => set({ aspect: e.target.value as AspectRatio })}>
                <option value="original">Original</option>
                <option value="9:16">9:16 vertical (TikTok, Reels, Shorts)</option>
                <option value="16:9">16:9 horizontal</option>
                <option value="1:1">1:1 quadrado</option>
                <option value="4:5">4:5 feed</option>
              </select>
            </Field>
            <Field label="Encaixe">
              <select value={o.fit} onChange={(e) => set({ fit: e.target.value as ExportOptions['fit'] })} disabled={o.aspect === 'original'}>
                <option value="crop">Recortar (preenche a tela)</option>
                <option value="blur">Fundo desfocado</option>
                <option value="pad">Barras pretas</option>
              </select>
            </Field>
          </div>
          {o.aspect !== 'original' && o.fit === 'crop' && (
            <Field label={`Posição do recorte: ${Math.round(o.cropX * 100)}% da esquerda`} hint="Arraste o quadro sobre o vídeo ou use o controle. 50% = centro.">
              <input type="range" min={0} max={1} step={0.01} value={o.cropX} onChange={(e) => set({ cropX: Number(e.target.value) })} />
            </Field>
          )}
        </>
      )}

      {!compact && (
        <>
          <div className="two">
            {o.format === 'mp4' && (
              <Field label="Qualidade">
                <select value={o.quality} onChange={(e) => set({ quality: e.target.value as ExportOptions['quality'] })}>
                  <option value="high">Alta</option>
                  <option value="medium">Média</option>
                  <option value="small">Leve</option>
                </select>
              </Field>
            )}
            {o.format === 'mp4' && (
              <Field label="Limite de tamanho (MB)">
                <input
                  type="number"
                  min={1}
                  placeholder="sem limite"
                  value={o.maxSizeMB ?? ''}
                  onChange={(e) => set({ maxSizeMB: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                />
              </Field>
            )}
          </div>
          {o.format === 'mp4' && (
            <Field label="Codificador" hint={hwEncoders.length ? 'Placas de vídeo detectadas e testadas neste computador.' : 'Nenhuma placa de vídeo compatível detectada; usando o processador.'}>
              <select value={o.encoder} onChange={(e) => set({ encoder: e.target.value as VideoEncoder })}>
                {encoders.map((e) => (
                  <option key={e} value={e}>
                    {ENCODER_LABEL[e]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="three">
            <Field label="Velocidade">
              <select value={o.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
                {[0.5, 0.75, 1, 1.1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fade de entrada (s)">
              <input type="number" min={0} max={5} step={0.1} value={o.fadeInSec} onChange={(e) => set({ fadeInSec: Math.max(0, Number(e.target.value)) })} />
            </Field>
            <Field label="Fade de saída (s)">
              <input type="number" min={0} max={5} step={0.1} value={o.fadeOutSec} onChange={(e) => set({ fadeOutSec: Math.max(0, Number(e.target.value)) })} />
            </Field>
          </div>

          {o.format !== 'gif' && (
            <div className="row wrap">
              <Toggle checked={o.includeAudio} onChange={(v) => set({ includeAudio: v })} label="Incluir áudio" />
              <Toggle checked={o.normalizeAudio} onChange={(v) => set({ normalizeAudio: v })} label="Normalizar volume (−14 LUFS)" hint="Deixa todos os cortes com o mesmo volume, padrão das redes." />
              {tracks.length > 1 && (
                <Field label="Faixa de áudio">
                  <select
                    value={String(o.audioTrack)}
                    onChange={(e) => set({ audioTrack: (e.target.value === 'mix' ? 'mix' : Number(e.target.value)) as AudioTrackChoice })}
                  >
                    {tracks.map((t) => (
                      <option key={t.index} value={t.index}>
                        Faixa {t.index + 1}
                        {t.title ? ` — ${t.title}` : ''}
                      </option>
                    ))}
                    <option value="mix">Misturar todas</option>
                  </select>
                </Field>
              )}
            </div>
          )}
          {isVideo && <Toggle checked={o.thumbnail} onChange={(v) => set({ thumbnail: v })} label="Gerar capa (JPG) junto" />}

          {o.format === 'mp4' && (
            <fieldset className="subgroup">
              <legend>
                Legendas <Tip text="Usa a transcrição do vídeo. Transcreva ou importe um SRT na aba Transcrição." />
              </legend>
              <Field label="Modo">
                <select value={o.subtitles} onChange={(e) => set({ subtitles: e.target.value as ExportOptions['subtitles'] })}>
                  <option value="none">Sem legendas</option>
                  <option value="burn">Gravadas no vídeo</option>
                  <option value="srt">Arquivo SRT separado</option>
                  <option value="both">Gravadas + SRT</option>
                </select>
              </Field>
              {o.subtitles !== 'none' && !hasTranscript && <p className="warn small">Sem transcrição: o corte sairá sem legendas.</p>}
              {(o.subtitles === 'burn' || o.subtitles === 'both') && (
                <>
                  <div className="three">
                    <Field label="Fonte">
                      <input value={o.subtitleStyle.font} onChange={(e) => setStyle({ font: e.target.value })} />
                    </Field>
                    <Field label="Tamanho">
                      <input type="number" min={20} max={160} value={o.subtitleStyle.fontSize} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} />
                    </Field>
                    <Field label="Posição">
                      <select value={o.subtitleStyle.position} onChange={(e) => setStyle({ position: e.target.value as SubtitleStyle['position'] })}>
                        <option value="bottom">Embaixo</option>
                        <option value="middle">Meio</option>
                        <option value="top">Em cima</option>
                      </select>
                    </Field>
                  </div>
                  <div className="three">
                    <Field label="Texto">
                      <input type="color" value={o.subtitleStyle.textColor} onChange={(e) => setStyle({ textColor: e.target.value })} />
                    </Field>
                    <Field label="Destaque">
                      <input type="color" value={o.subtitleStyle.highlightColor} onChange={(e) => setStyle({ highlightColor: e.target.value })} />
                    </Field>
                    <Field label="Contorno">
                      <input type="color" value={o.subtitleStyle.outlineColor} onChange={(e) => setStyle({ outlineColor: e.target.value })} />
                    </Field>
                  </div>
                  <div className="two">
                    <Field label="Letras por linha">
                      <input type="number" min={8} max={60} value={o.subtitleStyle.maxCharsPerLine} onChange={(e) => setStyle({ maxCharsPerLine: Number(e.target.value) })} />
                    </Field>
                    <Field label="Linhas">
                      <input type="number" min={1} max={3} value={o.subtitleStyle.maxLines} onChange={(e) => setStyle({ maxLines: Number(e.target.value) })} />
                    </Field>
                  </div>
                  <div className="row wrap">
                    <Toggle checked={o.subtitleStyle.uppercase} onChange={(v) => setStyle({ uppercase: v })} label="MAIÚSCULAS" />
                    <Toggle
                      checked={o.subtitleStyle.wordHighlight}
                      onChange={(v) => setStyle({ wordHighlight: v })}
                      label="Destacar palavra falada"
                      hint={hasWordTimes ? 'Estilo TikTok.' : 'Precisa de transcrição do whisper.cpp (tempo por palavra).'}
                    />
                    <Toggle checked={o.subtitleStyle.emojis} onChange={(v) => setStyle({ emojis: v })} label="Emojis automáticos" hint="Podem aparecer sem cor, dependendo das fontes do Windows." />
                  </div>
                  <SubtitlePreview style={o.subtitleStyle} aspect={o.aspect} />
                </>
              )}
            </fieldset>
          )}

          <fieldset className="subgroup">
            <legend>Arquivo</legend>
            <Field label="Modelo de nome" hint={`Use: ${NAME_TOKENS.join(' ')}`}>
              <input value={o.nameTemplate} onChange={(e) => set({ nameTemplate: e.target.value })} />
            </Field>
            <Toggle checked={o.subfolderPerSource} onChange={(v) => set({ subfolderPerSource: v })} label="Criar subpasta com o nome do vídeo" />
          </fieldset>
        </>
      )}
    </div>
  )
}

function SubtitlePreview({ style, aspect }: { style: SubtitleStyle; aspect: AspectRatio }) {
  const words = ['Olha', 'que', 'jogada', 'incrível']
  const vertical = aspect === '9:16' || aspect === '4:5'
  return (
    <div className={`sub-preview ${vertical ? 'vertical' : ''} pos-${style.position}`} aria-label="Prévia da legenda">
      <span
        style={{
          fontFamily: style.font,
          fontSize: `${Math.max(10, style.fontSize / (vertical ? 5 : 6))}px`,
          color: style.textColor,
          WebkitTextStroke: `${Math.max(0.5, style.outline / 4)}px ${style.outlineColor}`,
          textTransform: style.uppercase ? 'uppercase' : 'none'
        }}
      >
        {words.map((w, i) => (
          <span key={w} style={i === 2 && style.wordHighlight ? { color: style.highlightColor } : undefined}>
            {w}{' '}
          </span>
        ))}
      </span>
    </div>
  )
}
