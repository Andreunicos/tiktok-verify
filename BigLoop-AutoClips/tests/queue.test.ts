import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JobQueue, type JobRunner } from '../src/main/queue'
import type { Job } from '../src/shared/types'
import { req } from './helpers'

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))

/** Runner controlável: cada job fica pendente até resolve/reject manual. */
function controllable() {
  const live = new Map<string, { resolve: () => void; reject: (e: Error) => void; report: (r: number, e: number | null) => void }>()
  const started: string[] = []
  const runner: JobRunner = async (job, report) => {
    started.push(job.request.segmentName ?? job.id)
    if (job.request.segmentName === 'invalido') throw new Error('Pedido inválido')
    let resolve!: () => void
    let reject!: (e: Error) => void
    const done = new Promise<{ outputPath: string; extraFiles: string[] }>((res, rej) => {
      resolve = () => res({ outputPath: `/out/${job.request.segmentName}.mp4`, extraFiles: [] })
      reject = rej
    })
    live.set(job.request.segmentName!, { resolve, reject, report })
    return { done, cancel: () => reject(new Error('Corte cancelado.')) }
  }
  return { runner, live, started }
}

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('JobQueue', () => {
  it('respeita concorrência, prioridade e ordem', async () => {
    const c = controllable()
    const q = new JobQueue(null, c.runner, { concurrency: 1 })
    q.add(req({ segmentName: 'a' }))
    q.add(req({ segmentName: 'b' }))
    q.add(req({ segmentName: 'c' }), 'alta')
    await tick()
    expect(c.started).toEqual(['a'])
    c.live.get('a')!.resolve()
    await tick()
    expect(c.started).toEqual(['a', 'c'])
    q.setConcurrency(2)
    await tick()
    expect(c.started).toEqual(['a', 'c', 'b'])
  })

  it('progresso, conclusão, erro e repetir', async () => {
    const c = controllable()
    const q = new JobQueue(null, c.runner)
    const finished: Job[] = []
    q.on('finished', (j) => finished.push(j))
    const job = q.add(req({ segmentName: 'x' }))
    await tick()
    c.live.get('x')!.report(0.5, 3)
    expect(q.state().jobs[0]).toMatchObject({ ratio: 0.5, etaSec: 3, status: 'processando' })
    c.live.get('x')!.reject(new Error('FFmpeg falhou'))
    await tick()
    expect(q.state().jobs[0]).toMatchObject({ status: 'erro', error: 'FFmpeg falhou' })
    q.retry(job.id)
    await tick()
    c.live.get('x')!.resolve()
    await tick()
    expect(q.state().jobs[0]).toMatchObject({ status: 'concluído', outputPath: '/out/x.mp4', attempts: 2 })
    expect(finished.map((j) => j.status)).toEqual(['erro', 'concluído'])
  })

  it('erro antes de começar vira status erro', async () => {
    const c = controllable()
    const q = new JobQueue(null, c.runner)
    q.add(req({ segmentName: 'invalido' }))
    await tick()
    expect(q.state().jobs[0]).toMatchObject({ status: 'erro', error: 'Pedido inválido' })
  })

  it('pausa, cancela, reordena e limpa', async () => {
    const c = controllable()
    const q = new JobQueue(null, c.runner)
    q.pause()
    const a = q.add(req({ segmentName: 'a' }))
    const b = q.add(req({ segmentName: 'b' }))
    await tick()
    expect(c.started).toEqual([])
    q.move(b.id, -1)
    expect(q.state().jobs.map((j) => j.request.segmentName)).toEqual(['b', 'a'])
    q.cancel(a.id)
    q.resume()
    await tick()
    expect(c.started).toEqual(['b'])
    q.cancel(b.id)
    await tick()
    expect(q.state().jobs.map((j) => j.status)).toEqual(['cancelado', 'cancelado'])
    q.clearFinished()
    expect(q.state().jobs).toHaveLength(0)
  })

  it('persiste e recupera jobs interrompidos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'q-'))
    dirs.push(dir)
    const file = join(dir, 'fila.json')
    const c = controllable()
    const q = new JobQueue(file, c.runner)
    q.add(req({ segmentName: 'a' }))
    q.add(req({ segmentName: 'b' }))
    await tick()
    q.flush()
    // "Fecha o app" com 'a' processando
    const c2 = controllable()
    const q2 = new JobQueue(file, c2.runner)
    expect(q2.state().jobs.map((j) => j.status)).toEqual(['aguardando', 'aguardando'])
    expect(q2.state().jobs[0].error).toMatch(/Interrompido/)
  })
})
