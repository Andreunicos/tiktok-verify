/** Remove dados pessoais de um texto de diagnóstico (pasta do usuário, nome, chaves). */
export function redact(text: string, home: string, username: string): string {
  let out = text
  if (home) {
    const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])
    for (const v of variants) out = out.split(v).join('~')
  }
  if (username && username.length > 2) out = out.replace(new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<usuario>')
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-<removido>')
    .replace(/("?(password|senha|apiKey|aiKeyEnc|obsPasswordEnc)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<removido>"')
}
