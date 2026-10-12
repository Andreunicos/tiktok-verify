import type { AppSettings } from '@shared/types'
import { Field, Toggle } from '../lib/ui'

interface Props {
  settings: AppSettings
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const POSITIONS: [AppSettings['brand']['logoPosition'], string][] = [
  ['tl', 'Em cima, à esquerda'],
  ['tr', 'Em cima, à direita'],
  ['bl', 'Embaixo, à esquerda'],
  ['br', 'Embaixo, à direita']
]

/** Kit da marca: o que vai em todos os cortes do modo automático. */
export function BrandSettings({ settings: s, onSettings }: Props) {
  const b = s.brand
  const set = (patch: Partial<AppSettings['brand']>) => onSettings({ brand: { ...b, ...patch } })
  return (
    <div className="brand-settings">
      <p className="muted small">Coloca a sua identidade em todos os cortes do modo automático: @ do canal no canto, logo, chamada no final e a cor da legenda.</p>
      <Toggle checked={b.enabled} onChange={(v) => set({ enabled: v })} label="Usar o kit da marca" />
      <Field label="@ do seu canal" hint="Aparece pequeno no canto de cima durante todo o corte.">
        <input value={b.handle} maxLength={40} onChange={(e) => set({ handle: e.target.value.trim() })} placeholder="@seucanal" />
      </Field>
      <Field label={`Logo / marca d'água ${b.logoPath ? '✓' : ''}`} hint={b.logoPath || 'PNG com fundo transparente fica melhor.'}>
        <div className="row">
          <button
            onClick={async () => {
              const path = await window.bigloop.pickFile('image')
              if (path) await set({ logoPath: path })
            }}
          >
            Escolher imagem
          </button>
          {b.logoPath && (
            <button className="ghost" onClick={() => set({ logoPath: '' })}>
              Tirar logo
            </button>
          )}
          <select value={b.logoPosition} onChange={(e) => set({ logoPosition: e.target.value as AppSettings['brand']['logoPosition'] })} aria-label="Posição da logo">
            {POSITIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Chamada no final" hint="Aparece nos últimos 2,5 segundos. Ex.: SEGUE PRA PARTE 2 • LINK NA BIO">
        <input value={b.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} placeholder="SEGUE PRA VER MAIS" />
      </Field>
      <Field label="Cor de destaque da legenda" hint="A palavra falada fica nessa cor.">
        <div className="row">
          <input type="color" value={b.color || '#FFD400'} onChange={(e) => set({ color: e.target.value })} aria-label="Cor de destaque" />
          {b.color && (
            <button className="ghost" onClick={() => set({ color: '' })}>
              Usar a cor do estilo
            </button>
          )}
        </div>
      </Field>
    </div>
  )
}
