/**
 * 端到端冒烟测试：对 compose 启动的服务跑通关键业务流。
 * 用法：BASE=http://host.docker.internal:3054 node scripts/smoke.mjs
 */
const BASE = (process.env.BASE || 'http://host.docker.internal:3054') + '/api'

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✔ ${name}`)
  else { failures++; console.error(`  ✘ ${name} ${extra}`) }
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

async function login(username, password) {
  const r = await req('POST', '/auth/login', { body: { username, password } })
  if (r.status !== 200) throw new Error(`login ${username} failed: ${JSON.stringify(r.data)}`)
  return r.data.token
}

const tomorrow = (d = 1) => {
  const t = new Date(); t.setDate(t.getDate() + d)
  return t.toISOString().slice(0, 10)
}

async function main() {
  console.log('== 1. 各角色登录 ==')
  const tokens = {}
  for (const [u, p] of [
    ['user01', 'user123456'], ['user02', 'user123456'],
    ['tech01', 'tech123456'], ['tech02', 'tech123456'], ['tech03', 'tech123456'],
    ['cs01', 'cs123456'], ['wh01', 'wh123456'], ['admin', 'admin123'],
  ]) tokens[u] = await login(u, p)
  check('8 个演示账号全部登录成功', Object.keys(tokens).length === 8)

  const bad = await req('POST', '/auth/login', { body: { username: 'user01', password: 'wrong' } })
  check('错误密码被拒绝(401)', bad.status === 401)
  const noAuth = await req('GET', '/orders')
  check('未登录访问被拒绝(401)', noAuth.status === 401)

  console.log('== 2. 居民报修 + 智能推荐 ==')
  // 空调/格力/不启动 → 适配配件含"空调遥控接收板"(库存0)，用于验证配件-日程联动
  const create = await req('POST', '/orders', {
    token: tokens.user01,
    body: {
      device_type: 'ac', brand: '格力', model: 'KFR-35GW', fault_type: 'no_power',
      fault_desc: '冒烟测试：遥控无反应，整机不启动', purchase_years: 4, floor: 9,
      has_elevator: true, community: '阳光社区', address: '阳光社区测试栋901室',
      time_slots: [{ date: tomorrow(1), slot: '上午 9:00-12:00' }, { date: tomorrow(2), slot: '下午 14:00-17:00' }],
    },
  })
  check('创建报修单', create.status === 200 && create.data.id, JSON.stringify(create.data))
  const oid = create.data.id

  // 回归：故障标签必须按品类展示（空调 no_power = 不启动/遥控失灵，而非热水器的"不通电/显示异常"）
  const created = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('空调 no_power 详情故障标签为「不启动 / 遥控失灵」', created.data.order.fault_label === '不启动 / 遥控失灵', created.data.order.fault_label)
  check('时间线事件记录正确故障文案', created.data.events.some(e => JSON.stringify(e.detail).includes('不启动 / 遥控失灵')))
  const listMine = await req('GET', '/orders', { token: tokens.user01 })
  check('订单列表故障标签正确', listMine.data.find(o => o.id === oid)?.fault_label === '不启动 / 遥控失灵')

  const recs = await req('GET', `/orders/${oid}/recommendations`, { token: tokens.user01 })
  check('推荐列表返回师傅', recs.status === 200 && recs.data.length >= 2)
  const t01 = recs.data.find(r => r.name === '王师傅')
  const t03 = recs.data.find(r => r.name === '赵师傅')
  check('高空风险单：持证王师傅得分高于无证赵师傅', t01 && t03 && t01.score > t03.score,
    `王=${t01?.score} 赵=${t03?.score}`)
  check('推荐含安全警示（赵师傅无高空证）', !!t03?.safety_warning)
  check('推荐识别配件缺货 parts_ok=false', recs.data.every(r => r.parts_ok === false))

  console.log('== 3. 配件-日程联动：缺货拦截 → 仓库补货 → 预约成功 ==')
  const blocked = await req('POST', `/orders/${oid}/schedule`, {
    token: tokens.user01,
    body: { technician_id: t01.technician_id, date: tomorrow(1), slot: '上午 9:00-12:00' },
  })
  check('配件缺货时预约被拦截(409)', blocked.status === 409, JSON.stringify(blocked.data))

  const parts = await req('GET', '/parts', { token: tokens.wh01 })
  const board = parts.data.find(p => p.sku === 'P-AC-BOARD')
  check('仓库查到缺货配件 空调遥控接收板', !!board && board.available === 0)
  const restock = await req('POST', `/parts/${board.id}/restock`, { token: tokens.wh01, body: { qty: 5 } })
  check('仓库补货成功', restock.status === 200)

  const sched = await req('POST', `/orders/${oid}/schedule`, {
    token: tokens.user01,
    body: { technician_id: t01.technician_id, date: tomorrow(1), slot: '上午 9:00-12:00' },
  })
  check('补货后预约成功', sched.status === 200, JSON.stringify(sched.data))
  let detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('预约后自动预留配件', detail.data.parts.length >= 2 && detail.data.parts.every(p => p.status === 'reserved'))
  check('订单进入已预约状态', detail.data.order.status === 'scheduled')

  console.log('== 4. 师傅上门：签到 → 证据 → 报价 ==')
  const checkin = await req('POST', `/orders/${oid}/checkin`, { token: tokens.tech01, body: {} })
  check('师傅到场签到', checkin.status === 200)

  const svg = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#369"/><text x="10" y="35" fill="#fff">smoke</text></svg>`], { type: 'image/svg+xml' })
  const form = new FormData()
  form.append('file', svg, 'smoke.svg')
  form.append('stage', 'appearance')
  form.append('note', '冒烟测试上传外观照')
  const up = await req('POST', `/orders/${oid}/evidence`, { token: tokens.tech01, form })
  check('上传上门证据(multipart)', up.status === 200 && up.data.file_path)
  const evUrl = await fetch(BASE.replace('/api', '') + up.data.file_path)
  check('证据文件可访问', evUrl.status === 200)

  const quote = await req('POST', `/orders/${oid}/quotes`, {
    token: tokens.tech01,
    body: {
      remark: '电容与接收板老化',
      items: [
        { kind: 'labor', name: '上门检测与维修工时费', qty: 1, unit_price_cents: 10000 },
        { kind: 'part', name: '空调遥控接收板', part_id: board.id, qty: 1, unit_price_cents: 12000 },
      ],
    },
  })
  check('师傅提交报价', quote.status === 200 && quote.data.version === 1, JSON.stringify(quote.data))

  console.log('== 5. 居民确认报价 → 维修 → 完成 → 支付 → 评价归档 ==')
  detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  const q1 = detail.data.quotes[0]
  const confirm = await req('POST', `/orders/${oid}/quotes/${q1.id}/confirm`, { token: tokens.user01 })
  check('居民确认报价', confirm.status === 200)
  detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('确认后配件自动出库', detail.data.parts.some(p => p.part_id === board.id && p.status === 'outbound'))

  check('开始维修', (await req('POST', `/orders/${oid}/start-repair`, { token: tokens.tech01 })).status === 200)
  detail = await req('GET', `/orders/${oid}`, { token: tokens.tech01 })
  const op = detail.data.parts.find(p => p.part_id === board.id)
  check('登记更换配件', (await req('POST', `/orders/${oid}/use-part`, { token: tokens.tech01, body: { order_part_id: op.id } })).status === 200)
  const complete = await req('POST', `/orders/${oid}/complete`, {
    token: tokens.tech01,
    body: { test_result: 'pass', test_note: '遥控恢复正常', fee_adjust_cents: 0 },
  })
  check('完成维修(试机通过)', complete.status === 200)
  detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('生成 90 天质保', !!detail.data.warranty && detail.data.warranty.period_days === 90)

  const pay = await req('POST', `/orders/${oid}/pay`, { token: tokens.user01, body: { method: 'online' } })
  check('居民支付', pay.status === 200 && pay.data.amount_cents === 22000, JSON.stringify(pay.data))
  check('提交评价并归档', (await req('POST', `/orders/${oid}/review`, { token: tokens.user01, body: { rating: 5, tags: ['服务及时'], comment: '冒烟测试好评' } })).status === 200)
  detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('订单归档且时间线完整', detail.data.order.status === 'archived' && detail.data.events.length >= 10,
    `events=${detail.data.events.length}`)

  console.log('== 6. 质保返修 ==')
  const rework = await req('POST', `/orders/${oid}/rework`, { token: tokens.user01, body: { fault_desc: '冒烟测试：一周后故障复发' } })
  check('质保期内可发起返修', rework.status === 200 && rework.data.id)
  detail = await req('GET', `/orders/${oid}`, { token: tokens.user01 })
  check('原单生成故障复发异常', detail.data.exceptions.some(e => e.type === 'fault_recurrence'))
  const rwDetail = await req('GET', `/orders/${rework.data.id}`, { token: tokens.user01 })
  check('返修单关联原单', rwDetail.data.order.is_warranty_rework === true && rwDetail.data.original?.id === oid)

  console.log('== 7. 异常协同（种子数据） ==')
  const exList = await req('GET', '/exceptions?status=open', { token: tokens.cs01 })
  check('客服可见待处理异常', exList.status === 200 && exList.data.length >= 2, `open=${exList.data.length}`)
  const dispute = exList.data.find(e => e.type === 'quote_dispute')
  const resolve = await req('POST', `/exceptions/${dispute.id}/resolve`, {
    token: tokens.cs01,
    body: { resolution: '核实社区均价，要求师傅重新报价', action: 'requote' },
  })
  check('客服处理报价争议(要求重新报价)', resolve.status === 200)
  const disputedOrder = await req('GET', `/orders/${dispute.order_id}`, { token: tokens.cs01 })
  check('争议订单回到待报价状态', disputedOrder.data.order.status === 'arrived')

  const whEx = await req('GET', '/exceptions?status=open', { token: tokens.wh01 })
  const mismatch = whEx.data.find(e => e.type === 'parts_mismatch')
  check('仓库可见配件不匹配异常', !!mismatch)
  check('仓库处理配件不匹配', (await req('POST', `/exceptions/${mismatch.id}/resolve`, {
    token: tokens.wh01, body: { resolution: '已调拨原厂适配板，明日送达' },
  })).status === 200)

  console.log('== 8. 平台统计与准入 ==')
  const overview = await req('GET', '/stats/overview', { token: tokens.admin })
  check('统计总览', overview.status === 200 && overview.data.total > 0, JSON.stringify(overview.data))
  const byTech = await req('GET', '/stats/rework?group=technician', { token: tokens.admin })
  const zhao = byTech.data.find(t => t.name === '赵师傅')
  check('赵师傅返修率最高且触发准入预警', zhao && zhao.rework_rate > 0.2 && zhao.admission_hint.includes('暂停'),
    JSON.stringify(zhao))
  const byCat = await req('GET', '/stats/rework?group=category', { token: tokens.admin })
  check('按品类统计含快修/转售后建议', byCat.status === 200 && byCat.data.every(c => !!c.suggestion))
  const byPart = await req('GET', '/stats/rework?group=part', { token: tokens.admin })
  check('按配件统计返修率', byPart.status === 200 && byPart.data.length > 0)

  const techs = await req('GET', '/technicians', { token: tokens.admin })
  const zhaoRow = techs.data.find(t => t.name === '赵师傅')
  // 回归：准入建议必须随返修率给出（赵师傅约 43% → 暂停准入），不再显示 "—"
  check('准入建议：赵师傅(返修率>20%)显示暂停准入预警', zhaoRow?.stats?.admission_hint?.includes('暂停'), JSON.stringify(zhaoRow?.stats))
  check('所有师傅均有准入建议（无空值）', techs.data.every(t => !!t.stats?.admission_hint))
  check('平台暂停赵师傅准入', (await req('PATCH', `/technicians/${zhaoRow.id}`, { token: tokens.admin, body: { status: 'suspended' } })).status === 200)
  const recs2 = await req('GET', `/orders/${rework.data.id}/recommendations`, { token: tokens.user01 })
  check('被暂停师傅不再进入推荐', recs2.data.every(r => r.name !== '赵师傅'))
  check('恢复赵师傅准入', (await req('PATCH', `/technicians/${zhaoRow.id}`, { token: tokens.admin, body: { status: 'active' } })).status === 200)

  console.log('== 9. 档案与追溯 ==')
  const archives = await req('GET', '/archives', { token: tokens.admin })
  check('档案库列表', archives.status === 200 && archives.data.length >= 10, `n=${archives.data.length}`)
  const trace = await req('GET', `/parts/${board.id}/trace`, { token: tokens.wh01 })
  check('配件追溯含本次更换记录', trace.status === 200 && trace.data.usage.some(u => u.order_id === oid))
  const forbidden = await req('GET', `/orders/${oid}`, { token: tokens.user02 })
  check('他人订单不可见(403)', forbidden.status === 403)
  const archivedFull = await req('GET', `/orders/${oid}`, { token: tokens.admin })
  check('平台可还原完整证据链(事件/证据/报价/配件/支付/评价/质保)',
    archivedFull.data.events.length > 0 && archivedFull.data.evidence.length > 0 &&
    archivedFull.data.quotes.length > 0 && archivedFull.data.parts.length > 0 &&
    !!archivedFull.data.payment && !!archivedFull.data.review && !!archivedFull.data.warranty)

  console.log(failures ? `\n结果：${failures} 项失败` : '\n结果：全部通过 ✔')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error('冒烟测试异常：', e); process.exit(1) })
