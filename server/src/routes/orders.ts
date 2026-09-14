import { Router, Request, Response, NextFunction } from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { pool, q, logEvent, touchOrder, partAvailability } from '../db'
import { AuthedRequest, authRequired, requireRole, orderNo, today, addDays } from '../util'
import { COMMUNITIES, DEVICE_LABEL, ORDER_STATUS, SLOTS, WARRANTY_DAYS, DONE_STATUS, faultLabel } from '../meta'
import { recommendForOrder, neededParts, slotFreeCount } from '../recommend'

export const ordersRouter = Router()
ordersRouter.use(authRequired)

const h = (fn: (req: AuthedRequest, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next)

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg'
      cb(null, `${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
})

function withLabels(o: any) {
  return {
    ...o,
    device_label: DEVICE_LABEL[o.device_type] || o.device_type,
    fault_label: faultLabel(o.device_type, o.fault_type),
    status_label: ORDER_STATUS[o.status] || o.status,
  }
}

async function getOrderFull(id: number) {
  const o = await q(
    `SELECT o.*, r.name AS resident_name, r.phone AS resident_phone, t.name AS technician_name,
            st.name AS support_technician_name
     FROM orders o
     LEFT JOIN users r ON r.id = o.resident_id
     LEFT JOIN users t ON t.id = o.technician_id
     LEFT JOIN users st ON st.id = o.support_technician_id
     WHERE o.id = $1`,
    [id]
  )
  if (!o.rows.length) return null
  const [events, evidence, quotes, parts, exceptions, payment, review, warranty, reworks, risks, tracks] = await Promise.all([
    q(`SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    q(`SELECT * FROM evidence WHERE order_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    q(`SELECT * FROM quotes WHERE order_id = $1 ORDER BY version DESC, id DESC`, [id]),
    q(`SELECT op.*, p.name AS part_name, p.sku, p.price_cents, p.model AS part_model FROM order_parts op JOIN parts p ON p.id = op.part_id WHERE op.order_id = $1 ORDER BY op.id`, [id]),
    q(`SELECT * FROM exceptions WHERE order_id = $1 ORDER BY created_at DESC, id DESC`, [id]),
    q(`SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [id]),
    q(`SELECT * FROM reviews WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [id]),
    q(`SELECT * FROM warranties WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [id]),
    q(`SELECT id, order_no, status, created_at FROM orders WHERE original_order_id = $1 ORDER BY id DESC`, [id]),
    q(`SELECT r.*, u.name AS technician_name, su.name AS support_technician_name
       FROM risk_assessments r
       LEFT JOIN users u ON u.id = r.technician_id
       LEFT JOIN users su ON su.id = r.support_technician_id
       WHERE r.order_id = $1 ORDER BY r.created_at DESC, r.id DESC`, [id]),
    q(`SELECT * FROM tracks WHERE order_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
  ])
  let original: any = null
  if (o.rows[0].original_order_id) {
    const orig = await q(`SELECT id, order_no, status, created_at FROM orders WHERE id = $1`, [o.rows[0].original_order_id])
    original = orig.rows[0] || null
  }
  return {
    order: withLabels(o.rows[0]),
    events: events.rows,
    evidence: evidence.rows,
    quotes: quotes.rows,
    parts: parts.rows,
    exceptions: exceptions.rows,
    payment: payment.rows[0] || null,
    review: review.rows[0] || null,
    warranty: warranty.rows[0] || null,
    reworks: reworks.rows,
    risk_assessments: risks.rows,
    tracks: tracks.rows,
    original,
  }
}

function canView(user: any, order: any) {
  if (['admin', 'cs', 'warehouse'].includes(user.role)) return true
  if (user.role === 'resident') return order.resident_id === user.id
  if (user.role === 'technician') return order.technician_id === user.id || order.support_technician_id === user.id
  return false
}

/** 订单列表（按角色过滤） */
ordersRouter.get('/', h(async (req, res) => {
  const u = req.user!
  const conds: string[] = []
  const params: any[] = []
  if (u.role === 'resident') { params.push(u.id); conds.push(`o.resident_id = $${params.length}`) }
  if (u.role === 'technician') { params.push(u.id); conds.push(`(o.technician_id = $${params.length} OR o.support_technician_id = $${params.length})`) }
  if (req.query.status) { params.push(req.query.status); conds.push(`o.status = $${params.length}`) }
  if (req.query.device_type) { params.push(req.query.device_type); conds.push(`o.device_type = $${params.length}`) }
  if (req.query.technician_id) { params.push(req.query.technician_id); conds.push(`o.technician_id = $${params.length}`) }
  if (req.query.keyword) {
    params.push(`%${req.query.keyword}%`)
    conds.push(`(o.order_no ILIKE $${params.length} OR o.address ILIKE $${params.length} OR o.brand ILIKE $${params.length} OR o.model ILIKE $${params.length})`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await q(
    `SELECT o.*, r.name AS resident_name, t.name AS technician_name,
       (SELECT COUNT(*)::int FROM exceptions e WHERE e.order_id = o.id AND e.status = 'open') AS open_exceptions
     FROM orders o
     LEFT JOIN users r ON r.id = o.resident_id
     LEFT JOIN users t ON t.id = o.technician_id
     ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT 200`,
    params
  )
  res.json(r.rows.map(withLabels))
}))

/** 居民提交报修 */
ordersRouter.post('/', requireRole('resident'), h(async (req, res) => {
  const u = req.user!
  const b = req.body || {}
  const required = ['device_type', 'brand', 'fault_type', 'community', 'address']
  for (const k of required) if (!b[k]) return res.status(400).json({ error: `缺少字段：${k}` })
  if (!Array.isArray(b.time_slots) || b.time_slots.length === 0) {
    return res.status(400).json({ error: '请至少选择一个可上门时段' })
  }
  const community = COMMUNITIES.find(c => c.name === b.community)
  if (!community) return res.status(400).json({ error: '未知社区' })
  const floor = parseInt(b.floor) || 1
  const safetyRisk = b.device_type === 'ac' && floor >= 4 ? 'high' : floor >= 6 ? 'medium' : 'low'
  const no = orderNo()
  const r = await q(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status, safety_risk)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'recommended',$16) RETURNING id`,
    [no, u.id, b.device_type, b.brand, b.model || '', b.fault_type, b.fault_desc || '',
     parseInt(b.purchase_years) || 0, floor, !!b.has_elevator, b.community, b.address,
     community.lat, community.lng, JSON.stringify(b.time_slots), safetyRisk]
  )
  const id = r.rows[0].id
  await logEvent(id, u, '提交报修', {
    order_no: no,
    device: DEVICE_LABEL[b.device_type], brand: b.brand, model: b.model,
    fault: faultLabel(b.device_type, b.fault_type), floor, safety_risk: safetyRisk,
  })
  await logEvent(id, null, '系统生成师傅推荐', { rule: '技能+距离+配件库存+安全风险+档期' })
  res.json({ id, order_no: no })
}))

