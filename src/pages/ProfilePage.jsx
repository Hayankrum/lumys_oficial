export default function ProfilePage({ conta, erro, imagemQr, onBack }) {
  const nomeUsuario = conta?.nome || conta?.email?.split('@')[0]?.replace(/[._-]+/g, ' ')
  const nomeExibicao = nomeUsuario
    ? nomeUsuario.replace(/\b\p{L}/gu, (letra) => letra.toLocaleUpperCase('pt-BR'))
    : 'Usuário'

  return (
    <section className="about-page">
      <button className="back-button-quiet" type="button" onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        Voltar
      </button>
      {erro && <p className="form-error" role="alert">{erro}</p>}
      <div className="about-heading">
        <p className="eyebrow">PERFIL DA PLATAFORMA</p>
        <h1>Olá, {nomeExibicao}</h1>
        {conta?.email && <p className="profile-email">{conta.email}</p>}
        <p>Crie formulários, compartilhe por QR code ou código e acompanhe as respostas em um só lugar.</p>
      </div>
      <div className="about-layout">
        <aside className="about-qr-card">
          <p className="eyebrow">ACESSO À PLATAFORMA</p>
          <h2>Abra no seu celular</h2>
          {imagemQr
            ? <img className="about-qr" src={imagemQr} alt="QR code para abrir o Lumys" />
            : <div className="about-qr-placeholder" role="status">Gerando QR code…</div>}
          <p>Aponte a câmera do celular para acessar esta plataforma.</p>
          <a href={`${window.location.origin}${window.location.pathname}`} className="about-url">{window.location.host}</a>
        </aside>
      </div>
    </section>
  )
}
