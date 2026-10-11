import { EventEmitter } from 'node:events'
import type { UpdateStatus } from '../shared/types'

/** O que usamos do autoUpdater do electron-updater (permite testar com um falso). */
export interface UpdaterLike extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateControllerOptions {
  currentVersion: string
  /** false em modo desenvolvimento (app não empacotado). */
  enabled: boolean
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void
}

/** Mensagens de erro do electron-updater em português, sem detalhes técnicos demais. */
export function friendlyUpdateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/404|latest\.yml|No published versions|Cannot find channel/i.test(msg)) return 'Nenhuma versão publicada ainda no GitHub.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::|EAI_AGAIN|socket hang up/i.test(msg)) return 'Sem conexão com a internet para verificar atualizações.'
  if (/sha512 checksum mismatch|checksum/i.test(msg)) return 'O arquivo baixado veio corrompido; tento de novo na próxima verificação.'
  if (/rate limit|403/i.test(msg)) return 'O GitHub limitou as consultas; tento de novo mais tarde.'
  return `Falha ao atualizar: ${msg.split('\n')[0].slice(0, 200)}`
}

/**
 * Controla o ciclo de atualização: verificar → baixar em segundo plano → pronta.
 * Emite 'status' (UpdateStatus) a cada mudança e 'ready' quando a atualização baixou.
 * Instalar é decisão de quem usa (index.ts reinicia se não houver cortes em andamento;
 * senão instala ao fechar o app, via autoInstallOnAppQuit).
 */
export class UpdateController extends EventEmitter {
  status: UpdateStatus
  private checking = false

  constructor(
    private readonly updater: UpdaterLike,
    private readonly opts: UpdateControllerOptions
  ) {
    super()
    this.status = {
      state: opts.enabled ? 'parado' : 'desativado',
      currentVersion: opts.currentVersion,
      newVersion: null,
      percent: 0,
      error: opts.enabled ? null : 'Atualização automática só funciona no app instalado.',
      checkedAt: null
    }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => this.set({ state: 'verificando', error: null }))
    updater.on('update-available', (info: { version?: string }) => {
      this.opts.log?.('info', 'Atualização encontrada', { version: info?.version })
      this.set({ state: 'baixando', newVersion: info?.version ?? null, percent: 0 })
    })
    updater.on('update-not-available', () => this.set({ state: 'atualizado', newVersion: null, checkedAt: Date.now() }))
    updater.on('download-progress', (p: { percent?: number }) => this.set({ state: 'baixando', percent: Math.round(p?.percent ?? 0) }))
    updater.on('update-downloaded', (info: { version?: string }) => {
      this.opts.log?.('info', 'Atualização baixada', { version: info?.version })
      this.set({ state: 'pronta', newVersion: info?.version ?? this.status.newVersion, percent: 100, checkedAt: Date.now() })
      this.emit('ready', this.status)
    })
    updater.on('error', (err: unknown) => {
      this.opts.log?.('warn', 'Erro na atualização', err)
      this.set({ state: 'erro', error: friendlyUpdateError(err), checkedAt: Date.now() })
    })
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  async check(): Promise<UpdateStatus> {
    if (!this.opts.enabled) return this.status
    // Já baixou ou está baixando: não começa outra verificação.
    if (this.checking || this.status.state === 'baixando' || this.status.state === 'pronta') return this.status
    this.checking = true
    try {
      this.set({ state: 'verificando', error: null })
      await this.updater.checkForUpdates()
    } catch (err) {
      this.set({ state: 'erro', error: friendlyUpdateError(err), checkedAt: Date.now() })
    } finally {
      this.checking = false
    }
    return this.status
  }

  /** Fecha o app, instala em silêncio e abre de novo. */
  install(): boolean {
    if (this.status.state !== 'pronta') return false
    this.opts.log?.('info', 'Reiniciando para instalar atualização', { version: this.status.newVersion })
    this.updater.quitAndInstall(true, true)
    return true
  }
}
