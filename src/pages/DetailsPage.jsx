export default function DetailsPage({
  formulario,
  respostasRemotas,
  todasRespostas,
  tipos,
  erro,
  imagemQr,
  mensagemPartilha,
  publicando,
  onHome,
  onPreview,
  onAnswer,
  onPublish,
  onResults,
  onEdit,
  onCopyLink,
  onDelete,
}) {
  const totalRespostas = Math.max(
    formulario.respostasCount ?? 0,
    new Set([
      ...respostasRemotas,
      ...(todasRespostas ?? []).filter((item) => item.formularioId === formulario.id),
    ].map((item) => item.id)).size,
  )

  return (
    <section className="detail-page">
      <div className="detail-toolbar">
        <button className="back-button-quiet" type="button" onClick={onHome}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
          Voltar
        </button>
        <div className="detail-toolbar-actions">
          <button className="button button--small button--quiet detail-action" type="button" onClick={onPreview}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.3-7 9.5-7 9.5 7 9.5 7-3.3 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            Visualizar
          </button>
          <button className="button button--small button--quiet detail-action" type="button" onClick={onResults}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9m7 10V5m7 14v-7" /></svg>
            Resultados
          </button>
          <button className="button button--small button--primary detail-action" type="button" onClick={onEdit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></svg>
            Editar
          </button>
          <button className="button button--small detail-action detail-delete" type="button" aria-label={`Excluir ${formulario.titulo}`} onClick={onDelete}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>
            Excluir
          </button>
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="detail-overview">
            <p className="eyebrow">DETALHES DO QUESTIONÁRIO</p>
            <h1>{formulario.titulo || 'Questionário sem título'}</h1>
            <p className="detail-description">{formulario.descricao || 'Este questionário não tem descrição.'}</p>
            {formulario.publicada ? (
              <button className="button button--primary detail-answer-button" type="button" onClick={onAnswer}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                Responder formulário
              </button>
            ) : (
              <button className="button button--primary detail-answer-button" type="button" onClick={onPublish} disabled={publicando}>
                {publicando ? 'Publicando…' : 'Publicar formulário'}
              </button>
            )}
            <div className="detail-stats">
              <div><strong>{formulario.perguntas.length}</strong><span>{formulario.perguntas.length === 1 ? 'pergunta' : 'perguntas'}</span></div>
              <div><strong>{totalRespostas}</strong><span>respostas recebidas</span></div>
              <div><strong>{formulario.publicada ? 'Publicado' : 'Rascunho'}</strong><span>{formulario.publicada ? 'visível por código e link' : 'somente neste dispositivo'}</span></div>
            </div>
          </section>

          {erro && <p className="form-error detail-error" role="alert">{erro}</p>}

          <section className="detail-questions">
            <div className="detail-section-heading">
              <div><h2>Perguntas</h2><p>Conteúdo e formato das respostas</p></div>
              <span>{formulario.perguntas.length}</span>
            </div>
            {formulario.perguntas.map((pergunta, index) => (
              <article className="detail-question" key={pergunta.id}>
                <div className="detail-question-number">{String(index + 1).padStart(2, '0')}</div>
                <div className="detail-question-content">
                  <h3>{pergunta.titulo || `Pergunta ${index + 1}`}</h3>
                  <div className="detail-question-meta">
                    <span>{tipos.find((tipo) => tipo.value === pergunta.tipo)?.label ?? pergunta.tipo}</span>
                    {pergunta.obrigatoria && <span className="detail-required">Obrigatória</span>}
                  </div>
                  {['multipla', 'caixas', 'lista'].includes(pergunta.tipo) && (
                    <ul className="detail-options">
                      {pergunta.opcoes.map((opcao, optionIndex) => <li key={`${pergunta.id}-${optionIndex}`}>{opcao || `Opção ${optionIndex + 1}`}</li>)}
                    </ul>
                  )}
                  {pergunta.tipo === 'escala' && (
                    <p className="detail-scale">Escala de {pergunta.escalaMin ?? 1} a {pergunta.escalaMax ?? 5}</p>
                  )}
                </div>
              </article>
            ))}
          </section>
        </div>

        {formulario.publicada && <aside className="detail-share-card">
          <p className="eyebrow">COMPARTILHAMENTO</p>
          <>
            <h2>Compartilhe este formulário</h2>
            <p>Use o código ou o QR para que outras pessoas respondam em qualquer dispositivo.</p>
            <div className="detail-code">
              <span>Código do formulário</span>
              <strong>{formulario.codigo}</strong>
            </div>
            {imagemQr
              ? <img className="detail-qr" src={imagemQr} alt={`QR code para responder ${formulario.titulo}`} />
              : <p className="share-qr-loading">Gerando QR code…</p>}
            <label className="share-link-label" htmlFor="detail-share-link">Link para responder</label>
            <input id="detail-share-link" className="share-link" readOnly value={`${window.location.origin}${window.location.pathname}#/form/${formulario.codigo}`} />
            <button className="button button--quiet detail-copy-button" type="button" onClick={onCopyLink}>Copiar link</button>
            {mensagemPartilha && <p className="share-feedback" role="status">{mensagemPartilha}</p>}
          </>
        </aside>}
      </div>
    </section>
  )
}