/** 订单完整档案（时间线 + 证据 + 报价 + 配件 + 异常 + 支付 + 评价 + 质保 + 返修） */
ordersRouter.get('/:id', h(async (req, res) => {
  const full = await getOrderFull(parseInt(req.params.id))
  if (!full) return res.status(404).json({ error: '订单不存在' })
  if (!canView(req.user, full.order)) return res.status(403).json({ error: '无权查看该订单' })
  res.json(full)
}))

/** 推荐师傅 */
ordersRouter.get('/:id/recommendations', h(async (req, res) => {
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [parseInt(req.params.id)])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (!canView(req.user, order)) return res.status(403).json({ error: '无权查看该订单' })
  const list = await recommendForOrder(order)
  res.json(list)
}))

/** 居民预约师傅（校验档期 + 配件库存，配件未到不安排上门） */
ordersRouter.post('/:id/schedule', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const { technician_id, date, slot } = req.body || {}
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  if (!['pending', 'recommended'].includes(order.status)) {
    return res.status(409).json({ error: `当前状态（${ORDER_STATUS[order.status]}）不可预约` })
  }
  const tech = await q(`SELECT u.id, u.name, t.status, t.high_altitude_cert FROM users u JOIN technicians t ON t.user_id = u.id WHERE u.id = $1`, [technician_id])
  if (!tech.rows.length) return res.status(404).json({ error: '师傅不存在' })
  if (tech.rows[0].status !== 'active') return res.status(409).json({ error: '该师傅已暂停接单' })
  // 高空风险订单仅可派给持高空作业证的师傅（资质影响派单）
  if (order.safety_risk === 'high' && !tech.rows[0].high_altitude_cert) {
    await logEvent(orderId, req.user, '预约被拦截：师傅无高空作业资质', { technician: tech.rows[0].name })
    return res.status(403).json({ error: '高空风险订单仅可派给持高空作业证的师傅' })
  }
  const slotOk = (order.time_slots || []).some((ts: any) => ts.date === date && ts.slot === slot)
  if (!slotOk) return res.status(400).json({ error: '所选时段不在居民可上门时段内' })
  if ((await slotFreeCount(technician_id, date, slot)) <= 0) {
    return res.status(409).json({ error: '该时段师傅档期已满' })
  }
  // 配件联动：故障适配配件必须有货，否则不允许安排上门
  const needed = await neededParts(order)
  const missing: string[] = []
  for (const p of needed) {
    if ((await partAvailability(p.id)) < 1) missing.push(p.name)
  }
  if (missing.length) {
    await logEvent(orderId, req.user, '预约被拦截：配件未到货', { missing })
    return res.status(409).json({ error: `配件尚未到货，暂不能安排上门：${missing.join('、')}`, missing })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`,
      [technician_id, date, slot, orderId]
    )
    for (const p of needed) {
      await client.query(
        `INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'reserved',$3)`,
        [orderId, p.id, p.batch_no]
      )
    }
    await client.query(
      `UPDATE orders SET status='scheduled', technician_id=$1, scheduled_date=$2, scheduled_slot=$3, updated_at=now() WHERE id=$4`,
      [technician_id, date, slot, orderId]
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  await logEvent(orderId, req.user, '居民预约上门', {
    technician: tech.rows[0].name, date, slot,
    reserved_parts: needed.map((p: any) => p.name),
  })
  res.json({ ok: true })
}))

/** 师傅到场签到（记录到达坐标，纳入到达轨迹） */
ordersRouter.post('/:id/checkin', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  if (order.status !== 'scheduled') return res.status(409).json({ error: '当前状态不可签到' })
  const lat = parseFloat(req.body?.lat)
  const lng = parseFloat(req.body?.lng)
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng)
  await q(`UPDATE orders SET status='arrived', checkin_lat=$1, checkin_lng=$2, updated_at=now() WHERE id=$3`,
    [hasLoc ? lat : null, hasLoc ? lng : null, orderId])
  if (hasLoc) {
    await q(`INSERT INTO tracks(order_id, lat, lng, note, created_by, created_by_name) VALUES($1,$2,$3,'到场签到',$4,$5)`,
      [orderId, lat, lng, req.user!.id, req.user!.name])
  }
  await logEvent(orderId, req.user, '师傅到场签到', {
    note: req.body?.note || '',
    ...(hasLoc ? { location: `${lat.toFixed(6)},${lng.toFixed(6)}` } : {}),
  })
  res.json({ ok: true })
}))

/** 记录师傅到达轨迹点（上门过程留痕，投诉还原用） */
ordersRouter.post('/:id/track', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.technician_id !== req.user!.id && order.support_technician_id !== req.user!.id) {
    return res.status(403).json({ error: '该订单未指派给你' })
  }
  const lat = parseFloat(req.body?.lat)
  const lng = parseFloat(req.body?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: '缺少有效坐标（lat/lng）' })
  }
  const note = req.body?.note || ''
  const ins = await q(
    `INSERT INTO tracks(order_id, lat, lng, note, created_by, created_by_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [orderId, lat, lng, note, req.user!.id, req.user!.name]
  )
  await logEvent(orderId, req.user, '记录到达轨迹', { location: `${lat.toFixed(6)},${lng.toFixed(6)}`, note })
  res.json({ id: ins.rows[0].id })
}))

