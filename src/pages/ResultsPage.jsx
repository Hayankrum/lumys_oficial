import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const CORES_GRAFICO = ['#1b3a3a', '#3d6b5a', '#6f9d83', '#a8c9b2', '#d2e5d7', '#bd7624', '#d99b55']

function exportarCsv(formulario, respostas) {
  const protegerFormula = (valor) => {
    const texto = String(valor ?? '')
    return /^[=+\-@]/.test(texto.trimStart()) ? `'${texto}` : texto
  }
  const escaparCsv = (valor) => `"${protegerFormula(valor).replaceAll('"', '""')}"`
  const linhas = [
    ['Data da resposta', ...formulario.perguntas.map((pergunta, index) => pergunta.titulo || `Pergunta ${index + 1}`)],
    ...respostas.map((registro) => [
      new Date(registro.criadoEm).toLocaleString('pt-BR'),
      ...formulario.perguntas.map((pergunta) => {
        const resposta = registro.respostas[pergunta.id]
        return Array.isArray(resposta) ? resposta.join(', ') : resposta ?? ''
      }),
    ]),
  ]
  const conteudo = `\uFEFF${linhas.map((linha) => linha.map(escaparCsv).join(';')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  const nome = (formulario.titulo || 'resultados')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
  link.href = url
  link.download = `${nome || 'resultados'}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function GraficoResultado({ dados, tipo }) {
  const altura = Math.max(220, Math.min(340, dados.length * 38))

  if (tipo === 'rosca') {
    return (
      <div className="result-donut-layout">
        <div className="result-donut">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={dados} dataKey="quantidade" nameKey="rotulo" innerRadius={58} outerRadius={88} paddingAngle={2}>
                {dados.map((item, index) => (
                  <Cell key={`${item.rotulo}-${index}`} fill={CORES_GRAFICO[index % CORES_GRAFICO.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(valor, _nome, item) => [valor, item.payload.rotulo]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="result-donut-legend">
          {dados.map((item, index) => (
            <div className="result-donut-legend-item" key={`${item.rotulo}-${index}`}>
              <span style={{ backgroundColor: CORES_GRAFICO[index % CORES_GRAFICO.length] }} />
              <span title={item.rotulo}>{item.rotulo}</span>
              <strong>{item.quantidade}</strong>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="result-plot" style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        {tipo === 'linhas' ? (
          <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#e5f0ea" strokeDasharray="3 3" />
            <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} width={32} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="quantidade" name="Respostas" stroke="#1b3a3a" strokeWidth={3} dot={{ r: 4 }} />
          </LineChart>
        ) : (
          <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#e5f0ea" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="rotulo" width={130} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="quantidade" name="Respostas" fill="#1b3a3a" radius={[0, 5, 5, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export default function ResultsPage({
  formulario,
  ehDono = false,
  respostas,
  erro,
  tipos,
  rotuloEscala,
  agruparRespostasPorDia,
  contarOpcoes,
  GraficoBarras,
}) {
  const [tipoGrafico, setTipoGrafico] = useState('barras')
  const temPerguntasQuantitativas = formulario.perguntas.some((pergunta) =>
    ['multipla', 'caixas', 'lista', 'data', 'escala'].includes(pergunta.tipo),
  )

  return (
    <section className="responses-page">
      {ehDono && respostas.length > 0 && (
        <div className="responses-toolbar">
          <button className="button button--small button--quiet" type="button" onClick={() => exportarCsv(formulario, respostas)}>
            Exportar CSV
          </button>
        </div>
      )}
      <div className="responses-heading">
        <p className="eyebrow">PAINEL DE RESULTADOS</p>
        <h1>{formulario.titulo}</h1>
        <p>{respostas.length === 1 ? '1 resposta recebida' : `${respostas.length} respostas recebidas`}</p>
      </div>
      {erro && <p className="form-error" role="alert">{erro}</p>}
      {respostas.length ? (
        <>
          <div className="results-summary">
            <article className="summary-card">
              <span className="summary-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9m7 10V5m7 14v-7" /></svg></span>
              <span className="summary-label">Respostas recebidas</span>
              <strong>{respostas.length}</strong>
            </article>
            <article className="summary-card">
              <span className="summary-icon summary-icon--green">✓</span>
              <span className="summary-label">Perguntas no formulário</span>
              <strong>{formulario.perguntas.length}</strong>
            </article>
            <article className="summary-card">
              <span className="summary-icon summary-icon--orange">◷</span>
              <span className="summary-label">Última resposta</span>
              <strong className="summary-date">{new Date(respostas[0].criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
            </article>
          </div>

          <article className="results-chart-card timeline-card">
            <div className="chart-heading">
              <div>
                <h2>Respostas ao longo do tempo</h2>
                <p>Quantidade de envios por dia</p>
              </div>
              <span className="chart-legend"><i /> Respostas</span>
            </div>
            <GraficoBarras dados={agruparRespostasPorDia(respostas)} total={respostas.length} />
          </article>

          <div className="results-section-heading">
            <h2 className="results-section-title">Resultados por pergunta</h2>
            {temPerguntasQuantitativas && (
              <label className="chart-type-control">
                <span>Visualizar como</span>
                <select value={tipoGrafico} onChange={(event) => setTipoGrafico(event.target.value)}>
                  <option value="barras">Barras</option>
                  <option value="linhas">Linhas</option>
                  <option value="rosca">Rosca</option>
                </select>
              </label>
            )}
          </div>
          <div className="results-question-list">
            {formulario.perguntas.map((pergunta, index) => {
              const respostasDaPergunta = respostas.filter((registro) => {
                const resposta = registro.respostas[pergunta.id]
                return Array.isArray(resposta) ? resposta.length > 0 : Boolean(String(resposta ?? '').trim())
              })
              const tipoDeEscolha = ['multipla', 'caixas', 'lista', 'data', 'escala'].includes(pergunta.tipo)
              const dados = tipoDeEscolha ? contarOpcoes(pergunta, respostas) : []
              const respostasAbertas = respostasDaPergunta.map((registro) => registro.respostas[pergunta.id])
              const escalaMin = pergunta.escalaMin ?? 1
              const escalaMax = pergunta.escalaMax ?? 5
              const mediaEscala = pergunta.tipo === 'escala' && respostasDaPergunta.length
                ? respostasDaPergunta.reduce((soma, registro) => soma + registro.respostas[pergunta.id], 0) / respostasDaPergunta.length
                : null
              return (
                <article className="results-chart-card question-result-card" key={pergunta.id}>
                  <div className="chart-heading">
                    <div>
                      <span className="question-number">Pergunta {index + 1}</span>
                      <h2>{pergunta.titulo || `Pergunta ${index + 1}`}</h2>
                      <p>{tipos.find((tipo) => tipo.value === pergunta.tipo)?.label}</p>
                    </div>
                    <span className="answer-count">{respostasDaPergunta.length} {respostasDaPergunta.length === 1 ? 'resposta' : 'respostas'}</span>
                  </div>
                  {!respostasDaPergunta.length ? (
                    <p className="no-question-answers">Ainda não há respostas para esta pergunta.</p>
                  ) : tipoDeEscolha ? (
                    <>
                      {pergunta.tipo === 'escala' && (
                        <div className="scale-result-summary">
                          <span>Média da escala</span>
                          <strong>{mediaEscala.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
                          <span>de {escalaMin} a {escalaMax}</span>
                        </div>
                      )}
                      {pergunta.tipo === 'escala' && (
                        <div className="scale-result-labels">
                          <span>{rotuloEscala(pergunta.rotuloMin, escalaMin)}</span>
                          <span>{rotuloEscala(pergunta.rotuloMax, escalaMax)}</span>
                        </div>
                      )}
                      <GraficoResultado dados={dados} tipo={tipoGrafico} />
                      {pergunta.tipo === 'caixas' && <p className="chart-footnote">Cada pessoa pode selecionar mais de uma opção; os percentuais podem somar mais de 100%.</p>}
                    </>
                  ) : (
                    <div className="open-answer-list">
                      {respostasAbertas.map((resposta, respostaIndex) => (
                        <p key={`${respostasDaPergunta[respostaIndex].id}-${pergunta.id}`}>{Array.isArray(resposta) ? resposta.join(', ') : resposta}</p>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          <details className="all-responses">
            <summary>Ver respostas individuais</summary>
            <div className="responses-list">
              {respostas.map((registro, index) => (
                <article className="response-card" key={registro.id}>
                  <h2>Resposta {respostas.length - index}</h2>
                  {formulario.perguntas.map((pergunta, questionIndex) => {
                    const resposta = registro.respostas[pergunta.id]
                    return (
                      <div className="response-answer" key={pergunta.id}>
                        <h3>{pergunta.titulo || `Pergunta ${questionIndex + 1}`}</h3>
                        <p>{Array.isArray(resposta) ? resposta.join(', ') : resposta || 'Sem resposta'}</p>
                      </div>
                    )
                  })}
                  <time>{new Date(registro.criadoEm).toLocaleString('pt-BR')}</time>
                </article>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="empty-responses">
          <span><img src="/lumys-mark.svg" alt="" /></span>
          <h2>Seus gráficos aparecerão aqui</h2>
          <p>Assim que alguém responder, você verá os resultados por pergunta e a evolução das respostas.</p>
        </div>
      )}
    </section>
  )
}
