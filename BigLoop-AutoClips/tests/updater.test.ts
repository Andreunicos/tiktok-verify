import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { friendlyUpdateError, UpdateController, type UpdaterLike } from '../src/main/updater'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  installs: [boolean?, boolean?][] = []
  checks = 0
  behavior: 'update' | 'none' | 'fail' = 'update'
  async checkForUpdates() {
    this.checks++
    this.emit('checking-for-update')
    if (this.behavior === 'fail') throw new Error('HttpError: 404 Cannot find latest.yml in the latest release artifacts')
    if (this.behavior === 'none') return this.emit('update-not-available', { version: '0.3.1' })
    this.emit('update-available', { version: '0.3.7' })
    this.emit('download-progress', { percent: 42.4 })
    this.emit('update-downloaded', { version: '0.3.7' })
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

describe('UpdateController', () => {
  it('verifica, baixa sozinho e fica pronta para instalar em silêncio', async () => {
    const u = new FakeUpdater()
    const c = new UpdateController(u, { currentVersion: '0.3.1', enabled: true })
    expect(u.autoDownload).toBe(true)
    expect(u.autoInstallOnAppQuit).toBe(true)
    const states: string[] = []
    let ready = 0
    c.on('status', (s) => states.push(`${s.state}:${s.percent}`))
    c.on('ready', () => ready++)
    const st = await c.check()
    expect(st).toMatchObject({ state: 'pronta', newVersion: '0.3.7', currentVersion: '0.3.1', percent: 100 })
    expect(states).toContain('baixando:42')
    expect(ready).toBe(1)
    // não verifica de novo depois de pronta
    await c.check()
    expect(u.checks).toBe(1)
    expect(c.install()).toBe(true)
    expect(u.installs).toEqual([[true, true]])
  })

  it('sem atualização: fica "atualizado" e não instala nada', async () => {
    const u = new FakeUpdater()
    u.behavior = 'none'
    const c = new UpdateController(u, { currentVersion: '0.3.1', enabled: true })
    expect((await c.check()).state).toBe('atualizado')
    expect(c.install()).toBe(false)
  })

  it('erro vira mensagem amigável e permite tentar de novo', async () => {
    const u = new FakeUpdater()
    u.behavior = 'fail'
    const c = new UpdateController(u, { currentVersion: '0.3.1', enabled: true })
    expect(await c.check()).toMatchObject({ state: 'erro', error: 'Nenhuma versão publicada ainda no GitHub.' })
    u.behavior = 'none'
    expect((await c.check()).state).toBe('atualizado')
  })

  it('desativado em modo desenvolvimento', async () => {
    const u = new FakeUpdater()
    const c = new UpdateController(u, { currentVersion: '0.3.0', enabled: false })
    expect((await c.check()).state).toBe('desativado')
    expect(u.checks).toBe(0)
  })

  it('mensagens amigáveis', () => {
    expect(friendlyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/internet/)
    expect(friendlyUpdateError(new Error('sha512 checksum mismatch'))).toMatch(/corrompido/)
    expect(friendlyUpdateError('qualquer')).toBe('Falha ao atualizar: qualquer')
  })
})
