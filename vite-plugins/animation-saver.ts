import { Plugin } from 'vite'
import { promises as fs } from 'fs'
import path from 'path'

// Vite dev plugin: GET/POST /api/animations for persisting the editor's
// pose + anchor + animation library to public/custom-animations/library.json.
// Dev-server only — production builds don't need this since the editor
// itself only runs in dev.
export function animationSaverPlugin(): Plugin {
  const filePath = path.resolve(
    process.cwd(),
    'public/custom-animations/library.json',
  )

  return {
    name: 'duel-game:animation-saver',
    configureServer(server) {
      server.middlewares.use('/api/animations', async (req, res, next) => {
        try {
          if (req.method === 'GET') {
            try {
              const data = await fs.readFile(filePath, 'utf-8')
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(data)
            } catch {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(
                JSON.stringify({ poses: [], anchors: [], animations: [], creatorParts: [] }),
              )
            }
            return
          }
          if (req.method === 'POST') {
            let body = ''
            for await (const chunk of req) body += chunk
            // Validate it's parseable JSON before writing
            JSON.parse(body)
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, body, 'utf-8')
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }
          next()
        } catch (err) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}