/** 师傅提交高空风险确认单（需先上传风险照片） */
ordersRouter.post('/:id/risk-assessment', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  if (['completed', 'paid', 'reviewed', 'archived', 'cancelled'].includes(order.status)) {
    return res.status(409).json({ error: '订单已完结，不能发起风险确认' })
  }
  const photos = await q(`SELECT COUNT(*)::int AS c FROM evidence WHERE order_id=$1 AND stage='risk'`, [orderId])
  if (photos.rows[0].c === 0) {
    return res.status(409).json({ error: '请先上传高空风险照片（证据类型选「高空风险照片」）' })
  }
  const { floor, anchor_condition, need_two_person, danger_desc, fee_adjust_cents } = req.body || {}
  if (!danger_desc) return res.status(400).json({ error: '请填写危险情况说明' })
  const fee = Math.max(0, parseInt(fee_adjust_cents) || 0)
  const ins = await q(
    `INSERT INTO risk_assessments(order_id, technician_id, floor, anchor_condition, need_two_person, danger_desc, fee_adjust_cents)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orderId, req.user!.id, parseInt(floor) || order.floor, anchor_condition || '',
     !!need_two_person, danger_desc, fee]
  )
  await q(
    `INSERT INTO exceptions(order_id, type, title, description, created_by, created_by_name, created_by_role)
     VALUES($1,'high_altitude','高空作业风险确认',$2,$3,$4,'technician')`,
    [orderId, `${danger_desc}（${parseInt(floor) || order.floor} 层，${anchor_condition || '固定条件未知'}${need_two_person ? '，需双人作业' : ''}）`, req.user!.id, req.user!.name]
  )
  await logEvent(orderId, req.user, '上报高空风险确认', {
    floor: parseInt(floor) || order.floor, anchor_condition,
    need_two_person: !!need_two_person, danger_desc, fee_adjust_cents: fee,
  })
  res.json({ id: ins.rows[0].id })
}))

/** 上传上门证据（外观/旧损/检测/拆机/试机） */
ordersRouter.post('/:id/evidence', requireRole('technician', 'cs', 'admin'), upload.single('file'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (req.user!.role === 'technician' && order.technician_id !== req.user!.id) {
    return res.status(403).json({ error: '该订单未指派给你' })
  }
  if (!req.file) return res.status(400).json({ error: '请选择要上传的图片' })
  const stage = req.body.stage || 'other'
  const note = req.body.note || ''
  const ins = await q(
    `INSERT INTO evidence(order_id, stage, file_path, note, uploaded_by, uploaded_by_name)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [orderId, stage, `/uploads/${req.file.filename}`, note, req.user!.id, req.user!.name]
  )
  await logEvent(orderId, req.user, '上传证据', { stage, note, file: req.file.filename })
  res.json({ id: ins.rows[0].id, file_path: `/uploads/${req.file.filename}` })
}))

