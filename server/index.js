import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(serverDir, '.env') })

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
})
const app = express()
// A Vercel (e qualquer reverse proxy) preenche X-Forwarded-For. Sem isso o
// express-rate-limit trata todos os visitantes como o mesmo IP e bloqueia a
// API inteira depois de algumas tentativas (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
app.set('trust proxy', 1)
const distPath = resolve(serverDir, '../dist')
app.use(cors())
app.use(express.json())

let bancoPronto
function garantirBanco() {
  if (!process.env.DATABASE_URL) {
    return Promise.reject(new Error('DATABASE_URL não está configurada.'))
  }
  if (!bancoPronto) {
    bancoPronto = criarTabelas().catch((error) => {
      bancoPronto = undefined
      throw error
    })
  }
  return bancoPronto
}

app.use(['/api', '/sync'], async (_req, _res, next) => {
  try {
    await garantirBanco()
    next()
  } catch (error) {
    next(error)
  }
})

const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const codigoValido = (codigo) => /^[A-Z0-9]{8,16}$/.test(codigo)
const uuidValido = (id) => typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
const COOKIE_NAME = 'forms_session'
const SESSION_DAYS = 30

function lerCookie(req, nome) {
  const cookies = req.headers.cookie?.split(';') ?? []
  const cookie = cookies.find((item) => item.trim().startsWith(`${nome}=`))
  return cookie ? cookie.trim().slice(nome.length + 1) : ''
}

function definirCookieSessao(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`)
}

function limparCookieSessao(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
}

async function autenticar(req, res, next) {
  const token = lerCookie(req, COOKIE_NAME)
  if (!token) return res.status(401).json({ erro: 'Faça login para continuar.' })
  try {
    const { rows } = await pool.query(
      `select contas.id, contas.email from sessoes
       join contas on contas.id = sessoes.conta_id
       where sessoes.token_hash = $1 and sessoes.expira_em > now()`,
      [hashToken(token)]
    )
    if (!rows.length) {
      limparCookieSessao(res)
      return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' })
    }
    req.conta = rows[0]
    next()
  } catch (error) {
    next(error)
  }
}

const limitarAutenticacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
})
const limitarRespostaPublica = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { erro: 'Muitas respostas enviadas. Aguarde um momento e tente novamente.' },
})

async function criarSessao(contaId, res) {
  const token = randomBytes(32).toString('base64url')
  const expiraEm = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await pool.query(
    'insert into sessoes (token_hash, conta_id, expira_em) values ($1,$2,$3)',
    [hashToken(token), contaId, expiraEm]
  )
  definirCookieSessao(res, token)
}

app.post('/api/auth/cadastro', limitarAutenticacao, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ erro: 'Informe um endereço de e-mail válido.' })
  }
  if (Buffer.byteLength(senha, 'utf8') < 6 || Buffer.byteLength(senha, 'utf8') > 72) {
    return res.status(400).json({ erro: 'A senha deve ter entre 6 e 72 bytes.' })
  }
  try {
    const senhaHash = await bcrypt.hash(senha, 12)
    const contaId = randomUUID()
    const result = await pool.query(
      'insert into contas (id, email, senha_hash) values ($1,$2,$3) on conflict (email) do nothing returning id, email',
      [contaId, email, senhaHash]
    )
    if (!result.rowCount) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' })
    await criarSessao(contaId, res)
    res.status(201).json({ id: contaId, email })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível criar a conta.' })
  }
})

app.post('/api/auth/login', limitarAutenticacao, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : ''
  if (Buffer.byteLength(senha, 'utf8') > 72) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
  }
  try {
    const { rows } = await pool.query(
      'select id, email, senha_hash from contas where email = $1',
      [email]
    )
    const hashParaVerificar = rows[0]?.senha_hash ?? '$2a$12$C6UzMDM.H6dfI/f/IKcEe.2PzC5InRuwb1NpNgRbH8NddUeBDDP1u'
    const senhaValida = await bcrypt.compare(senha, hashParaVerificar)
    if (!rows.length || !senhaValida) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
    }
    await criarSessao(rows[0].id, res)
    res.json({ id: rows[0].id, email: rows[0].email })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível entrar na conta.' })
  }
})

app.get('/api/auth/sessao', autenticar, (req, res) => {
  res.json(req.conta)
})

app.post('/api/auth/sair', autenticar, async (req, res) => {
  try {
    await pool.query('delete from sessoes where token_hash = $1', [hashToken(lerCookie(req, COOKIE_NAME))])
    limparCookieSessao(res)
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível encerrar a sessão.' })
  }
})

app.get('/api/conta/formularios', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select formularios_conta.formulario,
         ((select count(*) from respostas_conta
           where respostas_conta.conta_id = formularios_conta.conta_id
             and respostas_conta.formulario_id = formularios_conta.id) +
          (select count(*) from respostas_publicas
           join formularios_publicos on formularios_publicos.codigo = respostas_publicas.formulario_codigo
           where formularios_publicos.conta_id = formularios_conta.conta_id
             and respostas_publicas.formulario_codigo = formularios_conta.formulario->>'codigo')) as respostas_count
       from formularios_conta
       where formularios_conta.conta_id = $1
         and not exists (
           select 1 from formularios_publicos
           where formularios_publicos.codigo = formularios_conta.formulario->>'codigo'
             and formularios_publicos.conta_id is not null
             and formularios_publicos.conta_id <> formularios_conta.conta_id
         )
       order by formularios_conta.atualizado_em desc`,
      [req.conta.id]
    )
    res.json(rows.map((row) => ({ ...row.formulario, respostasCount: Number(row.respostas_count) })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar os formulários da conta.' })
  }
})

