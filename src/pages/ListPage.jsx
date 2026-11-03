export default function ListPage({
  abaInicio,
  setAbaInicio,
  formulariosDaConta,
  questionariosRespondidos,
  todasRespostas,
  erro,
  onCreate,
  onOpenDetails,
  onEdit,
  onAnswer,
  onResults,
  onDelete,
}) {
  return (
    <section className="home-page">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">SEU ESPAÇO DE TRABALHO</p>
          <h1>Formulários</h1>
          <p className="intro">Crie questionários, reúna respostas e organize suas ideias.</p>
        </div>
        <div className="welcome-actions">
          <button className="button button--primary" type="button" onClick={onCreate}>
            <span className="button-plus">+</span> Criar formulário
          </button>
        </div>
      </div>

      {erro && <p className="form-error home-error" role="alert">{erro}</p>}
      <div className="home-tabs" role="tablist" aria-label="Seus questionários">
        <button className={`home-tab${abaInicio === 'meus' ? ' home-tab--active' : ''}`} type="button" role="tab" aria-selected={abaInicio === 'meus'} onClick={() => setAbaInicio('meus')}>
          Meus questionários <span>{formulariosDaConta.length}</span>
        </button>
        <button className={`home-tab${abaInicio === 'respondidos' ? ' home-tab--active' : ''}`} type="button" role="tab" aria-selected={abaInicio === 'respondidos'} onClick={() => setAbaInicio('respondidos')}>
          Respondidos <span>{questionariosRespondidos.length}</span>
        </button>
      </div>
      {abaInicio === 'meus' ? (
        <>
          <div className="section-heading">
            <h2>Meus questionários</h2>
            <span>{formulariosDaConta.length} no total</span>
          </div>
          {formulariosDaConta.length ? (
            <div className="form-grid">
              {formulariosDaConta.map((formulario) => {
                const totalRespostasLocais = (todasRespostas ?? []).filter((resposta) => resposta.formularioId === formulario.id).length
                const totalRespostas = Math.max(formulario.respostasCount ?? 0, totalRespostasLocais)
                return (
                  <article
                    className="form-card form-card--clickable"
                    key={formulario.id}
                  >
                    <button className="form-card-open" type="button" onClick={() => onOpenDetails(formulario)} aria-label={`Ver detalhes de ${formulario.titulo || 'Questionário sem título'}`} />
                    <div className="form-card-content">
                      <div className="form-card-art"><img src="/lumys-mark.svg" alt="" /></div>
                      <div className="form-card-body">
                        <h3>{formulario.titulo || 'Questionário sem título'}</h3>
                        <p>{formulario.descricao || 'Sem descrição'}</p>
                        <div className="form-card-meta">
                          <span>{formulario.perguntas.length} {formulario.perguntas.length === 1 ? 'pergunta' : 'perguntas'}</span>
                          <span>{totalRespostas} {totalRespostas === 1 ? 'resposta' : 'respostas'}</span>
                        </div>
                        <div className="form-card-actions">
                          <div className="form-card-secondary-actions">
                            {formulario.publicada && <button className="button button--small button--quiet" type="button" onClick={() => onAnswer(formulario)}>Responder</button>}
                            <button className="button button--small button--quiet" type="button" onClick={() => onResults(formulario)}>Resultados</button>
                          </div>
                          <div className="form-card-primary-actions">
                            <button className="icon-edit" type="button" aria-label={`Editar ${formulario.titulo}`} title="Editar questionário" onClick={() => onEdit(formulario)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></svg>
                            </button>
                            <button className="icon-delete" type="button" aria-label={`Excluir ${formulario.titulo}`} title="Excluir questionário" onClick={() => onDelete(formulario)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-home">
              <div className="empty-illustration"><img src="/lumys-mark.svg" alt="" /></div>
              <h2>Seu próximo formulário começa aqui</h2>
              <p>Adicione perguntas e escolha como as pessoas podem responder.</p>
              <button className="button button--primary" type="button" onClick={onCreate}>Criar meu primeiro formulário</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="section-heading">
            <h2>Questionários respondidos</h2>
            <span>{questionariosRespondidos.length} no total</span>
          </div>
          {questionariosRespondidos.length ? (
            <div className="form-grid">
              {questionariosRespondidos.map((formulario) => (
                <article className="form-card" key={formulario.codigo}>
                  <div className="form-card-art"><span>✓</span></div>
                  <div className="form-card-body">
                    <h3>{formulario.titulo || 'Questionário sem título'}</h3>
                    <p>{formulario.descricao || 'Sem descrição'}</p>
                    <div className="form-card-meta">
                      <span>{formulario.perguntas?.length ?? 0} perguntas</span>
                      <span>Respondido em {new Date(formulario.respondidoEm).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div className="form-card-actions">
                      <button className="button button--small button--quiet" type="button" onClick={() => onAnswer(formulario)}>Responder novamente</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-home">
              <div className="empty-illustration"><span>✓</span></div>
              <h2>Nenhum questionário respondido ainda</h2>
              <p>Quando você responder a um formulário, ele aparecerá aqui.</p>
            </div>
          )}
        </>
      )}
      <p className="local-note">Rascunhos ficam neste dispositivo. Publique um formulário para compartilhar por código ou QR.</p>
    </section>
  )
}