/** 师傅提交报价（支持多版本：追加项目 / 争议后重新报价） */
ordersRouter.post('/:id/quotes', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id = $1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  if (!['arrived', 'quote_pending', 'repairing'].includes(order.status)) {
    return res.status(409).json({ error: `当前状态（${ORDER_STATUS[order.status]}）不可报价` })
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (!items.length) return res.status(400).json({ error: '报价项目不能为空' })
  let total = 0
  for (const it of items) {
    const qty = parseInt(it.qty) || 1
    const price = parseInt(it.unit_price_cents) || 0
    total += qty * price
    it.qty = qty
    it.unit_price_cents = price
  }
  // 报价中的配件：检查库存并预留（已预留的复用）
  for (const it of items.filter((i: any) => i.kind === 'part' && i.part_id)) {
    const exist = await q(
      `SELECT * FROM order_parts WHERE order_id=$1 AND part_id=$2 AND status IN ('reserved','outbound','used')`,
      [orderId, it.part_id]
    )
    if (!exist.rows.length) {
      if ((await partAvailability(it.part_id)) < it.qty) {
        const p = await q(`SELECT name FROM parts WHERE id=$1`, [it.part_id])
        return res.status(409).json({ error: `配件「${p.rows[0]?.name || it.part_id}」库存不足，无法加入报价` })
      }
      const p = await q(`SELECT batch_no FROM parts WHERE id=$1`, [it.part_id])
      await q(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,$3,'reserved',$4)`,
        [orderId, it.part_id, it.qty, p.rows[0]?.batch_no || ''])
    }
  }
  const v = await q(`SELECT COALESCE(MAX(version),0)+1 AS v FROM quotes WHERE order_id=$1`, [orderId])
  const version = v.rows[0].v
  await q(`UPDATE quotes SET status='superseded' WHERE order_id=$1 AND status='pending'`, [orderId])
  const ins = await q(
    `INSERT INTO quotes(order_id, version, status, items, total_cents, remark, created_by, created_by_name)
     VALUES($1,$2,'pending',$3,$4,$5,$6,$7) RETURNING id`,
    [orderId, version, JSON.stringify(items), total, req.body?.remark || '', req.user!.id, req.user!.name]
  )
  await q(`UPDATE orders SET status='quote_pending', updated_at=now() WHERE id=$1`, [orderId])
  await logEvent(orderId, req.user, `提交报价 V${version}`, { total_cents: total, items: items.length, remark: req.body?.remark || '' })
  res.json({ id: ins.rows[0].id, version })
}))

/** 居民确认报价 */
ordersRouter.post('/:id/quotes/:qid/confirm', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const quoteId = parseInt(req.params.qid)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  const qr = await q(`SELECT * FROM quotes WHERE id=$1 AND order_id=$2`, [quoteId, orderId])
  const quote = qr.rows[0]
  if (!quote || quote.status !== 'pending') return res.status(409).json({ error: '报价不存在或已处理' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`UPDATE quotes SET status='confirmed', confirmed_by=$1, confirmed_at=now() WHERE id=$2`, [req.user!.name, quoteId])
    // 报价确认 → 该报价涉及的预留配件出库
    const partItems = (quote.items || []).filter((i: any) => i.kind === 'part' && i.part_id)
    for (const it of partItems) {
      const op = await client.query(
        `SELECT * FROM order_parts WHERE order_id=$1 AND part_id=$2 AND status='reserved' ORDER BY id LIMIT 1`,
        [orderId, it.part_id]
      )
      if (op.rows.length) {
        await client.query(`UPDATE order_parts SET status='outbound', updated_at=now() WHERE id=$1`, [op.rows[0].id])
        await client.query(`UPDATE parts SET stock = stock - $1 WHERE id=$2`, [op.rows[0].qty, it.part_id])
      }
    }
    await client.query(`UPDATE orders SET status='quote_confirmed', updated_at=now() WHERE id=$1`, [orderId])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  await logEvent(orderId, req.user, `确认报价 V${quote.version}`, { total_cents: quote.total_cents })
  res.json({ ok: true })
}))

/** 居民对报价发起争议 */
ordersRouter.post('/:id/quotes/:qid/dispute', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const quoteId = parseInt(req.params.qid)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  const qr = await q(`SELECT * FROM quotes WHERE id=$1 AND order_id=$2`, [quoteId, orderId])
  const quote = qr.rows[0]
  if (!quote || quote.status !== 'pending') return res.status(409).json({ error: '报价不存在或已处理' })
  await q(`UPDATE quotes SET status='disputed' WHERE id=$1`, [quoteId])
  const reason = req.body?.reason || '居民认为报价不合理'
  await q(
    `INSERT INTO exceptions(order_id, type, title, description, created_by, created_by_name, created_by_role)
     VALUES($1,'quote_dispute',$2,$3,$4,$5,'resident')`,
    [orderId, `报价争议（V${quote.version}）`, reason, req.user!.id, req.user!.name]
  )
  await logEvent(orderId, req.user, '发起报价争议', { version: quote.version, reason })
  res.json({ ok: true })
}))

/** 师傅开始维修 */
ordersRouter.post('/:id/start-repair', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  if (order.status !== 'quote_confirmed') return res.status(409).json({ error: '需先由居民确认报价' })
  await q(`UPDATE orders SET status='repairing', updated_at=now() WHERE id=$1`, [orderId])
  await logEvent(orderId, req.user, '开始维修', {})
  res.json({ ok: true })
}))

/** 师傅登记使用配件（或仓库出库后师傅确认装上） */
ordersRouter.post('/:id/use-part', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  const { order_part_id, part_id, qty } = req.body || {}
  if (order_part_id) {
    const op = await q(`SELECT * FROM order_parts WHERE id=$1 AND order_id=$2`, [order_part_id, orderId])
    if (!op.rows.length) return res.status(404).json({ error: '配件记录不存在' })
    if (op.rows[0].status === 'reserved') {
      await q(`UPDATE parts SET stock = stock - $1 WHERE id=$2`, [op.rows[0].qty, op.rows[0].part_id])
    }
    await q(`UPDATE order_parts SET status='used', updated_at=now() WHERE id=$1`, [order_part_id])
    const p = await q(`SELECT name, model FROM parts WHERE id=$1`, [op.rows[0].part_id])
    await logEvent(orderId, req.user, '登记更换配件', { part: p.rows[0]?.name, model: p.rows[0]?.model, qty: op.rows[0].qty, batch_no: op.rows[0].batch_no })
  } else if (part_id) {
    const n = parseInt(qty) || 1
    if ((await partAvailability(part_id)) < n) return res.status(409).json({ error: '该配件库存不足' })
    const p = await q(`SELECT * FROM parts WHERE id=$1`, [part_id])
    await q(`UPDATE parts SET stock = stock - $1 WHERE id=$2`, [n, part_id])
    await q(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,$3,'used',$4)`,
      [orderId, part_id, n, p.rows[0].batch_no])
    await logEvent(orderId, req.user, '登记更换配件', { part: p.rows[0].name, model: p.rows[0].model, qty: n, batch_no: p.rows[0].batch_no })
  } else {
    return res.status(400).json({ error: '缺少配件参数' })
  }
  await touchOrder(orderId)
  res.json({ ok: true })
}))

