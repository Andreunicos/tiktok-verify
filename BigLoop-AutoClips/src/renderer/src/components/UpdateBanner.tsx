import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { Progress } from '../lib/ui'

const COUNTDOWN = 10

/**
 * Faixa no topo: mostra o download da atualização e, quando pronta, reinicia sozinho
 * depois de alguns segundos (se não houver cortes rodando). "Depois" adia para quando o app fechar.
 */
export function UpdateBanner({ autoRestart, busy }: { autoRestart: boolean; busy: boolean }) {
  const [st, setSt] = useState<UpdateStatus | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const [postponed, setPostponed] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void window.bigloop.updateStatus().then(setSt)
    return window.bigloop.onUpdate(setSt)
  }, [])

  // Contagem regressiva para reiniciar
  useEffect(() => {
    const ready = st?.state === 'pronta' && autoRestart && !busy && !postponed
    if (!ready) {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
      setLeft(null)
      return
    }
    setLeft(COUNTDOWN)
    timer.current = setInterval(() => setLeft((n) => (n === null ? null : n - 1)), 1000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [st?.state, autoRestart, busy, postponed])

  useEffect(() => {
    if (left !== null && left <= 0) void window.bigloop.installUpdate()
  }, [left])

  if (!st) return null
  if (st.state === 'baixando')
    return (
      <div className="update-banner" role="status">
        <span>
          Baixando atualização {st.newVersion ? `v${st.newVersion}` : ''}… {st.percent}%
        </span>
        <Progress ratio={st.percent / 100} label="Download da atualização" />
      </div>
    )
  if (st.state === 'pronta')
    return (
      <div className="update-banner ready" role="status">
        <span>
          {postponed || busy || !autoRestart
            ? `Atualização v${st.newVersion} pronta. Será instalada quando você fechar o app${busy ? ' (há cortes em andamento)' : ''}.`
            : `Atualização v${st.newVersion} baixada. Reiniciando para atualizar em ${left ?? COUNTDOWN}s…`}
        </span>
        <button className="primary small" onClick={() => void window.bigloop.installUpdate()}>
          Reiniciar agora
        </button>
        {!postponed && !busy && autoRestart && (
          <button className="small" onClick={() => setPostponed(true)}>
            Depois
          </button>
        )}
      </div>
    )
  return null
}
