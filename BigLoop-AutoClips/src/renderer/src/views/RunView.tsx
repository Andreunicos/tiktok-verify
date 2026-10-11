import { useEffect, useState } from 'react'
import { PostModal } from '../components/PostModal'
import { formatTimecode } from '@shared/time'
import type { AutoClip, AutoRun } from '@shared/types'
import { Modal, newId, Progress, useToast } from '../lib/ui'

interface Props {
  run: AutoRun
  onNew: () => void
  onRetry: (run: AutoRun) => void
  onAdjust: (projectId: string, segmentId: string) => void
  onEnableSubtitles: () => void
  onOpenAccounts: () => void
}

const PLATFORM = { tiktok: 'TikTok', reels: 'Reels', shorts: 'Shorts', youtube: 'YouTube' } as const
const ICON = { pendente: '○', rodando: '◌', ok: '✓', pulado: '–', erro: '✕' } as const
const clipText = (c: AutoClip) => [c.title, c.description, c.hashtags.join(' ')].filter(Boolean).join('\n\n')

export function RunView({ run, onNew, onRetry, onAdjust, onEnableSubtitles, onOpenAccounts }: Props) {
  const toast = useToast()
  const api = window.bigloop
  const [preview, setPreview] = useState<AutoClip | null>(null)
  const [posting, setPosting] = useState<AutoClip | null>(null)
  const [tiktokOn, setTiktokOn] = useState(false)
  useEffect(() => {
    void api.tiktokStatus().then((s) => setTiktokOn(s.connected))
  }, [])
  const toDrafts = async (c: AutoClip) => {
    const res = await api.tiktokSend({ file: c.outputPath!, mode: 'rascunho', runId: run.id, segmentId: c.segmentId }, newId())
    if (!res.ok) toast(res.error, 'erro')
    else toast('Enviado para os rascunhos do TikTok. Abra a Caixa de entrada no app do celular para postar.', 'ok')
  }
  const ready = run.clips.filter((c) => c.status === 'concluído')
  const overall =
    run.state === 'concluído'
      ? 1
      : run.steps.reduce((t, s) => t + (s.state === 'ok' || s.state === 'pulado' ? 1 : s.state === 'rodando' ? (s.ratio ?? 0) : 0), 0) / run.steps.length
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast('Copiado! Cole na legenda do post.', 'ok')
  }

  return (
    <div className="run">
      <header className="run-head">
        <div className="grow">
          <h1 title={run.path}>{run.fileName}</h1>
          <span className="muted small">
            {new Date(run.createdAt).toLocaleString('pt-BR')} · {run.clips.length || run.options.count} cortes · {PLATFORM[run.options.platform]}
          </span>
        </div>
        {run.state === 'rodando' && (
          <button onClick={() => api.autoCancel(run.id)} className="ghost">
            Cancelar
          </button>
        )}
      </header>

      {run.state === 'rodando' && (
        <section className="card run-progress">
          <div className="row between">
            <strong>Trabalhando nos seus cortes…</strong>
            <span className="mono muted">{Math.round(overall * 100)}%</span>
          </div>
          <Progress ratio={overall} label="Progresso geral" />
          <p className="muted small">Pode usar outras coisas no PC. Você recebe um aviso quando ficar pronto.</p>
        </section>
      )}

      {run.state === 'concluído' && (
        <section className="card success">
          <div className="big-emoji">🎬</div>
          <div className="grow">
            <h2 className="plain">{ready.length} {ready.length === 1 ? 'corte pronto' : 'cortes prontos'}!</h2>
            <p className="muted">Já estão no formato certo, com volume ajustado{run.options.subtitles && run.steps.find((s) => s.key === 'transcrever')?.state === 'ok' ? ' e legendas' : ''}. É só postar.</p>
          </div>
          <div className="success-actions">
            {run.outputDir && (
              <button className="primary" onClick={() => api.openFolder(run.outputDir!)}>
                📂 Abrir pasta dos cortes
              </button>
            )}
            <button onClick={() => copy(ready.map((c) => `${c.index}. ${clipText(c)}`).join('\n\n———\n\n'))}>Copiar todos os textos</button>
            {tiktokOn ? (
              <button
                onClick={async () => {
                  for (const c of ready.filter((x) => !(x.posts ?? []).some((p) => p.platform === 'tiktok' && p.status !== 'erro'))) await toDrafts(c)
                }}
              >
                📲 Todos para os rascunhos do TikTok
              </button>
            ) : (
              <button className="ghost" onClick={onOpenAccounts}>
                Conectar TikTok
              </button>
            )}
            <button className="ghost" onClick={onNew}>
              + Criar mais cortes
            </button>
          </div>
        </section>
      )}

      {(run.state === 'erro' || run.state === 'cancelado') && (
        <section className="card failure">
          <strong>{run.state === 'cancelado' ? 'Cancelado.' : 'Não deu para terminar.'}</strong>
          {run.error && <p>{run.error}</p>}
          <div className="row">
            <button className="primary" onClick={() => onRetry(run)}>
              Tentar de novo
            </button>
            <button className="ghost" onClick={onNew}>
              Escolher outro vídeo
            </button>
          </div>
        </section>
      )}

      {run.notes.length > 0 && (
        <section className="notes">
          {run.notes.map((n) => (
            <p key={n} className="note">
              ℹ {n}{' '}
              {/legenda/.test(n) && /instalad/.test(n) && (
                <button className="link" onClick={onEnableSubtitles}>
                  Ativar legendas
                </button>
              )}
            </p>
          ))}
        </section>
      )}

      <ol className="steps">
        {run.steps.map((s) => (
          <li key={s.key} className={`step ${s.state}`}>
            <span className={`step-icon ${s.state === 'rodando' ? 'spin' : ''}`} aria-hidden>
              {ICON[s.state]}
            </span>
            <div className="grow">
              <span>{s.label}</span>
              {s.detail && <span className="muted small"> · {s.detail}</span>}
              {s.state === 'rodando' && <Progress ratio={s.ratio ?? 0} label={s.label} />}
            </div>
          </li>
        ))}
      </ol>

      {run.clips.length > 0 && (
        <section>
          <h2>Seus cortes</h2>
          <ul className="clips">
            {run.clips.map((c) => (
              <li key={c.segmentId} className={`clip ${c.status}`}>
                <button className="clip-thumb" onClick={() => c.outputPath && setPreview(c)} disabled={!c.outputPath} aria-label={`Assistir ${c.title}`}>
                  {c.thumbnail ? <img src={api.mediaUrl(c.thumbnail)} alt="" /> : <span className="thumb-wait">{c.status === 'erro' ? '✕' : c.status === 'processando' ? `${Math.round(c.ratio * 100)}%` : '…'}</span>}
                  {c.outputPath && <span className="play">▶</span>}
                  <span className="clip-dur">{formatTimecode(c.durationSec).replace(/\.\d+$/, '')}</span>
                </button>
                {c.status === 'processando' && <Progress ratio={c.ratio} label="Progresso do corte" />}
                <div className="clip-body">
                  <strong className="clip-title" title={c.title}>
                    {c.index}. {c.title}
                  </strong>
                  {c.score > 0 && (
                    <span className="badge" title={c.reasons.join('\n')}>
                      nota {c.score}
                    </span>
                  )}
                  {c.description && <p className="small clip-desc">{c.description.split('\n')[0]}</p>}
                  <p className="muted small hashtags">{c.hashtags.join(' ')}</p>
                  {c.status === 'concluído' && (
                    <div className="row feedback" role="group" aria-label="O que achou deste corte?">
                      <span className="muted small">Gostou?</span>
                      {(['up', 'down'] as const).map((v) => (
                        <button
                          key={v}
                          className={`small ghost ${c.feedback === v ? 'on' : ''}`}
                          aria-pressed={c.feedback === v}
                          aria-label={v === 'up' ? 'Gostei' : 'Não gostei'}
                          onClick={async () => {
                            const res = await api.autoFeedback(run.id, c.segmentId, c.feedback === v ? null : v)
                            if (!res.ok) toast(res.error, 'erro')
                            else if (c.feedback !== v) toast(v === 'up' ? 'Anotado! Vou fazer mais cortes assim.' : 'Anotado! Vou evitar cortes assim.', 'ok')
                          }}
                        >
                          {v === 'up' ? '👍' : '👎'}
                        </button>
                      ))}
                    </div>
                  )}
                  {c.error && <p className="error small">{c.error}</p>}
                  {(c.posts ?? []).map((p) => (
                    <p key={p.at} className={`small post-status ${p.status}`}>
                      TikTok {p.mode === 'rascunho' ? 'rascunho' : 'post'}:{' '}
                      {p.status === 'enviando' ? `enviando ${Math.round((p.progress ?? 0) * 100)}%` : p.status === 'processando' ? 'processando no TikTok…' : p.status === 'enviado' ? '✓ nos rascunhos' : p.status === 'publicado' ? '✓ publicado' : `erro — ${p.error}`}
                    </p>
                  ))}
                  <div className="row wrap">
                    <button className="small" onClick={() => copy(clipText(c))}>
                      Copiar texto
                    </button>
                    {c.outputPath && (
                      <button className="small" onClick={() => api.showInFolder(c.outputPath!)}>
                        Mostrar
                      </button>
                    )}
                    {tiktokOn && c.outputPath && (
                      <>
                        <button className="small" onClick={() => toDrafts(c)} title="Vai para a Caixa de entrada do app TikTok">
                          📲 Rascunho
                        </button>
                        <button className="small primary" onClick={() => setPosting(c)}>
                          Postar
                        </button>
                      </>
                    )}
                    <button className="ghost small" onClick={() => onAdjust(run.projectId, c.segmentId)} title="Ajustar início e fim no editor avançado">
                      Ajustar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posting && <PostModal clip={posting} runId={run.id} onClose={() => setPosting(null)} />}
      {preview && (
        <Modal title={`${preview.index}. ${preview.title}`} onClose={() => setPreview(null)} wide>
          <div className="preview-wrap">
            <video className="preview-vertical" src={api.mediaUrl(preview.outputPath!)} controls autoPlay />
            <div className="preview-side">
              <h3>Texto para postar</h3>
              <p className="pre">{clipText(preview)}</p>
              <button className="primary" onClick={() => copy(clipText(preview))}>
                Copiar texto
              </button>
              <button onClick={() => api.showInFolder(preview.outputPath!)}>Mostrar na pasta</button>
              {preview.reasons.length > 0 && (
                <>
                  <h3>Por que esse trecho?</h3>
                  <ul className="reasons">
                    {preview.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
