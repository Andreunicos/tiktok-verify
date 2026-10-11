export interface Shortcut {
  keys: string
  action: string
}

export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Reprodução',
    items: [
      { keys: 'Espaço', action: 'Tocar / pausar' },
      { keys: '← / →', action: 'Voltar / avançar 1 quadro' },
      { keys: 'Shift + ← / →', action: 'Voltar / avançar 1 segundo' },
      { keys: 'J / L', action: 'Voltar / avançar 5 segundos' },
      { keys: 'P', action: 'Prévia do trecho selecionado' }
    ]
  },
  {
    group: 'Trechos',
    items: [
      { keys: 'I', action: 'Marcar início (cria um trecho se não houver)' },
      { keys: 'O', action: 'Marcar fim' },
      { keys: 'N', action: 'Novo trecho na posição atual' },
      { keys: 'M', action: 'Adicionar marcador' },
      { keys: 'Delete', action: 'Apagar trecho selecionado' },
      { keys: 'Ctrl + Z / Ctrl + Shift + Z', action: 'Desfazer / refazer' },
      { keys: 'Ctrl + E', action: 'Exportar trechos marcados' }
    ]
  },
  {
    group: 'Linha do tempo',
    items: [
      { keys: '+ / −', action: 'Zoom' },
      { keys: 'Ctrl + roda do mouse', action: 'Zoom no ponto do mouse' },
      { keys: 'Arrastar as alças', action: 'Ajustar início/fim do trecho' }
    ]
  },
  { group: 'Geral', items: [{ keys: '?', action: 'Mostrar esta lista' }, { keys: 'Ctrl + O', action: 'Importar vídeo' }] }
]

/** True se o foco está num campo de texto (atalhos de letra não devem disparar). */
export const typingTarget = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
