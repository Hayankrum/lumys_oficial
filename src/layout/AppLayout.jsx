import './AppLayout.css'

export default function AppLayout({ children, conta, authCarregando, tela, onHome, onList, onProfile, onLogout }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <nav className="main-navigation" aria-label="Navegação principal">
          <button className="brand" type="button" onClick={onHome} aria-label="Ir para o início">
            <img className="brand-logo" src="/lumys-logo.svg" alt="" />
            <span>Lumys</span>
          </button>
          <div className="navigation-links">
            <button className={`navigation-link${tela === 'inicio' ? ' navigation-link--active' : ''}`} type="button" onClick={onHome} aria-current={tela === 'inicio' ? 'page' : undefined}>Home</button>
            <button className={`navigation-link${tela === 'lista' ? ' navigation-link--active' : ''}`} type="button" onClick={onList} aria-current={tela === 'lista' ? 'page' : undefined}>Lista</button>
            <button className={`navigation-link${tela === 'perfil' ? ' navigation-link--active' : ''}`} type="button" onClick={onProfile} aria-current={tela === 'perfil' ? 'page' : undefined}>Perfil</button>
          </div>
          {(authCarregando || conta) && (
            <div className="account-actions">
              {authCarregando && (
                <span
                  className="session-status"
                  role="status"
                  aria-label="Verificando sessão em segundo plano"
                  title="Estamos conferindo sua sessão em segundo plano. Você já pode navegar normalmente."
                >
                  <span className="session-status-dot" aria-hidden="true" />
                  <span className="session-status-label">Verificando sessão…</span>
                </span>
              )}
              {conta && (
                <>
                  <span className="account-email">{conta.email}</span>
                  <button className="account-logout" type="button" onClick={onLogout} aria-label="Sair da conta" title="Sair">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M10 17l5-5-5-5M15 12H3" />
                      <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
                    </svg>
                    <span>Sair</span>
                  </button>
                </>
              )}
            </div>
          )}
        </nav>
      </header>
      {children}
    </main>
  )
}
