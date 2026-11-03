export default function AnswerPage({
  formulario,
  enviado,
  erro,
  renderizarCampo,
  somenteLeitura = false,
  onBack,
  onSubmit,
  onAnsweredHistory,
}) {
  return (
    <section className="respond-page">
      <button className="back-button-quiet back-button" type="button" onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        Voltar
      </button>
      {enviado ? (
        <div className="submitted-card">
          <span className="submitted-mark">✓</span>
          <h1>Resposta registrada</h1>
          <p>Obrigado por preencher “{formulario.titulo}”.</p>
          {erro && <p className="form-error" role="alert">{erro}</p>}
          <div className="submitted-actions">
            <button className="button button--primary" type="button" onClick={onAnsweredHistory}>Ver questionários respondidos</button>
            <button className="back-button-quiet" type="button" onClick={onBack}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <form className="respond-form" onSubmit={somenteLeitura ? (event) => event.preventDefault() : onSubmit}>
          <div className="respond-heading">
            <div className="title-accent" />
            <h1>{formulario.titulo || 'Questionário sem título'}</h1>
            {formulario.descricao && <p>{formulario.descricao}</p>}
            {somenteLeitura
              ? <p className="preview-hint">Pré-visualização — suas respostas não serão enviadas.</p>
              : <p className="required-hint">* Indica uma pergunta obrigatória</p>}
          </div>
          {formulario.perguntas.map((pergunta, index) => (
            <section className="respond-question" key={pergunta.id}>
              <h2>{pergunta.titulo || `Pergunta ${index + 1}`}{pergunta.obrigatoria && <span className="required-mark"> *</span>}</h2>
              {renderizarCampo(pergunta, somenteLeitura)}
            </section>
          ))}
          {!somenteLeitura && erro && <p className="form-error" role="alert">{erro}</p>}
          {!somenteLeitura && <button className="button button--primary submit-button" type="submit">Enviar resposta</button>}
        </form>
      )}
    </section>
  )
}
