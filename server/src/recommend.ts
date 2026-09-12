import { q, partsAvailabilityMap } from './db'
import { haversineKm } from './util'
import { SLOT_CAPACITY } from './meta'

export interface RecommendItem {
  technician_id: number
  name: string
  community: string
  skills: string[]
  high_altitude_cert: boolean
  distance_km: number
  score: number
  breakdown: {
    skill: number
    distance: number
    parts: number
    safety: number
    schedule: number
  }
  parts_needed: { part_id: number; name: string; available: number; ok: boolean }[]
  parts_ok: boolean
  safety_warning: string
  available_slots: { date: string; slot: string }[]
  rework_rate: number | null
  avg_rating: number | null
}

/** 订单故障对应的适配配件（按品类 + 故障 + 品牌匹配，brands 为空表示通用件） */
export async function neededParts(order: any) {
  const r = await q(
    `SELECT * FROM parts WHERE device_type = $1 AND faults ? $2
       AND (brands = '[]'::jsonb OR brands ? $3)`,
    [order.device_type, order.fault_type, order.brand]
  )
  return r.rows
}

/** 师傅某时段剩余容量 */
export async function slotFreeCount(technicianId: number, date: string, slot: string): Promise<number> {
  const r = await q(
    `SELECT COUNT(*)::int AS c FROM schedule WHERE technician_id = $1 AND date = $2 AND slot = $3`,
    [technicianId, date, slot]
  )
  return SLOT_CAPACITY - r.rows[0].c
}

/**
 * 推荐算法：技能匹配 + 距离 + 配件库存 + 安全风险 + 档期，满分 100。
 * 配件缺货不直接排除，但 parts_ok=false，预约时会被拦截（配件未到不安排上门）。
 */
export async function recommendForOrder(order: any): Promise<RecommendItem[]> {
  const techs = await q(
    `SELECT u.id, u.name, t.skills, t.high_altitude_cert, t.community, t.lat, t.lng
     FROM technicians t JOIN users u ON u.id = t.user_id
     WHERE t.status = 'active'`
  )
  const needed = await neededParts(order)
  const avail = await partsAvailabilityMap()

  // 师傅历史返修率与评分
  const stats = await q(`
    SELECT o.technician_id,
           COUNT(*) FILTER (WHERE o.status IN ('completed','paid','reviewed','archived'))::int AS done,
           (SELECT COUNT(*) FROM orders r JOIN orders o2 ON o2.id = r.original_order_id
             WHERE r.is_warranty_rework AND o2.technician_id = o.technician_id)::int AS rework
    FROM orders o WHERE o.technician_id IS NOT NULL GROUP BY o.technician_id
  `)
  const ratings = await q(
    `SELECT o.technician_id, AVG(rv.rating)::numeric(3,1) AS avg
     FROM reviews rv JOIN orders o ON o.id = rv.order_id GROUP BY o.technician_id`
  )
  const statMap = new Map(stats.rows.map((s: any) => [s.technician_id, s]))
  const ratingMap = new Map(ratings.rows.map((r: any) => [r.technician_id, parseFloat(r.avg)]))

  const highRisk = order.safety_risk === 'high'
  const out: RecommendItem[] = []

  for (const t of techs.rows) {
    const skills: string[] = t.skills || []
    const hasSkill = skills.includes(order.device_type)

    // 技能 40 分
    const skill = hasSkill ? 40 : 0

    // 距离 25 分（10km 外得 0）
    const dist = haversineKm(t.lat, t.lng, order.lat, order.lng)
    const distance = Math.max(0, Math.round(25 - dist * 2.5))

    // 配件 20 分
    const partsNeeded = needed.map((p: any) => ({
      part_id: p.id,
      name: p.name,
      available: avail.get(p.id) ?? 0,
      ok: (avail.get(p.id) ?? 0) > 0,
    }))
    const partsOk = partsNeeded.every(p => p.ok)
    const parts = needed.length === 0 ? 20 : partsOk ? 20 : partsNeeded.some(p => p.ok) ? 10 : 0

    // 安全 15 分：高空风险订单需要高空作业证
    let safety = 15
    let safetyWarning = ''
    if (highRisk && !t.high_altitude_cert) {
      safety = 0
      safetyWarning = '高楼层空调外机作业，该师傅无高空作业证，存在安全风险'
    }

    // 档期 10 分：居民期望时段内有空即得分
    const availableSlots: { date: string; slot: string }[] = []
    for (const ts of order.time_slots || []) {
      const free = await slotFreeCount(t.id, ts.date, ts.slot)
      if (free > 0) availableSlots.push({ date: ts.date, slot: ts.slot })
    }
    const schedule = availableSlots.length > 0 ? 10 : 0

    const st: any = statMap.get(t.id)
    const reworkRate = st && st.done > 0 ? st.rework / st.done : null

    out.push({
      technician_id: t.id,
      name: t.name,
      community: t.community,
      skills,
      high_altitude_cert: t.high_altitude_cert,
      distance_km: Math.round(dist * 10) / 10,
      score: skill + distance + parts + safety + schedule,
      breakdown: { skill, distance, parts, safety, schedule },
      parts_needed: partsNeeded,
      parts_ok: partsOk,
      safety_warning: safetyWarning,
      available_slots: availableSlots,
      rework_rate: reworkRate,
      avg_rating: ratingMap.get(t.id) ?? null,
    })
  }

  out.sort((a, b) => b.score - a.score)
  return out
}
