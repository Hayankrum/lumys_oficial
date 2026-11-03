import { db } from './db'
import { sincronizar } from './sync'

export async function adicionarTarefa(titulo) {
  const agora = Date.now()
  const registro = {
    id: crypto.randomUUID(),
    titulo,
    concluida: false,
    criadaEm: agora,
    atualizadaEm: agora,
  }
  await db.transaction('rw', db.tarefas, db.outbox, async () => {
    await db.tarefas.add(registro)
    await db.outbox.add({ operacao: 'upsert', registroId: registro.id })
  })
  sincronizar()
}

export async function alternarTarefa(tarefa) {
  await db.transaction('rw', db.tarefas, db.outbox, async () => {
    await db.tarefas.update(tarefa.id, {
      concluida: !tarefa.concluida,
      atualizadaEm: Date.now(),
    })
    await db.outbox.add({ operacao: 'upsert', registroId: tarefa.id })
  })
  sincronizar()
}

export async function removerTarefa(id) {
  await db.transaction('rw', db.tarefas, db.outbox, async () => {
    await db.tarefas.delete(id)
    await db.outbox.add({ operacao: 'delete', registroId: id })
  })
  sincronizar()
}