import { useCallback, useEffect, useRef, useState } from 'react'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function suportaPush() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const seguro = window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost'
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && seguro
}

async function aguardarServiceWorker(timeout = 15000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('O service worker demorou para ficar pronto.')), timeout)
    }),
  ])
}

export function usePushSubscription() {
  const [isSupported] = useState(suportaPush)
  const [isLoading, setIsLoading] = useState(() => suportaPush())
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'denied')
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  useEffect(() => {
    if (!isSupported) return undefined
    let cancelado = false
    const verificar = async () => {
      try {
        const registration = await aguardarServiceWorker(10000)
        if (cancelado) return
        const subscription = await registration.pushManager.getSubscription()
        if (cancelado) return
        if (!subscription) {
          if (montado.current) setIsSubscribed(false)
          return
        }
        try {
          const resposta = await fetch('/api/subscribe/check', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          })
          const dados = await resposta.json().catch(() => ({}))
          if (cancelado) return
          if (!dados.registered) {
            await subscription.unsubscribe().catch(() => {})
            if (montado.current) setIsSubscribed(false)
          } else if (montado.current) {
            setIsSubscribed(true)
          }
        } catch {
          if (montado.current && !cancelado) setIsSubscribed(true)
        }
      } catch {
        if (montado.current && !cancelado) setIsSubscribed(false)
      } finally {
        if (montado.current && !cancelado) setIsLoading(false)
      }
    }
    void verificar()
    return () => { cancelado = true }
  }, [isSupported])

  const subscribe = useCallback(async () => {
    if (isSubscribing) return { success: false, error: 'Aguarde a operação atual terminar.' }
    if (isSubscribed) return { success: true }
    setIsSubscribing(true)
    try {
      const respostaChave = await fetch('/api/vapid-key', { credentials: 'same-origin' })
      const dadosChave = await respostaChave.json().catch(() => ({}))
      if (!respostaChave.ok || !dadosChave.publicKey) {
        return {
          success: false,
          error: dadosChave.erro || 'As notificações push não estão configuradas no servidor.',
        }
      }

      if (Notification.permission === 'denied') {
        setPermissionDenied(true)
        return {
          success: false,
          error: 'As notificações estão bloqueadas. Ative-as nas configurações do navegador (ícone do cadeado na barra de endereço).',
        }
      }
      if (Notification.permission !== 'granted') {
        const permissao = await Notification.requestPermission()
        if (permissao !== 'granted') {
          setPermissionDenied(permissao === 'denied')
          return { success: false, error: 'Você precisa permitir notificações para ativar os alertas.' }
        }
      }

      const registration = await aguardarServiceWorker(20000)
      let subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await subscription.unsubscribe().catch(() => {})
        subscription = null
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(dadosChave.publicKey),
      })

      const json = subscription.toJSON()
      const resposta = await fetch('/api/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      if (!resposta.ok) {
        const dados = await resposta.json().catch(() => ({}))
        await subscription.unsubscribe().catch(() => {})
        return { success: false, error: dados.erro || 'Não foi possível salvar a inscrição no servidor.' }
      }

      if (montado.current) setIsSubscribed(true)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'Não foi possível ativar as notificações neste navegador.',
      }
    } finally {
      if (montado.current) setIsSubscribing(false)
    }
  }, [isSubscribing, isSubscribed])

  const unsubscribe = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/unsubscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {})
        await subscription.unsubscribe().catch(() => {})
      }
      if (montado.current) setIsSubscribed(false)
      return { success: true }
    } catch (error) {
      if (montado.current) setIsSubscribed(false)
      return { success: true, error: error?.message }
    }
  }, [])

  return { isSupported, isLoading, isSubscribed, isSubscribing, permissionDenied, subscribe, unsubscribe }
}
