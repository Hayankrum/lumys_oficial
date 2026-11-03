import { db } from '../src/db'

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const headers = { 'Content-Type': 'application/json' }
let rodando = false

export async function sincronizar() {
  if (rodando || !navigator.onLine) return
  rodando = true
  try {
    const sessao = await fetch(`${API}/api/auth/sessao`, { headers, credentials: 'same-origin' })
    if (!sessao.ok) return
    await push()
    await pull()
  } catch (e) {
    console.warn('Sync falhou, tentará de novo:', e.message)
  } finally {
    rodando = false
  }
}

async function push() {
  const pendentes = await db.outbox.orderBy('seq').toArray()
  if (!pendentes.length) return

  const operacoes = await Promise.all(
    pendentes.map(async (op) => ({
      operacao: op.operacao,
      id: op.registroId,
      dados: op.operacao === 'upsert' ? await db.tarefas.get(op.registroId) : null,
    }))
  )

  const res = await fetch(`${API}/sync/push`, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ operacoes }),
  })
  if (!res.ok) throw new Error('push falhou')

  // só limpa a fila depois do servidor confirmar
  await db.outbox.bulkDelete(pendentes.map((p) => p.seq))
}

async function pull() {
  const meta = await db.meta.get('ultimoSync')
  const desde = meta?.valor ?? 0

  const res = await fetch(`${API}/sync/pull?desde=${desde}`, { headers, credentials: 'same-origin' })
  if (!res.ok) throw new Error('pull falhou')
  const { registros, removidos, agora } = await res.json()

  await db.transaction('rw', db.tarefas, db.outbox, db.meta, async () => {
    // não sobrescreve o que ainda tem alteração local pendente
    const pendentes = new Set((await db.outbox.toArray()).map((o) => o.registroId))

    for (const r of registros) {
      if (pendentes.has(r.id)) continue
      const local = await db.tarefas.get(r.id)
      if (!local || r.atualizadaEm > local.atualizadaEm) {
        await db.tarefas.put(r)
      }
    }
    await db.tarefas.bulkDelete(removidos.filter((id) => !pendentes.has(id)))
    await db.meta.put({ chave: 'ultimoSync', valor: agora })
  })
}