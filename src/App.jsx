import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { enfileirarRequisicao, sincronizarFilaApi } from './offlineSync'
import AppLayout from './layout/AppLayout'
import AnswerPage from './pages/AnswerPage'
import DetailsPage from './pages/DetailsPage'
import HomePage from './pages/HomePage'
import ListPage from './pages/ListPage'
import ProfilePage from './pages/ProfilePage'
import './style.css'

const ResultsPage = lazy(() => import('./pages/ResultsPage'))

const TIPOS = [
  { value: 'curta', label: 'Resposta curta' },
  { value: 'paragrafo', label: 'Parágrafo' },
  { value: 'multipla', label: 'Múltipla escolha' },
  { value: 'caixas', label: 'Caixas de seleção' },
  { value: 'lista', label: 'Lista suspensa' },
  { value: 'escala', label: 'Escala' },
  { value: 'data', label: 'Data' },
]

const MODELO_JSON = `{
  "titulo": "Exemplo com todos os tipos de pergunta",
  "descricao": "Edite este JSON e importe o questionário.",
  "perguntas": [
    {
      "titulo": "Qual é o seu nome?",
      "tipo": "curta",
      "obrigatoria": true
    },
    {
      "titulo": "Conte um pouco sobre você.",
      "tipo": "paragrafo",
      "obrigatoria": false
    },
    {
      "titulo": "Qual meio de contato prefere?",
      "tipo": "multipla",
      "obrigatoria": true,
      "opcoes": ["E-mail", "Telefone", "WhatsApp"]
    },
    {
      "titulo": "Quais assuntos interessam a você?",
      "tipo": "caixas",
      "obrigatoria": false,
      "opcoes": ["Novidades", "Ofertas", "Eventos"]
    },
    {
      "titulo": "Qual sua região?",
      "tipo": "lista",
      "obrigatoria": false,
      "opcoes": ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"]
    },
    {
      "titulo": "Como avalia sua experiência?",
      "tipo": "escala",
      "obrigatoria": true,
      "escalaMin": 1,
      "escalaMax": 5
    },
    {
      "titulo": "Qual a melhor data para contato?",
      "tipo": "data",
      "obrigatoria": false
    }
  ]
}`

function validarFormularioJson(texto) {
  let conteudo
  try {
    conteudo = JSON.parse(texto)
  } catch (error) {
    throw new Error(`JSON inválido: ${error.message}`, { cause: error })
  }

  if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) {
    throw new Error('O JSON precisa ser um objeto com título e perguntas.')
  }
  const dados = conteudo.formulario ?? conteudo
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new Error('O campo "formulario" precisa ser um objeto.')
  }
  if (dados.titulo !== undefined && typeof dados.titulo !== 'string') {
    throw new Error('O campo "titulo" precisa ser um texto.')
  }
  if (dados.descricao !== undefined && typeof dados.descricao !== 'string') {
    throw new Error('O campo "descricao" precisa ser um texto.')
  }
  if (!Array.isArray(dados.perguntas) || dados.perguntas.length === 0) {
    throw new Error('Inclua pelo menos uma pergunta no campo "perguntas".')
  }
  if (dados.perguntas.length > 100) {
    throw new Error('O formulário pode ter no máximo 100 perguntas.')
  }

  const tiposValidos = new Set(TIPOS.map((tipo) => tipo.value))
  const perguntas = dados.perguntas.map((pergunta, index) => {
    const numero = index + 1
    if (!pergunta || typeof pergunta !== 'object' || Array.isArray(pergunta)) {
      throw new Error(`A pergunta ${numero} precisa ser um objeto.`)
    }
    if (typeof pergunta.titulo !== 'string' || !pergunta.titulo.trim()) {
      throw new Error(`Informe o texto da pergunta ${numero} em "titulo".`)
    }
    if (!tiposValidos.has(pergunta.tipo)) {
      throw new Error(`O tipo da pergunta ${numero} é inválido. Use: ${[...tiposValidos].join(', ')}.`)
    }
    if (pergunta.obrigatoria !== undefined && typeof pergunta.obrigatoria !== 'boolean') {
      throw new Error(`O campo "obrigatoria" da pergunta ${numero} precisa ser verdadeiro ou falso.`)
    }

    const usaOpcoes = ['multipla', 'caixas', 'lista'].includes(pergunta.tipo)
    let opcoes = []
    if (usaOpcoes) {
      if (!Array.isArray(pergunta.opcoes) || pergunta.opcoes.length < 2) {
        throw new Error(`A pergunta ${numero} precisa ter pelo menos duas "opcoes".`)
      }
      if (pergunta.opcoes.some((opcao) => typeof opcao !== 'string' || !opcao.trim())) {
        throw new Error(`Todas as opções da pergunta ${numero} precisam ser textos não vazios.`)
      }
      opcoes = pergunta.opcoes.map((opcao) => opcao.trim())
    } else if (pergunta.opcoes !== undefined && !Array.isArray(pergunta.opcoes)) {
      throw new Error(`O campo "opcoes" da pergunta ${numero} precisa ser uma lista.`)
    }

    const escalaMin = pergunta.escalaMin ?? 1
    const escalaMax = pergunta.escalaMax ?? 5
    if (pergunta.tipo === 'escala') {
      if (!Number.isInteger(escalaMin) || !Number.isInteger(escalaMax) || escalaMin < 0 || escalaMax > 100 || escalaMax <= escalaMin) {
        throw new Error(`A escala da pergunta ${numero} precisa ter limites inteiros entre 0 e 100, com máximo maior que mínimo.`)
      }
      if (pergunta.rotuloMin !== undefined && typeof pergunta.rotuloMin !== 'string') {
        throw new Error(`O campo "rotuloMin" da pergunta ${numero} precisa ser um texto.`)
      }
      if (pergunta.rotuloMax !== undefined && typeof pergunta.rotuloMax !== 'string') {
        throw new Error(`O campo "rotuloMax" da pergunta ${numero} precisa ser um texto.`)
      }
    }

    return {
      id: crypto.randomUUID(),
      titulo: pergunta.titulo.trim(),
      tipo: pergunta.tipo,
      obrigatoria: pergunta.obrigatoria ?? false,
      opcoes,
      escalaMin,
      escalaMax,
      rotuloMin: typeof pergunta.rotuloMin === 'string' ? pergunta.rotuloMin.trim() : '',
      rotuloMax: typeof pergunta.rotuloMax === 'string' ? pergunta.rotuloMax.trim() : '',
    }
  })

  const agora = Date.now()
  return {
    id: crypto.randomUUID(),
    titulo: dados.titulo?.trim() || 'Questionário sem título',
    descricao: dados.descricao?.trim() ?? '',
    perguntas,
    criadoEm: agora,
    atualizadoEm: agora,
  }
}

function novaPergunta() {
  return {
    id: crypto.randomUUID(),
    titulo: '',
    tipo: 'curta',
    obrigatoria: false,
    opcoes: ['Opção 1', 'Opção 2'],
    escalaMin: 1,
    escalaMax: 5,
    rotuloMin: '',
    rotuloMax: '',
  }
}

function novoFormulario() {
  const agora = Date.now()
  return {
    id: crypto.randomUUID(),
    codigo: crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
    tokenProprietario: crypto.randomUUID(),
    publicada: false,
    titulo: 'Questionário sem título',
    descricao: '',
    perguntas: [novaPergunta()],
    criadoEm: agora,
    atualizadoEm: agora,
  }
}

function prepararFormulario(formulario) {
  return { ...formulario, atualizadoEm: Date.now() }
}

function codigoDaUrl() {
  const correspondencia = window.location.hash.match(/^#\/form\/([A-Z0-9]{8,16})$/i)
  return correspondencia?.[1]?.toUpperCase() ?? ''
}

function codigoDoQr(texto) {
  try {
    const url = new URL(texto.trim())
    const rotas = [url.hash, url.pathname]
    for (const rota of rotas) {
      const correspondencia = rota.match(/(?:^#?\/form\/|^#\/form\/)([A-Z0-9]{8,16})(?:[/?#]|$)/i)
      if (correspondencia) return correspondencia[1].toUpperCase()
    }
    const codigo = url.searchParams.get('codigo')?.trim().toUpperCase() ?? ''
    return /^[A-Z0-9]{8,16}$/.test(codigo) ? codigo : ''
  } catch {
    const codigo = texto.trim().toUpperCase()
    return /^[A-Z0-9]{8,16}$/.test(codigo) ? codigo : ''
  }
}

async function requisitarApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.erro || 'Não foi possível concluir a operação.')
    error.status = response.status
    throw error
  }
  return body
}