/** 师傅完成维修（试机结果 + 收费明细） */
ordersRouter.post('/:id/complete', requireRole('technician'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.technician_id !== req.user!.id) return res.status(403).json({ error: '该订单未指派给你' })
  if (order.status !== 'repairing') return res.status(409).json({ error: '订单不在维修中' })
  const { test_result, test_note, fee_adjust_cents, fee_note } = req.body || {}
  if (!['pass', 'fail'].includes(test_result)) return res.status(400).json({ error: '请填写试机结果（pass/fail）' })
  if (test_result === 'fail') {
    await q(`UPDATE orders SET test_result='fail', test_note=$1, updated_at=now() WHERE id=$2`, [test_note || '', orderId])
    await logEvent(orderId, req.user, '试机未通过，继续维修', { test_note })
    return res.json({ ok: true, status: 'repairing' })
  }
  const adjust = parseInt(fee_adjust_cents) || 0
  const start = today()
  // 费用调整为累加制：高空作业费、双人作业费等已入账费用不被覆盖
  await q(
    `UPDATE orders SET status='completed', test_result='pass', test_note=$1,
       fee_adjust_cents = fee_adjust_cents + $2,
       fee_note = CASE WHEN $3 = '' THEN fee_note WHEN fee_note = '' THEN $3 ELSE fee_note || '；' || $3 END,
       updated_at=now() WHERE id=$4`,
    [test_note || '', adjust, fee_note || '', orderId]
  )
  await q(
    `INSERT INTO warranties(order_id, period_days, start_date, end_date, status) VALUES($1,$2,$3,$4,'active')`,
    [orderId, WARRANTY_DAYS, start, addDays(start, WARRANTY_DAYS)]
  )
  await logEvent(orderId, req.user, '维修完成，试机通过', {
    test_note, fee_adjust_cents: adjust, fee_note, warranty_days: WARRANTY_DAYS,
  })
  res.json({ ok: true })
}))