app.get('/api/conta/formularios/excluidos', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select id, excluido_em from formularios_conta_excluidos
       where conta_id = $1
       order by excluido_em desc`,
      [req.conta.id]
    )
    res.json(rows.map((row) => ({ id: row.id, excluidoEm: Number(row.excluido_em) })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as exclusões da conta.' })
  }
})

app.get('/api/conta/respostas', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select id, formulario_id, respostas, criado_em
       from respostas_conta where conta_id = $1
       union
       select respostas_publicas.id, respostas_publicas.formulario_id,
              respostas_publicas.respostas, respostas_publicas.criado_em
       from respostas_publicas
       join formularios_publicos on formularios_publicos.codigo = respostas_publicas.formulario_codigo
       where formularios_publicos.conta_id = $1
       union
       select respostas_publicas.id, respostas_publicas.formulario_id,
              respostas_publicas.respostas, respostas_publicas.criado_em
       from respostas_publicas
       where respostas_publicas.respondente_conta_id = $1
       order by criado_em desc`,
      [req.conta.id]
    )
    res.json(rows.map((row) => ({
      id: row.id,
      formularioId: row.formulario_id,
      respostas: row.respostas,
      criadoEm: Number(row.criado_em),
    })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as respostas da conta.' })
  }
})

app.get('/api/conta/respondidos', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select formularios_publicos.codigo, formularios_publicos.id,
         formularios_publicos.titulo, formularios_publicos.descricao,
         formularios_publicos.perguntas,
         contas.email as criador_email,
         max(respostas_publicas.criado_em) as respondido_em,
         count(respostas_publicas.id) as total_respostas
       from respostas_publicas
       join formularios_publicos on formularios_publicos.codigo = respostas_publicas.formulario_codigo
       left join contas on contas.id = formularios_publicos.conta_id
       where respostas_publicas.respondente_conta_id = $1
       group by formularios_publicos.codigo, formularios_publicos.id,
         formularios_publicos.titulo, formularios_publicos.descricao,
         formularios_publicos.perguntas, contas.email
       order by max(respostas_publicas.criado_em) desc`,
      [req.conta.id]
    )
    res.json(rows.map((row) => ({
      codigo: row.codigo,
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao,
      perguntas: row.perguntas,
      criadorEmail: row.criador_email ?? null,
      respondidoEm: Number(row.respondido_em),
      totalRespostas: Number(row.total_respostas),
      publica: true,
    })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar os questionários respondidos.' })
  }
})

app.put('/api/conta/formularios/:id', autenticar, async (req, res) => {
  const formulario = req.body?.formulario
  if (!formulario || !uuidValido(req.params.id) || formulario.id !== req.params.id ||
      typeof formulario.titulo !== 'string' || typeof formulario.descricao !== 'string' ||
      !Array.isArray(formulario.perguntas) || formulario.perguntas.length < 1 ||
      formulario.perguntas.length > 100 || !Number.isSafeInteger(formulario.atualizadoEm) ||
      formulario.perguntas.some((pergunta) => !pergunta || !uuidValido(pergunta.id) ||
        typeof pergunta.titulo !== 'string' || typeof pergunta.tipo !== 'string' ||
        typeof pergunta.obrigatoria !== 'boolean') ||
      (formulario.metaRespostas !== undefined && formulario.metaRespostas !== null &&
        (!Number.isSafeInteger(formulario.metaRespostas) || formulario.metaRespostas < 1 || formulario.metaRespostas > 1_000_000))) {
    return res.status(400).json({ erro: 'Dados inválidos para sincronizar o formulário.' })
  }
  const codigoFormulario = typeof formulario.codigo === 'string' ? formulario.codigo.toUpperCase() : ''
  try {
    // Uma conta nunca deve guardar uma cópia de um formulário público que
    // pertence a outra conta. Sem esta verificação, abrir um formulário
    // público para responder podia "adotá-lo" na conta do respondente e
    // expor as respostas de outra pessoa.
    if (codigoFormulario) {
      const publico = await pool.query(
        'select conta_id from formularios_publicos where codigo = $1',
        [codigoFormulario]
      )
      if (publico.rowCount && publico.rows[0].conta_id && publico.rows[0].conta_id !== req.conta.id) {
        return res.json({ ok: true, ignorado: true, motivo: 'formulario_publico_de_outra_conta' })
      }
    }
    const excluido = await pool.query(
      `select 1 from formularios_conta_excluidos where conta_id = $1 and id = $2
       union all
       select 1 from formularios_publicos_excluidos where codigo = $3
       limit 1`,
      [req.conta.id, req.params.id, codigoFormulario]
    )
    if (excluido.rowCount) {
      return res.status(409).json({
        erro: 'Este formulário foi excluído e não pode mais ser sincronizado.',
        codigo: 'excluido',
      })
    }
    const result = await pool.query(
      `insert into formularios_conta (conta_id, id, formulario, atualizado_em)
       values ($1,$2,$3,$4)
       on conflict (conta_id, id) do update set
         formulario = excluded.formulario,
         atualizado_em = excluded.atualizado_em
       where formularios_conta.atualizado_em <= excluded.atualizado_em
       returning atualizado_em`,
      [req.conta.id, formulario.id, JSON.stringify({ ...formulario, contaId: req.conta.id }), formulario.atualizadoEm]
    )
    if (!result.rowCount) return res.status(409).json({ erro: 'O formulário foi alterado em outra sessão. Atualize e tente novamente.' })
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível sincronizar o formulário.' })
  }
})

app.delete('/api/conta/formularios/:id', autenticar, async (req, res) => {
  if (!uuidValido(req.params.id)) return res.status(400).json({ erro: 'Identificador de formulário inválido.' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into formularios_conta_excluidos (conta_id, id, excluido_em)
       values ($1,$2,$3)
       on conflict (conta_id, id) do update set
         excluido_em = greatest(formularios_conta_excluidos.excluido_em, excluded.excluido_em)`,
      [req.conta.id, req.params.id, Date.now()]
    )
    await client.query('delete from formularios_conta where conta_id = $1 and id = $2', [req.conta.id, req.params.id])
    await client.query('commit')
    res.json({ ok: true })
  } catch (error) {
    await client.query('rollback')
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível excluir o formulário da conta.' })
  } finally {
    client.release()
  }
})

