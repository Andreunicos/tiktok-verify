import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SocialCopy } from '@shared/api'
import { clipDuration } from '@shared/ffmpeg'
import { PRESETS } from '@shared/presets'
import { hashtags, localDescription, localTitle } from '@shared/social'
import { formatBytes, formatTimecode } from '@shared/time'
import type { AnalysisResult, AppSettings, Cue, CutRequest, ExportOptions, MediaMetadata, Project, Segment, Suggestion, ToolStatus } from '@shared/types'
import { fastModeBlocker, validateRequest } from '@shared/validation'
import { ExportPanel } from '../components/ExportPanel'
import { Player } from '../components/Player'
import { SegmentList } from '../components/SegmentList'
import { SuggestionsPanel } from '../components/SuggestionsPanel'
import { Timeline } from '../components/Timeline'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { typingTarget } from '../lib/keys'
import { newId, useToast } from '../lib/ui'

type Tab = 'exportar' | 'sugestoes' | 'transcricao' | 'redes' | 'info'

interface Props {
  projectId: string
  settings: AppSettings
  tools: ToolStatus | null
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
  onOpenSettings: (section?: string) => void
  onGoQueue: () => void
  onClose: () => void
  reloadKey: number
}

const api = () => window.bigloop

export function Editor(p: Props) {
  const toast = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [meta, setMeta] = useState<MediaMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [thumbs, setThumbs] = useState<{ timeSec: number; url: string }[]>([])
  const [segments, setSegmentsRaw] = useState<Segment[]>([])
  const history = useRef<{ past: Segment[][]; future: Segment[][] }>({ past: [], future: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [current, setCurrent] = useState(0)
  const [tab, setTab] = useState<Tab>('exportar')
  const [options, setOptions] = useState<ExportOptions>(p.settings.exportDefaults)
  const [presetId, setPresetId] = useState('')
  const [task, setTask] = useState<{ id: string; kind: 'analise' | 'transcricao'; ratio: number; label: string } | null>(null)
  const [scenes, setScenes] = useState(true)
  const [social, setSocial] = useState<SocialCopy | null>(null)
  const [socialBusy, setSocialBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewEnd = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ───── Carregar projeto ─────
  useEffect(() => {
    let alive = true
    ;(async () => {
      setError(null)
      const proj = await api().getProject(p.projectId)
      if (!proj) return setError('Projeto não encontrado.')
      const opened = await api().openMedia(proj.path)
      if (!alive) return
      if (!opened.ok) {
        setProject(proj)
        return setError(opened.error)
      }
      setProject(opened.value.project)
      setMeta(opened.value.meta)
      setSegmentsRaw(opened.value.project.segments)
      setChecked(new Set(opened.value.project.segments.map((s) => s.id)))
      history.current = { past: [], future: [] }
      const a = await api().getAnalysis(p.projectId)
      if (!alive) return
      setAnalysis(a)
      const t = await api().thumbnails(p.projectId, Math.min(120, Math.max(12, Math.round(opened.value.meta.durationSec / 20))))
      if (alive && t.ok) setThumbs(t.value)
    })()
    return () => {
      alive = false
    }
  }, [p.projectId, p.reloadKey])

  // Atualizações vindas de fora (OBS marcou, pasta importou e analisou)
  useEffect(
    () =>
      api().onLibraryChanged(async (info) => {
        if (info.projectId !== p.projectId) return
        const proj = await api().getProject(p.projectId)
        if (proj) setProject((old) => (old ? { ...old, markers: proj.markers, suggestions: proj.suggestions, hasAnalysis: proj.hasAnalysis } : proj))
        setAnalysis(await api().getAnalysis(p.projectId))
      }),
    [p.projectId]
  )

  useEffect(() => api().onTaskProgress((t) => setTask((old) => (old && old.id === t.taskId ? { ...old, ratio: t.ratio, label: t.label } : old))), [])

  const persist = useCallback(
    (patch: Partial<Pick<Project, 'segments' | 'markers' | 'transcript' | 'suggestions'>>) => {
      setProject((old) => (old ? { ...old, ...patch } : old))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const id = p.projectId
      saveTimer.current = setTimeout(() => void api().updateProject(id, patch), 400)
    },
    [p.projectId]
  )

  /** Altera trechos com histórico (desfazer/refazer). */
  const setSegments = useCallback(
    (next: Segment[], record = true) => {
      setSegmentsRaw((prev) => {
        if (record) {
          history.current.past.push(prev)
          if (history.current.past.length > 100) history.current.past.shift()
          history.current.future = []
        }
        return next
      })
      persist({ segments: next })
    },
    [persist]
  )
  const undo = () => {
    const prev = history.current.past.pop()
    if (!prev) return
    history.current.future.push(segments)
    setSegmentsRaw(prev)
    persist({ segments: prev })
  }
  const redo = () => {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(segments)
    setSegmentsRaw(next)
    persist({ segments: next })
  }

  const duration = meta?.durationSec ?? project?.durationSec ?? 0
  const fps = meta?.video?.fps ?? 30
  const selected = segments.find((s) => s.id === selectedId) ?? null
  const transcript = project?.transcript ?? null
  const hasWordTimes = !!transcript?.cues.some((c) => c.words && c.words.length > 1 && !transcript.engine.startsWith('importado'))

  // ───── Reprodução ─────
  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(duration, t))
      setCurrent(v.currentTime)
    },
    [duration]
  )
  const playRange = (start: number, end: number) => {
    previewEnd.current = end
    seek(start)
    void videoRef.current?.play()
  }
  const onTime = (t: number) => {
    setCurrent(t)
    if (previewEnd.current !== null && t >= previewEnd.current) {
      videoRef.current?.pause()
      previewEnd.current = null
    }
  }

  // ───── Operações com trechos ─────
  const addSegment = (startSec: number, endSec: number, extra: Partial<Segment> = {}) => {
    const seg: Segment = { id: newId(), name: extra.name ?? `Trecho ${segments.length + 1}`, ranges: [{ startSec, endSec }], createdAt: Date.now(), origin: 'manual', ...extra }
    setSegments([...segments, seg])
    setSelectedId(seg.id)
    setChecked((c) => new Set(c).add(seg.id))
    return seg
  }
  const updateSegment = (seg: Segment, record = true) => setSegments(segments.map((s) => (s.id === seg.id ? seg : s)), record)
  const markIn = () => {
    const t = videoRef.current?.currentTime ?? current
    if (!selected) return addSegment(t, Math.min(duration, t + 15))
    const r = selected.ranges[selected.ranges.length - 1]
    updateSegment({ ...selected, ranges: selected.ranges.map((x, i) => (i === selected.ranges.length - 1 ? { startSec: Math.min(t, r.endSec - 0.1), endSec: r.endSec } : x)) })
  }
  const markOut = () => {
    const t = videoRef.current?.currentTime ?? current
    if (!selected) return addSegment(Math.max(0, t - 15), t)
    const r = selected.ranges[selected.ranges.length - 1]
    updateSegment({ ...selected, ranges: selected.ranges.map((x, i) => (i === selected.ranges.length - 1 ? { startSec: r.startSec, endSec: Math.max(t, r.startSec + 0.1) } : x)) })
  }
  const addMarker = () => {
    if (!project) return
    const m = { id: newId(), timeSec: videoRef.current?.currentTime ?? current, label: `Marcador ${project.markers.length + 1}`, source: 'manual' as const }
    persist({ markers: [...project.markers, m].sort((a, b) => a.timeSec - b.timeSec) })
  }

  // ───── Atalhos ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingTarget(e)) return
      const v = videoRef.current
      const k = e.key
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'e') {
        e.preventDefault()
        return void exportChecked()
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (k === ' ' && v) {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault()
        const dir = k === 'ArrowLeft' ? -1 : 1
        v?.pause()
        seek((v?.currentTime ?? current) + dir * (e.shiftKey ? 1 : 1 / fps))
      } else if (k === 'j' || k === 'J') seek(current - 5)
      else if (k === 'l' || k === 'L') seek(current + 5)
      else if (k === 'i' || k === 'I') markIn()
      else if (k === 'o' || k === 'O') markOut()
      else if (k === 'n' || k === 'N') addSegment(current, Math.min(duration, current + 15))
      else if (k === 'm' || k === 'M') addMarker()
      else if ((k === 'p' || k === 'P') && selected) playRange(selected.ranges[0].startSec, selected.ranges[selected.ranges.length - 1].endSec)
      else if ((k === 'Delete' || k === 'Backspace') && selected) deleteSegment(selected.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const deleteSegment = (id: string) => {
    setSegments(segments.filter((s) => s.id !== id))
    setSelectedId(null)
    toast('Trecho apagado.', 'info', { label: 'Desfazer', run: undo })
  }

  // ───── Análise e sugestões ─────
  const runAnalysis = async () => {
    if (!project) return
    const id = newId()
    setTask({ id, kind: 'analise', ratio: 0, label: 'Analisando áudio' })
    const track = typeof options.audioTrack === 'number' ? options.audioTrack : 0
    const res = await api().analyze(project.id, id, { audioTrack: track, scenes })
    setTask(null)
    if (!res.ok) return toast(res.error, 'erro')
    setAnalysis(res.value)
    toast(`Análise pronta: ${res.value.silences.length} pausas, ${res.value.scenes.length} cenas.`, 'ok')
    await runSuggest()
  }
  const runSuggest = async () => {
    if (!project) return
    const res = await api().suggest(project.id, p.settings.suggestion)
    if (!res.ok) return toast(res.error, 'erro')
    setProject((old) => (old ? { ...old, suggestions: res.value } : old))
    if (res.value.length === 0) toast('Nenhum trecho com a duração pedida. Tente outra faixa de duração.', 'info')
  }
  const rate = async (s: Suggestion, approved: boolean) => {
    if (!project) return
    const res = await api().rateSuggestion(project.id, s.id, approved)
    if (!res.ok) return toast(res.error, 'erro')
    setProject((old) => (old ? { ...old, suggestions: res.value.suggestions } : old))
    if (approved) addSegment(s.startSec, s.endSec, { name: s.title.slice(0, 40) || `Sugestão ${formatTimecode(s.startSec)}`, origin: 'suggestion', suggestionId: s.id })
  }

  // ───── Transcrição ─────
  const runTranscribe = async (onlySelection: boolean) => {
    if (!project) return
    const id = newId()
    setTask({ id, kind: 'transcricao', ratio: 0, label: 'Extraindo áudio' })
    const range = onlySelection && selected ? { startSec: selected.ranges[0].startSec, endSec: selected.ranges[selected.ranges.length - 1].endSec } : undefined
    const res = await api().transcribe(project.id, id, { audioTrack: typeof options.audioTrack === 'number' ? options.audioTrack : 0, range })
    setTask(null)
    if (!res.ok) return toast(res.error, 'erro')
    setProject((old) => (old ? { ...old, transcript: res.value } : old))
    toast(`Transcrição pronta: ${res.value.cues.length} falas.`, 'ok')
  }
  const editCue = (cue: Cue) => {
    if (!transcript) return
    persist({ transcript: { ...transcript, cues: transcript.cues.map((c) => (c.id === cue.id ? cue : c)) } })
  }

  // ───── Exportação ─────
  const buildRequest = (seg: Segment, n: number): CutRequest => ({
    inputPath: project!.path,
    outputDir: p.settings.outputDir,
    ranges: [...seg.ranges],
    options,
    segmentName: seg.name,
    presetName: PRESETS.find((x) => x.id === presetId)?.name,
    cues: transcript?.cues,
    sequence: n,
    source: {
      durationSec: duration,
      width: meta?.video?.width ?? 0,
      height: meta?.video?.height ?? 0,
      fps: meta?.video?.fps ?? null,
      audioTracks: meta?.audioTracks.length ?? 0
    }
  })
  const toExport = segments.filter((s) => checked.has(s.id))
  const firstProblem = useMemo(() => {
    if (!project || !meta) return null
    for (const [i, s] of toExport.entries()) {
      const err = validateRequest(buildRequest(s, i + 1))
      if (err) return `${s.name}: ${err}`
    }
    return null
  }, [toExport, options, project, meta])
  const presetWarning = useMemo(() => {
    const preset = PRESETS.find((x) => x.id === presetId)
    if (!preset?.maxDurationSec) return null
    const long = toExport.filter((s) => clipDuration({ ranges: s.ranges, options }) > preset.maxDurationSec!)
    return long.length ? `${long.length} trecho(s) passam de ${Math.round(preset.maxDurationSec / 60)} min, o limite comum em ${preset.name}.` : null
  }, [toExport, options, presetId])

  async function exportChecked() {
    if (!project || toExport.length === 0) return toast('Marque pelo menos um trecho para exportar.', 'info')
    if (firstProblem) return toast(firstProblem, 'erro')
    const res = await api().enqueue(toExport.map((s, i) => buildRequest(s, i + 1)))
    if (!res.ok) return toast(res.error, 'erro')
    toast(`${res.value.length} corte(s) na fila.`, 'ok', { label: 'Ver fila', run: p.onGoQueue })
  }
  const exportEdit = async (kind: 'fcpxml' | 'edl') => {
    if (!project) return
    const res = await api().exportInterchange(project.id, kind, toExport.length ? toExport.map((s) => s.id) : undefined)
    if (!res.ok) return toast(res.error, 'erro')
    toast(kind === 'fcpxml' ? 'XML criado. No Premiere: Arquivo → Importar.' : 'EDL criada. No DaVinci: Arquivo → Importar → Linha do tempo.', 'ok', {
      label: 'Mostrar',
      run: () => void api().showInFolder(res.value)
    })
  }

  // ───── Textos para redes ─────
  const selectedText = useMemo(() => {
    if (!selected || !transcript) return ''
    return transcript.cues
      .filter((c) => selected.ranges.some((r) => c.endSec > r.startSec && c.startSec < r.endSec))
      .map((c) => c.text)
      .join(' ')
  }, [selected, transcript])
  useEffect(() => setSocial(null), [selectedId])

  if (error && !meta)
    return (
      <div className="center-msg">
        <p className="error">{error}</p>
        <button onClick={p.onClose}>Voltar ao início</button>
      </div>
    )
  if (!project || !meta) return <div className="center-msg muted">Abrindo…</div>

  const wordsAvailable = hasWordTimes
  return (
    <main className="editor">
      <section className="editor-main">
        <div className="editor-title row between">
          <div>
            <h1 title={project.path}>{project.fileName}</h1>
            <span className="muted small">
              {formatTimecode(duration, true)} · {meta.video ? `${meta.video.width}×${meta.video.height} · ${meta.video.fps ?? '?'} fps` : 'só áudio'} ·{' '}
              {formatBytes(meta.sizeBytes)}
              {meta.audioTracks.length > 1 ? ` · ${meta.audioTracks.length} faixas de áudio` : ''}
            </span>
          </div>
          <div className="row">
            <button className="ghost small" onClick={undo} disabled={history.current.past.length === 0} title="Desfazer (Ctrl+Z)">
              ↶
            </button>
            <button className="ghost small" onClick={redo} disabled={history.current.future.length === 0} title="Refazer (Ctrl+Shift+Z)">
              ↷
            </button>
          </div>
        </div>
        {meta.video ? (
          <Player
            ref={videoRef}
            src={api().mediaUrl(project.path)}
            width={meta.video.width}
            height={meta.video.height}
            options={options}
            onTime={onTime}
            onCropX={(cropX) => setOptions({ ...options, cropX })}
          />
        ) : (
          <audio ref={videoRef as unknown as React.RefObject<HTMLAudioElement>} src={api().mediaUrl(project.path)} controls onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)} className="audio-only" />
        )}
        <div className="row controls">
          <span className="mono">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>
          <button className="small" onClick={() => seek(current - 1 / fps)} title="Quadro anterior (←)">
            ⟨ quadro
          </button>
          <button className="small" onClick={() => seek(current + 1 / fps)} title="Próximo quadro (→)">
            quadro ⟩
          </button>
          <button className="small" onClick={markIn} title="Atalho: I">
            Marcar início [I]
          </button>
          <button className="small" onClick={markOut} title="Atalho: O">
            Marcar fim [O]
          </button>
          <button className="small" onClick={() => addSegment(current, Math.min(duration, current + 15))} title="Atalho: N">
            + Trecho [N]
          </button>
          <button className="small" onClick={addMarker} title="Atalho: M">
            ⚑ Marcador [M]
          </button>
        </div>
        <Timeline
          duration={duration}
          current={current}
          analysis={analysis}
          thumbnails={thumbs}
          markers={project.markers}
          suggestions={project.suggestions}
          segments={segments}
          selectedId={selectedId}
          onSeek={seek}
          onSelect={setSelectedId}
          onRangeChange={(segId, idx, a, b, done) => {
            const seg = segments.find((s) => s.id === segId)
            if (!seg) return
            const next = { ...seg, ranges: seg.ranges.map((r, i) => (i === idx ? { startSec: Math.round(a * 1000) / 1000, endSec: Math.round(b * 1000) / 1000 } : r)) }
            if (!done) setSegmentsRaw(segments.map((s) => (s.id === segId ? next : s)))
            else setSegments(segments.map((s) => (s.id === segId ? next : s)))
          }}
          onSuggestionClick={(s) => {
            setTab('sugestoes')
            playRange(s.startSec, s.endSec)
          }}
        />
        <SegmentList
          segments={segments}
          selectedId={selectedId}
          checked={checked}
          duration={duration}
          onSelect={(id) => {
            setSelectedId(id)
            const s = segments.find((x) => x.id === id)
            if (s) seek(s.ranges[0].startSec)
          }}
          onToggleCheck={(id) =>
            setChecked((c) => {
              const n = new Set(c)
              if (n.has(id)) n.delete(id)
              else n.add(id)
              return n
            })
          }
          onCheckAll={(all) => setChecked(all ? new Set(segments.map((s) => s.id)) : new Set())}
          onChange={(seg) => updateSegment(seg)}
          onDelete={deleteSegment}
          onDuplicate={(id) => {
            const s = segments.find((x) => x.id === id)
            if (s) addSegment(0, 1, { ...s, id: newId(), name: `${s.name} (cópia)`, ranges: s.ranges.map((r) => ({ ...r })) })
          }}
          onAddRange={(id) => {
            const s = segments.find((x) => x.id === id)
            if (!s) return
            const last = s.ranges[s.ranges.length - 1]
            const start = Math.min(duration - 1, Math.max(current, last.endSec + 0.5))
            updateSegment({ ...s, ranges: [...s.ranges, { startSec: start, endSec: Math.min(duration, start + 5) }] })
            toast('Pedaço adicionado. Ajuste o início e o fim dele na lista ou arrastando na linha do tempo.', 'info')
          }}
          onRemoveFillers={async (id) => {
            const res = await api().removeFillers(project.id, id)
            if (!res.ok) return toast(res.error, 'erro')
            updateSegment(res.value.segment)
            toast(`Removidos ${res.value.removedWords} vícios e ${res.value.removedSec}s de pausas.`, 'ok', { label: 'Desfazer', run: undo })
          }}
          onPreview={(id) => {
            const s = segments.find((x) => x.id === id)
            if (s) playRange(s.ranges[0].startSec, s.ranges[s.ranges.length - 1].endSec)
          }}
          canRemoveFillers={wordsAvailable}
        />
      </section>

      <aside className="editor-side">
        <nav className="tabs" role="tablist">
          {(
            [
              ['exportar', 'Exportar'],
              ['sugestoes', `Sugestões${project.suggestions.length ? ` (${project.suggestions.length})` : ''}`],
              ['transcricao', 'Transcrição'],
              ['redes', 'Textos'],
              ['info', 'Info']
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="tab-body">
          {tab === 'exportar' && (
            <>
              <ExportPanel
                options={options}
                onChange={(o) => {
                  setOptions(o)
                  if (o.mode === 'fast' && fastModeBlocker({ ranges: selected?.ranges ?? [{ startSec: 0, endSec: 1 }], options: o })) setPresetId('')
                }}
                meta={meta}
                hwEncoders={p.tools?.hardwareEncoders ?? []}
                hasTranscript={!!transcript?.cues.length}
                hasWordTimes={wordsAvailable}
                presetId={presetId}
                onPreset={setPresetId}
              />
              <div className="export-actions">
                {presetWarning && <p className="warn small">{presetWarning}</p>}
                {firstProblem && <p className="error small">{firstProblem}</p>}
                <p className="muted small" title={p.settings.outputDir}>
                  Saída: <code>{p.settings.outputDir}</code>{' '}
                  <button
                    className="link"
                    onClick={async () => {
                      const d = await api().pickDir('Pasta de saída dos cortes', p.settings.outputDir)
                      if (d) await p.onSettings({ outputDir: d })
                    }}
                  >
                    alterar
                  </button>
                </p>
                <button className="primary wide" onClick={exportChecked} disabled={toExport.length === 0 || !!firstProblem}>
                  Exportar {toExport.length || ''} corte{toExport.length === 1 ? '' : 's'} (Ctrl+E)
                </button>
                <div className="row">
                  <button className="small" onClick={() => p.onSettings({ exportDefaults: options })} title="Usar estas opções ao abrir outros vídeos">
                    Salvar como padrão
                  </button>
                  <button className="small" onClick={() => exportEdit('fcpxml')} disabled={segments.length === 0} title="Sequência para Premiere Pro / DaVinci (FCP XML)">
                    Premiere (XML)
                  </button>
                  <button className="small" onClick={() => exportEdit('edl')} disabled={segments.length === 0} title="Lista de cortes EDL (DaVinci, Avid)">
                    EDL
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === 'sugestoes' && (
            <SuggestionsPanel
              hasAnalysis={!!analysis}
              analyzing={task?.kind === 'analise' ? task : null}
              suggestions={project.suggestions}
              options={p.settings.suggestion}
              scenes={scenes}
              onScenes={setScenes}
              onOptions={(o) => void p.onSettings({ suggestion: o })}
              onAnalyze={runAnalysis}
              onCancel={() => task && void api().cancelTask(task.id)}
              onSuggest={runSuggest}
              onApprove={(s) => void rate(s, true)}
              onReject={(s) => void rate(s, false)}
              onPreview={(s) => playRange(s.startSec, s.endSec)}
            />
          )}
          {tab === 'transcricao' && (
            <TranscriptPanel
              transcript={transcript}
              current={current}
              busy={task?.kind === 'transcricao' ? task : null}
              whisperReady={!p.tools?.whisper.error}
              aiEnabled={p.settings.aiEnabled}
              hasSelection={!!selected}
              onTranscribe={runTranscribe}
              onCancel={() => task && void api().cancelTask(task.id)}
              onImport={async () => {
                const res = await api().importSubtitles(project.id)
                if (!res.ok) return toast(res.error, 'erro')
                if (res.value) {
                  setProject((old) => (old ? { ...old, transcript: res.value } : old))
                  toast(`${res.value.cues.length} legendas importadas.`, 'ok')
                }
              }}
              onExport={async (f) => {
                const res = await api().exportSubtitles(project.id, f)
                if (!res.ok) toast(res.error, 'erro')
                else if (res.value) toast('Legenda salva.', 'ok', { label: 'Mostrar', run: () => void api().showInFolder(res.value!) })
              }}
              onTranslate={async (lang) => {
                toast('Traduzindo com IA…', 'info')
                const res = await api().aiTranslate(project.id, lang)
                if (!res.ok) return toast(res.error, 'erro')
                setProject((old) => (old ? { ...old, transcript: res.value } : old))
                toast('Legendas traduzidas.', 'ok')
              }}
              onSeek={seek}
              onEditCue={editCue}
              onCreateSegment={(cues) => {
                const s = Math.min(...cues.map((c) => c.startSec))
                const e = Math.max(...cues.map((c) => c.endSec))
                addSegment(Math.max(0, s - 0.15), Math.min(duration, e + 0.25), { name: cues[0].text.slice(0, 40), origin: 'transcript' })
              }}
              onOpenSettings={() => p.onOpenSettings('transcricao')}
            />
          )}
          {tab === 'redes' && (
            <div className="social">
              {!selected ? (
                <p className="muted">Selecione um trecho para gerar título, descrição e hashtags.</p>
              ) : !selectedText ? (
                <p className="muted">O trecho não tem transcrição. Transcreva ou importe legendas primeiro.</p>
              ) : (
                <>
                  <h3>Sugestão local (grátis, sem internet)</h3>
                  <CopyBox label="Título" text={localTitle(selectedText)} />
                  <CopyBox label="Descrição" text={localDescription(selectedText)} />
                  <CopyBox label="Hashtags" text={hashtags(selectedText).join(' ')} />
                  <h3>Com IA (Claude)</h3>
                  {!p.settings.aiEnabled ? (
                    <p className="muted small">
                      Desligado. A IA é opcional e paga (usa a sua chave da Anthropic).{' '}
                      <button className="link" onClick={() => p.onOpenSettings('ia')}>
                        Ativar em Configurações
                      </button>
                    </p>
                  ) : (
                    <>
                      <button
                        disabled={socialBusy}
                        onClick={async () => {
                          setSocialBusy(true)
                          const res = await api().aiSocial(project.id, selected.id, PRESETS.find((x) => x.id === presetId)?.name ?? 'TikTok')
                          setSocialBusy(false)
                          if (!res.ok) return toast(res.error, 'erro')
                          setSocial(res.value)
                        }}
                      >
                        {socialBusy ? 'Gerando…' : 'Gerar com IA'}
                      </button>
                      {social && (
                        <>
                          <CopyBox label="Título" text={social.title} />
                          <CopyBox label="Descrição" text={social.description} />
                          <CopyBox label="Hashtags" text={social.hashtags.join(' ')} />
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {tab === 'info' && (
            <div className="info">
              <dl className="meta">
                {(
                  [
                    ['Arquivo', project.path],
                    ['Duração', formatTimecode(duration, true)],
                    ['Formato', meta.formatName],
                    ['Vídeo', meta.video ? `${meta.video.codec} · ${meta.video.width}×${meta.video.height} · ${meta.video.fps ?? '?'} fps` : '—'],
                    ...meta.audioTracks.map((t) => [`Áudio ${t.index + 1}`, `${t.codec} · ${t.channels ?? '?'} canais${t.title ? ` · ${t.title}` : ''}${t.language ? ` · ${t.language}` : ''}`]),
                    ['Bitrate', meta.bitRate ? `${Math.round(meta.bitRate / 1000)} kb/s` : '—'],
                    ['Origem', project.origin === 'obs' ? 'OBS' : project.origin === 'pasta' ? 'Pasta monitorada' : 'Importado'],
                    ['Análise', analysis ? `${analysis.silences.length} pausas · ${analysis.scenes.length} cenas` : 'não feita']
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd title={v}>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="row">
                <button className="small" onClick={() => api().showInFolder(project.path)}>
                  Mostrar arquivo
                </button>
              </div>
              <h3>Marcadores ({project.markers.length})</h3>
              {project.markers.length === 0 && <p className="muted small">Pressione M, ou use o atalho global durante a gravação no OBS.</p>}
              <ul className="markers">
                {project.markers.map((m) => (
                  <li key={m.id} className="row">
                    <button className="link mono" onClick={() => seek(m.timeSec)}>
                      {formatTimecode(m.timeSec)}
                    </button>
                    <input value={m.label} aria-label="Nome do marcador" onChange={(e) => persist({ markers: project.markers.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) })} />
                    <span className="badge">{m.source === 'obs' ? 'OBS' : 'manual'}</span>
                    <button className="small" onClick={() => addSegment(Math.max(0, m.timeSec - 20), Math.min(duration, m.timeSec + 10), { name: m.label, origin: 'marker' })} title="Cria trecho de 20s antes a 10s depois">
                      Trecho
                    </button>
                    <button className="ghost small" aria-label="Apagar marcador" onClick={() => persist({ markers: project.markers.filter((x) => x.id !== m.id) })}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </main>
  )
}

function CopyBox({ label, text }: { label: string; text: string }) {
  const toast = useToast()
  return (
    <div className="copybox">
      <div className="row between">
        <span className="muted small">{label}</span>
        <button
          className="link small"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            toast('Copiado.', 'ok')
          }}
        >
          Copiar
        </button>
      </div>
      <p>{text}</p>
    </div>
  )
}