/** 居民支付 */
ordersRouter.post('/:id/pay', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  if (order.status !== 'completed') return res.status(409).json({ error: '订单不在待支付状态' })
  const quote = await q(
    `SELECT * FROM quotes WHERE order_id=$1 AND status='confirmed' ORDER BY version DESC LIMIT 1`, [orderId]
  )
  const base = quote.rows[0]?.total_cents || 0
  const amount = order.is_warranty_rework ? 0 : base + (order.fee_adjust_cents || 0)
  await q(`INSERT INTO payments(order_id, amount_cents, method, status) VALUES($1,$2,$3,'paid')`,
    [orderId, amount, req.body?.method || 'online'])
  await q(`UPDATE orders SET status='paid', updated_at=now() WHERE id=$1`, [orderId])
  await logEvent(orderId, req.user, '支付完成', { amount_cents: amount, method: req.body?.method || 'online' })
  res.json({ ok: true, amount_cents: amount })
}))

/** 居民评价（评价后自动归档） */
ordersRouter.post('/:id/review', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  if (order.status !== 'paid') return res.status(409).json({ error: '订单不在可评价状态' })
  const rating = Math.min(5, Math.max(1, parseInt(req.body?.rating) || 5))
  await q(`INSERT INTO reviews(order_id, rating, tags, comment) VALUES($1,$2,$3,$4)`,
    [orderId, rating, JSON.stringify(req.body?.tags || []), req.body?.comment || ''])
  await q(`UPDATE orders SET status='archived', updated_at=now() WHERE id=$1`, [orderId])
  await logEvent(orderId, req.user, '提交评价', { rating, comment: req.body?.comment || '' })
  await logEvent(orderId, null, '订单归档', { note: '证据链、报价、配件追溯、质保信息已入档' })
  res.json({ ok: true })
}))

