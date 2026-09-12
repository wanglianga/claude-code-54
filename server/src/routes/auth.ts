import { Router } from 'express'
import { q } from '../db'
import { AuthedRequest, authRequired, signToken, verifyPassword } from '../util'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' })
  const r = await q(`SELECT * FROM users WHERE username = $1`, [username])
  const user = r.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  let tech: any = null
  if (user.role === 'technician') {
    const t = await q(`SELECT * FROM technicians WHERE user_id = $1`, [user.id])
    tech = t.rows[0] || null
  }
  const token = signToken({ id: user.id, role: user.role, name: user.name, username: user.username })
  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, phone: user.phone, technician: tech },
  })
})

authRouter.get('/me', authRequired, async (req: AuthedRequest, res) => {
  const r = await q(`SELECT id, username, name, role, phone FROM users WHERE id = $1`, [req.user!.id])
  if (!r.rows.length) return res.status(404).json({ error: '用户不存在' })
  let tech: any = null
  if (r.rows[0].role === 'technician') {
    const t = await q(`SELECT * FROM technicians WHERE user_id = $1`, [r.rows[0].id])
    tech = t.rows[0] || null
  }
  res.json({ ...r.rows[0], technician: tech })
})
