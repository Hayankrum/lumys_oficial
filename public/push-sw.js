/* Handlers de notificações push para o service worker gerado pelo Workbox.
   Importado pelo service worker principal via `workbox.importScripts`. */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let dados
  try {
    dados = event.data.json()
  } catch {
    dados = { title: 'Lumys', body: event.data.text() }
  }

  const opcoes = {
    body: dados.body || dados.mensagem || '',
    icon: dados.icon || '/pwa-192x192.png',
    badge: dados.badge || '/pwa-192x192.png',
    vibrate: [100, 50, 100],
    data: { url: dados.url || '/' },
    tag: dados.tag || 'lumys-notificacao',
    renotify: true,
    requireInteraction: false,
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Dispensar' },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(dados.title || 'Lumys', opcoes)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return

  const destino = event.notification.data?.url || '/'
  const urlParaAbrir = new URL(destino, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if (janela.url === urlParaAbrir && 'focus' in janela) return janela.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(urlParaAbrir)
      return undefined
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const registration = self.registration
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        const resposta = await fetch('/api/vapid-key')
        if (!resposta.ok) return
        const { publicKey } = await resposta.json()
        if (!publicKey) return

        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4)
        const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/')
        const rawData = atob(base64)
        const applicationServerKey = new Uint8Array(rawData.length)
        for (let i = 0; i < rawData.length; i += 1) applicationServerKey[i] = rawData.charCodeAt(i)

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      }

      if (subscription) {
        const json = subscription.toJSON()
        await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        })
      }
    } catch {
      // Sem ação: a próxima visita ao app recria a inscrição.
    }
  })())
})
