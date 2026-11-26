// O Safari do iOS ignora `user-scalable=no` e ainda aplica zoom por pinça.
// O zoom ao focar campos é evitado no CSS, mantendo font-size >= 16px.
function impedirPadrao(evento) {
  evento.preventDefault()
}

for (const tipo of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(tipo, impedirPadrao, { passive: false })
}

// Fallback para navegadores que não disparam os eventos `gesture*`.
document.addEventListener(
  'touchmove',
  (evento) => {
    if (evento.touches.length > 1) evento.preventDefault()
  },
  { passive: false },
)
