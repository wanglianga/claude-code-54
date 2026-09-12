import express from 'express'
import path from 'path'
import fs from 'fs'
import { initDb, pool } from './db'
import { seedIfEmpty } from './seed'
import { authRouter } from './routes/auth'
import { ordersRouter } from './routes/orders'
import { collabRouter } from './routes/collab'

const app = express()
app.use(express.json({ limit: '2mb' }))

const PORT = parseInt(process.env.PORT || '8080')
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/uploads')
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', 'public')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'up', time: new Date().toISOString() })
  } catch (e: any) {
    res.status(503).json({ ok: false, error: e.message })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/orders', ordersRouter)
app.use('/api', collabRouter)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

// 前端静态资源 + SPA 回退
if (fs.existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
    res.sendFile(path.join(WEB_DIR, 'index.html'))
  })
}

// 统一错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message)
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' })
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

async function main() {
  await initDb()
  await seedIfEmpty()
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`))
}

main().catch(e => {
  console.error('启动失败:', e)
  process.exit(1)
})
