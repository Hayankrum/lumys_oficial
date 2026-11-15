import { useState } from 'react'
import { usePushSubscription } from '../usePushSubscription'

const CHAVE_DISPENSA = 'lumys:banner-notificacoes-dispensado'

export default function NotificationPermissionPopup({ visivel }) {
  const { isSubscribed, isSubscribing, isSupported, isLoading, permissionDenied, subscribe } = usePushSubscription()
  const [dispensado, setDispensado] = useState(() => {
    try {
      return window.localStorage.getItem(CHAVE_DISPENSA) === '1'
    } catch {
      return false
    }
  })
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState(false)

  if (!visivel || !isSupported || isLoading || isSubscribed || dispensado) return null

  const dispensar = () => {
    try {
      window.localStorage.setItem(CHAVE_DISPENSA, '1')
    } catch {
      // Ignora falhas de armazenamento.
    }
    setDispensado(true)
  }

  const ativar = async () => {
    setErro('')
    const resultado = await subscribe()
    if (resultado.success) {
      setSucesso(true)
      window.setTimeout(dispensar, 2000)
    } else {
      setErro(resultado.error || 'Não foi possível ativar as notificações.')
    }
  }

  return (
    <div className="notification-banner" role="status">
      <button className="notification-banner-close" type="button" aria-label="Dispensar aviso de notificações" onClick={dispensar}>×</button>
      <span className={`notification-banner-icon${sucesso ? ' notification-banner-icon--ok' : ''}`} aria-hidden="true">
        {sucesso ? '✓' : permissionDenied ? '🔒' : '🔔'}
      </span>
      <div className="notification-banner-text">
        <strong>{sucesso ? 'Notificações ativadas!' : permissionDenied ? 'Notificações bloqueadas' : 'Ative as notificações'}</strong>
        <span>
          {sucesso
            ? 'Você será avisado quando um questionário atingir a meta de respostas.'
            : permissionDenied
              ? 'Toque no ícone de cadeado na barra de endereço e permita as notificações.'
              : 'Receba um aviso quando seus questionários atingirem a meta de respostas.'}
        </span>
        {erro && <span className="notification-banner-error">{erro}</span>}
      </div>
      {!permissionDenied && !sucesso && (
        <button className="button button--small button--primary" type="button" onClick={() => void ativar()} disabled={isSubscribing}>
          {isSubscribing ? 'Ativando…' : 'Ativar'}
        </button>
      )}
    </div>
  )
}