app.get('/api/conta/formularios/:id/respostas', autenticar, async (req, res) => {
  if (!uuidValido(req.params.id)) return res.status(400).json({ erro: 'Identificador de formulário inválido.' })
  try {
    const { rows } = await pool.query(
      `select id, formulario_id, respostas, criado_em
       from respostas_conta
       where conta_id = $1 and formulario_id = $2
       union all
       select respostas_publicas.id, respostas_publicas.formulario_id,
              respostas_publicas.respostas, respostas_publicas.criado_em
       from respostas_publicas
       join formularios_conta on formularios_conta.conta_id = $1
         and formularios_conta.id = $2
         and respostas_publicas.formulario_codigo = formularios_conta.formulario->>'codigo'
       join formularios_publicos on formularios_publicos.codigo = respostas_publicas.formulario_codigo
         and formularios_publicos.conta_id = formularios_conta.conta_id
       order by criado_em desc`,
      [req.conta.id, req.params.id]
    )
    res.json(rows.map((row) => ({
      id: row.id,
      formularioId: row.formulario_id,
      respostas: row.respostas,
      criadoEm: Number(row.criado_em),
    })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as respostas da conta.' })
  }
})

app.post('/api/conta/formularios/:id/respostas', autenticar, async (req, res) => {
  const { id, respostas, criadoEm } = req.body ?? {}
  if (!uuidValido(req.params.id) || !uuidValido(id) || typeof criadoEm !== 'number' ||
      !Number.isSafeInteger(criadoEm) || !respostas ||
      typeof respostas !== 'object' || Array.isArray(respostas)) {
    return res.status(400).json({ erro: 'Dados inválidos para sincronizar a resposta.' })
  }
  try {
    const formulario = await pool.query(
      `select formulario from formularios_conta where conta_id = $1 and id = $2`,
      [req.conta.id, req.params.id]
    )
    if (!formulario.rowCount) return res.status(404).json({ erro: 'Formulário não encontrado na conta.' })
    const { perguntas } = formulario.rows[0].formulario
    const perguntasPorId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta]))
    if (Object.keys(respostas).some((perguntaId) => !perguntasPorId.has(perguntaId)) ||
        perguntas.some((pergunta) => !validarResposta(pergunta, respostas[pergunta.id]))) {
      return res.status(400).json({ erro: 'Informe respostas válidas para as perguntas do formulário.' })
    }
    const inserida = await pool.query(
      `insert into respostas_conta (id, conta_id, formulario_id, respostas, criado_em)
       values ($1,$2,$3,$4,$5) on conflict (conta_id, id) do nothing
       returning id`,
      [id, req.conta.id, req.params.id, JSON.stringify(respostas), criadoEm]
    )
    const dados = formulario.rows[0].formulario
    const codigo = typeof dados?.codigo === 'string' ? dados.codigo : null
    const meta = Number(dados?.metaRespostas)
    if (inserida.rowCount && Number.isSafeInteger(meta) && meta >= 1) {
      const contagem = await pool.query(
        `select
           (select count(*) from respostas_conta
             where conta_id = $1 and formulario_id = $2) +
           (select count(*) from respostas_publicas
             where formulario_codigo = $3) as total`,
        [req.conta.id, req.params.id, codigo]
      )
      await notificarMetaAtingida({
        contaId: req.conta.id,
        formularioId: req.params.id,
        titulo: dados?.titulo,
        meta,
        total: contagem.rows[0]?.total,
        codigo,
      })
    }
    res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível sincronizar a resposta.' })
  }
})

function respostaVazia(resposta) {
  return resposta === undefined || resposta === null ||
    (typeof resposta === 'string' && !resposta.trim()) ||
    (Array.isArray(resposta) && resposta.length === 0)
}