/** 质保期内故障复发 → 发起返修（生成关联返修单 + 异常记录） */
ordersRouter.post('/:id/rework', requireRole('resident'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order || order.resident_id !== req.user!.id) return res.status(403).json({ error: '无权操作该订单' })
  if (!DONE_STATUS.includes(order.status)) return res.status(409).json({ error: '订单尚未完成，不能返修' })
  const w = await q(`SELECT * FROM warranties WHERE order_id=$1 ORDER BY id DESC LIMIT 1`, [orderId])
  const warranty = w.rows[0]
  if (!warranty || warranty.end_date < today()) {
    return res.status(409).json({ error: '质保期已过，请新建普通报修单' })
  }
  const desc = req.body?.fault_desc || '质保期内故障复发'
  const slots = Array.isArray(req.body?.time_slots) && req.body.time_slots.length
    ? req.body.time_slots
    : [
        { date: addDays(today(), 1), slot: SLOTS[0] },
        { date: addDays(today(), 1), slot: SLOTS[1] },
        { date: addDays(today(), 2), slot: SLOTS[0] },
      ]
  const no = orderNo()
  const ins = await q(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status, safety_risk,
       original_order_id, is_warranty_rework)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'recommended',$16,$17,true) RETURNING id`,
    [no, order.resident_id, order.device_type, order.brand, order.model, order.fault_type, desc,
     order.purchase_years, order.floor, order.has_elevator, order.community, order.address,
     order.lat, order.lng, JSON.stringify(slots), order.safety_risk, orderId]
  )
  const newId = ins.rows[0].id
  await q(
    `INSERT INTO exceptions(order_id, type, title, description, created_by, created_by_name, created_by_role)
     VALUES($1,'fault_recurrence','维修后故障复发',$2,$3,$4,'resident')`,
    [orderId, `${desc}（已生成返修单 ${no}）`, req.user!.id, req.user!.name]
  )
  await logEvent(orderId, req.user, '质保期内故障复发，发起返修', { rework_order_no: no, desc })
  await logEvent(newId, req.user, '生成质保返修单', { original_order_no: order.order_no, free: true })
  res.json({ id: newId, order_no: no })
}))

/** 取消订单（释放预留配件与档期） */
ordersRouter.post('/:id/cancel', requireRole('resident', 'cs', 'admin'), h(async (req, res) => {
  const orderId = parseInt(req.params.id)
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (req.user!.role === 'resident' && order.resident_id !== req.user!.id) {
    return res.status(403).json({ error: '无权操作该订单' })
  }
  if (DONE_STATUS.includes(order.status) || order.status === 'cancelled') {
    return res.status(409).json({ error: '订单已完成或已取消' })
  }
  await q(`DELETE FROM order_parts WHERE order_id=$1 AND status='reserved'`, [orderId])
  await q(`DELETE FROM schedule WHERE order_id=$1`, [orderId])
  await q(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [orderId])
  await logEvent(orderId, req.user, '取消订单', { reason: req.body?.reason || '' })
  res.json({ ok: true })
}))
