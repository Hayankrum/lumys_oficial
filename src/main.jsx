import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


import { sincronizar } from './sync'

// ...depois do createRoot(...).render(...)
window.addEventListener('online', sincronizar)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sincronizar()
})
setInterval(sincronizar, 30_000)
sincronizar()