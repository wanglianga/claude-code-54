import { Router, Request, Response, NextFunction } from 'express'
import { q, logEvent, partsAvailabilityMap } from '../db'
import { AuthedRequest, authRequired, requireRole, today } from '../util'
import {
  DEVICE_TYPES, BRANDS, FAULTS, COMMUNITIES, SLOTS, EVIDENCE_STAGES,
  EXCEPTION_TYPES, EXCEPTION_LABEL, ORDER_STATUS, DONE_STATUS, WARRANTY_DAYS,
  ANCHOR_CONDITIONS, RISK_ACTIONS, RISK_ACTION_LABEL,
} from '../meta'
import { slotFreeCount } from '../recommend'

export const collabRouter = Router()
collabRouter.use(authRequired)

const h = (fn: (req: AuthedRequest, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next)

/** 元数据（表单选项） */
collabRouter.get('/meta', h(async (_req, res) => {
  res.json({
    device_types: DEVICE_TYPES, brands: BRANDS, faults: FAULTS, communities: COMMUNITIES,
    slots: SLOTS, evidence_stages: EVIDENCE_STAGES, exception_types: EXCEPTION_TYPES,
    order_status: ORDER_STATUS, warranty_days: WARRANTY_DAYS,
    anchor_conditions: ANCHOR_CONDITIONS, risk_actions: RISK_ACTIONS,
  })
}))

/* ---------------- 异常协同 ---------------- */

collabRouter.get('/exceptions', h(async (req, res) => {
  const u = req.user!
  const conds: string[] = []
  const params: any[] = []
  if (u.role === 'resident') { params.push(u.id); conds.push(`o.resident_id = $${params.length}`) }
  if (u.role === 'technician') { params.push(u.id); conds.push(`o.technician_id = $${params.length}`) }
  if (u.role === 'warehouse') { conds.push(`e.type = 'parts_mismatch'`) }
  if (req.query.status) { params.push(req.query.status); conds.push(`e.status = $${params.length}`) }
  if (req.query.type) { params.push(req.query.type); conds.push(`e.type = $${params.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await q(
    `SELECT e.*, o.order_no, o.device_type, o.brand, o.status AS order_status,
            ru.name AS resident_name, tu.name AS technician_name
     FROM exceptions e
     JOIN orders o ON o.id = e.order_id
     LEFT JOIN users ru ON ru.id = o.resident_id
     LEFT JOIN users tu ON tu.id = o.technician_id
     ${where} ORDER BY e.status = 'open' DESC, e.created_at DESC LIMIT 200`,
    params
  )
  res.json(r.rows.map((x: any) => ({ ...x, type_label: EXCEPTION_LABEL[x.type] || x.type })))
}))

/** 围绕订单创建异常（居民/师傅/客服/仓库均可发起对应类型） */
collabRouter.post('/orders/:id/exceptions', h(async (req, res) => {
  const u = req.user!
  const orderId = parseInt(req.params.id)
  const { type, title, description } = req.body || {}
  if (!EXCEPTION_LABEL[type]) return res.status(400).json({ error: '未知异常类型' })
  const r = await q(`SELECT * FROM orders WHERE id=$1`, [orderId])
  const order = r.rows[0]
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (u.role === 'resident' && order.resident_id !== u.id) return res.status(403).json({ error: '无权操作该订单' })
  if (u.role === 'technician' && order.technician_id !== u.id) return res.status(403).json({ error: '该订单未指派给你' })
  const ins = await q(
    `INSERT INTO exceptions(order_id, type, title, description, created_by, created_by_name, created_by_role)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orderId, type, title || EXCEPTION_LABEL[type], description || '', u.id, u.name, u.role]
  )
  await logEvent(orderId, u, `发起异常：${EXCEPTION_LABEL[type]}`, { title, description })
  res.json({ id: ins.rows[0].id })
}))

/** 处理/关闭异常（客服全部类型，仓库处理配件不匹配，平台全部） */
collabRouter.post('/exceptions/:id/resolve', requireRole('cs', 'warehouse', 'admin'), h(async (req, res) => {
  const u = req.user!
  const id = parseInt(req.params.id)
  const r = await q(`SELECT e.*, o.order_no FROM exceptions e JOIN orders o ON o.id=e.order_id WHERE e.id=$1`, [id])
  const ex = r.rows[0]
  if (!ex) return res.status(404).json({ error: '异常不存在' })
  if (u.role === 'warehouse' && ex.type !== 'parts_mismatch') {
    return res.status(403).json({ error: '仓库仅处理配件不匹配异常' })
  }
  if (ex.status === 'resolved') return res.status(409).json({ error: '该异常已处理' })
  const { resolution, action } = req.body || {}
  await q(
    `UPDATE exceptions SET status='resolved', resolution=$1, handler_id=$2, handler_name=$3, resolved_at=now() WHERE id=$4`,
    [resolution || '', u.id, u.name, id]
  )
  // 联动动作：报价争议 → 要求师傅重新报价 / 取消订单
  if (action === 'requote') {
    await q(`UPDATE quotes SET status='superseded' WHERE order_id=$1 AND status IN ('pending','disputed')`, [ex.order_id])
    await q(`UPDATE orders SET status='arrived', updated_at=now() WHERE id=$1`, [ex.order_id])
  }
  if (action === 'cancel_order') {
    await q(`DELETE FROM order_parts WHERE order_id=$1 AND status='reserved'`, [ex.order_id])
    await q(`DELETE FROM schedule WHERE order_id=$1`, [ex.order_id])
    await q(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [ex.order_id])
  }
  await logEvent(ex.order_id, u, `异常已处理：${EXCEPTION_LABEL[ex.type]}`, {
    resolution: resolution || '', action: action || 'none',
  })
  res.json({ ok: true })
}))

/* ---------------- 高空风险确认处置（客服/平台） ---------------- */

collabRouter.post('/risk-assessments/:id/resolve', requireRole('cs', 'admin'), h(async (req, res) => {
  const u = req.user!
  const id = parseInt(req.params.id)
  const r = await q(`SELECT * FROM risk_assessments WHERE id=$1`, [id])
  const ra = r.rows[0]
  if (!ra) return res.status(404).json({ error: '风险确认单不存在' })
  if (ra.status !== 'pending') return res.status(409).json({ error: '该风险确认单已处理' })
  const { action, note, new_date, new_slot, support_technician_id } = req.body || {}
  if (!['continue', 'reschedule', 'reinforce', 'cancel'].includes(action)) {
    return res.status(400).json({ error: '非法处置动作' })
  }
  const order = (await q(`SELECT * FROM orders WHERE id=$1`, [ra.order_id])).rows[0]
  if (!order) return res.status(404).json({ error: '关联订单不存在' })

  if (action === 'continue') {
    // 确认风险继续维修：加收高空作业费，居民端可见费用变化
    await q(
      `UPDATE orders SET fee_adjust_cents = fee_adjust_cents + $1,
         fee_note = CASE WHEN fee_note = '' THEN $2 ELSE fee_note || '；' || $2 END, updated_at=now() WHERE id=$3`,
      [ra.fee_adjust_cents, `高空作业费(${ra.floor}层)`, ra.order_id]
    )
  }
  if (action === 'reschedule') {
    if (!new_date || !new_slot) return res.status(400).json({ error: '改期需选择新时段' })
    // 改期影响师傅排班：释放旧档期，占用新档期（含加派师傅）
    await q(`DELETE FROM schedule WHERE order_id=$1`, [ra.order_id])
    await q(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [order.technician_id, new_date, new_slot, ra.order_id])
    if (order.support_technician_id) {
      await q(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [order.support_technician_id, new_date, new_slot, ra.order_id])
    }
    await q(`UPDATE orders SET scheduled_date=$1, scheduled_slot=$2, status='scheduled', updated_at=now() WHERE id=$3`,
      [new_date, new_slot, ra.order_id])
  }
  if (action === 'reinforce') {
    if (!support_technician_id) return res.status(400).json({ error: '加派需选择支援师傅' })
    const sup = await q(
      `SELECT u.id, u.name, t.status, t.high_altitude_cert FROM users u JOIN technicians t ON t.user_id=u.id WHERE u.id=$1`,
      [support_technician_id]
    )
    if (!sup.rows.length) return res.status(404).json({ error: '支援师傅不存在' })
    if (sup.rows[0].status !== 'active') return res.status(409).json({ error: '支援师傅已暂停接单' })
    if (order.safety_risk === 'high' && !sup.rows[0].high_altitude_cert) {
      return res.status(409).json({ error: '高空风险订单的支援师傅也需持高空作业证' })
    }
    if ((await slotFreeCount(support_technician_id, order.scheduled_date, order.scheduled_slot)) <= 0) {
      return res.status(409).json({ error: '支援师傅该时段档期已满' })
    }
    // 加派影响排班（支援师傅占用档期）与费用（双人作业费）
    await q(
      `UPDATE orders SET support_technician_id=$1, fee_adjust_cents = fee_adjust_cents + $2,
         fee_note = CASE WHEN fee_note = '' THEN $3 ELSE fee_note || '；' || $3 END, updated_at=now() WHERE id=$4`,
      [support_technician_id, ra.fee_adjust_cents, `双人高空作业费(${ra.floor}层)`, ra.order_id]
    )
    await q(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [support_technician_id, order.scheduled_date, order.scheduled_slot, ra.order_id])
    await q(`UPDATE risk_assessments SET support_technician_id=$1 WHERE id=$2`, [support_technician_id, id])
  }
  if (action === 'cancel') {
    await q(`DELETE FROM order_parts WHERE order_id=$1 AND status='reserved'`, [ra.order_id])
    await q(`DELETE FROM schedule WHERE order_id=$1`, [ra.order_id])
    await q(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [ra.order_id])
  }

  const statusMap: Record<string, string> = { continue: 'confirmed', reschedule: 'rescheduled', reinforce: 'reinforced', cancel: 'cancelled' }
  await q(
    `UPDATE risk_assessments SET status=$1, cs_action=$2, cs_note=$3, handler_id=$4, handler_name=$5, new_date=$6, new_slot=$7, resolved_at=now() WHERE id=$8`,
    [statusMap[action], action, note || '', u.id, u.name, new_date || '', new_slot || '', id]
  )
  // 高空风险确认计入师傅高空资质档案（影响派单资质）
  await q(`UPDATE technicians SET risk_reports = risk_reports + 1 WHERE user_id=$1`, [ra.technician_id])
  // 关联高空异常同步闭环
  await q(
    `UPDATE exceptions SET status='resolved', resolution=$1, handler_id=$2, handler_name=$3, resolved_at=now()
     WHERE order_id=$4 AND type='high_altitude' AND status='open'`,
    [`高空风险已确认：${RISK_ACTION_LABEL[action]}${note ? `（${note}）` : ''}`, u.id, u.name, ra.order_id]
  )
  await logEvent(ra.order_id, u, `高空风险处置：${RISK_ACTION_LABEL[action]}`, {
    note: note || '', new_date: new_date || '', new_slot: new_slot || '',
    support_technician_id: support_technician_id || null, fee_adjust_cents: ra.fee_adjust_cents,
  })
  res.json({ ok: true })
}))

/* ---------------- 配件仓库 ---------------- */

collabRouter.get('/parts', h(async (_req, res) => {
  const avail = await partsAvailabilityMap()
  const r = await q(`SELECT * FROM parts ORDER BY device_type, id`)
  res.json(r.rows.map((p: any) => ({ ...p, available: avail.get(p.id) ?? p.stock })))
}))

collabRouter.post('/parts', requireRole('warehouse', 'admin'), h(async (req, res) => {
  const b = req.body || {}
  if (!b.sku || !b.name || !b.device_type) return res.status(400).json({ error: '缺少必填字段' })
  const ins = await q(
    `INSERT INTO parts(sku, name, device_type, brands, faults, stock, price_cents, batch_no, supplier, model)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [b.sku, b.name, b.device_type, JSON.stringify(b.brands || []), JSON.stringify(b.faults || []),
     parseInt(b.stock) || 0, parseInt(b.price_cents) || 0, b.batch_no || '', b.supplier || '', b.model || '']
  )
  res.json({ id: ins.rows[0].id })
}))

collabRouter.post('/parts/:id/restock', requireRole('warehouse', 'admin'), h(async (req, res) => {
  const id = parseInt(req.params.id)
  const qty = parseInt(req.body?.qty) || 0
  if (qty <= 0) return res.status(400).json({ error: '补货数量需大于 0' })
  const r = await q(`UPDATE parts SET stock = stock + $1 WHERE id=$2 RETURNING name, stock`, [qty, id])
  if (!r.rows.length) return res.status(404).json({ error: '配件不存在' })
  res.json({ ok: true, name: r.rows[0].name, stock: r.rows[0].stock })
}))

/** 配件追溯：批号 → 用在哪些订单 → 是否返修 */
collabRouter.get('/parts/:id/trace', h(async (req, res) => {
  const id = parseInt(req.params.id)
  const p = await q(`SELECT * FROM parts WHERE id=$1`, [id])
  if (!p.rows.length) return res.status(404).json({ error: '配件不存在' })
  const usage = await q(
    `SELECT op.id AS order_part_id, op.status AS part_status, op.qty, op.batch_no, op.updated_at,
            o.id AS order_id, o.order_no, o.status AS order_status, o.device_type, o.brand,
            u.name AS technician_name, r.name AS resident_name,
            (SELECT COUNT(*)::int FROM orders rw WHERE rw.original_order_id = o.id AND rw.is_warranty_rework) AS rework_count
     FROM order_parts op
     JOIN orders o ON o.id = op.order_id
     LEFT JOIN users u ON u.id = o.technician_id
     LEFT JOIN users r ON r.id = o.resident_id
     WHERE op.part_id = $1 ORDER BY op.id DESC LIMIT 100`,
    [id]
  )
  res.json({ part: p.rows[0], usage: usage.rows })
}))

/** 仓库视角的配件出入库流水 */
collabRouter.get('/order-parts', requireRole('warehouse', 'admin', 'cs'), h(async (req, res) => {
  const conds: string[] = []
  const params: any[] = []
  if (req.query.status) { params.push(req.query.status); conds.push(`op.status = $${params.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await q(
    `SELECT op.*, p.name AS part_name, p.sku, o.order_no, o.id AS order_id2, o.status AS order_status,
            u.name AS technician_name
     FROM order_parts op
     JOIN parts p ON p.id = op.part_id
     JOIN orders o ON o.id = op.order_id
     LEFT JOIN users u ON u.id = o.technician_id
     ${where} ORDER BY op.id DESC LIMIT 200`,
    params
  )
  res.json(r.rows)
}))

/** 仓库手动出库（预留 → 出库，扣实物库存） */
collabRouter.post('/order-parts/:id/outbound', requireRole('warehouse', 'admin'), h(async (req, res) => {
  const id = parseInt(req.params.id)
  const r = await q(`SELECT op.*, p.name FROM order_parts op JOIN parts p ON p.id=op.part_id WHERE op.id=$1`, [id])
  const op = r.rows[0]
  if (!op) return res.status(404).json({ error: '记录不存在' })
  if (op.status !== 'reserved') return res.status(409).json({ error: '仅预留状态可出库' })
  await q(`UPDATE order_parts SET status='outbound', updated_at=now() WHERE id=$1`, [id])
  await q(`UPDATE parts SET stock = stock - $1 WHERE id=$2`, [op.qty, op.part_id])
  await logEvent(op.order_id, req.user, '仓库配件出库', { part: op.name, qty: op.qty, batch_no: op.batch_no })
  res.json({ ok: true })
}))

/* ---------------- 师傅日程 ---------------- */

collabRouter.get('/schedule', h(async (req, res) => {
  const u = req.user!
  let techId = u.role === 'technician' ? u.id : parseInt(req.query.technician_id as string)
  if (!techId) return res.status(400).json({ error: '缺少 technician_id' })
  if (u.role === 'technician' && techId !== u.id) return res.status(403).json({ error: '仅可查看本人日程' })
  const params: any[] = [techId]
  let dateCond = ''
  if (req.query.date) { params.push(req.query.date); dateCond = `AND s.date = $${params.length}` }
  const r = await q(
    `SELECT s.*, o.order_no, o.device_type, o.brand, o.status AS order_status, o.address, o.community,
            o.scheduled_slot, r.name AS resident_name
     FROM schedule s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN users r ON r.id = o.resident_id
     WHERE s.technician_id = $1 ${dateCond} AND o.status != 'cancelled'
     ORDER BY s.date, s.slot`,
    params
  )
  res.json(r.rows)
}))

/* ---------------- 平台：师傅与统计 ---------------- */

collabRouter.get('/technicians', requireRole('admin', 'cs'), h(async (_req, res) => {
  const r = await q(
    `SELECT u.id, u.name, u.phone, t.skills, t.high_altitude_cert, t.community, t.status, t.risk_reports, t.created_at
     FROM technicians t JOIN users u ON u.id = t.user_id ORDER BY u.id`
  )
  const stats = await technicianStats()
  const statMap = new Map(stats.map((s: any) => [s.technician_id, s]))
  res.json(r.rows.map((t: any) => ({
    ...t,
    stats: statMap.get(t.id) || {
      done: 0, rework: 0, rework_rate: null, avg_rating: null, exception_count: 0,
      admission_hint: '样本不足，继续观察',
    },
  })))
}))

collabRouter.patch('/technicians/:id', requireRole('admin'), h(async (req, res) => {
  const id = parseInt(req.params.id)
  const { status, high_altitude_cert } = req.body || {}
  const u = await q(`SELECT name FROM users WHERE id=$1`, [id])
  if (!u.rows.length) return res.status(404).json({ error: '师傅不存在' })
  if (status !== undefined) {
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: '非法状态' })
    await q(`UPDATE technicians SET status=$1 WHERE user_id=$2`, [status, id])
    // 记录到该师傅未完成订单的时间线（便于追溯）
    await q(
      `INSERT INTO order_events(order_id, actor_id, actor_name, actor_role, action, detail)
       SELECT o.id, $1, $2, 'admin', $3, $4 FROM orders o
       WHERE o.technician_id=$5 AND o.status IN ('scheduled','arrived','quote_pending','quote_confirmed','repairing')`,
      [req.user!.id, req.user!.name, status === 'suspended' ? '师傅被暂停准入' : '师傅恢复准入', JSON.stringify({ technician: u.rows[0].name }), id]
    )
  }
  if (high_altitude_cert !== undefined) {
    // 高空作业资质授予/吊销：直接影响高空风险订单派单
    await q(`UPDATE technicians SET high_altitude_cert=$1 WHERE user_id=$2`, [!!high_altitude_cert, id])
    await q(
      `INSERT INTO order_events(order_id, actor_id, actor_name, actor_role, action, detail)
       SELECT o.id, $1, $2, 'admin', $3, $4 FROM orders o
       WHERE o.technician_id=$5 AND o.status IN ('scheduled','arrived','quote_pending','quote_confirmed','repairing')`,
      [req.user!.id, req.user!.name, high_altitude_cert ? '高空作业资质授予' : '高空作业资质吊销', JSON.stringify({ technician: u.rows[0].name }), id]
    )
  }
  res.json({ ok: true })
}))

async function technicianStats() {
  const r = await q(`
    SELECT o.technician_id,
      COUNT(*) FILTER (WHERE o.status IN ('completed','paid','reviewed','archived'))::int AS done,
      (SELECT COUNT(*) FROM orders rw JOIN orders o2 ON o2.id = rw.original_order_id
        WHERE rw.is_warranty_rework AND o2.technician_id = o.technician_id)::int AS rework,
      (SELECT AVG(rv.rating)::numeric(3,1) FROM reviews rv JOIN orders o3 ON o3.id = rv.order_id
        WHERE o3.technician_id = o.technician_id) AS avg_rating,
      (SELECT COUNT(*) FROM exceptions e JOIN orders o4 ON o4.id = e.order_id
        WHERE o4.technician_id = o.technician_id)::int AS exception_count
    FROM orders o WHERE o.technician_id IS NOT NULL GROUP BY o.technician_id
  `)
  return r.rows.map((s: any) => {
    const avg = s.avg_rating ? parseFloat(s.avg_rating) : null
    const rate = s.done > 0 ? s.rework / s.done : null
    return {
      ...s,
      avg_rating: avg,
      rework_rate: rate,
      // 准入规则：完成 ≥3 单且返修率 >20% → 建议暂停准入；返修率 ≤10% 且评分 ≥4.5 → 优质师傅
      admission_hint: s.done >= 3 && rate !== null && rate > 0.2
        ? '返修率偏高，建议暂停准入'
        : rate !== null && rate <= 0.1 && (avg ?? 0) >= 4.5
          ? '优质师傅，可优先派单'
          : s.done < 3 ? '样本不足，继续观察' : '正常',
    }
  })
}

collabRouter.get('/stats/overview', requireRole('admin', 'cs'), h(async (_req, res) => {
  const r = await q(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('completed','paid','reviewed','archived'))::int AS done,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','paid','reviewed','archived','cancelled'))::int AS active,
      COUNT(*) FILTER (WHERE is_warranty_rework)::int AS rework_orders
    FROM orders
  `)
  const ex = await q(`SELECT COUNT(*)::int AS open FROM exceptions WHERE status='open'`)
  const pay = await q(`SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM payments WHERE status='paid'`)
  res.json({ ...r.rows[0], open_exceptions: ex.rows[0].open, revenue_cents: pay.rows[0].total })
}))

/** 返修率统计：按师傅 / 按品类 / 按配件 */
collabRouter.get('/stats/rework', requireRole('admin', 'cs'), h(async (req, res) => {
  const group = (req.query.group as string) || 'technician'
  if (group === 'technician') {
    const techs = await q(`SELECT u.id, u.name FROM technicians t JOIN users u ON u.id=t.user_id`)
    const stats = await technicianStats()
    const m = new Map(stats.map((s: any) => [s.technician_id, s]))
    return res.json(techs.rows.map((t: any) => {
      const s: any = m.get(t.id) || {
        done: 0, rework: 0, rework_rate: null, avg_rating: null, exception_count: 0,
        admission_hint: '样本不足，继续观察',
      }
      return {
        key: t.id, name: t.name, done: s.done, rework: s.rework,
        rework_rate: s.rework_rate, avg_rating: s.avg_rating, exception_count: s.exception_count,
        admission_hint: s.admission_hint,
      }
    }))
  }
  if (group === 'category') {
    const r = await q(`
      SELECT o.device_type AS key,
        COUNT(*) FILTER (WHERE o.status IN ('completed','paid','reviewed','archived'))::int AS done,
        (SELECT COUNT(*) FROM orders rw JOIN orders o2 ON o2.id = rw.original_order_id
          WHERE rw.is_warranty_rework AND o2.device_type = o.device_type)::int AS rework
      FROM orders o WHERE o.technician_id IS NOT NULL GROUP BY o.device_type
    `)
    return res.json(r.rows.map((x: any) => {
      const rate = x.done > 0 ? x.rework / x.done : null
      return {
        ...x, rework_rate: rate,
        suggestion: x.done < 3 ? '样本不足'
          : rate !== null && rate <= 0.05 ? '适合社区快修'
          : rate !== null && rate <= 0.15 ? '谨慎快修，建议加强复检'
          : '建议转品牌售后',
      }
    }))
  }
  // group === 'part'
  const r = await q(`
    SELECT p.id AS key, p.name, p.sku, p.device_type,
      COUNT(*) FILTER (WHERE op.status = 'used')::int AS used,
      (SELECT COUNT(*) FROM orders rw
        JOIN orders o2 ON o2.id = rw.original_order_id
        JOIN order_parts op2 ON op2.order_id = o2.id AND op2.part_id = p.id AND op2.status = 'used'
        WHERE rw.is_warranty_rework)::int AS rework
    FROM parts p
    LEFT JOIN order_parts op ON op.part_id = p.id
    GROUP BY p.id ORDER BY p.id
  `)
  res.json(r.rows.map((x: any) => ({
    ...x, rework_rate: x.used > 0 ? x.rework / x.used : null,
    suggestion: x.used < 3 ? '样本不足'
      : x.rework / Math.max(1, x.used) > 0.15 ? '该配件质量存疑，建议更换供应商'
      : '正常',
  })))
}))

/** 平台档案库：全部订单（可过滤） */
collabRouter.get('/archives', requireRole('admin', 'cs'), h(async (req, res) => {
  const conds: string[] = []
  const params: any[] = []
  if (req.query.status) { params.push(req.query.status); conds.push(`o.status = $${params.length}`) }
  if (req.query.device_type) { params.push(req.query.device_type); conds.push(`o.device_type = $${params.length}`) }
  if (req.query.technician_id) { params.push(req.query.technician_id); conds.push(`o.technician_id = $${params.length}`) }
  if (req.query.keyword) {
    params.push(`%${req.query.keyword}%`)
    conds.push(`(o.order_no ILIKE $${params.length} OR o.address ILIKE $${params.length} OR o.brand ILIKE $${params.length})`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await q(
    `SELECT o.*, r.name AS resident_name, t.name AS technician_name,
       (SELECT COUNT(*)::int FROM exceptions e WHERE e.order_id=o.id) AS exception_count,
       (SELECT COUNT(*)::int FROM evidence ev WHERE ev.order_id=o.id) AS evidence_count
     FROM orders o
     LEFT JOIN users r ON r.id = o.resident_id
     LEFT JOIN users t ON t.id = o.technician_id
     ${where} ORDER BY o.created_at DESC LIMIT 300`,
    params
  )
  res.json(r.rows)
}))

/** 今日日期（前端计算时段用） */
collabRouter.get('/today', h(async (_req, res) => {
  res.json({ today: today() })
}))
