import Dexie from 'dexie'

export const db = new Dexie('MeuBancoV2')

db.version(1).stores({
  tarefas: 'id, criadaEm, atualizadaEm',
  outbox: '++seq',
  meta: 'chave',
})

db.version(2).stores({
  tarefas: 'id, criadaEm, atualizadaEm',
  outbox: '++seq',
  meta: 'chave',
  formularios: 'id, atualizadoEm',
  respostas: 'id, formularioId, criadoEm',
})

db.version(3).stores({
  tarefas: 'id, criadaEm, atualizadaEm',
  outbox: '++seq',
  meta: 'chave',
  formularios: 'id, codigo, atualizadoEm',
  respostas: 'id, formularioId, criadoEm',
}).upgrade(async (transaction) => {
  await transaction.table('formularios').toCollection().modify((formulario) => {
    formulario.codigo ??= crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    formulario.tokenProprietario ??= crypto.randomUUID()
    formulario.publicada ??= false
  })
})

db.version(4).stores({
  tarefas: 'id, criadaEm, atualizadaEm',
  outbox: '++seq',
  meta: 'chave',
  formularios: 'id, codigo, contaId, atualizadoEm',
  respostas: 'id, formularioId, criadoEm',
})

db.version(5).stores({
  tarefas: 'id, criadaEm, atualizadaEm',
  outbox: '++seq',
  meta: 'chave',
  formularios: 'id, codigo, contaId, atualizadoEm',
  respostas: 'id, formularioId, criadoEm',
  filaApi: '++seq, chave, contaId',
})