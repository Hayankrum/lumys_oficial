import app from '../server/index.js'

export default function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const route = url.searchParams.get('__vercel_path')

  if (route) {
    url.searchParams.delete('__vercel_path')
    req.url = `${route}${url.search}`
  }

  return app(req, res)
}
