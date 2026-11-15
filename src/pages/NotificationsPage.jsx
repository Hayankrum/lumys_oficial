import { useCallback, useEffect, useState } from 'react'
import { usePushSubscription } from '../usePushSubscription'

function formatarData(valor) {
  return new Date(valor).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function enviarJson(url, corpo) {
  try {
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  } catch {
    // A lista local já reflete a intenção do usuário.
  }
}

function avisarAtualizacao() {
  window.dispatchEvent(new Event('notifications:updated'))
  try {
    window.localStorage.setItem('notifications:updated', String(Date.now()))
  } catch {
    // Ignora falhas de armazenamento.
  }
}

export default function NotificationsPage({ erro, onOpenUrl }) {
  const { isSubscribed, isSubscribing, isSupported, isLoading, permissionDenied, subscribe, unsubscribe } = usePushSubscription()
  const [historico, setHistorico] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState(null)

  const carregarHistorico = useCallback(async () => {
    try {
      const resposta = await fetch('/api/notifications/history', { credentials: 'same-origin' })
      const dados = await resposta.json().catch(() => ({}))
      setHistorico(Array.isArray(dados.notificacoes) ? dados.notificacoes : [])
    } catch {
      setHistorico([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    let cancelado = false
    Promise.resolve().then(async () => {
      if (cancelado) return
      await carregarHistorico()
    })
    return () => { cancelado = true }
  }, [carregarHistorico])

  const mostrarMensagem = (tipo, texto) => {
    setMensagem({ tipo, texto })
    window.setTimeout(() => setMensagem(null), 5000)
  }

  const alternarPush = async () => {
    if (isSubscribed) {
      await unsubscribe()
      mostrarMensagem('sucesso', 'Notificações push desativadas.')
    } else {
      const resultado = await subscribe()
      if (resultado.success) mostrarMensagem('sucesso', 'Notificações push ativadas!')
      else mostrarMensagem('erro', resultado.error || 'Não foi possível ativar as notificações.')
    }
  }

  const marcarLida = async (id) => {
    setHistorico((atual) => atual.map((item) => (item.id === id ? { ...item, lida: true } : item)))
    await enviarJson('/api/notifications/read', { id })
    avisarAtualizacao()
  }

  const marcarTodas = async () => {
    setHistorico((atual) => atual.map((item) => ({ ...item, lida: true })))
    await enviarJson('/api/notifications/read', { all: true })
    avisarAtualizacao()
  }

  const excluir = async (id) => {
    setHistorico((atual) => atual.filter((item) => item.id !== id))
    await enviarJson('/api/notifications/delete', { id })
    avisarAtualizacao()
  }

  const excluirTodas = async () => {
    if (!window.confirm('Tem certeza que deseja excluir todas as notificações?')) return
    setHistorico([])
    await enviarJson('/api/notifications/delete', { all: true })
    avisarAtualizacao()
  }

  const abrir = (notificacao) => {
    if (!notificacao.lida) void marcarLida(notificacao.id)
    if (onOpenUrl) onOpenUrl(notificacao.url)
  }

  const naoLidas = historico.filter((item) => !item.lida).length

  return (
    <section className="notifications-page">
      <div className="section-heading">
        <h1>Notificações</h1>
        <span>{naoLidas > 0 ? `${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'}` : 'Tudo em dia'}</span>
      </div>

      {erro && <p className="form-error" role="alert">{erro}</p>}
      {mensagem && (
        <p className={mensagem.tipo === 'erro' ? 'form-error' : 'notifications-feedback'} role="status">
          {mensagem.texto}
        </p>
      )}

      <div className="notifications-push-card">
        <div className="notifications-push-info">
          <span className={`notifications-push-dot${isSubscribed ? ' notifications-push-dot--on' : ''}`} aria-hidden="true" />
          <div>
            <strong>Notificações push</strong>
            <span>{isLoading ? 'Verificando…' : isSubscribed ? 'Ativas neste dispositivo' : 'Inativas neste dispositivo'}</span>
          </div>
        </div>
        {isSupported ? (
          <button
            className={isSubscribed ? 'button button--small button--quiet' : 'button button--small button--primary'}
            type="button"
            onClick={() => void alternarPush()}
            disabled={isSubscribing || isLoading}
          >
            {isSubscribing ? 'Aguarde…' : isSubscribed ? 'Desativar' : 'Ativar'}
          </button>
        ) : (
          <span className="notifications-push-unavailable">Não suportado neste navegador</span>
        )}
      </div>
      {permissionDenied && (
        <p className="notifications-hint">
          As notificações estão bloqueadas no navegador. Toque no ícone de cadeado na barra de endereço para permitir.
        </p>
      )}

      <div className="notifications-history">
        <div className="notifications-history-heading">
          <h2>Histórico</h2>
          <div className="notifications-history-actions">
            {naoLidas > 0 && <button type="button" onClick={() => void marcarTodas()}>Marcar todas como lidas</button>}
            {historico.length > 0 && <button type="button" onClick={() => void excluirTodas()}>Excluir todas</button>}
          </div>
        </div>

        {carregando ? (
          <p className="notifications-empty">Carregando…</p>
        ) : historico.length === 0 ? (
          <p className="notifications-empty">Nenhuma notificação por aqui. Avisaremos quando um questionário atingir a meta de respostas.</p>
        ) : (
          <ul className="notifications-list">
            {historico.map((notificacao) => (
              <li key={notificacao.id} className={`notification-item${notificacao.lida ? '' : ' notification-item--unread'}`}>
                <button className="notification-body" type="button" onClick={() => abrir(notificacao)}>
                  <strong>{notificacao.titulo}</strong>
                  <span>{notificacao.mensagem}</span>
                  <time dateTime={new Date(notificacao.criadaEm).toISOString()}>{formatarData(notificacao.criadaEm)}</time>
                </button>
                <button
                  className="notification-remove"
                  type="button"
                  aria-label={`Excluir notificação: ${notificacao.titulo}`}
                  onClick={() => void excluir(notificacao.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
