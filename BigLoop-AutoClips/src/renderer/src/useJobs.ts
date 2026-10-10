import { useEffect, useState } from 'react'
import type { CutRequest } from '@shared/types'

export type JobStatus = 'processando' | 'concluído' | 'erro' | 'cancelado'

export interface Job {
  id: string
  request: CutRequest
  status: JobStatus
  ratio: number
  outputPath?: string
  error?: string
  elapsedMs?: number
}

/** Acompanha os cortes desta sessão a partir dos eventos do processo principal. */
export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    const offProgress = window.bigloop.onCutProgress((p) =>
      setJobs((list) => list.map((j) => (j.id === p.jobId && j.status === 'processando' ? { ...j, ratio: p.ratio } : j)))
    )
    const offDone = window.bigloop.onCutDone((r) =>
      setJobs((list) =>
        list.map((j) => {
          if (j.id !== r.jobId) return j
          if (r.ok) return { ...j, status: 'concluído', ratio: 1, outputPath: r.value.outputPath, elapsedMs: r.value.elapsedMs }
          const cancelled = r.error === 'Corte cancelado.'
          return { ...j, status: cancelled ? 'cancelado' : 'erro', error: cancelled ? undefined : r.error }
        })
      )
    )
    return () => {
      offProgress()
      offDone()
    }
  }, [])

  const add = (id: string, request: CutRequest) =>
    setJobs((list) => [{ id, request, status: 'processando', ratio: 0 }, ...list])
  const clearFinished = () => setJobs((list) => list.filter((j) => j.status === 'processando'))

  return { jobs, add, clearFinished }
}
