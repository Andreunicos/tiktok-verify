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
  step('Tela inicial simples')
  await page.waitForSelector('text=Arraste seu vídeo aqui')
  await page.evaluate((o) => window.bigloop.saveSettings({ outputDir: o, auto: { platform: 'tiktok', count: 3, length: 'curto', subtitles: true, cleanSpeech: true, framing: 'blur' } }), outDir)
  await page.reload()
  await page.waitForSelector('text=Arraste seu vídeo aqui')
  await page.waitForSelector('text=Legendas automáticas') // cartão para ativar legendas (whisper ainda não configurado)
  await shot('01-inicio')

  step('2 cliques: escolher vídeo → Gerar cortes')
  await mockOpen(video)
  await page.click('.hero-drop') // clique 1
  await page.waitForSelector('.ready-card >> text=minha live.mp4')
  await shot('02-opcoes')
  await page.click('button.cta') // clique 2
  await page.waitForSelector('text=Trabalhando nos seus cortes')
  await shot('03-progresso')
  await page.waitForSelector('text=cortes prontos!', { timeout: 240000 })
  await shot('04-pronto')
  const folder = join(outDir, 'minha live')
  const mp4s = readdirSync(folder).filter((f) => f.endsWith('.mp4'))
  assert.equal(mp4s.length, 3, `3 cortes esperados, achei ${mp4s}`)
  for (const f of mp4s) {
    const info = probe(join(folder, f))
    const v = info.streams.find((x) => x.codec_type === 'video')
    assert.equal(`${v.width}x${v.height}`, '1080x1920')
    assert.ok(info.streams.some((x) => x.codec_type === 'audio'))
  }
  assert.ok(existsSync(join(folder, 'textos para postar.txt')))
  assert.equal(await page.locator('.clip').count(), 3)
  await page.locator('.clip-thumb').first().click()
  await page.waitForSelector('.modal video')
  await page.waitForFunction(() => document.querySelector('.modal video')?.readyState >= 2, null, { timeout: 15000 })
  await shot('05-assistir')
  await page.keyboard.press('Escape')

  step('Meus cortes (histórico)')
  await page.click('nav >> text=Meus cortes')
  await page.waitForSelector('.history-item >> text=minha live.mp4')
  await shot('06-meus-cortes')

  step('Com legendas automáticas (whisper simulado)')
  await page.evaluate((w) => window.bigloop.saveSettings({ whisperPath: w[0], whisperModelPath: w[1] }), [join(APP, 'tests/fixtures/fake-whisper.mjs'), srt])
  await page.reload()
  await page.waitForSelector('text=Arraste seu vídeo aqui')
  assert.equal(await page.locator('text=Legendas automáticas').count(), 0, 'cartão de legendas some depois de configurado')
  await mockOpen(video)
  await page.click('.hero-drop')
  await page.locator('.choices').nth(1).getByRole('button', { name: '3' }).click()
  await page.click('button.cta')
  await page.waitForSelector('text=cortes prontos!', { timeout: 240000 })
  const steps = await page.locator('.step').evaluateAll((els) => els.map((e) => e.className))
  assert.ok(steps[2].includes('ok'), `transcrição deveria estar ok: ${steps}`)

  step('Editor avançado: abrir, analisar, sugestão, transcrição, exportar, XML/EDL, desfazer')
  await page.click('nav >> text=Editor avançado')
  await page.waitForSelector('text=Vídeos abertos antes')
  await page.click('.project >> text=minha live.mp4')
  await page.waitForSelector('.editor h1 >> text=minha live.mp4')
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 15000 })
  await page.click('.tabs >> text=Sugestões')
  await page.waitForSelector('li.sugg')
  await page.locator('li.sugg').first().getByRole('button', { name: /Aprovar e criar trecho/ }).click()
  await page.click('.tabs >> text=Transcrição')
  assert.ok((await page.locator('.cues li').count()) >= 2)
  await page.click('.tabs >> text=Exportar')
  await page.click('text=Premiere (XML)')
  await toast('XML criado')
  await page.click('text=EDL')
  await toast('EDL criada')
  const interDir = join(outDir, 'Premiere e DaVinci')
  assert.ok(readdirSync(interDir).some((f) => f.endsWith('.xml')))
  assert.ok(readdirSync(interDir).some((f) => f.endsWith('.edl')))
  const before = await page.locator('.segment').count()
  await page.locator('.segment').first().click()
  await page.click('.segment.selected >> text=Apagar')
  await page.waitForFunction((n) => document.querySelectorAll('.segment').length === n - 1, before)
  await page.locator('body').click({ position: { x: 5, y: 880 } })
  await page.keyboard.press('Control+z')
  await page.waitForFunction((n) => document.querySelectorAll('.segment').length === n, before)
  await shot('07-editor')

  step('OBS simulado: ao parar de gravar, gera os cortes sozinho')
  await page.evaluate((port) => window.bigloop.saveSettings({ obsEnabled: true, obsPort: port, autoOnNewRecording: true }), obsServer.address().port)
  for (let i = 0; i < 50 && (await page.evaluate(() => window.bigloop.obsStatus())).state !== 'conectado'; i++) await page.waitForTimeout(200)
  assert.equal((await page.evaluate(() => window.bigloop.obsStatus())).state, 'conectado')
  recording = true
  obsEvent('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' })
  recDuration = 12_000
  assert.ok((await page.evaluate(() => window.bigloop.obsMarker())).ok)
  const obsFile = join(watchDir, 'live-obs.mp4')
  makeVideo(obsFile, 40)
  recording = false
  obsEvent('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: obsFile })
  await toast('Gerando cortes da gravação nova', 40000)
  for (let i = 0; i < 300; i++) {
    const runs = await page.evaluate(() => window.bigloop.autoList())
    const r = runs.find((x) => x.fileName === 'live-obs.mp4')
    if (r && r.state !== 'rodando') {
      assert.equal(r.state, 'concluído', JSON.stringify(r.error))
      break
    }
    await page.waitForTimeout(1000)
  }
  const obsRun = (await page.evaluate(() => window.bigloop.autoList())).find((x) => x.fileName === 'live-obs.mp4')
  assert.equal(obsRun.state, 'concluído')
  assert.equal(obsRun.origin, 'obs')
  const obsProj = (await page.evaluate(() => window.bigloop.listProjects())).find((p) => p.fileName === 'live-obs.mp4')
  const full = await page.evaluate((id) => window.bigloop.getProject(id), obsProj.id)
  assert.equal(full.markers.length, 1)

  step('Configurações, tema, sobre e atalhos')
  await page.evaluate(() => window.bigloop.saveSettings({ obsEnabled: false }))
  await page.click('button[aria-label="Configurações"]')
  await page.waitForSelector('text=Placa de vídeo')
  await shot('08-configuracoes')
  await page.locator('.settings-view select').first().selectOption('dark')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.click('nav >> text=Criar cortes')
  await page.click('.recent-item >> nth=0')
  await page.waitForSelector('text=cortes prontos!')
  await shot('09-tema-escuro')
  await page.click('button[aria-label="Configurações"]')
  await page.click('.settings-nav >> text=Sobre e atualizações')
  await page.waitForSelector('text=Privacidade')
  const diag = await page.evaluate(() => window.bigloop.diagnostics())
  assert.ok(diag.includes('BigLoop AutoClips'))
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
