import { describe, expect, it } from 'vitest'
import { defaultSettings, sanitizeSettings } from '../src/main/settings'

const d = defaultSettings({ outputDir: '/v' })

describe('sanitizeSettings', () => {
  it('ignora chaves desconhecidas e tipos errados', () => {
    expect(sanitizeSettings({ hack: 1, concurrency: '9', outputDir: '/x', obsPort: 4456 }, d)).toEqual({ outputDir: '/x', obsPort: 4456 })
  })
  it('mescla objetos aninhados com tipos', () => {
    const s = sanitizeSettings({ exportDefaults: { aspect: '9:16', speed: 'rápido', audioTrack: 'mix', maxSizeMB: 16, subtitleStyle: { fontSize: 80, font: 3 } } }, d)
    expect(s.exportDefaults).toMatchObject({ aspect: '9:16', speed: 1, audioTrack: 'mix', maxSizeMB: 16 })
    expect(s.exportDefaults!.subtitleStyle).toMatchObject({ fontSize: 80, font: 'Arial' })
  })
  it('pesos aprendidos', () => {
    expect(sanitizeSettings({ learnedWeights: { energy: 1 } }, d)).toEqual({ learnedWeights: { energy: 1 } })
    expect(sanitizeSettings({ learnedWeights: { energy: 'x' } }, d)).toEqual({})
  })
})

import { redact } from '../src/main/diagnostics'
describe('redact', () => {
  it('remove pasta do usuário, nome e segredos', () => {
    const t = 'C:\\Users\\Andre\\Videos\\a.mp4 C:/Users/Andre/x andre sk-ant-api03-abc "obsPasswordEnc":"zzz"'
    expect(redact(t, 'C:\\Users\\Andre', 'Andre')).toBe('~\\Videos\\a.mp4 ~/x <usuario> sk-ant-<removido> "obsPasswordEnc":"<removido>"')
  })
})
