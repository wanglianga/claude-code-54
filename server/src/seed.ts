import fs from 'fs'
import path from 'path'
import { pool } from './db'
import { hashPassword, addDays } from './util'
import { DEVICE_LABEL, FAULT_LABEL, SLOTS, WARRANTY_DAYS } from './meta'

/** 种子数据在单事务内执行，失败整体回滚，避免半初始化状态 */
let tx: any = null
async function s(text: string, params?: any[]) {
  return (tx || pool).query(text, params)
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/uploads')

function daysAgo(n: number, hour = 9): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, Math.floor(Math.random() * 50) + 5, 0, 0)
  return d
}
function dateStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 生成占位证据图（SVG），模拟现场拍照上传 */
function svgEvidence(orderNo: string, label: string, color: string): string {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const name = `seed-${orderNo}-${label.replace(/\W+/g, '')}.svg`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="640" height="400" fill="${color}"/>
  <rect x="16" y="16" width="608" height="368" fill="none" stroke="#ffffff" stroke-width="4" stroke-dasharray="12 8"/>
  <text x="320" y="180" font-size="40" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${label}</text>
  <text x="320" y="240" font-size="24" fill="#e8e8e8" text-anchor="middle" font-family="sans-serif">工单 ${orderNo} · 现场取证</text>
</svg>`
  fs.writeFileSync(path.join(UPLOAD_DIR, name), svg)
  return `/uploads/${name}`
}

const STAGE_COLOR: Record<string, string> = {
  appearance: '#3b6ea5', old_damage: '#8c5a2b', fault_check: '#6b4e9e',
  disassembly: '#2b6e5a', test_result: '#9e3b3b',
}
const STAGE_LABEL: Record<string, string> = {
  appearance: '设备外观', old_damage: '旧损记录', fault_check: '故障检测',
  disassembly: '拆机照片', test_result: '试机结果',
}

async function ev(orderId: number, actor: any, action: string, detail: any, at: Date) {
  await s(
    `INSERT INTO order_events(order_id, actor_id, actor_name, actor_role, action, detail, created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, actor?.id ?? null, actor?.name ?? '系统', actor?.role ?? 'system', action, JSON.stringify(detail), at]
  )
}

