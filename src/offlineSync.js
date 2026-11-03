import { db } from './db'

let sincronizacaoAtiva

export async function enfileirarRequisicao({ url, method, headers = {}, body, contaId = null, chave }) {
  await db.transaction('rw', db.filaApi, async () => {
    const existente = chave ? await db.filaApi.where('chave').equals(chave).first() : null
    const requisicao = {
      url,
      method,
      headers,
      body,
      contaId,
      chave,
      criadoEm: Date.now(),
      tentativas: existente?.tentativas ?? 0,
    }

    if (existente) {
      await db.filaApi.put({ ...requisicao, seq: existente.seq })
    } else {
      await db.filaApi.add(requisicao)
    }
  })
}

export function sincronizarFilaApi(contaId) {
  if (sincronizacaoAtiva) return sincronizacaoAtiva

  sincronizacaoAtiva = (async () => {
    const pendentes = await db.filaApi.orderBy('seq').toArray()
    let sincronizadas = 0

    for (const requisicao of pendentes) {
      if (!navigator.onLine) break
      if (requisicao.contaId && requisicao.contaId !== contaId) continue
      if (requisicao.bloqueada) continue

      try {
        const response = await fetch(requisicao.url, {
          method: requisicao.method,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...requisicao.headers },
          ...(requisicao.body === undefined ? {} : { body: requisicao.body }),
        })
        if (!response.ok) {
          const resultado = await response.json().catch(() => ({}))
          const erro = new Error(resultado.erro || `Falha HTTP ${response.status}`)
          erro.status = response.status
          throw erro
        }
        await db.filaApi.delete(requisicao.seq)
        sincronizadas += 1
      } catch (error) {
        await db.filaApi.update(requisicao.seq, {
          tentativas: (requisicao.tentativas ?? 0) + 1,
          ultimoErro: error.message,
          bloqueada: error.status >= 400 && error.status < 500 && error.status !== 401,
        })
        if (!navigator.onLine) break
      }
    }

    return sincronizadas
  })().finally(() => {
    sincronizacaoAtiva = null
  })

  return sincronizacaoAtiva
}
