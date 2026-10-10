import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ───────────── Avisos (toasts) ─────────────
type ToastKind = 'info' | 'ok' | 'erro'
interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: { label: string; run: () => void }
}
const ToastCtx = createContext<(text: string, kind?: ToastKind, action?: Toast['action']) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)
  const push = useCallback((text: string, kind: ToastKind = 'info', action?: Toast['action']) => {
    const id = next.current++
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'erro' ? 9000 : 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button className="link" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
            <button className="ghost icon" aria-label="Fechar aviso" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ───────────── Modal ─────────────
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ───────────── Pequenos componentes ─────────────
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small className="muted block">{hint}</small>}
      </span>
    </label>
  )
}

export function Progress({ ratio, label }: { ratio: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={label}>
      <div style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </div>
  )
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} title={text} aria-label={text}>
      ?
    </span>
  )
}

export const newId = () => crypto.randomUUID()
