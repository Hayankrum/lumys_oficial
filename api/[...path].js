import app from '../server/index.js'

export default function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) {
    url.pathname = url.pathname.replace(/^\/api\/sync(?=\/|$)/, '/sync')
    req.url = `${url.pathname}${url.search}`
  }
  return app(req, res)
}