function validarResposta(pergunta, resposta) {
  if (respostaVazia(resposta)) return !pergunta.obrigatoria
  if (['curta', 'paragrafo', 'data'].includes(pergunta.tipo)) {
    return typeof resposta === 'string' && resposta.length <= 5000
  }
  if (pergunta.tipo === 'escala') {
    return Number.isInteger(resposta) &&
      resposta >= (pergunta.escalaMin ?? 1) &&
      resposta <= (pergunta.escalaMax ?? 5)
  }
  if (pergunta.tipo === 'multipla' || pergunta.tipo === 'lista') {
    return typeof resposta === 'string' && pergunta.opcoes.includes(resposta)
  }
  if (pergunta.tipo === 'caixas') {
    return Array.isArray(resposta) &&
      resposta.every((opcao) => typeof opcao === 'string' && pergunta.opcoes.includes(opcao))
  }
  return false
}

app.put('/api/formularios/:codigo', autenticar, async (req, res) => {
  const codigo = req.params.codigo.toUpperCase()
  const token = req.get('x-owner-token')
  const { id, titulo, descricao, perguntas, atualizadoEm, metaRespostas } = req.body ?? {}
  const meta = metaRespostas === undefined || metaRespostas === null || metaRespostas === ''
    ? null
    : Number(metaRespostas)
  if (!codigoValido(codigo) || !token || token.length > 200 || !uuidValido(id) ||
      typeof titulo !== 'string' || typeof descricao !== 'string' ||
      titulo.length > 1000 || descricao.length > 5000 ||
      !Array.isArray(perguntas) || perguntas.length === 0 || perguntas.length > 100 ||
      (meta !== null && (!Number.isSafeInteger(meta) || meta < 1 || meta > 1_000_000)) ||
      !Number.isSafeInteger(atualizadoEm)) {
    return res.status(400).json({ erro: 'Dados inválidos para publicar o formulário.' })
  }

  try {
    const excluido = await pool.query(
      `select 1 from formularios_publicos_excluidos where codigo = $1
       union all
       select 1 from formularios_conta_excluidos where conta_id = $2 and id = $3
       limit 1`,
      [codigo, req.conta.id, id]
    )
    if (excluido.rowCount) {
      return res.status(409).json({
        erro: 'Este formulário foi excluído e não pode ser publicado novamente com este código.',
        codigo: 'excluido',
      })
    }
    const { rows } = await pool.query(
      `insert into formularios_publicos
         (codigo, id, titulo, descricao, perguntas, token_hash, atualizado_em, conta_id, meta_respostas)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (codigo) do update set
         id = excluded.id,
         titulo = excluded.titulo,
         descricao = excluded.descricao,
         perguntas = excluded.perguntas,
         atualizado_em = excluded.atualizado_em,
         conta_id = excluded.conta_id,
         meta_respostas = excluded.meta_respostas
       where formularios_publicos.token_hash = excluded.token_hash
         and (formularios_publicos.conta_id is null or formularios_publicos.conta_id = excluded.conta_id)
         and formularios_publicos.atualizado_em <= excluded.atualizado_em
       returning codigo`,
      [codigo, id, titulo, descricao, JSON.stringify(perguntas), hashToken(token), atualizadoEm, req.conta.id, meta]
    )
    if (!rows.length) return res.status(409).json({ erro: 'Este código já está em uso ou o formulário foi atualizado em outro dispositivo.' })
    res.json({ ok: true, codigo })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível publicar o formulário.' })
  }
})

