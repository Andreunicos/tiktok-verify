import { formatTimecode } from '@shared/time'
import type { Job } from '../useJobs'

interface Props {
  jobs: Job[]
  outputDir: string
  onClear: () => void
}

export function JobList({ jobs, outputDir, onClear }: Props) {
  return (
    <section className="card jobs">
      <div className="card-header">
        <h2>Cortes desta sessão</h2>
        <div className="row">
          <button className="ghost" onClick={() => window.bigloop.openFolder(outputDir)}>
            Abrir pasta de saída
          </button>
          <button className="ghost" onClick={onClear} disabled={!jobs.some((j) => j.status !== 'processando')}>
            Limpar finalizados
          </button>
        </div>
      </div>
      {jobs.length === 0 && <p className="muted">Nenhum corte gerado ainda.</p>}
      <ul>
        {jobs.map((job) => (
          <li key={job.id} className={`job ${job.status}`}>
            <div className="job-line">
              <span className={`badge ${job.status}`}>{job.status}</span>
              <span className="job-range">
                {formatTimecode(job.request.startSec)} → {formatTimecode(job.request.endSec)} ·{' '}
                {job.request.mode === 'precise' ? 'preciso' : 'rápido'}
              </span>
              <span className="job-actions">
                {job.status === 'processando' && (
                  <button className="ghost" onClick={() => window.bigloop.cancelCut(job.id)}>
                    Cancelar
                  </button>
                )}
                {job.outputPath && (
                  <button className="ghost" onClick={() => window.bigloop.showInFolder(job.outputPath!)}>
                    Mostrar na pasta
                  </button>
                )}
              </span>
            </div>
            {job.status === 'processando' && (
              <progress max={1} value={job.ratio} aria-label="Progresso do corte" />
            )}
            {job.outputPath && (
              <div className="muted small" title={job.outputPath}>
                {job.outputPath}
                {job.elapsedMs !== undefined && ` · ${(job.elapsedMs / 1000).toFixed(1)}s`}
              </div>
            )}
            {job.error && <div className="error small">{job.error}</div>}
          </li>
        ))}
      </ul>
    </section>
  )
}