async function sincronizarFormulariosDaConta(conta) {
  const locais = await db.formularios.toArray()
  const daConta = locais.filter((formulario) => !formulario.contaId || formulario.contaId === conta.id)
  const remotos = await requisitarApi('/api/conta/formularios')
  const porIdRemoto = new Map(remotos.map((formulario) => [formulario.id, formulario]))

  for (const local of daConta) {
    const formularioLocal = { ...local, contaId: conta.id }
    const remoto = porIdRemoto.get(local.id)
    if (!remoto || formularioLocal.atualizadoEm > remoto.atualizadoEm) {
      await requisitarApi(`/api/conta/formularios/${formularioLocal.id}`, {
        method: 'PUT',
        body: JSON.stringify({ formulario: formularioLocal }),
      })
      await db.formularios.put(formularioLocal)
    } else {
      await db.formularios.put({ ...remoto, contaId: conta.id })
    }
  }

  const idsLocais = new Set(daConta.map((formulario) => formulario.id))
  for (const remoto of remotos) {
    if (!idsLocais.has(remoto.id)) await db.formularios.put({ ...remoto, contaId: conta.id })
  }

  for (const formulario of daConta) {
    const respostasLocais = await db.respostas.where('formularioId').equals(formulario.id).toArray()
    for (const resposta of respostasLocais) {
      const respostaPublica = formulario.publicada && formulario.codigo
      await enfileirarRequisicao({
        url: respostaPublica
          ? `/api/formularios/${formulario.codigo}/respostas`
          : `/api/conta/formularios/${formulario.id}/respostas`,
        method: 'POST',
        body: JSON.stringify(resposta),
        contaId: conta.id,
        chave: `${respostaPublica ? 'resposta-publica' : 'resposta-conta'}:${resposta.id}`,
      })
    }
  }
  const respostasRemotas = await requisitarApi('/api/conta/respostas')
  if (respostasRemotas.length) await db.respostas.bulkPut(respostasRemotas)
  await sincronizarFilaApi(conta.id)

  return db.formularios.where('contaId').equals(conta.id).toArray()
}

function rotuloEscala(rotulo, padrao) {
  if (!rotulo || rotulo === 'Insatisfeito' || rotulo === 'Satisfeito') return String(padrao)
  return rotulo
}

function agruparRespostasPorDia(respostas) {
  const grupos = new Map()
  for (const resposta of respostas) {
    const data = new Date(resposta.criadoEm)
    const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
    grupos.set(chave, (grupos.get(chave) ?? 0) + 1)
  }
  return [...grupos].map(([data, quantidade]) => ({
    rotulo: new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    quantidade,
  }))
}

function contarOpcoes(pergunta, respostas) {
  const valores = respostas
    .map((registro) => registro.respostas[pergunta.id])
    .flatMap((resposta) => Array.isArray(resposta) ? resposta : [resposta])
    .filter((resposta) => typeof resposta === 'number' || (typeof resposta === 'string' && resposta.trim()))
  const contagens = new Map()
  for (const valor of valores) contagens.set(valor, (contagens.get(valor) ?? 0) + 1)
  const escalaMin = pergunta.escalaMin ?? 1
  const escalaMax = pergunta.escalaMax ?? 5
  const opcoes = pergunta.tipo === 'escala'
    ? Array.from({ length: escalaMax - escalaMin + 1 }, (_, index) => escalaMin + index)
    : pergunta.tipo === 'data'
      ? [...contagens.keys()].sort()
      : pergunta.opcoes
  const dados = opcoes.map((opcao, index) => ({
    rotulo: pergunta.tipo === 'escala' ? String(opcao) : opcao || `Opção ${index + 1}`,
    quantidade: contagens.get(opcao) ?? 0,
  }))
  if (['data', 'escala'].includes(pergunta.tipo)) return dados
  for (const [rotulo, quantidade] of contagens) {
    if (!dados.some((item) => item.rotulo === rotulo)) dados.push({ rotulo, quantidade })
  }
  return dados
}

function GraficoBarras({ dados, total }) {
  const maximo = Math.max(...dados.map((item) => item.quantidade), 1)
  return (
    <div className="chart-bars" role="list">
      {dados.map((item, index) => (
        <div className="chart-row" role="listitem" key={`${item.rotulo}-${index}`}>
          <div className="chart-label" title={item.rotulo}>{item.rotulo}</div>
          <div className="chart-track" aria-hidden="true">
            <span className="chart-fill" style={{ width: `${item.quantidade / maximo * 100}%` }} />
          </div>
          <span className="chart-value">{item.quantidade}</span>
          <span className="chart-percent">{total ? `${Math.round(item.quantidade / total * 100)}%` : '0%'}</span>
        </div>
      ))}
    </div>
  )
}

function combinarRespondidos(principais, locais) {
  const porCodigo = new Map()
  for (const formulario of [...locais, ...principais]) {
    if (formulario?.codigo) {
      porCodigo.set(formulario.codigo, {
        ...porCodigo.get(formulario.codigo),
        ...formulario,
      })
    }
  }
  return [...porCodigo.values()].sort((a, b) => (b.respondidoEm ?? 0) - (a.respondidoEm ?? 0))
}

