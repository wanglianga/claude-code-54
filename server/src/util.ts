import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

const SECRET = process.env.APP_SECRET || 'community-repair-secret'

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(8).toString('hex')
  const h = crypto.scryptSync(pw, salt, 32).toString('hex')
  return `${salt}:${h}`
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, h] = stored.split(':')
  if (!salt || !h) return false
  const calc = crypto.scryptSync(pw, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(h))
}

export function signToken(payload: object, ttlSec = 60 * 60 * 24 * 7): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyToken(token: string): any | null {
  const [body, sig] = (token || '').split('.')
  if (!body || !sig) return null
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (expect !== sig) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp && payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

export interface AuthedRequest extends Request {
  user?: { id: number; role: string; name: string; username: string }
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  const payload = verifyToken(token)
  if (!payload) return res.status(401).json({ error: '未登录或登录已过期' })
  req.user = payload
  next()
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限执行该操作' })
    }
    next()
  }
}

export function orderNo(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `R${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${rand}`
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 球面距离（公里） */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
