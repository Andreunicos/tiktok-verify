import { sanitizeFileName } from './ffmpeg'
import { timecodeForFileName } from './time'

export interface NameVars {
  nome: string
  trecho?: string
  inicio: number
  fim: number
  duracao: number
  n?: number
  preset?: string
  formato: string
  data?: Date
}

const pad = (v: number, w = 2) => String(v).padStart(w, '0')

export const NAME_TOKENS = ['{nome}', '{trecho}', '{inicio}', '{fim}', '{duracao}', '{n}', '{preset}', '{formato}', '{data}', '{hora}']

/** Preenche um modelo de nome como "{nome}_{trecho}_{inicio}". Tokens desconhecidos são mantidos. */
export function renderName(template: string, vars: NameVars): string {
  const d = vars.data ?? new Date()
  const values: Record<string, string> = {
    nome: vars.nome,
    trecho: vars.trecho ?? '',
    inicio: timecodeForFileName(vars.inicio),
    fim: timecodeForFileName(vars.fim),
    duracao: `${Math.round(vars.duracao)}s`,
    n: vars.n !== undefined ? pad(vars.n, 3) : '',
    preset: vars.preset ?? '',
    formato: vars.formato,
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`
  }
  const filled = (template.trim() || '{nome}_corte_{inicio}-{fim}').replace(/\{(\w+)\}/g, (m, key: string) =>
    key in values ? values[key] : m
  )
  // Remove separadores sobrando quando um token ficou vazio.
  const tidy = filled.replace(/([_\- ])[_\- ]+/g, '$1').replace(/^[_\- ]+|[_\- ]+$/g, '')
  return sanitizeFileName(tidy || vars.nome)
}