function App() {
  const [tela, setTela] = useState(() => codigoDaUrl() ? 'carregando' : 'inicio')
  const [conta, setConta] = useState(null)
  const [abaInicio, setAbaInicio] = useState('meus')
  const [questionariosRespondidos, setQuestionariosRespondidos] = useState([])
  const [authCarregando, setAuthCarregando] = useState(true)
  const [authModo, setAuthModo] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authSenha, setAuthSenha] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [authErro, setAuthErro] = useState('')
  const [authOcupado, setAuthOcupado] = useState(false)
  const [rascunho, setRascunho] = useState(null)
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false)
  const [formularioAtivo, setFormularioAtivo] = useState(null)
  const [somenteLeitura, setSomenteLeitura] = useState(false)
  const [respostas, setRespostas] = useState({})
  const [respostaIdPendente, setRespostaIdPendente] = useState(null)
  const [respostasRemotas, setRespostasRemotas] = useState([])
  const [erro, setErro] = useState('')
  const [jsonConteudo, setJsonConteudo] = useState(MODELO_JSON)
  const [jsonErro, setJsonErro] = useState('')
  const [jsonAberto, setJsonAberto] = useState(false)
  const [mensagemPartilha, setMensagemPartilha] = useState('')
  const [imagemQr, setImagemQr] = useState('')
  const [imagemQrPlataforma, setImagemQrPlataforma] = useState('')
  const [scannerAberto, setScannerAberto] = useState(false)
  const [codigoBusca, setCodigoBusca] = useState('')
  const [confirmandoAlteracoes, setConfirmandoAlteracoes] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const scannerVideo = useRef(null)
  const sincronizacaoRef = useRef(new Map())
  const jsonModo = 'substituir'
  const formularios = useLiveQuery(() => db.formularios.orderBy('atualizadoEm').reverse().toArray(), [])
  const todasRespostas = useLiveQuery(() => db.respostas.toArray(), [])
  const filaSincronizacao = useLiveQuery(() => db.filaApi.toArray(), []) ?? []
  const sincronizacoesPendentes = filaSincronizacao.filter((item) => !item.bloqueada).length
  const sincronizacoesRecusadas = filaSincronizacao.filter((item) => item.bloqueada).length
  const formulariosDaConta = conta
    ? (formularios ?? []).filter((formulario) => formulario.contaId === conta.id)
    : []
  const respostasDoFormulario = useLiveQuery(
    () => formularioAtivo
      ? db.respostas.where('formularioId').equals(formularioAtivo.id).toArray().then((items) => items.sort((a, b) => b.criadoEm - a.criadoEm))
      : [],
    [formularioAtivo?.id],
  )
  const respostasParaExibir = [...new Map(
    [...respostasRemotas, ...(respostasDoFormulario ?? [])].map((resposta) => [resposta.id, resposta]),
  ).values()].sort((a, b) => b.criadoEm - a.criadoEm)

  const contaId = conta?.id
  useEffect(() => {
    let cancelado = false
    Promise.resolve().then(async () => {
      const chave = `formularios-respondidos:${contaId ?? 'anonimo'}`
      let locais = []
      try {
        const armazenados = JSON.parse(window.localStorage.getItem(chave) ?? '[]')
        if (Array.isArray(armazenados)) locais = armazenados
      } catch (error) {
        if (!cancelado) setErro(`Não foi possível carregar o histórico local de respostas: ${error.message}`)
      }
      if (cancelado) return
      setQuestionariosRespondidos(locais)
      if (contaId) {
        try {
          const remotos = await requisitarApi('/api/conta/respondidos')
          if (!cancelado) setQuestionariosRespondidos(combinarRespondidos(remotos, locais))
        } catch (error) {
          if (!cancelado) setErro(`Não foi possível sincronizar os questionários respondidos: ${error.message}`)
        }
      }
    })
    return () => { cancelado = true }
  }, [contaId])

  useEffect(() => {
    let cancelado = false
    const logoutPendente = window.localStorage.getItem('lumys:logout-pendente')
    let contaEmCache = null
    let erroContaCache = ''
    try {
      contaEmCache = JSON.parse(window.localStorage.getItem('lumys:conta-cache') ?? 'null')
    } catch (error) {
      erroContaCache = `Não foi possível carregar a conta salva neste dispositivo: ${error.message}`
    }
    const verificarSessao = async () => {
      if (erroContaCache) setAuthErro(erroContaCache)
      if (logoutPendente) {
        if (navigator.onLine) {
          try {
            await requisitarApi('/api/auth/sair', { method: 'POST' })
            window.localStorage.removeItem('lumys:logout-pendente')
          } catch {
            if (!cancelado) setAuthCarregando(false)
            return
          }
        } else {
          setAuthCarregando(false)
          return
        }
      }
      if (!navigator.onLine) {
        if (contaEmCache) setConta(contaEmCache)
        return null
      }
      return requisitarApi('/api/auth/sessao')
    }

    verificarSessao()
      .then(async (sessao) => {
        if (cancelado || !sessao) return
        window.localStorage.setItem('lumys:conta-cache', JSON.stringify(sessao))
        setConta(sessao)
        try {
          await sincronizarFormulariosDaConta(sessao)
        } catch (error) {
          if (!cancelado) setErro(`Sessão ativa, mas não foi possível sincronizar os formulários: ${error.message}`)
        }
      })
      .catch((error) => {
        if (!cancelado && !error.status && contaEmCache) {
          setConta(contaEmCache)
        } else if (error.status !== 401 && !cancelado) {
          setAuthErro(`Não foi possível verificar a sessão: ${error.message}`)
        }
      })
      .finally(() => {
        if (!cancelado) setAuthCarregando(false)
      })
    return () => { cancelado = true }
  }, [])

  useEffect(() => {
    const sincronizarAoConectar = async () => {
      if (window.localStorage.getItem('lumys:logout-pendente')) {
        try {
          await requisitarApi('/api/auth/sair', { method: 'POST' })
          window.localStorage.removeItem('lumys:logout-pendente')
        } catch {
          return
        }
      }
      try {
        await sincronizarFilaApi(contaId)
      } catch (error) {
        setErro(`Não foi possível processar a fila offline: ${error.message}`)
      }
    }
    window.addEventListener('online', sincronizarAoConectar)
    window.addEventListener('focus', sincronizarAoConectar)
    document.addEventListener('visibilitychange', sincronizarAoConectar)
    const intervalo = window.setInterval(sincronizarAoConectar, 30_000)
    if (navigator.onLine) void sincronizarAoConectar()
    return () => {
      window.removeEventListener('online', sincronizarAoConectar)
      window.removeEventListener('focus', sincronizarAoConectar)
      document.removeEventListener('visibilitychange', sincronizarAoConectar)
      window.clearInterval(intervalo)
    }
  }, [contaId])

  const abrirFormularioPublico = useCallback(async (codigo, atualizarUrl = false) => {
    const codigoNormalizado = codigo.trim().toUpperCase()
    if (!/^[A-Z0-9]{8,16}$/.test(codigoNormalizado)) {
      setErro('Informe um código válido com 8 a 16 letras ou números.')
      setTela('inicio')
      return
    }
    setSomenteLeitura(false)
    setErro('')
    setTela('carregando')
    try {
      const formulario = await requisitarApi(`/api/formularios/${codigoNormalizado}`)
      const local = await db.formularios.where('codigo').equals(codigoNormalizado).first()
      const formularioEmCache = {
        ...local,
        ...formulario,
        contaId: local?.contaId,
        tokenProprietario: local?.tokenProprietario,
        publicada: true,
        publica: true,
      }
      await db.formularios.put(formularioEmCache)
      setFormularioAtivo(formularioEmCache)
      setRespostas({})
      setRespostaIdPendente(null)
      setCodigoBusca(codigoNormalizado)
      setTela('responder')
      if (atualizarUrl) {
        window.history.pushState(null, '', `#/form/${codigoNormalizado}`)
      }
    } catch (error) {
      const local = await db.formularios.where('codigo').equals(codigoNormalizado).first()
      if (local && (local.publicada || local.publica) && (!navigator.onLine || !error.status)) {
        setFormularioAtivo({ ...local, publica: true })
        setRespostas({})
        setRespostaIdPendente(null)
        setCodigoBusca(codigoNormalizado)
        setErro('Formulário aberto do dispositivo. A resposta será sincronizada quando a conexão voltar.')
        setTela('responder')
        if (atualizarUrl) window.history.pushState(null, '', `#/form/${codigoNormalizado}`)
        return
      }
      setErro(error instanceof Error ? error.message : 'Não foi possível encontrar o formulário.')
      setCodigoBusca(codigoNormalizado)
      setTela('inicio')
    }
  }, [])

  async function concluirAutenticacao(contaAutenticada) {
    window.localStorage.removeItem('lumys:logout-pendente')
    window.localStorage.setItem('lumys:conta-cache', JSON.stringify(contaAutenticada))
    setConta(contaAutenticada)
    setAuthSenha('')
    setAuthErro('')
    setErro('')
    setTela('lista')
    try {
      await sincronizarFormulariosDaConta(contaAutenticada)
      await sincronizarFilaApi(contaAutenticada.id)
    } catch (error) {
      setErro(`Login concluído, mas não foi possível sincronizar os formulários: ${error.message}`)
    }
  }

  async function enviarFormularioAuth(event) {
    event.preventDefault()
    setAuthOcupado(true)
    setAuthErro('')
    try {
      const contaAutenticada = await requisitarApi(`/api/auth/${authModo === 'cadastro' ? 'cadastro' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email: authEmail, senha: authSenha }),
      })
      await concluirAutenticacao(contaAutenticada)
    } catch (error) {
      setAuthErro(error instanceof Error ? error.message : 'Não foi possível autenticar.')
    } finally {
      setAuthOcupado(false)
    }
  }

  async function sairDaConta() {
    if (!conta) return
    if (tela === 'editar' && alteracoesPendentes &&
        !window.confirm('As alterações ainda não foram confirmadas. Deseja sair e descartá-las?')) return
    window.localStorage.setItem('lumys:logout-pendente', conta.id)
    window.localStorage.removeItem('lumys:conta-cache')
    for (const timeout of sincronizacaoRef.current.values()) window.clearTimeout(timeout)
    sincronizacaoRef.current.clear()
    setConta(null)
    setAbaInicio('meus')
    setTela('inicio')
    setRascunho(null)
    setFormularioAtivo(null)
    setAuthModo('login')
    setAuthErro('')
    setErro('')
    try {
      await requisitarApi('/api/auth/sair', { method: 'POST' })
      window.localStorage.removeItem('lumys:logout-pendente')
    } catch {
      setErro('Sessão encerrada neste dispositivo. O servidor encerrará a sessão quando a conexão voltar.')
    }
  }

  useEffect(() => {
    const sincronizacoesAtivas = sincronizacaoRef.current
    const abrirPelaUrl = () => {
      const codigo = codigoDaUrl()
      if (codigo) void abrirFormularioPublico(codigo)
      else {
        setFormularioAtivo(null)
        setTela('inicio')
      }
    }
    if (codigoDaUrl()) abrirPelaUrl()
    window.addEventListener('hashchange', abrirPelaUrl)
    return () => {
      window.removeEventListener('hashchange', abrirPelaUrl)
      for (const timeout of sincronizacoesAtivas.values()) window.clearTimeout(timeout)
      sincronizacoesAtivas.clear()
    }
  }, [abrirFormularioPublico])

  useEffect(() => {
    if (!scannerAberto || tela !== 'inicio') return undefined
    let encerrado = false
    let controles
    import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (encerrado) return
      const leitor = new BrowserQRCodeReader()
      return leitor.decodeFromVideoDevice(undefined, scannerVideo.current, (resultado, _erroLeitura, novosControles) => {
        controles = novosControles
        if (!resultado || encerrado) return
        const codigo = codigoDoQr(resultado.getText())
        if (!codigo) {
          setErro('O QR code não contém um link ou código de formulário válido.')
          return
        }
        encerrado = true
        controles?.stop()
        setScannerAberto(false)
        void abrirFormularioPublico(codigo, true)
      }).then((novosControles) => {
        if (encerrado) novosControles.stop()
        else controles = novosControles
      })
    }).catch((error) => {
      if (encerrado) return
      setScannerAberto(false)
      setErro(error instanceof Error ? `Não foi possível acessar a câmera: ${error.message}` : 'Não foi possível acessar a câmera.')
    })
    return () => {
      encerrado = true
      controles?.stop()
    }
  }, [abrirFormularioPublico, scannerAberto, tela])

  useEffect(() => {
    if (tela !== 'detalhes' || !formularioAtivo?.publicada) return
    let cancelado = false
    const link = `${window.location.origin}${window.location.pathname}#/form/${formularioAtivo.codigo}`
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(link, { width: 240, margin: 2 }))
      .then((imagem) => { if (!cancelado) setImagemQr(imagem) })
      .catch(() => { if (!cancelado) setErro('Não foi possível gerar o QR code.') })
    return () => { cancelado = true }
  }, [formularioAtivo, tela])

  useEffect(() => {
    if (tela !== 'perfil') return
    let cancelado = false
    const endereco = `${window.location.origin}${window.location.pathname}`
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(endereco, { width: 280, margin: 2 }))
      .then((imagem) => { if (!cancelado) setImagemQrPlataforma(imagem) })
      .catch(() => { if (!cancelado) setErro('Não foi possível gerar o QR code da plataforma.') })
    return () => { cancelado = true }
  }, [tela])

  async function agendarSincronizacao(formulario) {
    if (!formulario.publicada || !formulario.tokenProprietario) return
    window.clearTimeout(sincronizacaoRef.current.get(formulario.id))
    try {
      await enfileirarRequisicao({
        url: `/api/formularios/${formulario.codigo}`,
        method: 'PUT',
        headers: { 'x-owner-token': formulario.tokenProprietario },
        body: JSON.stringify({
          id: formulario.id,
          titulo: formulario.titulo,
          descricao: formulario.descricao,
          perguntas: formulario.perguntas,
          atualizadoEm: formulario.atualizadoEm,
        }),
        chave: `formulario-publico:${formulario.codigo}`,
      })
    } catch (error) {
      setErro(`Salvo neste dispositivo, mas não foi possível preparar a sincronização: ${error.message}`)
      return
    }
    const timeout = window.setTimeout(() => {
      sincronizacaoRef.current.delete(formulario.id)
      void sincronizarFilaApi(conta?.id)
    }, 700)
    sincronizacaoRef.current.set(formulario.id, timeout)
  }

  async function salvarFormulario(formulario) {
    const atualizado = prepararFormulario({ ...formulario, contaId: conta?.id ?? formulario.contaId })
    setRascunho(atualizado)
    setAlteracoesPendentes(true)
    setErro('')
  }

  async function confirmarAlteracoesFormulario() {
    if (!rascunho || confirmandoAlteracoes) return
    setConfirmandoAlteracoes(true)
    setErro('')
    const confirmado = prepararFormulario({ ...rascunho, contaId: conta?.id ?? rascunho.contaId })
    try {
      await db.formularios.put(confirmado)
    } catch (error) {
      setErro(`Não foi possível salvar as alterações neste dispositivo: ${error.message}`)
      setConfirmandoAlteracoes(false)
      return
    }

    setRascunho(confirmado)
    setAlteracoesPendentes(false)
    setFormularioAtivo(confirmado)
    setTela('detalhes')
    try {
      await agendarSincronizacao(confirmado)
      if (conta && confirmado.contaId === conta.id) {
        await enfileirarRequisicao({
          url: `/api/conta/formularios/${confirmado.id}`,
          method: 'PUT',
          body: JSON.stringify({ formulario: confirmado }),
          contaId: conta.id,
          chave: `formulario-conta:${confirmado.id}`,
        })
      }
      if (navigator.onLine) await sincronizarFilaApi(conta?.id)
      const contaPendente = conta
        ? await db.filaApi.where('chave').equals(`formulario-conta:${confirmado.id}`).first()
        : null
      const publicoPendente = confirmado.publicada
        ? await db.filaApi.where('chave').equals(`formulario-publico:${confirmado.codigo}`).first()
        : null
      const recusada = [contaPendente, publicoPendente].find((item) => item?.bloqueada)
      setErro(recusada
        ? `Alterações salvas neste dispositivo, mas a nuvem recusou a sincronização: ${recusada.ultimoErro}`
        : contaPendente || publicoPendente
          ? 'Alterações confirmadas neste dispositivo. A sincronização será concluída quando possível.'
          : '')
    } catch (error) {
      setErro(`Alterações confirmadas neste dispositivo, mas não foi possível preparar a sincronização: ${error.message}`)
    } finally {
      setConfirmandoAlteracoes(false)
    }
  }

  async function publicarFormulario(formulario = formularioAtivo) {
    if (!formulario || publicando) return
    if (!navigator.onLine) {
      setErro('Conecte-se à internet para publicar. O rascunho continua salvo na sua conta.')
      return
    }
    setPublicando(true)
    setErro('')
    const paraPublicar = prepararFormulario({
      ...formulario,
      contaId: conta?.id ?? formulario.contaId,
    })
    try {
      await requisitarApi(`/api/formularios/${paraPublicar.codigo}`, {
        method: 'PUT',
        headers: { 'x-owner-token': paraPublicar.tokenProprietario },
        body: JSON.stringify({
          id: paraPublicar.id,
          titulo: paraPublicar.titulo,
          descricao: paraPublicar.descricao,
          perguntas: paraPublicar.perguntas,
          atualizadoEm: paraPublicar.atualizadoEm,
        }),
      })
      const publicado = { ...paraPublicar, publicada: true }
      await db.formularios.put(publicado)
      setFormularioAtivo(publicado)
      setRascunho(publicado)
      if (conta && publicado.contaId === conta.id) {
        await enfileirarRequisicao({
          url: `/api/conta/formularios/${publicado.id}`,
          method: 'PUT',
          body: JSON.stringify({ formulario: publicado }),
          contaId: conta.id,
          chave: `formulario-conta:${publicado.id}`,
        })
        await sincronizarFilaApi(conta.id)
      }
      setErro('')
    } catch (error) {
      setErro(`Não foi possível publicar o formulário: ${error.message}`)
    } finally {
      setPublicando(false)
    }
  }

  async function criarFormulario() {
    const formulario = { ...novoFormulario(), contaId: conta?.id }
    await db.formularios.put(formulario)
    if (conta) {
      try {
        await enfileirarRequisicao({
          url: `/api/conta/formularios/${formulario.id}`,
          method: 'PUT',
          body: JSON.stringify({ formulario }),
          contaId: conta.id,
          chave: `formulario-conta:${formulario.id}`,
        })
        await sincronizarFilaApi(conta.id)
      } catch (error) {
        setErro(`Formulário salvo neste dispositivo, mas não foi possível preparar a sincronização: ${error.message}`)
      }
    }
    setRascunho(formulario)
    setAlteracoesPendentes(false)
    setTela('editar')
  }

  async function criarFormularioDoJson(event) {
    event.preventDefault()
    setJsonErro('')
    try {
      const importado = validarFormularioJson(jsonConteudo)
      const formulario = prepararFormulario({
        ...importado,
        id: rascunho.id,
        codigo: rascunho.codigo,
        tokenProprietario: rascunho.tokenProprietario,
        publicada: rascunho.publicada,
        contaId: conta?.id ?? rascunho.contaId,
        criadoEm: rascunho.criadoEm,
      })
      setRascunho(formulario)
      setAlteracoesPendentes(true)
      setErro('')
      setJsonAberto(false)
    } catch (error) {
      setJsonErro(error instanceof Error ? error.message : 'Não foi possível importar o formulário.')
    }
  }

  function abrirJson() {
    setJsonConteudo(MODELO_JSON)
    setJsonErro('')
    setJsonAberto(true)
  }

  async function editarFormulario(formulario) {
    if (!formulario?.id) {
      setErro('Este formulário não tem perguntas carregadas. Atualize a lista e tente editar novamente.')
      return
    }
    try {
      const local = await db.formularios.get(formulario.id)
      const candidatos = [formulario, local].filter((item) =>
        item && Array.isArray(item.perguntas) && item.perguntas.length > 0,
      )
      const completo = candidatos.sort(
        (a, b) => (b.atualizadoEm ?? 0) - (a.atualizadoEm ?? 0),
      )[0]
      if (!completo) {
        setErro('Este formulário não tem perguntas carregadas. Atualize a lista e tente editar novamente.')
        return
      }
      setRascunho(completo)
      setAlteracoesPendentes(false)
      setErro('')
      setTela('editar')
    } catch (error) {
      setErro(`Não foi possível carregar o formulário para edição: ${error.message}`)
    }
  }

  function abrirDetalhes(formulario) {
    setFormularioAtivo(formulario)
    setRespostasRemotas([])
    setErro('')
    setTela('detalhes')
    if (conta && formulario.contaId === conta.id) {
      void requisitarApi(`/api/conta/formularios/${formulario.id}/respostas`)
        .then(setRespostasRemotas).catch((error) => {
          setErro(`Não foi possível carregar as respostas sincronizadas: ${error.message}`)
      })
    }
  }

  async function excluirFormulario(formulario) {
    if (!window.confirm(`Excluir "${formulario.titulo}" e todas as respostas?`)) return
    try {
      if (formulario.publicada) {
        await enfileirarRequisicao({
          url: `/api/formularios/${formulario.codigo}`,
          method: 'DELETE',
          headers: { 'x-owner-token': formulario.tokenProprietario },
          chave: `excluir-publico:${formulario.codigo}`,
        })
      }
      if (conta && formulario.contaId === conta.id) {
        await enfileirarRequisicao({
          url: `/api/conta/formularios/${formulario.id}`,
          method: 'DELETE',
          contaId: conta.id,
          chave: `excluir-conta:${formulario.id}`,
        })
      }
    } catch (error) {
      setErro(`Não foi possível preparar a exclusão para sincronização: ${error.message}`)
      return
    }
    await db.transaction('rw', db.formularios, db.respostas, async () => {
      await db.formularios.delete(formulario.id)
      await db.respostas.where('formularioId').equals(formulario.id).delete()
    })
    if (formularioAtivo?.id === formulario.id) {
      setFormularioAtivo(null)
      setTela('lista')
    }
    setErro('')
    if (navigator.onLine) await sincronizarFilaApi(conta?.id)
  }

  function atualizarPergunta(id, alteracoes) {
    const formulario = {
      ...rascunho,
      perguntas: rascunho.perguntas.map((pergunta) =>
        pergunta.id === id
          ? {
              ...pergunta,
              ...alteracoes,
              ...(alteracoes.tipo === 'escala' ? {
                escalaMin: pergunta.escalaMin ?? 1,
                escalaMax: pergunta.escalaMax ?? 5,
                rotuloMin: pergunta.rotuloMin ?? '',
                rotuloMax: pergunta.rotuloMax ?? '',
              } : {}),
            }
          : pergunta,
      ),
    }
    void salvarFormulario(formulario)
  }

  async function removerPergunta(id) {
    await salvarFormulario({
      ...rascunho,
      perguntas: rascunho.perguntas.filter((pergunta) => pergunta.id !== id),
    })
  }

  async function adicionarPergunta() {
    await salvarFormulario({ ...rascunho, perguntas: [...rascunho.perguntas, novaPergunta()] })
  }

  function iniciarResposta(formulario, modoSomenteLeitura = false) {
    setFormularioAtivo(formulario)
    setRespostas({})
    setRespostaIdPendente(null)
    setSomenteLeitura(modoSomenteLeitura)
    setErro('')
    setTela('responder')
  }

  async function copiarLinkPublico(formulario = rascunho) {
    const link = `${window.location.origin}${window.location.pathname}#/form/${formulario.codigo}`
    try {
      await navigator.clipboard.writeText(link)
      setMensagemPartilha('Link copiado.')
    } catch {
      setErro('Não foi possível copiar o link. Copie o endereço exibido manualmente.')
    }
  }

  function buscarFormulario(event) {
    event.preventDefault()
    void abrirFormularioPublico(codigoBusca, true)
  }

  function iniciarScannerQr() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErro('A leitura por câmera exige HTTPS ou acesso local seguro e suporte à câmera neste navegador.')
      return
    }
    setErro('')
    setScannerAberto(true)
  }

  function atualizarResposta(id, valor) {
    setRespostaIdPendente(null)
    setRespostas((atuais) => ({ ...atuais, [id]: valor }))
  }

  async function enviarResposta(event) {
    event.preventDefault()
    if (somenteLeitura) return
    const faltando = formularioAtivo.perguntas.find((pergunta) => {
      if (!pergunta.obrigatoria) return false
      const resposta = respostas[pergunta.id]
      return Array.isArray(resposta) ? resposta.length === 0 : !String(resposta ?? '').trim()
    })
    if (faltando) {
      setErro(`Responda à pergunta obrigatória: ${faltando.titulo || 'Sem título'}.`)
      return
    }

    const resposta = {
      id: respostaIdPendente ?? crypto.randomUUID(),
      formularioId: formularioAtivo.id,
      respostas,
      criadoEm: Date.now(),
    }
    setRespostaIdPendente(resposta.id)
    try {
      await db.respostas.put(resposta)
      let chaveSync = ''
      if (formularioAtivo.publica || formularioAtivo.publicada) {
        chaveSync = `resposta-publica:${resposta.id}`
        await enfileirarRequisicao({
          url: `/api/formularios/${formularioAtivo.codigo}/respostas`,
          method: 'POST',
          body: JSON.stringify(resposta),
          contaId: conta?.id ?? null,
          chave: chaveSync,
        })
      } else if (conta && formularioAtivo.contaId === conta.id) {
        chaveSync = `resposta-conta:${resposta.id}`
        await enfileirarRequisicao({
          url: `/api/conta/formularios/${formularioAtivo.id}/respostas`,
          method: 'POST',
          body: JSON.stringify(resposta),
          contaId: conta.id,
          chave: chaveSync,
        })
      }
      if (navigator.onLine) await sincronizarFilaApi(conta?.id)
      const pendente = chaveSync ? await db.filaApi.where('chave').equals(chaveSync).first() : null
      setErro(pendente?.bloqueada
        ? `Resposta salva neste dispositivo, mas a API recusou a sincronização: ${pendente.ultimoErro}`
        : pendente
          ? 'Resposta salva neste dispositivo. Será sincronizada quando a conexão estiver disponível.'
          : '')
    } catch (error) {
      setErro(`Não foi possível salvar a resposta neste dispositivo: ${error.message}`)
      return
    }
    try {
      const chave = `formularios-respondidos:${conta?.id ?? 'anonimo'}`
      const respondido = {
        id: formularioAtivo.id,
        codigo: formularioAtivo.codigo,
        titulo: formularioAtivo.titulo,
        descricao: formularioAtivo.descricao,
        perguntas: formularioAtivo.perguntas,
        publica: true,
        respondidoEm: resposta.criadoEm,
        totalRespostas: 1,
      }
      const historico = JSON.parse(window.localStorage.getItem(chave) ?? '[]')
      const atualizados = combinarRespondidos(
        [respondido],
        Array.isArray(historico) ? historico : [],
      )
      window.localStorage.setItem(chave, JSON.stringify(atualizados))
      setQuestionariosRespondidos((atuais) => combinarRespondidos([respondido], atuais))
    } catch (error) {
      setErro(`Resposta registrada, mas não foi possível salvar o histórico neste dispositivo: ${error.message}`)
    }
    setRespostaIdPendente(null)
    setTela('enviado')
  }

  async function visualizarRespostas(formulario) {
    setFormularioAtivo(formulario)
    setRespostasRemotas([])
    setErro('')
    setTela('respostas')
    if (conta && formulario.contaId === conta.id) {
      try {
        const remotas = await requisitarApi(`/api/conta/formularios/${formulario.id}/respostas`)
        setRespostasRemotas(remotas)
      } catch (error) {
        setErro(`Não foi possível sincronizar as respostas compartilhadas: ${error.message}`)
      }
    }
  }

  function renderizarCampo(pergunta, somenteLeitura = false) {
    const valor = respostas[pergunta.id] ?? ''
    const nome = `pergunta-${pergunta.id}`

    if (pergunta.tipo === 'curta') {
      return <input className="answer-input" name={nome} value={valor} onChange={(event) => atualizarResposta(pergunta.id, event.target.value)} placeholder="Sua resposta" disabled={somenteLeitura} />
    }
    if (pergunta.tipo === 'paragrafo') {
      return <textarea className="answer-input answer-input--long" name={nome} value={valor} onChange={(event) => atualizarResposta(pergunta.id, event.target.value)} placeholder="Sua resposta" disabled={somenteLeitura} />
    }
    if (pergunta.tipo === 'escala') {
      const escalaMin = pergunta.escalaMin ?? 1
      const escalaMax = pergunta.escalaMax ?? 5
      const valorEscala = typeof valor === 'number' ? valor : escalaMin
      return (
        <div className="scale-control">
          <div className="scale-value" aria-live="polite">{typeof valor === 'number' ? valor : '—'}</div>
          <input
            className="scale-range"
            type="range"
            name={nome}
            min={escalaMin}
            max={escalaMax}
            step="1"
            value={valorEscala}
            onChange={(event) => atualizarResposta(pergunta.id, Number(event.target.value))}
            disabled={somenteLeitura}
            aria-label={`Avaliação de ${escalaMin} a ${escalaMax}`}
          />
          <div className="scale-endpoints">
            <span>{rotuloEscala(pergunta.rotuloMin, escalaMin)}</span>
            <span>{rotuloEscala(pergunta.rotuloMax, escalaMax)}</span>
          </div>
        </div>
      )
    }
    if (pergunta.tipo === 'data') {
      return <input className="answer-input" type="date" name={nome} value={valor} onChange={(event) => atualizarResposta(pergunta.id, event.target.value)} disabled={somenteLeitura} />
    }
    if (pergunta.tipo === 'lista') {
      return (
        <select className="answer-input" name={nome} value={valor} onChange={(event) => atualizarResposta(pergunta.id, event.target.value)} disabled={somenteLeitura}>
          <option value="">Selecione uma opção</option>
          {pergunta.opcoes.map((opcao, index) => <option key={`${pergunta.id}-${index}`} value={opcao}>{opcao || `Opção ${index + 1}`}</option>)}
        </select>
      )
    }

    const multipla = pergunta.tipo === 'multipla'
    return (
      <div className="answer-options">
        {pergunta.opcoes.map((opcao, index) => (
          <label className="answer-option" key={`${pergunta.id}-${index}`}>
            <input
              type={multipla ? 'radio' : 'checkbox'}
              name={nome}
              value={opcao}
              checked={multipla ? valor === opcao : Array.isArray(valor) && valor.includes(opcao)}
              disabled={somenteLeitura}
              onChange={(event) => {
                if (multipla) atualizarResposta(pergunta.id, event.target.value)
                else atualizarResposta(pergunta.id, event.target.checked
                  ? [...(Array.isArray(valor) ? valor : []), event.target.value]
                  : valor.filter((item) => item !== event.target.value))
              }}
            />
            <span>{opcao || `Opção ${index + 1}`}</span>
          </label>
        ))}
      </div>
    )
  }

  const confirmarSaidaDoEditor = () => {
    if (tela !== 'editar' || !alteracoesPendentes) return true
    const sair = window.confirm('As alterações ainda não foram confirmadas. Deseja sair e descartá-las?')
    if (sair) setAlteracoesPendentes(false)
    return sair
  }

  const voltarInicio = () => {
    if (!confirmarSaidaDoEditor()) return
    if (codigoDaUrl()) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    setScannerAberto(false)
    setTela('inicio')
    setErro('')
  }

  const abrirLista = () => {
    if (!confirmarSaidaDoEditor()) return
    if (codigoDaUrl()) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    setScannerAberto(false)
    setErro('')
    setTela('lista')
  }

  return (
      <AppLayout
        conta={conta}
        tela={tela}
        onHome={voltarInicio}
        onList={abrirLista}
        onProfile={() => {
          if (!confirmarSaidaDoEditor()) return
          setScannerAberto(false)
          setErro('')
          setTela('perfil')
        }}
        onLogout={() => void sairDaConta()}
      >
      {(sincronizacoesPendentes > 0 || sincronizacoesRecusadas > 0) && (
        <p
          className="app-sync-status"
          role="status"
          title={filaSincronizacao.filter((item) => item.bloqueada).map((item) => item.ultimoErro).filter(Boolean).join('\n')}
        >
          {sincronizacoesPendentes > 0 && (
            <span>{sincronizacoesPendentes} {sincronizacoesPendentes === 1 ? 'alteração aguardando sincronização' : 'alterações aguardando sincronização'}</span>
          )}
          {sincronizacoesPendentes > 0 && sincronizacoesRecusadas > 0 && ' · '}
          {sincronizacoesRecusadas > 0 && (
            <span>
              {sincronizacoesRecusadas} {sincronizacoesRecusadas === 1 ? 'alteração recusada pelo servidor' : 'alterações recusadas pelo servidor'}
              {filaSincronizacao.find((item) => item.bloqueada)?.ultimoErro && `: ${filaSincronizacao.find((item) => item.bloqueada).ultimoErro}`}
            </span>
          )}
        </p>
      )}

      {authCarregando && !['responder', 'enviado'].includes(tela) && (
        <section className="auth-page"><div className="auth-card"><p>Verificando sua sessão…</p></div></section>
      )}

      {!authCarregando && !conta && tela === 'lista' && (
        <section className="auth-page">
          <div className="auth-card">
            <div className="auth-mark"><img src="/lumys-logo.svg" alt="" /></div>
            <p className="eyebrow">{authModo === 'cadastro' ? 'COMECE A CRIAR' : 'BEM-VINDO DE VOLTA'}</p>
            <h1>{authModo === 'cadastro' ? 'Crie sua conta' : 'Entre na sua conta'}</h1>
            <form className="auth-form" onSubmit={(event) => void enviarFormularioAuth(event)}>
              <label htmlFor="auth-email">E-mail</label>
              <input id="auth-email" type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required maxLength="254" />
              <label htmlFor="auth-password">Senha</label>
              <div className="password-field">
                <input id="auth-password" type={senhaVisivel ? 'text' : 'password'} autoComplete={authModo === 'cadastro' ? 'new-password' : 'current-password'} value={authSenha} onChange={(event) => setAuthSenha(event.target.value)} required minLength={authModo === 'cadastro' ? 6 : undefined} maxLength="72" />
                <button
                  className="password-visibility"
                  type="button"
                  aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={senhaVisivel}
                  onClick={() => setSenhaVisivel((visivel) => !visivel)}
                >
                  {senhaVisivel ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.6 4.5 9.5 6-.4.7-1.4 2.1-3.3 3.5M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.3.6 1.5 2.2 3.5 3.6A10.5 10.5 0 0012 17c.7 0 1.4-.1 2-.2"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.3-7 9.5-7 9.5 7 9.5 7-3.3 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
              {authModo === 'cadastro' && <span className="auth-hint">Use uma senha com pelo menos 6 caracteres.</span>}
              {authErro && <p className="form-error" role="alert">{authErro}</p>}
              <button className="button button--primary auth-submit" type="submit" disabled={authOcupado}>{authOcupado ? 'Aguarde…' : authModo === 'cadastro' ? 'Criar conta' : 'Entrar'}</button>
            </form>
            <button className="auth-switch" type="button" onClick={() => { setAuthErro(''); setAuthModo(authModo === 'cadastro' ? 'login' : 'cadastro') }}>
              {authModo === 'cadastro' ? 'Já tem uma conta? Entrar' : 'Ainda não tem conta? Criar conta'}
            </button>
          </div>
        </section>
      )}

      {tela === 'perfil' && <ProfilePage conta={conta} erro={erro} imagemQr={imagemQrPlataforma} onBack={voltarInicio} />}

      {!authCarregando && tela === 'inicio' && (
        <HomePage
          codigoBusca={codigoBusca}
          setCodigoBusca={setCodigoBusca}
          erro={erro}
          scannerAberto={scannerAberto}
          scannerVideo={scannerVideo}
          onSubmit={buscarFormulario}
          onScan={iniciarScannerQr}
          onCloseScanner={() => setScannerAberto(false)}
        />
      )}

      {conta && tela === 'lista' && (
        <ListPage
          abaInicio={abaInicio}
          setAbaInicio={setAbaInicio}
          formulariosDaConta={formulariosDaConta}
          questionariosRespondidos={questionariosRespondidos}
          todasRespostas={todasRespostas}
          erro={erro}
          onCreate={() => void criarFormulario()}
          onOpenDetails={abrirDetalhes}
          onEdit={editarFormulario}
          onAnswer={iniciarResposta}
          onResults={visualizarRespostas}
          onDelete={excluirFormulario}
        />
      )}

      {tela === 'carregando' && (
        <section className="lookup-page"><div className="lookup-card"><p>Carregando formulário…</p></div></section>
      )}

      {conta && tela === 'detalhes' && formularioAtivo && (
        <DetailsPage
          formulario={formularioAtivo}
          respostasRemotas={respostasRemotas}
          todasRespostas={todasRespostas}
          tipos={TIPOS}
          erro={erro}
          imagemQr={imagemQr}
          mensagemPartilha={mensagemPartilha}
          publicando={publicando}
          onHome={abrirLista}
          onPreview={() => iniciarResposta(formularioAtivo, true)}
          onAnswer={() => iniciarResposta(formularioAtivo)}
          onPublish={() => void publicarFormulario(formularioAtivo)}
          onResults={() => void visualizarRespostas(formularioAtivo)}
          onEdit={() => editarFormulario(formularioAtivo)}
          onDelete={() => void excluirFormulario(formularioAtivo)}
          onCopyLink={() => void copiarLinkPublico(formularioAtivo)}
        />
      )}

      {conta && tela === 'json' && jsonAberto && (
        <section className="json-page">
          <button className="back-button-quiet back-button" type="button" onClick={() => jsonModo === 'substituir' ? setTela('editar') : abrirLista()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
            Voltar
          </button>
          <div className="json-intro">
            <p className="eyebrow">{jsonModo === 'substituir' ? 'EDIÇÃO AUTOMATIZADA' : 'CRIAÇÃO AUTOMATIZADA'}</p>
            <h1>{jsonModo === 'substituir' ? 'Importar JSON para este formulário' : 'Criar formulário via JSON'}</h1>
            <p>{jsonModo === 'substituir'
              ? 'Cole o JSON para atualizar o título, a descrição e as perguntas deste formulário.'
              : 'Cole um objeto JSON para gerar o formulário e suas perguntas automaticamente.'}</p>
          </div>
          <form className="json-form" onSubmit={(event) => void criarFormularioDoJson(event)}>
            <div className="json-editor-heading">
              <label htmlFor="form-json">Estrutura do formulário</label>
              <button className="json-reset" type="button" onClick={() => { setJsonConteudo(MODELO_JSON); setJsonErro('') }}>Restaurar exemplo</button>
            </div>
            <textarea
              id="form-json"
              className="json-textarea"
              spellCheck="false"
              value={jsonConteudo}
              onChange={(event) => { setJsonConteudo(event.target.value); setJsonErro('') }}
              aria-describedby={jsonErro ? 'json-error' : 'json-help'}
            />
            {jsonErro
              ? <p className="json-error" id="json-error" role="alert">{jsonErro}</p>
              : <p className="json-help" id="json-help">Tipos aceitos: curta, paragrafo, multipla, caixas, lista, escala e data. Perguntas de escolha precisam ter pelo menos duas opções.</p>}
            {jsonModo === 'substituir' && (
              <p className="json-warning">As perguntas atuais serão substituídas. As respostas já recebidas serão mantidas, mas podem não corresponder às novas perguntas.</p>
            )}
            <div className="json-actions">
              <button className="button button--quiet" type="button" onClick={() => jsonModo === 'substituir' ? setTela('editar') : abrirLista()}>Cancelar</button>
              <button className="button button--primary" type="submit">{jsonModo === 'substituir' ? 'Importar para este formulário' : 'Criar formulário'}</button>
            </div>
          </form>
          <aside className="json-schema">
            <h2>Formato esperado</h2>
            <pre>{`{
  "titulo": "Título do formulário",
  "descricao": "Descrição opcional",
  "perguntas": [
    {
      "titulo": "Texto da pergunta",
      "tipo": "multipla",
      "obrigatoria": true,
      "opcoes": ["Opção 1", "Opção 2"]
    }
  ]
}`}</pre>
            <p>Os campos <code>titulo</code> e <code>descricao</code> do formulário são opcionais. Para perguntas de escala, você pode informar <code>escalaMin</code>, <code>escalaMax</code>, <code>rotuloMin</code> e <code>rotuloMax</code> (padrão: 1 a 5). Para resposta curta, parágrafo ou data, o campo <code>opcoes</code> não é necessário.</p>
          </aside>
        </section>
      )}

      {conta && tela === 'editar' && rascunho && (
        <section className="editor-page">
          <div className="editor-toolbar">
            <button className="back-button-quiet" type="button" onClick={abrirLista}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
              Voltar
            </button>
            <span className={`save-status${erro ? ' save-status--error' : ''}`} role={erro ? 'alert' : undefined}>
              {erro || (alteracoesPendentes ? 'Alterações aguardando confirmação' : 'Sem alterações pendentes')}
            </span>
            <div className="editor-toolbar-actions">
              <button className="button button--small button--quiet" type="button" onClick={abrirJson} title="Importar formulário">Importar</button>
              <button className="button button--small button--primary" type="button" onClick={() => void confirmarAlteracoesFormulario()} disabled={confirmandoAlteracoes} title="Confirmar alterações">
                {confirmandoAlteracoes ? 'Confirmando…' : 'Confirmar'}
              </button>
            </div>
          </div>
          <div className="editor-layout">
            <div className="editor-main">
              <section className="editor-card form-title-card">
                <div className="title-accent" />
                <input className="form-title-input" aria-label="Título do formulário" value={rascunho.titulo} onChange={(event) => void salvarFormulario({ ...rascunho, titulo: event.target.value })} placeholder="Título do formulário" />
                <textarea className="form-description-input" aria-label="Descrição do formulário" value={rascunho.descricao} onChange={(event) => void salvarFormulario({ ...rascunho, descricao: event.target.value })} placeholder="Descrição do formulário" rows="2" />
              </section>
              {rascunho.perguntas.map((pergunta, index) => (
                <section className="editor-card question-card" key={pergunta.id}>
                  <div className="question-topline">
                    <span className="question-number">Pergunta {index + 1}</span>
                    <label className="type-select-label">
                      <span className="visually-hidden">Tipo da pergunta {index + 1}</span>
                      <select value={pergunta.tipo} onChange={(event) => atualizarPergunta(pergunta.id, { tipo: event.target.value })}>
                        {TIPOS.map((tipo) => <option key={tipo.value} value={tipo.value}>{tipo.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="question-title-row">
                    <input className="question-title-input" aria-label={`Texto da pergunta ${index + 1}`} value={pergunta.titulo} onChange={(event) => atualizarPergunta(pergunta.id, { titulo: event.target.value })} placeholder="Pergunta sem título" />
                    <span className="required-mark" aria-hidden="true">{pergunta.obrigatoria ? '*' : ''}</span>
                  </div>
                  {['multipla', 'caixas', 'lista'].includes(pergunta.tipo) && (
                    <div className="choice-editor">
                      {pergunta.opcoes.map((opcao, optionIndex) => (
                        <div className="choice-row" key={`${pergunta.id}-${optionIndex}`}>
                          <span className={`choice-icon choice-icon--${pergunta.tipo}`} />
                          <input aria-label={`Opção ${optionIndex + 1}`} value={opcao} onChange={(event) => {
                            const opcoes = [...pergunta.opcoes]
                            opcoes[optionIndex] = event.target.value
                            atualizarPergunta(pergunta.id, { opcoes })
                          }} />
                          {pergunta.opcoes.length > 2 && <button className="choice-remove" type="button" aria-label={`Remover opção ${optionIndex + 1}`} onClick={() => atualizarPergunta(pergunta.id, { opcoes: pergunta.opcoes.filter((_, i) => i !== optionIndex) })}>×</button>}
                        </div>
                      ))}
                      <button className="add-option" type="button" onClick={() => atualizarPergunta(pergunta.id, { opcoes: [...pergunta.opcoes, `Opção ${pergunta.opcoes.length + 1}`] })}>+ Adicionar opção</button>
                    </div>
                  )}
                  {pergunta.tipo === 'escala' && (
                    <div className="scale-editor">
                      <div className="scale-editor-numbers">
                        <label>
                          <span>Valor mínimo</span>
                          <input type="number" min="0" max="99" value={pergunta.escalaMin ?? 1} onChange={(event) => {
                            const escalaMin = Math.min(Math.max(Number(event.target.value), 0), (pergunta.escalaMax ?? 5) - 1)
                            atualizarPergunta(pergunta.id, { escalaMin })
                          }} />
                        </label>
                        <label>
                          <span>Valor máximo</span>
                          <input type="number" min="1" max="100" value={pergunta.escalaMax ?? 5} onChange={(event) => {
                            const escalaMax = Math.min(Math.max(Number(event.target.value), (pergunta.escalaMin ?? 1) + 1), 100)
                            atualizarPergunta(pergunta.id, { escalaMax })
                          }} />
                        </label>
                      </div>
                      <div className="scale-editor-labels">
                        <input aria-label="Rótulo do valor mínimo" value={['Insatisfeito', 'Satisfeito'].includes(pergunta.rotuloMin) ? '' : pergunta.rotuloMin ?? ''} onChange={(event) => atualizarPergunta(pergunta.id, { rotuloMin: event.target.value })} placeholder="Mínimo (opcional)" />
                        <input aria-label="Rótulo do valor máximo" value={['Insatisfeito', 'Satisfeito'].includes(pergunta.rotuloMax) ? '' : pergunta.rotuloMax ?? ''} onChange={(event) => atualizarPergunta(pergunta.id, { rotuloMax: event.target.value })} placeholder="Máximo (opcional)" />
                      </div>
                      <div className="scale-preview">
                        <span>{rotuloEscala(pergunta.rotuloMin, pergunta.escalaMin ?? 1)}</span>
                        <input type="range" min={pergunta.escalaMin ?? 1} max={pergunta.escalaMax ?? 5} value={pergunta.escalaMin ?? 1} disabled tabIndex={-1} aria-label="Prévia da escala" />
                        <span>{rotuloEscala(pergunta.rotuloMax, pergunta.escalaMax ?? 5)}</span>
                      </div>
                    </div>
                  )}
                  {['curta', 'paragrafo'].includes(pergunta.tipo) && <div className={`answer-placeholder${pergunta.tipo === 'paragrafo' ? ' answer-placeholder--long' : ''}`}>Resposta curta</div>}
                  {pergunta.tipo === 'data' && <div className="answer-placeholder">Dia / mês / ano</div>}
                  <div className="question-footer">
                    <label className="required-toggle">
                      <input type="checkbox" checked={pergunta.obrigatoria} onChange={(event) => atualizarPergunta(pergunta.id, { obrigatoria: event.target.checked })} />
                      <span>Obrigatória</span>
                    </label>
                    <button className="delete-question" type="button" onClick={() => void removerPergunta(pergunta.id)} disabled={rascunho.perguntas.length === 1}>Excluir pergunta</button>
                  </div>
                </section>
              ))}
              <button className="add-question" type="button" onClick={() => void adicionarPergunta()}>+ Adicionar pergunta</button>
            </div>
          </div>
        </section>
      )}

      {(tela === 'responder' || tela === 'enviado') && formularioAtivo && (
        <AnswerPage
          formulario={formularioAtivo}
          enviado={tela === 'enviado'}
          erro={erro}
          renderizarCampo={renderizarCampo}
          somenteLeitura={somenteLeitura}
          onBack={() => conta ? abrirLista() : voltarInicio()}
          onSubmit={(event) => void enviarResposta(event)}
          onAnsweredHistory={() => {
            setAbaInicio(conta ? 'respondidos' : 'meus')
            setTela(conta ? 'lista' : 'respondidos')
          }}
        />
      )}

      {!conta && tela === 'respondidos' && (
        <section className="home-page">
          <button className="back-button-quiet" type="button" onClick={voltarInicio}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
            Voltar
          </button>
          {erro && <p className="form-error home-error" role="alert">{erro}</p>}
          <div className="section-heading">
            <h1>Questionários respondidos</h1>
            <span>Salvos neste dispositivo</span>
          </div>
          {questionariosRespondidos.length ? (
            <div className="form-grid">
              {questionariosRespondidos.map((formulario) => (
                <article className="form-card" key={formulario.codigo}>
                  <div className="form-card-art"><span>✓</span></div>
                  <div className="form-card-body">
                    <h3>{formulario.titulo || 'Questionário sem título'}</h3>
                    <p>{formulario.descricao || 'Sem descrição'}</p>
                    <div className="form-card-meta"><span>Respondido em {new Date(formulario.respondidoEm).toLocaleDateString('pt-BR')}</span></div>
                    <div className="form-card-actions">
                      <button className="button button--small button--quiet" type="button" onClick={() => iniciarResposta(formulario)}>Responder novamente</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-home">
              <div className="empty-illustration"><span>✓</span></div>
              <h2>Nenhum questionário respondido neste dispositivo</h2>
              <p>Respostas sem login ficam visíveis somente neste navegador.</p>
            </div>
          )}
        </section>
      )}

      {conta && tela === 'respostas' && formularioAtivo && (
        <Suspense fallback={<section className="responses-page"><p>Carregando resultados…</p></section>}>
          <ResultsPage
            formulario={formularioAtivo}
            respostas={respostasParaExibir}
            erro={erro}
            tipos={TIPOS}
            rotuloEscala={rotuloEscala}
            agruparRespostasPorDia={agruparRespostasPorDia}
            contarOpcoes={contarOpcoes}
            GraficoBarras={GraficoBarras}
            onBack={abrirLista}
          />
        </Suspense>
      )}

      {jsonAberto && tela === 'editar' && (
        <div className="json-modal-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setJsonAberto(false)
        }}>
          <section className="json-modal" role="dialog" aria-modal="true" aria-labelledby="json-modal-title">
            <div className="json-modal-heading">
              <h2 id="json-modal-title">Importar JSON</h2>
              <button className="json-modal-close" type="button" aria-label="Fechar" onClick={() => setJsonAberto(false)}>×</button>
            </div>
            <form onSubmit={(event) => void criarFormularioDoJson(event)}>
              <textarea
                className="json-textarea"
                aria-label="JSON do formulário"
                placeholder="Cole aqui o JSON do formulário"
                spellCheck="false"
                value={jsonConteudo}
                onChange={(event) => { setJsonConteudo(event.target.value); setJsonErro('') }}
                aria-describedby={jsonErro ? 'json-error' : undefined}
                autoFocus
              />
              {jsonErro && <p className="json-error" id="json-error" role="alert">{jsonErro}</p>}
              <div className="json-actions">
                <button className="button button--quiet" type="button" onClick={() => setJsonAberto(false)}>Cancelar</button>
                <button className="button button--primary" type="submit">Importar</button>
              </div>
            </form>
          </section>
        </div>
      )}

    </AppLayout>
  )
}

export default App