async function evd(orderId: number, orderNo: string, stage: string, note: string, by: any, at: Date) {
  const fp = svgEvidence(orderNo, STAGE_LABEL[stage] || stage, STAGE_COLOR[stage] || '#555')
  await s(
    `INSERT INTO evidence(order_id, stage, file_path, note, uploaded_by, uploaded_by_name, created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, stage, fp, note, by.id, by.name, at]
  )
}

interface SeedOrderOpts {
  orderNo: string
  resident: any
  tech: any
  device: string
  brand: string
  model: string
  fault: string
  floor: number
  community: { name: string; lat: number; lng: number }
  createdDaysAgo: number
  rating: number
  comment: string
  partIds: number[]
  laborCents: number
  rework?: boolean
  originalId?: number
}

/** 构造一条走完完整流程的归档订单（含证据链/报价/配件/支付/评价/质保） */
async function seedFullOrder(o: SeedOrderOpts): Promise<number> {
  const t0 = daysAgo(o.createdDaysAgo, 9)
  const t1 = daysAgo(o.createdDaysAgo, 10)
  const t2 = daysAgo(o.createdDaysAgo, 11)
  const t3 = daysAgo(o.createdDaysAgo, 14)
  const t4 = daysAgo(o.createdDaysAgo, 15)
  const t5 = daysAgo(o.createdDaysAgo, 16)
  const t6 = daysAgo(o.createdDaysAgo, 17)
  const date = dateStr(o.createdDaysAgo - 1)
  const safety = o.device === 'ac' && o.floor >= 4 ? 'high' : o.floor >= 6 ? 'medium' : 'low'
  const r = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, original_order_id, is_warranty_rework,
       test_result, test_note, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'archived',$16,$17,$18,$19,$20,$21,'pass','试机正常，运行参数达标',$22,$23) RETURNING id`,
    [o.orderNo, o.resident.id, o.device, o.brand, o.model, o.fault, `${FAULT_LABEL[o.fault] || ''}，用户报修`,
     3, o.floor, true, o.community.name, `${o.community.name}${1 + (o.createdDaysAgo % 20)}栋${o.floor}0${1 + (o.createdDaysAgo % 3)}室`,
     o.community.lat, o.community.lng,
     JSON.stringify([{ date, slot: SLOTS[0] }, { date, slot: SLOTS[1] }]),
     o.tech.id, date, SLOTS[0], safety, o.originalId ?? null, !!o.rework, t0, t6]
  )
  const id = r.rows[0].id

  await ev(id, o.resident, '提交报修', { order_no: o.orderNo, device: DEVICE_LABEL[o.device], brand: o.brand, fault: FAULT_LABEL[o.fault] }, t0)
  await ev(id, null, '系统生成师傅推荐', { rule: '技能+距离+配件库存+安全风险+档期' }, t0)
  await ev(id, o.resident, '居民预约上门', { technician: o.tech.name, date, slot: SLOTS[0] }, t0)
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id, created_at) VALUES($1,$2,$3,$4,$5)`,
    [o.tech.id, date, SLOTS[0], id, t0])
  await ev(id, o.tech, '师傅到场签到', {}, t1)
  await evd(id, o.orderNo, 'appearance', '机身外观整体完好，拍照留档', o.tech, t1)
  await evd(id, o.orderNo, 'old_damage', '旧损：外壳右下角有历史划痕，已与用户确认', o.tech, t1)
  await evd(id, o.orderNo, 'fault_check', '现场检测：确认故障点，与用户描述一致', o.tech, t1)
  await ev(id, o.tech, '上传证据', { stage: 'arrival', count: 3 }, t1)

  // 报价
  const items: any[] = [{ kind: 'labor', name: '上门检测与维修工时费', qty: 1, unit_price_cents: o.laborCents }]
  for (const pid of o.partIds) {
    const p = await s(`SELECT * FROM parts WHERE id=$1`, [pid])
    if (p.rows.length) items.push({ kind: 'part', name: p.rows[0].name, part_id: pid, qty: 1, unit_price_cents: p.rows[0].price_cents })
  }
  const total = items.reduce((s, i) => s + i.qty * i.unit_price_cents, 0)
  await s(
    `INSERT INTO quotes(order_id, version, status, items, total_cents, remark, created_by, created_by_name, created_at, confirmed_by, confirmed_at)
     VALUES($1,1,'confirmed',$2,$3,'',$4,$5,$6,$7,$8)`,
    [id, JSON.stringify(items), total, o.tech.id, o.tech.name, t2, o.resident.name, t2]
  )
  await ev(id, o.tech, '提交报价 V1', { total_cents: total, items: items.length }, t2)
  await ev(id, o.resident, '确认报价 V1', { total_cents: total }, t2)

  // 配件出库并使用（历史数据直接扣减当前库存）
  for (const pid of o.partIds) {
    const p = await s(`SELECT * FROM parts WHERE id=$1`, [pid])
    if (!p.rows.length) continue
    await s(`UPDATE parts SET stock = GREATEST(stock - 1, 0) WHERE id=$1`, [pid])
    await s(
      `INSERT INTO order_parts(order_id, part_id, qty, status, batch_no, created_at, updated_at)
       VALUES($1,$2,1,'used',$3,$4,$5)`,
      [id, pid, p.rows[0].batch_no, t3, t3]
    )
    await ev(id, o.tech, '登记更换配件', { part: p.rows[0].name, qty: 1, batch_no: p.rows[0].batch_no }, t3)
  }
  await ev(id, o.tech, '开始维修', {}, t3)
  await evd(id, o.orderNo, 'disassembly', '拆机过程拍照，内部结构留档', o.tech, t3)
  await evd(id, o.orderNo, 'test_result', '维修后试机，运行正常', o.tech, t4)
  await ev(id, o.tech, '维修完成，试机通过', { test_note: '试机正常', warranty_days: WARRANTY_DAYS }, t4)

  const start = dateStr(o.createdDaysAgo - 1)
  await s(`INSERT INTO warranties(order_id, period_days, start_date, end_date, status, created_at) VALUES($1,$2,$3,$4,'active',$5)`,
    [id, WARRANTY_DAYS, start, addDays(start, WARRANTY_DAYS), t4])

  const pay = o.rework ? 0 : total
  await s(`INSERT INTO payments(order_id, amount_cents, method, status, created_at) VALUES($1,$2,'online','paid',$3)`, [id, pay, t5])
  await ev(id, o.resident, '支付完成', { amount_cents: pay }, t5)
  await s(`INSERT INTO reviews(order_id, rating, tags, comment, created_at) VALUES($1,$2,$3,$4,$5)`,
    [id, o.rating, JSON.stringify(['服务及时']), o.comment, t6])
  await ev(id, o.resident, '提交评价', { rating: o.rating }, t6)
  await ev(id, null, '订单归档', { note: '证据链、报价、配件追溯、质保信息已入档' }, t6)
  return id
}

export async function seedIfEmpty() {
  const c = await pool.query(`SELECT COUNT(*)::int AS c FROM users`)
  if (c.rows[0].c > 0) return
  console.log('[seed] 初始化演示数据...')
  const client = await pool.connect()
  tx = client
  try {
    await client.query('BEGIN')

  const pw = {
    admin: hashPassword('admin123'),
    cs: hashPassword('cs123456'),
    wh: hashPassword('wh123456'),
    tech: hashPassword('tech123456'),
    user: hashPassword('user123456'),
  }

  async function user(username: string, name: string, role: string, phone: string, pwh: string) {
    const r = await s(
      `INSERT INTO users(username, password_hash, name, role, phone) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [username, pwh, name, role, phone]
    )
    return { id: r.rows[0].id, name, role, username }
  }

  const admin = await user('admin', '平台运营中心', 'admin', '021-10000000', pw.admin)
  const cs = await user('cs01', '客服小陈', 'cs', '13800000001', pw.cs)
  const wh = await user('wh01', '仓库老周', 'warehouse', '13800000002', pw.wh)
  const tech01 = await user('tech01', '王师傅', 'technician', '13800000011', pw.tech)
  const tech02 = await user('tech02', '李师傅', 'technician', '13800000012', pw.tech)
  const tech03 = await user('tech03', '赵师傅', 'technician', '13800000013', pw.tech)
  const user01 = await user('user01', '张女士', 'resident', '13900000001', pw.user)
  const user02 = await user('user02', '刘先生', 'resident', '13900000002', pw.user)

  const C = [
    { name: '阳光社区', lat: 31.2395, lng: 121.4998 },
    { name: '滨江花园', lat: 31.2252, lng: 121.5123 },
    { name: '梧桐里', lat: 31.2487, lng: 121.4862 },
    { name: '江南水岸', lat: 31.2189, lng: 121.4755 },
  ]
  await s(`INSERT INTO technicians(user_id, skills, high_altitude_cert, community, lat, lng, status) VALUES
    ($1,'["ac","fridge"]',true,'阳光社区',$2,$3,'active'),
    ($4,'["washer","water_heater","fridge"]',false,'滨江花园',$5,$6,'active'),
    ($7,'["ac","fridge","washer","water_heater"]',false,'梧桐里',$8,$9,'active')`,
    [tech01.id, C[0].lat, C[0].lng, tech02.id, C[1].lat, C[1].lng, tech03.id, C[2].lat, C[2].lng])

  const partsSeed = [
    ['P-FR-COMP', '冰箱压缩机（通用）', 'fridge', [], ['not_cooling'], 3, 45000, 'B202601-A', '华冷配件'],
    ['P-FR-DRAIN', '冰箱排水管', 'fridge', [], ['leaking'], 8, 2500, 'B202601-B', '华冷配件'],
    ['P-FR-FAN', '冰箱风扇电机', 'fridge', [], ['noisy'], 5, 8000, 'B202602-A', '苏北机电'],
    ['P-WM-PUMP', '洗衣机排水泵', 'washer', [], ['no_spin', 'leaking'], 6, 6500, 'B202601-C', '苏北机电'],
    ['P-WM-BELT', '洗衣机皮带', 'washer', [], ['no_spin', 'noisy'], 10, 1500, 'B202603-A', '苏北机电'],
    ['P-WM-BOARD', '洗衣机电脑板', 'washer', ['海尔', '小天鹅'], ['no_power'], 2, 18000, 'B202602-B', '原厂渠道'],
    ['P-AC-CAP', '空调电容', 'ac', [], ['no_power', 'not_cooling'], 12, 3000, 'B202604-A', '制冷配件城'],
    ['P-AC-REF', '制冷剂 R32（罐）', 'ac', [], ['not_cooling'], 7, 9000, 'B202604-B', '制冷配件城'],
    ['P-AC-BOARD', '空调遥控接收板', 'ac', ['格力', '美的'], ['no_power'], 0, 12000, 'B202605-A', '原厂渠道'],
    ['P-WH-HEAT', '热水器加热管', 'water_heater', [], ['no_heat'], 6, 7500, 'B202603-B', '苏北机电'],
    ['P-WH-VALVE', '安全泄压阀', 'water_heater', [], ['leaking'], 9, 2000, 'B202601-D', '苏北机电'],
    ['P-WH-IGN', '燃气点火器', 'water_heater', [], ['no_ignite'], 4, 5500, 'B202602-C', '原厂渠道'],
  ]
  const partId: Record<string, number> = {}
  for (const [sku, name, dt, brands, faults, stock, price, batch, supplier] of partsSeed as any[]) {
    const r = await s(
      `INSERT INTO parts(sku, name, device_type, brands, faults, stock, price_cents, batch_no, supplier)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [sku, name, dt, JSON.stringify(brands), JSON.stringify(faults), stock, price, batch, supplier]
    )
    partId[sku] = r.rows[0].id
  }

  // ---------- 历史归档订单（完整证据链） ----------
  let seq = 1
  const no = () => `R2026SEED-${String(seq++).padStart(3, '0')}`
  const full = (o: Partial<SeedOrderOpts> & Pick<SeedOrderOpts, 'tech' | 'device' | 'fault' | 'createdDaysAgo'>) =>
    seedFullOrder({
      orderNo: no(), resident: user01, brand: '海尔', model: '标准型', floor: 3,
      community: C[0], rating: 5, comment: '师傅很专业，修完还讲解了保养方法。',
      partIds: [], laborCents: 8000, ...o,
    } as SeedOrderOpts)

  // 王师傅（tech01）：6 单完成，1 单被返修
  const a1 = await full({ tech: tech01, device: 'ac', fault: 'not_cooling', brand: '格力', model: 'KFR-35GW', floor: 12, createdDaysAgo: 60, partIds: [partId['P-AC-REF']], laborCents: 12000, rating: 5, comment: '加氟后制冷恢复正常，高空作业很规范。' })
  await full({ tech: tech01, device: 'ac', fault: 'no_power', brand: '美的', model: 'KFR-26GW', floor: 8, createdDaysAgo: 52, partIds: [partId['P-AC-CAP']], laborCents: 10000, rating: 5 })
  await full({ tech: tech01, device: 'fridge', fault: 'not_cooling', brand: '海尔', model: 'BCD-216', floor: 2, createdDaysAgo: 45, partIds: [partId['P-FR-COMP']], laborCents: 15000, rating: 4, comment: '换压缩机后正常，价格略高但有明细。' })
  await full({ tech: tech01, device: 'fridge', fault: 'leaking', brand: '容声', model: 'BCD-180', floor: 4, createdDaysAgo: 38, partIds: [partId['P-FR-DRAIN']], laborCents: 6000, rating: 5 })
  await full({ tech: tech01, device: 'ac', fault: 'leaking', brand: '奥克斯', model: 'KFR-32GW', floor: 6, createdDaysAgo: 30, partIds: [], laborCents: 8000, rating: 5, comment: '疏通排水管，未换件，收费透明。' })
  await full({ tech: tech01, device: 'fridge', fault: 'noisy', brand: '西门子', model: 'KK28', floor: 5, createdDaysAgo: 22, partIds: [partId['P-FR-FAN']], laborCents: 8000, rating: 4 })

  // 李师傅（tech02）：5 单完成，0 返修
  await full({ tech: tech02, device: 'washer', fault: 'no_spin', brand: '小天鹅', model: 'TG80', floor: 3, createdDaysAgo: 55, partIds: [partId['P-WM-PUMP']], laborCents: 8000, rating: 5, resident: user02, community: C[1] })
  await full({ tech: tech02, device: 'washer', fault: 'noisy', brand: '海尔', model: 'XQG70', floor: 7, createdDaysAgo: 47, partIds: [partId['P-WM-BELT']], laborCents: 6000, rating: 5, resident: user02, community: C[1] })
  await full({ tech: tech02, device: 'water_heater', fault: 'no_heat', brand: 'AO史密斯', model: 'E60', floor: 9, createdDaysAgo: 40, partIds: [partId['P-WH-HEAT']], laborCents: 10000, rating: 5, resident: user02, community: C[1] })
  await full({ tech: tech02, device: 'water_heater', fault: 'leaking', brand: '万和', model: 'JSQ24', floor: 11, createdDaysAgo: 33, partIds: [partId['P-WH-VALVE']], laborCents: 6000, rating: 4, resident: user02, community: C[1] })
  await full({ tech: tech02, device: 'fridge', fault: 'leaking', brand: '美的', model: 'BCD-320', floor: 1, createdDaysAgo: 25, partIds: [partId['P-FR-DRAIN']], laborCents: 6000, rating: 5, resident: user02, community: C[1] })

  // 赵师傅（tech03）：6 单完成，其中 3 单被返修 → 触发准入预警
  const c1 = await full({ tech: tech03, device: 'washer', fault: 'no_spin', brand: '海尔', model: 'XQG80', floor: 4, createdDaysAgo: 58, partIds: [partId['P-WM-BELT']], laborCents: 7000, rating: 3, comment: '修完一周又坏了。', resident: user02, community: C[1] })
  const c2 = await full({ tech: tech03, device: 'water_heater', fault: 'no_heat', brand: '美的', model: 'F60', floor: 6, createdDaysAgo: 50, partIds: [partId['P-WH-HEAT']], laborCents: 9000, rating: 2, comment: '加热管用了一个月又烧。', resident: user02, community: C[1] })
  const c3 = await full({ tech: tech03, device: 'ac', fault: 'not_cooling', brand: '海尔', model: 'KFR-35', floor: 5, createdDaysAgo: 42, partIds: [partId['P-AC-REF']], laborCents: 11000, rating: 3, comment: '加氟没多久又不制冷。', resident: user02, community: C[1] })
  await full({ tech: tech03, device: 'washer', fault: 'leaking', brand: '美的', model: 'MG70', floor: 2, createdDaysAgo: 35, partIds: [partId['P-WM-PUMP']], laborCents: 7000, rating: 4, resident: user02, community: C[1] })
  await full({ tech: tech03, device: 'fridge', fault: 'noisy', brand: '容声', model: 'BCD-202', floor: 3, createdDaysAgo: 28, partIds: [partId['P-FR-FAN']], laborCents: 7000, rating: 4, resident: user02, community: C[1] })
  await full({ tech: tech03, device: 'water_heater', fault: 'no_ignite', brand: '万和', model: 'JSQ20', floor: 8, createdDaysAgo: 20, partIds: [partId['P-WH-IGN']], laborCents: 8000, rating: 4, resident: user02, community: C[1] })

  // 3 条返修单（质保期内故障复发，已完成，计入师傅返修率）
  const rw1 = await full({ tech: tech01, device: 'washer', fault: 'no_spin', brand: '海尔', model: 'XQG80', floor: 4, createdDaysAgo: 50, partIds: [partId['P-WM-PUMP']], laborCents: 0, rating: 4, rework: true, originalId: c1, resident: user02, community: C[1], comment: '返修换了排水泵，这次没问题了。' })
  const rw2 = await full({ tech: tech02, device: 'water_heater', fault: 'no_heat', brand: '美的', model: 'F60', floor: 6, createdDaysAgo: 40, partIds: [partId['P-WH-HEAT']], laborCents: 0, rating: 4, rework: true, originalId: c2, resident: user02, community: C[1] })
  const rw3 = await full({ tech: tech03, device: 'ac', fault: 'not_cooling', brand: '海尔', model: 'KFR-35', floor: 5, createdDaysAgo: 35, partIds: [partId['P-AC-REF']], laborCents: 0, rating: 3, rework: true, originalId: c3, resident: user02, community: C[1] })
  for (const [rwId, origId, techName] of [[rw1, c1, '王师傅'], [rw2, c2, '李师傅'], [rw3, c3, '赵师傅']] as any[]) {
    await s(
      `INSERT INTO exceptions(order_id, type, title, description, status, created_by, created_by_name, created_by_role, handler_id, handler_name, resolution, created_at, resolved_at)
       VALUES($1,'fault_recurrence','维修后故障复发',$2,'resolved',$3,'张女士','resident',$4,'客服小陈','已安排质保返修并完成',$5,$6)`,
      [origId, `质保期内故障复发，已生成返修单并由${techName}完成`, user01.id, cs.id, daysAgo(52), daysAgo(36)]
    )
  }

  // ---------- 进行中的演示订单 ----------
  // 1) 待预约（user01 空调不制冷，格力 8 楼 → 高空风险）
  const d1 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status, safety_risk, created_at, updated_at)
     VALUES($1,$2,'ac','格力','KFR-35GW','not_cooling','开机两小时不制冷，出风口温度偏高',$3,8,true,'阳光社区','阳光社区7栋802室',$4,$5,$6,'recommended','high',$7,$7) RETURNING id`,
    [no(), user01.id, 4, C[0].lat, C[0].lng,
     JSON.stringify([{ date: dateStr(-1), slot: SLOTS[0] }, { date: dateStr(-1), slot: SLOTS[1] }, { date: dateStr(-2), slot: SLOTS[0] }]),
     daysAgo(0, 8)]
  )
  await ev(d1.rows[0].id, user01, '提交报修', { device: '空调', brand: '格力', fault: FAULT_LABEL['not_cooling'] }, daysAgo(0, 8))
  await ev(d1.rows[0].id, null, '系统生成师傅推荐', { rule: '技能+距离+配件库存+安全风险+档期' }, daysAgo(0, 8))

  // 2) 已预约（user02 洗衣机不脱水 → 李师傅，明天上午；排水泵已预留）
  const d2date = dateStr(-1)
  const d2 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, created_at, updated_at)
     VALUES($1,$2,'washer','小天鹅','TG80-1226','no_spin','脱水时滚筒不转，伴随异响',$3,5,true,'滨江花园','滨江花园3栋501室',$4,$5,$6,'scheduled',$7,$8,$9,'low',$10,$10) RETURNING id`,
    [no(), user02.id, 2, C[1].lat, C[1].lng,
     JSON.stringify([{ date: d2date, slot: SLOTS[0] }, { date: d2date, slot: SLOTS[1] }]),
     tech02.id, d2date, SLOTS[0], daysAgo(0, 7)]
  )
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`, [tech02.id, d2date, SLOTS[0], d2.rows[0].id])
  await s(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'reserved',$3)`,
    [d2.rows[0].id, partId['P-WM-PUMP'], 'B202601-C'])
  await ev(d2.rows[0].id, user02, '提交报修', { device: '洗衣机', brand: '小天鹅', fault: FAULT_LABEL['no_spin'] }, daysAgo(0, 7))
  await ev(d2.rows[0].id, user02, '居民预约上门', { technician: '李师傅', date: d2date, slot: SLOTS[0] }, daysAgo(0, 7))

  // 3) 报价待确认（user01 热水器不加热 → 李师傅已到场检测并报价，含配件不匹配异常待仓库处理）
  const d3 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, created_at, updated_at)
     VALUES($1,$2,'water_heater','AO史密斯','E60-VD0','no_heat','加热指示灯亮但水温不升',$3,6,true,'阳光社区','阳光社区12栋603室',$4,$5,$6,'quote_pending',$7,$8,$9,'low',$10,$10) RETURNING id`,
    [no(), user01.id, 5, C[0].lat, C[0].lng,
     JSON.stringify([{ date: dateStr(0), slot: SLOTS[0] }]), tech02.id, dateStr(0), SLOTS[0], daysAgo(1, 16)]
  )
  const d3id = d3.rows[0].id
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`, [tech02.id, dateStr(0), SLOTS[0], d3id])
  await s(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'reserved',$3)`, [d3id, partId['P-WH-HEAT'], 'B202603-B'])
  await ev(d3id, user01, '提交报修', { device: '热水器', brand: 'AO史密斯', fault: FAULT_LABEL['no_heat'] }, daysAgo(1, 16))
  await ev(d3id, user01, '居民预约上门', { technician: '李师傅', date: dateStr(0), slot: SLOTS[0] }, daysAgo(1, 17))
  await ev(d3id, tech02, '师傅到场签到', {}, daysAgo(0, 9))
  await evd(d3id, no(), 'appearance', '热水器外观完好，无磕碰', tech02, daysAgo(0, 9))
  await evd(d3id, no(), 'fault_check', '万用表检测加热管断路，需更换', tech02, daysAgo(0, 9))
  await s(
    `INSERT INTO quotes(order_id, version, status, items, total_cents, remark, created_by, created_by_name, created_at)
     VALUES($1,1,'pending',$2,$3,'加热管烧断，建议更换原厂加热管',$4,'李师傅',$5)`,
    [d3id, JSON.stringify([
      { kind: 'labor', name: '上门检测与维修工时费', qty: 1, unit_price_cents: 10000 },
      { kind: 'part', name: '热水器加热管', part_id: partId['P-WH-HEAT'], qty: 1, unit_price_cents: 7500 },
    ]), 17500, tech02.id, daysAgo(0, 10)]
  )
  await ev(d3id, tech02, '提交报价 V1', { total_cents: 17500, items: 2 }, daysAgo(0, 10))

  // 4) 维修中（user01 冰箱不制冷 → 王师傅，报价已确认，压缩机已出库）
  const d4 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, created_at, updated_at)
     VALUES($1,$2,'fridge','海尔','BCD-216STPT','not_cooling','冷藏室不制冷，压缩机不启动',$3,3,true,'阳光社区','阳光社区5栋302室',$4,$5,$6,'repairing',$7,$8,$9,'low',$10,$10) RETURNING id`,
    [no(), user01.id, 6, C[0].lat, C[0].lng,
     JSON.stringify([{ date: dateStr(0), slot: SLOTS[1] }]), tech01.id, dateStr(0), SLOTS[1], daysAgo(2, 15)]
  )
  const d4id = d4.rows[0].id
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`, [tech01.id, dateStr(0), SLOTS[1], d4id])
  await s(`UPDATE parts SET stock = GREATEST(stock-1,0) WHERE id=$1`, [partId['P-FR-COMP']])
  await s(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'outbound',$3)`, [d4id, partId['P-FR-COMP'], 'B202601-A'])
  await ev(d4id, user01, '提交报修', { device: '冰箱', brand: '海尔', fault: FAULT_LABEL['not_cooling'] }, daysAgo(2, 15))
  await ev(d4id, user01, '居民预约上门', { technician: '王师傅', date: dateStr(0), slot: SLOTS[1] }, daysAgo(2, 16))
  await ev(d4id, tech01, '师傅到场签到', {}, daysAgo(0, 14))
  await evd(d4id, no(), 'appearance', '冰箱外观完好', tech01, daysAgo(0, 14))
  await evd(d4id, no(), 'old_damage', '旧损：门封条老化，已告知用户', tech01, daysAgo(0, 14))
  await evd(d4id, no(), 'fault_check', '检测压缩机绕组开路，需更换压缩机', tech01, daysAgo(0, 14))
  await s(
    `INSERT INTO quotes(order_id, version, status, items, total_cents, remark, created_by, created_by_name, created_at, confirmed_by, confirmed_at)
     VALUES($1,1,'confirmed',$2,$3,'压缩机损坏，建议更换',$4,'王师傅',$5,'张女士',$6)`,
    [d4id, JSON.stringify([
      { kind: 'labor', name: '上门检测与维修工时费', qty: 1, unit_price_cents: 15000 },
      { kind: 'part', name: '冰箱压缩机（通用）', part_id: partId['P-FR-COMP'], qty: 1, unit_price_cents: 45000 },
    ]), 60000, tech01.id, daysAgo(0, 14), daysAgo(0, 15)]
  )
  await ev(d4id, tech01, '提交报价 V1', { total_cents: 60000, items: 2 }, daysAgo(0, 14))
  await ev(d4id, user01, '确认报价 V1', { total_cents: 60000 }, daysAgo(0, 15))
  await ev(d4id, tech01, '开始维修', {}, daysAgo(0, 15))

  // 5) 报价争议待客服处理（user02 空调不启动 → 赵师傅报价后用户争议）
  const d5 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, created_at, updated_at)
     VALUES($1,$2,'ac','美的','KFR-26GW','no_power','遥控无反应，整机不启动',$3,3,true,'滨江花园','滨江花园8栋303室',$4,$5,$6,'quote_pending',$7,$8,$9,'low',$10,$10) RETURNING id`,
    [no(), user02.id, 3, C[1].lat, C[1].lng,
     JSON.stringify([{ date: dateStr(0), slot: SLOTS[2] }]), tech03.id, dateStr(0), SLOTS[2], daysAgo(1, 10)]
  )
  const d5id = d5.rows[0].id
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`, [tech03.id, dateStr(0), SLOTS[2], d5id])
  await s(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'reserved',$3)`, [d5id, partId['P-AC-CAP'], 'B202604-A'])
  await ev(d5id, user02, '提交报修', { device: '空调', brand: '美的', fault: FAULT_LABEL['no_power'] }, daysAgo(1, 10))
  await ev(d5id, user02, '居民预约上门', { technician: '赵师傅', date: dateStr(0), slot: SLOTS[2] }, daysAgo(1, 11))
  await ev(d5id, tech03, '师傅到场签到', {}, daysAgo(0, 18))
  await evd(d5id, no(), 'fault_check', '检测为电容老化，建议更换', tech03, daysAgo(0, 18))
  await s(
    `INSERT INTO quotes(order_id, version, status, items, total_cents, remark, created_by, created_by_name, created_at)
     VALUES($1,1,'disputed',$2,$3,'',$4,'赵师傅',$5)`,
    [d5id, JSON.stringify([
      { kind: 'labor', name: '上门检测与维修工时费', qty: 1, unit_price_cents: 20000 },
      { kind: 'part', name: '空调电容', part_id: partId['P-AC-CAP'], qty: 1, unit_price_cents: 3000 },
    ]), 23000, tech03.id, daysAgo(0, 18)]
  )
  await s(
    `INSERT INTO exceptions(order_id, type, title, description, status, created_by, created_by_name, created_by_role, created_at)
     VALUES($1,'quote_dispute','报价争议（V1）','用户认为工时费 200 元过高，同类维修社区均价约 100 元','open',$2,'刘先生','resident',$3)`,
    [d5id, user02.id, daysAgo(0, 19)]
  )
  await ev(d5id, tech03, '提交报价 V1', { total_cents: 23000, items: 2 }, daysAgo(0, 18))
  await ev(d5id, user02, '发起报价争议', { version: 1, reason: '工时费过高' }, daysAgo(0, 19))

  // 6) 配件不匹配待仓库处理（user01 洗衣机电脑板 → 李师傅发现型号不匹配）
  const d6 = await s(
    `INSERT INTO orders(order_no, resident_id, device_type, brand, model, fault_type, fault_desc,
       purchase_years, floor, has_elevator, community, address, lat, lng, time_slots, status,
       technician_id, scheduled_date, scheduled_slot, safety_risk, created_at, updated_at)
     VALUES($1,$2,'washer','海尔','XQG100-BD','no_power','通电无显示，疑似电脑板故障',$3,4,true,'阳光社区','阳光社区9栋404室',$4,$5,$6,'arrived',$7,$8,$9,'low',$10,$10) RETURNING id`,
    [no(), user01.id, 4, C[0].lat, C[0].lng,
     JSON.stringify([{ date: dateStr(0), slot: SLOTS[1] }]), tech02.id, dateStr(0), SLOTS[1], daysAgo(1, 14)]
  )
  const d6id = d6.rows[0].id
  await s(`INSERT INTO schedule(technician_id, date, slot, order_id) VALUES($1,$2,$3,$4)`, [tech02.id, dateStr(0), SLOTS[1], d6id])
  await s(`INSERT INTO order_parts(order_id, part_id, qty, status, batch_no) VALUES($1,$2,1,'reserved',$3)`, [d6id, partId['P-WM-BOARD'], 'B202602-B'])
  await ev(d6id, user01, '提交报修', { device: '洗衣机', brand: '海尔', fault: FAULT_LABEL['no_power'] }, daysAgo(1, 14))
  await ev(d6id, user01, '居民预约上门', { technician: '李师傅', date: dateStr(0), slot: SLOTS[1] }, daysAgo(1, 15))
  await ev(d6id, tech02, '师傅到场签到', {}, daysAgo(0, 15))
  await evd(d6id, no(), 'fault_check', '电脑板烧毁，但仓库预留板与该机型接口不匹配', tech02, daysAgo(0, 15))
  await s(
    `INSERT INTO exceptions(order_id, type, title, description, status, created_by, created_by_name, created_by_role, created_at)
     VALUES($1,'parts_mismatch','配件不匹配','预留的海尔电脑板（批次 B202602-B）与 XQG100-BD 接口不匹配，请仓库协调原厂适配板','open',$2,'李师傅','technician',$3)`,
    [d6id, tech02.id, daysAgo(0, 15)]
  )
  await ev(d6id, tech02, '发起异常：配件不匹配', { title: '配件不匹配' }, daysAgo(0, 15))

    await client.query('COMMIT')
    console.log('[seed] 完成：7 个账号、12 个配件、6+3 归档订单、6 条进行中订单')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[seed] 种子数据失败，已回滚:', e)
    throw e
  } finally {
    tx = null
    client.release()
  }
}