app.get('/api/formularios/:codigo/respostas', autenticar, async (req, res) => {
  const codigo = req.params.codigo.toUpperCase()
  const token = req.get('x-owner-token')
  if (!codigoValido(codigo) || !token) {
    return res.status(400).json({ erro: 'Código ou token do proprietário inválido.' })
  }
  try {
    const dono = await pool.query(
      `select 1 from formularios_publicos
       where codigo = $1 and (conta_id = $2 or (conta_id is null and token_hash = $3))`,
      [codigo, req.conta.id, hashToken(token)]
    )
    if (!dono.rowCount) return res.status(403).json({ erro: 'Acesso às respostas não autorizado.' })
    const { rows } = await pool.query(
      `select id, formulario_id, respostas, criado_em
       from respostas_publicas where formulario_codigo = $1 order by criado_em desc`,
      [codigo]
    )
    res.json(rows.map((row) => ({
      id: row.id,
      formularioId: row.formulario_id,
      respostas: row.respostas,
      criadoEm: Number(row.criado_em),
    })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as respostas.' })
  }
})

app.delete('/api/formularios/:codigo', autenticar, async (req, res) => {
  const codigo = req.params.codigo.toUpperCase()
  const token = req.get('x-owner-token')
  if (!codigoValido(codigo) || !token) {
    return res.status(400).json({ erro: 'Código ou token do proprietário inválido.' })
  }
  try {
    const result = await pool.query(
      `with removido as (
         delete from formularios_publicos
         where codigo = $1 and (conta_id = $2 or (conta_id is null and token_hash = $3))
         returning codigo
       )
       insert into formularios_publicos_excluidos (codigo, excluido_em)
       select codigo, $4 from removido
       on conflict (codigo) do update set
         excluido_em = greatest(formularios_publicos_excluidos.excluido_em, excluded.excluido_em)
       returning codigo`,
      [codigo, req.conta.id, hashToken(token), Date.now()]
    )
    if (!result.rowCount) return res.status(404).json({ erro: 'Formulário não encontrado ou acesso não autorizado.' })
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível excluir o formulário publicado.' })
  }
})

app.post('/api/formularios/:codigo/respostas', limitarRespostaPublica, async (req, res) => {
  const codigo = req.params.codigo.toUpperCase()
  const { id, respostas, criadoEm } = req.body ?? {}
  if (!codigoValido(codigo) || typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !respostas || typeof respostas !== 'object' || Array.isArray(respostas) ||
      !Number.isSafeInteger(criadoEm)) {
    return res.status(400).json({ erro: 'Resposta inválida.' })
  }
  try {
    const sessao = lerCookie(req, COOKIE_NAME)
    const contaRespondente = sessao
      ? await pool.query(
          'select conta_id from sessoes where token_hash = $1 and expira_em > now()',
          [hashToken(sessao)]
        )
      : { rows: [] }
    const respondenteContaId = contaRespondente.rows[0]?.conta_id ?? null
    const formulario = await pool.query(
      'select id, perguntas, titulo, meta_respostas, conta_id from formularios_publicos where codigo = $1',
      [codigo]
    )
    if (!formulario.rowCount) return res.status(404).json({ erro: 'Formulário não encontrado.' })
    const perguntas = formulario.rows[0].perguntas
    const perguntasPorId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta]))
    if (Object.keys(respostas).some((perguntaId) => !perguntasPorId.has(perguntaId)) ||
        perguntas.some((pergunta) => !validarResposta(pergunta, respostas[pergunta.id]))) {
      return res.status(400).json({ erro: 'Preencha as perguntas obrigatórias e informe respostas válidas.' })
    }

    const { rows } = await pool.query(
      `insert into respostas_publicas
         (id, formulario_codigo, formulario_id, respostas, criado_em, respondente_conta_id)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do nothing
       returning id, formulario_id, respostas, criado_em`,
      [id, codigo, formulario.rows[0].id, JSON.stringify(respostas), criadoEm, respondenteContaId]
    )
    if (rows.length) {
      const row = rows[0]
      const dados = formulario.rows[0]
      if (dados.conta_id && dados.meta_respostas) {
        const contagem = await pool.query(
          'select count(*)::int as total from respostas_publicas where formulario_codigo = $1',
          [codigo]
        )
        await notificarMetaAtingida({
          contaId: dados.conta_id,
          formularioId: dados.id,
          titulo: dados.titulo,
          meta: dados.meta_respostas,
          total: contagem.rows[0]?.total,
          codigo,
        })
      }
      return res.status(201).json({
        id: row.id,
        formularioId: row.formulario_id,
        respostas: row.respostas,
        criadoEm: Number(row.criado_em),
      })
    }
    const existente = await pool.query(
      'select id from respostas_publicas where id = $1 and formulario_codigo = $2',
      [id, codigo]
    )
    if (!existente.rowCount) return res.status(409).json({ erro: 'Identificador de resposta já utilizado.' })
    res.json({ ok: true, id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível registrar a resposta.' })
  }
})

app.get('/api/formularios/:codigo', async (req, res) => {
  const codigo = req.params.codigo.toUpperCase()
  if (!codigoValido(codigo)) return res.status(400).json({ erro: 'Código inválido.' })
  try {
    const { rows } = await pool.query(
      `select codigo, id, titulo, descricao, perguntas, atualizado_em, meta_respostas
       from formularios_publicos where codigo = $1`,
      [codigo]
    )
    if (!rows.length) return res.status(404).json({ erro: 'Nenhum formulário encontrado com esse código.' })
    const row = rows[0]
    res.json({
      codigo: row.codigo,
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao,
      perguntas: row.perguntas,
      metaRespostas: row.meta_respostas === null ? null : Number(row.meta_respostas),
      atualizadoEm: Number(row.atualizado_em),
      publica: true,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível localizar o formulário.' })
  }
})

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL || ''

let webPushPronto = null
async function carregarWebPush() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null
  if (webPushPronto) return webPushPronto
  try {
    const modulo = await import('web-push')
    const webpush = modulo.default ?? modulo
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    webPushPronto = webpush
    return webpush
  } catch (error) {
    console.error('[Notificação] Não foi possível carregar o web-push:', error)
    return null
  }
}

async function enviarPush(contaId, payload) {
  try {
    const webpush = await carregarWebPush()
    if (!webpush) return
    const { rows } = await pool.query(
      'select id, endpoint, p256dh, auth from inscricoes_push where conta_id = $1',
      [contaId]
    )
    if (!rows.length) return
    const corpo = JSON.stringify(payload)
    await Promise.allSettled(rows.map(async (inscricao) => {
      try {
        await webpush.sendNotification(
          { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
          corpo
        )
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await pool.query('delete from inscricoes_push where id = $1', [inscricao.id])
        }
      }
    }))
  } catch (error) {
    console.error('[Notificação] Erro ao enviar push:', error)
  }
}

async function criarNotificacao({ contaId, titulo, mensagem, url }) {
  try {
    const { rows } = await pool.query(
      'select notificacoes_ativas, notificar_sistema from contas where id = $1',
      [contaId]
    )
    if (!rows.length || !rows[0].notificacoes_ativas || !rows[0].notificar_sistema) return false
    await pool.query(
      `insert into notificacoes (id, conta_id, titulo, mensagem, url, lida, criada_em)
       values ($1,$2,$3,$4,$5,false,$6)`,
      [randomUUID(), contaId, titulo, mensagem, url ?? null, Date.now()]
    )
    await enviarPush(contaId, {
      title: titulo,
      body: mensagem,
      url: url ?? '/',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'lumys-notificacao',
    })
    return true
  } catch (error) {
    console.error('[Notificação] Erro ao criar notificação:', error)
    return false
  }
}

async function notificarMetaAtingida({ contaId, formularioId, titulo, meta, total, codigo }) {
  const metaNumero = Number(meta)
  const totalNumero = Number(total)
  if (!contaId || !formularioId || !Number.isSafeInteger(metaNumero) || metaNumero < 1) return
  if (!Number.isFinite(totalNumero) || totalNumero < metaNumero) return
  try {
    const { rows } = await pool.query(
      'select notificar_questionarios from contas where id = $1',
      [contaId]
    )
    if (!rows.length || !rows[0].notificar_questionarios) return
    const reserva = await pool.query(
      `insert into metas_notificadas (conta_id, formulario_id, notificada_em)
       values ($1,$2,$3)
       on conflict (conta_id, formulario_id) do nothing
       returning conta_id`,
      [contaId, formularioId, Date.now()]
    )
    if (!reserva.rowCount) return
    await criarNotificacao({
      contaId,
      titulo: 'Meta de respostas atingida!',
      mensagem: `O questionário "${titulo || 'Sem título'}" atingiu ${metaNumero} respostas (${totalNumero} no total)`,
      url: codigo ? `#/form/${codigo}` : '#/notificacoes',
    })
  } catch (error) {
    console.error('[Notificação] Erro ao notificar a meta:', error)
  }
}

app.get('/api/vapid-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ erro: 'As notificações push não estão configuradas no servidor.' })
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY })
})

