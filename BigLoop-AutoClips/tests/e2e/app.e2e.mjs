// Teste de ponta a ponta: abre o app Electron de verdade e percorre o fluxo principal.
// Uso: npm run test:e2e  (no Linux sem tela: xvfb-run -a npm run test:e2e)
import { _electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const APP = join(here, '..', '..')
const WORK = join(tmpdir(), `bigloop-e2e-${process.pid}`)
const SHOTS = process.env.E2E_SCREENSHOTS ?? join(WORK, 'telas')
const userData = join(WORK, 'dados')
const outDir = join(WORK, 'saida')
const watchDir = join(WORK, 'gravacoes')
rmSync(WORK, { recursive: true, force: true })
for (const d of [userData, outDir, watchDir, SHOTS]) mkdirSync(d, { recursive: true })

const ffmpeg = process.env.BIGLOOP_FFMPEG || 'ffmpeg'
const ffprobe = process.env.BIGLOOP_FFPROBE || 'ffprobe'
function makeVideo(path, seconds) {
  // som alternando com silêncio a cada 3 s + troca de cena no meio
  const r = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds / 2}`,
    '-f', 'lavfi', '-i', `smptebars=size=1280x720:rate=30:duration=${seconds / 2}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-filter_complex', `[0:v][1:v]concat=n=2:v=1[v];[2:a]volume='if(lt(mod(t\\,6)\\,3)\\,1\\,0)':eval=frame[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path
  ])
  if (r.status !== 0) throw new Error(r.stderr.toString())
}
const probe = (path) => JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path]).stdout.toString())

const video = join(WORK, 'minha live.mp4')
makeVideo(video, 60)
const srt = join(WORK, 'legendas.srt')
writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,800\nOlha só que jogada incrível!\n\n2\n00:00:06,200 --> 00:00:08,900\nVocês viram isso?\n')

// OBS simulado (obs-websocket v5, sem senha)
const obsServer = new WebSocketServer({ port: 0 })
const obsSockets = []
let recording = false
let recDuration = 0
obsServer.on('connection', (ws) => {
  obsSockets.push(ws)
  ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1 } }))
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.op === 1) ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
    if (m.op === 6) {
      const data = { GetVersion: { obsVersion: '31.0.0' }, GetRecordStatus: { outputActive: recording, outputDuration: recDuration }, GetRecordDirectory: { recordDirectory: watchDir } }[m.d.requestType] ?? {}
      ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, responseData: data } }))
    }
  })
})
const obsEvent = (eventType, eventData) => obsSockets.forEach((s) => s.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 64, eventData } })))
await new Promise((r) => obsServer.once('listening', r))

const step = (msg) => console.log(`• ${msg}`)
const app = await _electron.launch({ args: [APP, '--no-sandbox', `--user-data-dir=${userData}`], cwd: APP, env: { ...process.env, LANG: 'pt_BR.UTF-8' } })
const page = await app.firstWindow()
const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
await page.setViewportSize({ width: 1440, height: 900 })
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const mockOpen = (file) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }) }, file)
const toast = (re, timeout = 30000) => page.waitForSelector(`.toast >> text=${re}`, { timeout })

