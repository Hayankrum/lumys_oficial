export default function HomePage({
  codigoBusca,
  setCodigoBusca,
  erro,
  scannerAberto,
  scannerVideo,
  onSubmit,
  onScan,
  onCloseScanner,
}) {
  return (
    <section className="lookup-page home-entry-page">
      <div className="lookup-card home-entry-card">
        <img className="home-entry-logo" src="/lumys-mark.svg" alt="Lumys" />
        <h1>Responder formulário</h1>
        <p>Digite o código recebido ou leia o QR code para abrir o questionário.</p>
        <form className="lookup-form" onSubmit={onSubmit}>
          <label htmlFor="form-code">Código do formulário</label>
          <input
            id="form-code"
            className="answer-input lookup-code"
            value={codigoBusca}
            onChange={(event) => setCodigoBusca(event.target.value.toUpperCase())}
            placeholder="Ex.: A1B2C3D4E5"
            minLength="8"
            maxLength="16"
            required
          />
          {erro && <p className="form-error" role="alert">{erro}</p>}
          <button className="button button--primary" type="submit">Buscar formulário</button>
        </form>
        <div className="lookup-divider"><span>ou</span></div>
        {!scannerAberto ? (
          <button className="button button--quiet" type="button" onClick={onScan}>Ler QR code com a câmera</button>
        ) : (
          <div className="scanner-panel">
            <video ref={scannerVideo} className="scanner-video" muted playsInline />
            <p>Aponte a câmera para o QR code do formulário.</p>
            <button className="button button--quiet" type="button" onClick={onCloseScanner}>Fechar câmera</button>
          </div>
        )}
      </div>
    </section>
  )
}
