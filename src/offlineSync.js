import { db } from './db'
import { mensagemDeErro } from './erros'

let sincronizacaoAtiva

const STATUS_SEM_RETENTATIVA = new Set([400, 403, 404, 409, 422])

async function limparFilaObsoleta() {
  const pendentes = await db.filaApi.toArray()
  const obsoletas = new Set()

  for (const item of pendentes) {
    if (!item.bloqueada) continue

    if (item.method === 'DELETE') {
      if (item.ultimoStatus === 404 || /n[ãa]o encontrado|n[ãa]o autorizado/i.test(item.ultimoErro ?? '')) {
        obsoletas.add(item.seq)
      }
      continue
    }

    const chave = item.chave ?? ''
    if (chave.startsWith('formulario-conta:')) {
      const id = chave.split(':')[1]
      if (!id || !(await db.formularios.get(id))) obsoletas.add(item.seq)
    } else if (chave.startsWith('formulario-publico:')) {
      const codigo = chave.split(':')[1]
      if (!codigo || !(await db.formularios.where('codigo').equals(codigo).first())) obsoletas.add(item.seq)
    } else if (chave.startsWith('resposta-conta:') || chave.startsWith('resposta-publica:')) {
      const id = chave.split(':')[1]
      if (!id || !(await db.respostas.get(id))) obsoletas.add(item.seq)
    }
  }

  if (obsoletas.size) await db.filaApi.bulkDelete([...obsoletas])
}

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

export async function reenfileirarFilaApi(contaId) {
  await limparFilaObsoleta()
  const pendentes = await db.filaApi.toArray()
  const bloqueadas = pendentes.filter((item) =>
    item.bloqueada && (!item.contaId || item.contaId === contaId),
  )
  await db.filaApi.bulkUpdate(
    bloqueadas.map((item) => ({ key: item.seq, changes: { bloqueada: false, tentativas: 0, ultimoErro: undefined } })),
  )
}

export async function descartarFilaBloqueada(contaId) {
  const pendentes = await db.filaApi.toArray()
  const bloqueadas = pendentes
    .filter((item) => item.bloqueada && (!item.contaId || item.contaId === contaId))
    .map((item) => item.seq)
  await db.filaApi.bulkDelete(bloqueadas)
}

export function sincronizarFilaApi(contaId) {
  if (sincronizacaoAtiva) return sincronizacaoAtiva

  sincronizacaoAtiva = (async () => {
    await limparFilaObsoleta()
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
          // Excluir algo que já não existe no servidor é o resultado esperado.
          if (requisicao.method === 'DELETE' && response.status === 404) {
            await db.filaApi.delete(requisicao.seq)
            sincronizadas += 1
            continue
          }
          const resultado = await response.json().catch(() => ({}))
          const erro = new Error(mensagemDeErro({
            status: response.status,
            message: resultado.erro,
          }))
          erro.status = response.status
          throw erro
        }
        await db.filaApi.delete(requisicao.seq)
        sincronizadas += 1
      } catch (error) {
        await db.filaApi.update(requisicao.seq, {
          tentativas: (requisicao.tentativas ?? 0) + 1,
          ultimoErro: mensagemDeErro(error),
          ultimoStatus: error.status ?? null,
          bloqueada: STATUS_SEM_RETENTATIVA.has(error.status),
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
