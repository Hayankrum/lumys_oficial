import { useCallback, useEffect, useState } from 'react'

export default function SinoNotificacoes({ ativo = false, onOpen }) {
  const [count, setCount] = useState(0)

  const buscar = useCallback(async () => {
    if (document.hidden) return
    try {
      const resposta = await fetch('/api/notifications/unread', { credentials: 'same-origin' })
      const dados = await resposta.json().catch(() => ({}))
      setCount(Number(dados.count) || 0)
    } catch {
      // Sem conexão: mantém a última contagem conhecida.
    }
  }, [])

  useEffect(() => {
    const inicial = window.setTimeout(() => void buscar(), 100)
    const aoAtualizar = () => void buscar()
    const aoVisibilidade = () => { if (!document.hidden) void buscar() }
    const aoArmazenamento = (event) => { if (event.key === 'notifications:updated') void buscar() }
    window.addEventListener('notifications:updated', aoAtualizar)
    window.addEventListener('storage', aoArmazenamento)
    document.addEventListener('visibilitychange', aoVisibilidade)
    return () => {
      window.clearTimeout(inicial)
      window.removeEventListener('notifications:updated', aoAtualizar)
      window.removeEventListener('storage', aoArmazenamento)
      document.removeEventListener('visibilitychange', aoVisibilidade)
    }
  }, [buscar])

  return (
    <button
      className={`notifications-bell${ativo ? ' notifications-bell--active' : ''}`}
      type="button"
      onClick={onOpen}
      aria-label={count > 0 ? `Notificações, ${count} não lidas` : 'Notificações'}
      aria-current={ativo ? 'page' : undefined}
      title="Notificações"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && <span className="notifications-badge">{count > 99 ? '99+' : count}</span>}
    </button>
  )
}