try {
  step('Início')
  await page.waitForSelector('text=Arraste um vídeo aqui')
  await page.evaluate(([o, w]) => window.bigloop.saveSettings({ outputDir: o, whisperPath: w[0], whisperModelPath: w[1] }), [outDir, [join(APP, 'tests/fixtures/fake-whisper.mjs'), srt]])
  await page.reload()
  await page.waitForSelector('text=Arraste um vídeo aqui')
  await shot('01-inicio')

  step('Importar vídeo')
  await mockOpen(video)
  await page.click('header >> text=Importar vídeo')
  await page.waitForSelector('.editor h1 >> text=minha live.mp4')
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 15000 })

  step('Analisar e sugerir')
  await page.click('.tabs >> text=Sugestões')
  await page.locator('.suggestions .three input').nth(0).fill('8')
  await page.locator('.suggestions .three input').nth(1).fill('20')
  await page.click('text=Analisar vídeo')
  await toast('Análise pronta')
  await page.waitForSelector('li.sugg')
  const nSugg = await page.locator('li.sugg').count()
  assert.ok(nSugg > 0, 'deveria haver sugestões')
  await page.locator('li.sugg').first().getByRole('button', { name: /Aprovar e criar trecho/ }).click()
  await page.waitForSelector('.segment')
  await shot('02-sugestoes')

  step('Transcrever (whisper simulado) e legendas')
  await page.click('.tabs >> text=Transcrição')
  await page.click('text=Transcrever (local)')
  await toast('Transcrição pronta')
  assert.ok((await page.locator('.cues li').count()) >= 2)
  await page.fill('input[aria-label="Buscar na transcrição"]', 'jogar')
  assert.equal(await page.locator('.cues li').count(), 1)
  await page.fill('input[aria-label="Buscar na transcrição"]', '')
  await shot('03-transcricao')

  step('Criar trecho manual com teclado (I/O) e unir pedaços')
  await page.click('.player')
  await page.evaluate(() => { document.querySelector('video').currentTime = 1 })
  await page.keyboard.press('Escape')
  await page.locator('body').click({ position: { x: 5, y: 880 } })
  await page.keyboard.press('n')
  await page.waitForFunction(() => document.querySelectorAll('.segment').length === 2)

  step('Exportar com preset TikTok (9:16, legendas gravadas)')
  await page.click('.tabs >> text=Exportar')
  await page.locator('.export-panel select').first().selectOption('tiktok')
  await page.click('text=Gerar capa (JPG) junto')
  await shot('04-exportar')
  await page.click('button.primary.wide')
  await toast('na fila')
  await page.click('nav >> text=Fila')
  await page.waitForFunction(() => document.querySelectorAll('.gallery-item').length === 2, null, { timeout: 120000 })
  await shot('05-fila')
  const outputs = readdirSync(outDir).filter((f) => f.endsWith('.mp4'))
  assert.equal(outputs.length, 2, `2 MP4 esperados, achei ${outputs}`)
  for (const f of outputs) {
    const info = probe(join(outDir, f))
    const v = info.streams.find((s) => s.codec_type === 'video')
    assert.equal(`${v.width}x${v.height}`, '1080x1920')
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'))
  }
  assert.ok(readdirSync(outDir).some((f) => f.endsWith('.jpg')), 'capa JPG')

  step('Exportar para Premiere (XML) e EDL')
  await page.click('nav >> text=Editor')
  await page.click('text=Premiere (XML)')
  await toast('XML criado')
  await page.click('text=EDL')
  await toast('EDL criada')
  const interDir = join(outDir, 'Premiere e DaVinci')
  assert.ok(readdirSync(interDir).some((f) => f.endsWith('.xml')))
  assert.ok(readdirSync(interDir).some((f) => f.endsWith('.edl')))

  step('Desfazer apaga e restaura trecho')
  const before = await page.locator('.segment').count()
  await page.locator('.segment').first().click()
  await page.click('.segment.selected >> text=Apagar')
  await page.waitForFunction((n) => document.querySelectorAll('.segment').length === n - 1, before)
  await page.locator('body').click({ position: { x: 5, y: 880 } })
  await page.keyboard.press('Control+z')
  await page.waitForFunction((n) => document.querySelectorAll('.segment').length === n, before)

  step('OBS simulado: conectar, marcar e importar gravação ao parar')
  await page.evaluate((port) => window.bigloop.saveSettings({ obsEnabled: true, obsPort: port, watchEnabled: false }), obsServer.address().port)
  const waitObs = async () => {
    for (let i = 0; i < 50; i++) {
      if ((await page.evaluate(() => window.bigloop.obsStatus())).state === 'conectado') return
      await page.waitForTimeout(200)
    }
    throw new Error('OBS não conectou')
  }
  await waitObs()
  recording = true
  obsEvent('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' })
  recDuration = 12_000
  const marker = await page.evaluate(() => window.bigloop.obsMarker())
  assert.ok(marker.ok, JSON.stringify(marker))
  const obsFile = join(watchDir, 'live-obs.mp4')
  makeVideo(obsFile, 20)
  recording = false
  obsEvent('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: obsFile })
  await toast('Nova gravação do OBS', 40000)
  const projects = await page.evaluate(() => window.bigloop.listProjects())
  const obsProj = projects.find((p) => p.fileName === 'live-obs.mp4')
  assert.ok(obsProj && obsProj.origin === 'obs')
  const full = await page.evaluate((id) => window.bigloop.getProject(id), obsProj.id)
  assert.equal(full.markers.length, 1)
  assert.ok(Math.abs(full.markers[0].timeSec - 11) < 0.01)

  step('Pasta monitorada importa arquivo novo')
  await page.evaluate((d) => window.bigloop.saveSettings({ obsEnabled: false, watchEnabled: true, watchDir: d, watchAutoAnalyze: true }), watchDir)
  await page.waitForTimeout(500)
  copyFileSync(video, join(watchDir, 'nova gravacao.mp4'))
  await toast('Nova gravação importada da pasta', 40000)
  await page.click('nav >> text=Início')
  await page.waitForSelector('.project >> text=nova gravacao.mp4')
  await shot('06-biblioteca')

  step('Configurações, troca de tema e Sobre')
  await page.click('nav >> text=Configurações')
  await page.waitForSelector('text=Placa de vídeo')
  await shot('07-configuracoes')
  await page.locator('.settings-view select').first().selectOption('dark')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.click('nav >> text=Início')
  await shot('08-tema-escuro')
  await page.click('nav >> text=Sobre')
  await page.waitForSelector('text=Privacidade')
  const diag = await page.evaluate(() => window.bigloop.diagnostics())
  assert.ok(diag.includes('BigLoop AutoClips') && !diag.includes(userData.split('/')[2] === 'root' ? '/root/' : '\u0000'))
  await page.keyboard.press('?')
  await page.waitForSelector('.modal >> text=Atalhos de teclado')
  await page.keyboard.press('Escape')

  assert.deepEqual(problems, [], 'erros no console do app')
  console.log(`\nE2E OK — telas em ${SHOTS}`)
} catch (err) {
  await shot('falha').catch(() => undefined)
  console.error('\nE2E FALHOU:', err)
  console.error(problems.join('\n'))
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  obsServer.close()
  if (!process.env.E2E_KEEP) rmSync(WORK, { recursive: true, force: true })
}