app.post('/api/subscribe', autenticar, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''
  const keys = req.body?.keys
  if (!endpoint || endpoint.length > 2000 ||
      !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return res.status(400).json({ erro: 'Inscrição de notificação inválida.' })
  }
  try {
    await pool.query(
      `insert into inscricoes_push (id, conta_id, endpoint, p256dh, auth, criada_em)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (endpoint) do update set
         conta_id = excluded.conta_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         criada_em = excluded.criada_em`,
      [randomUUID(), req.conta.id, endpoint, keys.p256dh, keys.auth, Date.now()]
    )
    res.status(201).json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível registrar a inscrição de notificação.' })
  }
})

app.post('/api/subscribe/check', autenticar, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''
  if (!endpoint) return res.json({ registered: false })
  try {
    const { rowCount } = await pool.query(
      'select 1 from inscricoes_push where endpoint = $1 and conta_id = $2',
      [endpoint, req.conta.id]
    )
    res.json({ registered: rowCount > 0 })
  } catch (error) {
    console.error(error)
    res.json({ registered: false })
  }
})

app.post('/api/unsubscribe', autenticar, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''
  if (!endpoint) return res.status(400).json({ erro: 'Inscrição de notificação inválida.' })
  try {
    await pool.query(
      'delete from inscricoes_push where endpoint = $1 and conta_id = $2',
      [endpoint, req.conta.id]
    )
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível remover a inscrição de notificação.' })
  }
})

app.get('/api/notifications/unread', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'select count(*)::int as total from notificacoes where conta_id = $1 and lida = false',
      [req.conta.id]
    )
    res.json({ count: rows[0]?.total ?? 0 })
  } catch (error) {
    console.error(error)
    res.json({ count: 0 })
  }
})

app.get('/api/notifications/history', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select id, titulo, mensagem, url, lida, criada_em
       from notificacoes where conta_id = $1
       order by criada_em desc
       limit 50`,
      [req.conta.id]
    )
    res.json({
      notificacoes: rows.map((row) => ({
        id: row.id,
        titulo: row.titulo,
        mensagem: row.mensagem,
        url: row.url,
        lida: row.lida,
        criadaEm: Number(row.criada_em),
      })),
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as notificações.' })
  }
})

app.post('/api/notifications/read', autenticar, async (req, res) => {
  const { id, all } = req.body ?? {}
  try {
    if (all) {
      await pool.query(
        'update notificacoes set lida = true where conta_id = $1 and lida = false',
        [req.conta.id]
      )
    } else if (uuidValido(id)) {
      await pool.query(
        'update notificacoes set lida = true where id = $1 and conta_id = $2',
        [id, req.conta.id]
      )
    } else {
      return res.status(400).json({ erro: 'Parâmetro inválido.' })
    }
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível marcar as notificações como lidas.' })
  }
})

app.post('/api/notifications/delete', autenticar, async (req, res) => {
  const { id, all } = req.body ?? {}
  try {
    if (all) {
      await pool.query('delete from notificacoes where conta_id = $1', [req.conta.id])
    } else if (uuidValido(id)) {
      await pool.query('delete from notificacoes where id = $1 and conta_id = $2', [id, req.conta.id])
    } else {
      return res.status(400).json({ erro: 'Parâmetro inválido.' })
    }
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível excluir as notificações.' })
  }
})

app.get('/api/notifications/preferences', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select notificacoes_ativas, notificar_sistema, notificar_questionarios
       from contas where id = $1`,
      [req.conta.id]
    )
    if (!rows.length) return res.status(404).json({ erro: 'Conta não encontrada.' })
    res.json({
      notificacoesAtivas: rows[0].notificacoes_ativas,
      notificarSistema: rows[0].notificar_sistema,
      notificarQuestionarios: rows[0].notificar_questionarios,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível carregar as preferências de notificação.' })
  }
})

