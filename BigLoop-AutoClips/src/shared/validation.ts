export const MIN_CUT_SECONDS = 0.1

/** Valida um intervalo de corte. Retorna mensagem de erro em português ou null. */
export function validateCutRange(startSec: number, endSec: number, durationSec: number): string | null {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 'Início e fim precisam ser tempos válidos.'
  if (startSec < 0) return 'O início não pode ser negativo.'
  if (endSec <= startSec) return 'O fim precisa ser maior que o início.'
  if (endSec - startSec < MIN_CUT_SECONDS) return `O corte precisa ter pelo menos ${MIN_CUT_SECONDS}s.`
  if (durationSec > 0 && startSec >= durationSec) return 'O início está depois do fim do vídeo.'
  if (durationSec > 0 && endSec > durationSec + 0.05) return 'O fim está depois do fim do vídeo.'
  return null
}