app.put('/api/notifications/preferences', autenticar, async (req, res) => {
  const { notificacoesAtivas, notificarSistema, notificarQuestionarios } = req.body ?? {}
  const valores = [notificacoesAtivas, notificarSistema, notificarQuestionarios]
  if (valores.some((valor) => valor !== undefined && typeof valor !== 'boolean')) {
    return res.status(400).json({ erro: 'Preferências de notificação inválidas.' })
  }
  try {
    const { rows } = await pool.query(
      `update contas set
         notificacoes_ativas = coalesce($2, notificacoes_ativas),
         notificar_sistema = coalesce($3, notificar_sistema),
         notificar_questionarios = coalesce($4, notificar_questionarios)
       where id = $1
       returning notificacoes_ativas, notificar_sistema, notificar_questionarios`,
      [req.conta.id, notificacoesAtivas ?? null, notificarSistema ?? null, notificarQuestionarios ?? null]
    )
    if (!rows.length) return res.status(404).json({ erro: 'Conta não encontrada.' })
    res.json({
      notificacoesAtivas: rows[0].notificacoes_ativas,
      notificarSistema: rows[0].notificar_sistema,
      notificarQuestionarios: rows[0].notificar_questionarios,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: 'Não foi possível salvar as preferências de notificação.' })
  }
})

app.use('/api', (_req, res) => {
  res.status(404).json({ erro: 'rota não encontrada' })
})

app.post('/sync/push', autenticar, async (req, res) => {
  const userId = req.conta.id
  const { operacoes = [] } = req.body
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const op of operacoes) {
      const agora = Date.now()
      if (op.operacao === 'upsert' && op.dados) {
        const d = op.dados
        await client.query(
          `insert into tarefas
             (id, user_id, titulo, concluida, criada_em, atualizada_em, deletado_em, servidor_em)
           values ($1,$2,$3,$4,$5,$6,null,$7)
           on conflict (id) do update set
             titulo = excluded.titulo,
             concluida = excluded.concluida,
             atualizada_em = excluded.atualizada_em,
             deletado_em = null,
             servidor_em = excluded.servidor_em
           where tarefas.user_id = excluded.user_id
             and tarefas.atualizada_em <= excluded.atualizada_em`,
          [d.id, userId, d.titulo, d.concluida, d.criadaEm, d.atualizadaEm, agora]
        )
      } else if (op.operacao === 'delete') {
        await client.query(
          `update tarefas set deletado_em = $1, servidor_em = $1
           where id = $2 and user_id = $3`,
          [agora, op.id, userId]
        )
      }
    }
    await client.query('commit')
    res.json({ ok: true })
  } catch (e) {
    await client.query('rollback')
    console.error(e)
    res.status(500).json({ erro: 'falha no push' })
  } finally {
    client.release()
  }
})

app.get('/sync/pull', autenticar, async (req, res) => {
  const userId = req.conta.id
  const desde = Number(req.query.desde) || 0
  try {
    const { rows } = await pool.query(
      `select * from tarefas
       where user_id = $1 and servidor_em > $2
       order by servidor_em`,
      [userId, desde]
    )
    const registros = rows
      .filter((r) => !r.deletado_em)
      .map((r) => ({
        id: r.id,
        titulo: r.titulo,
        concluida: r.concluida,
        criadaEm: Number(r.criada_em),
        atualizadaEm: Number(r.atualizada_em),
      }))
    const removidos = rows.filter((r) => r.deletado_em).map((r) => r.id)
    const agora = rows.length ? Number(rows[rows.length - 1].servidor_em) : desde
    res.json({ registros, removidos, agora })
  } catch (e) {
    console.error(e)
    res.status(500).json({ erro: 'falha no pull' })
  }
})

app.use('/sync', (_req, res) => {
  res.status(404).json({ erro: 'rota não encontrada' })
})

app.use(express.static(distPath))
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next()
  res.sendFile(resolve(distPath, 'index.html'))
})

app.use((error, _req, res, next) => {
  console.error('Erro ao processar requisição da API:', error)
  if (res.headersSent) return next(error)
  res.status(500).json({ erro: 'Não foi possível processar a requisição.' })
})

async function criarTabelas() {
  // Reconciliação de esquema: versões anteriores desta base podiam ter uma
  // tabela "notificacoes" (tipo/chave/lida_em) e "push_inscricoes" de um
  // desenho antigo. Como o formato é incompatível, movemos essas tabelas
  // legadas para fora do caminho (sem apagar dados) antes de criar o esquema
  // atual. O bloco é idempotente: só age quando encontra o esquema antigo.
  await pool.query(`
    do $$
    begin
      if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'notificacoes'
      ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'notificacoes' and column_name = 'lida'
      ) then
        drop table if exists notificacoes_legado;
        alter table notificacoes rename to notificacoes_legado;
        if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notificacoes_conta_criada_idx') then
          alter index notificacoes_conta_criada_idx rename to notificacoes_legado_conta_criada_idx;
        end if;
        if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notificacoes_conta_id_chave_key') then
          alter index notificacoes_conta_id_chave_key rename to notificacoes_legado_conta_id_chave_key;
        end if;
      end if;

      if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'push_inscricoes'
      ) and not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'inscricoes_push'
      ) then
        drop table if exists push_inscricoes_legado;
        alter table push_inscricoes rename to push_inscricoes_legado;
        if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'push_inscricoes_conta_idx') then
          alter index push_inscricoes_conta_idx rename to push_inscricoes_legado_conta_idx;
        end if;
      end if;
    end $$;
  `)

  await pool.query(`
    create table if not exists contas (
      id uuid primary key,
      email varchar(254) not null unique,
      senha_hash text not null,
      criada_em timestamptz not null default now()
    );
    create table if not exists sessoes (
      token_hash char(64) primary key,
      conta_id uuid not null references contas(id) on delete cascade,
      expira_em timestamptz not null,
      criada_em timestamptz not null default now()
    );
    create index if not exists sessoes_expira_em_idx on sessoes (expira_em);
    create table if not exists formularios_conta (
      conta_id uuid not null references contas(id) on delete cascade,
      id uuid not null,
      formulario jsonb not null,
      atualizado_em bigint not null,
      primary key (conta_id, id)
    );
    create table if not exists formularios_conta_excluidos (
      conta_id uuid not null references contas(id) on delete cascade,
      id uuid not null,
      excluido_em bigint not null,
      primary key (conta_id, id)
    );
    create index if not exists formularios_conta_excluidos_conta_idx
      on formularios_conta_excluidos (conta_id, excluido_em desc);
    create table if not exists respostas_conta (
      id uuid not null,
      conta_id uuid not null references contas(id) on delete cascade,
      formulario_id uuid not null,
      respostas jsonb not null,
      criado_em bigint not null,
      primary key (conta_id, id),
      foreign key (conta_id, formulario_id)
        references formularios_conta(conta_id, id) on delete cascade
    );
    create index if not exists respostas_conta_conta_form_idx
      on respostas_conta (conta_id, formulario_id, criado_em desc);
    create table if not exists formularios_publicos (
      codigo varchar(16) primary key,
      id uuid not null,
      titulo text not null,
      descricao text not null default '',
      perguntas jsonb not null,
      token_hash char(64) not null,
      atualizado_em bigint not null,
      conta_id uuid references contas(id) on delete set null
    );
    create table if not exists formularios_publicos_excluidos (
      codigo varchar(16) primary key,
      excluido_em bigint not null
    );
    alter table formularios_publicos
      add column if not exists conta_id uuid references contas(id) on delete set null;
    create table if not exists respostas_publicas (
      id uuid primary key,
      formulario_codigo varchar(16) not null references formularios_publicos(codigo) on delete cascade,
      formulario_id uuid not null,
      respostas jsonb not null,
      criado_em bigint not null,
      respondente_conta_id uuid references contas(id) on delete set null
    );
    alter table respostas_publicas
      add column if not exists respondente_conta_id uuid references contas(id) on delete set null;
    create index if not exists respostas_publicas_respondente_idx
      on respostas_publicas (respondente_conta_id, criado_em desc);
    create index if not exists respostas_publicas_codigo_criado_idx
      on respostas_publicas (formulario_codigo, criado_em desc);
    alter table contas
      add column if not exists notificacoes_ativas boolean not null default true;
    alter table contas
      add column if not exists notificar_sistema boolean not null default true;
    alter table contas
      add column if not exists notificar_questionarios boolean not null default true;
    alter table formularios_publicos
      add column if not exists meta_respostas integer;
    create table if not exists inscricoes_push (
      id uuid primary key,
      conta_id uuid not null references contas(id) on delete cascade,
      endpoint text not null unique,
      p256dh text not null,
      auth text not null,
      criada_em bigint not null
    );
    create index if not exists inscricoes_push_conta_idx
      on inscricoes_push (conta_id);
    create table if not exists notificacoes (
      id uuid primary key,
      conta_id uuid not null references contas(id) on delete cascade,
      titulo text not null,
      mensagem text not null,
      url text,
      lida boolean not null default false,
      criada_em bigint not null,
      enviada_em bigint
    );
    create index if not exists notificacoes_conta_criada_idx
      on notificacoes (conta_id, criada_em desc);
    create index if not exists notificacoes_conta_lida_idx
      on notificacoes (conta_id, lida);
    create table if not exists metas_notificadas (
      conta_id uuid not null references contas(id) on delete cascade,
      formulario_id uuid not null,
      notificada_em bigint not null,
      primary key (conta_id, formulario_id)
    );
  `)
}

export default app

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  garantirBanco()
    .then(() => app.listen(process.env.PORT || 3001, () => console.log('Aplicação e API rodando')))
    .catch((error) => {
      console.error('Não foi possível iniciar a API. Verifique a conexão e o schema do PostgreSQL.', error)
      process.exitCode = 1
    })
}