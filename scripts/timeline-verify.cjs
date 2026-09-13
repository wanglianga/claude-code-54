/**
 * 时间线区域专项验收（Playwright + Chromium）：
 * 居民新建空调「不启动/遥控失灵」工单后，在订单详情的「全过程时间线」区域内断言：
 *  - 「提交报修」节点明确显示居民选择的故障「不启动 / 遥控失灵」与设备信息
 *  - 时间线区域内不出现串品类错误文案「不通电 / 显示异常」
 * 另抽查一条种子归档工单（平台视角）的时间线节点同样展示故障文案。
 */
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = process.env.BASE || 'http://app:8080'
const SHOTS = '/pw/shots'
fs.mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✔ ${name}`)
  else { failures++; console.error(`  ✘ ${name} ${extra}`) }
}

async function login(page, u, p, expectPath) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('用户名').fill(u)
  await page.getByPlaceholder('密码').fill(p)
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL(`**${expectPath}`, { timeout: 15000 })
}

async function selectOption(page, formItemLabel, optionText) {
  await page.locator('.el-form-item', { hasText: formItemLabel }).locator('.el-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: optionText }).first().click()
}

async function main() {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })).newPage()
  page.setDefaultTimeout(20000)

  console.log('== 1. 居民新建空调「不启动/遥控失灵」工单 ==')
  await login(page, 'user01', 'user123456', '/my')
  await page.goto(BASE + '/new')
  await page.locator('.el-form-item', { hasText: '设备品类' }).locator('.el-radio-button', { hasText: '空调' }).click()
  await selectOption(page, '品牌', '格力')
  await page.getByPlaceholder('如 KFR-35GW（机身铭牌可查）').fill('KFR-35GW')
  await selectOption(page, '故障现象', '不启动 / 遥控失灵')
  await page.getByPlaceholder('补充描述故障表现').fill('时间线验收：遥控无反应，整机不启动')
  await selectOption(page, '所在社区', '阳光社区')
  await page.getByPlaceholder('如 阳光社区7栋802室').fill('阳光社区8栋901室')
  await page.locator('.el-form-item', { hasText: '楼层' }).locator('input').first().fill('9')
  await page.locator('.slot-row').first().locator('.el-checkbox', { hasText: '上午' }).click()
  await page.getByRole('button', { name: '提交报修并推荐师傅' }).click()
  await page.waitForURL('**/orders/**', { timeout: 20000 })
  const titleText = await page.locator('.page-title').textContent()
  const orderNo = (titleText.match(/R\d+-\d+/) || [])[0]
  console.log('  工单号:', orderNo)

  console.log('== 2. 时间线区域断言（居民视角，新建工单） ==')
  const timeline = page.locator('.card', { hasText: '全过程时间线' })
  await timeline.locator('.el-timeline-item', { hasText: '提交报修' }).waitFor()
  const submitNode = timeline.locator('.el-timeline-item', { hasText: '提交报修' }).first()
  const nodeText = await submitNode.textContent()
  console.log('  「提交报修」节点文本:', nodeText.replace(/\s+/g, ' ').trim())
  check('节点显示故障「不启动 / 遥控失灵」', nodeText.includes('不启动 / 遥控失灵'))
  check('节点显示设备信息「空调 格力」', nodeText.includes('空调') && nodeText.includes('格力'))
  check('节点不再只有工单号（含故障描述字段）', nodeText.includes('故障：'))
  const timelineText = await timeline.textContent()
  check('时间线区域不出现「不通电 / 显示异常」', !timelineText.includes('不通电 / 显示异常'))
  check('时间线区域包含「不启动 / 遥控失灵」', timelineText.includes('不启动 / 遥控失灵'))
  await timeline.screenshot({ path: `${SHOTS}/t1-timeline-resident-new-order.png` })

  console.log('== 3. 平台档案抽查种子归档工单时间线 ==')
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.waitForURL('**/login')
  await login(page, 'admin', 'admin123', '/dashboard')
  await page.goto(BASE + '/archives')
  await page.getByPlaceholder('工单号 / 地址 / 品牌').fill('R2026SEED-001')
  await page.getByRole('button', { name: '查询' }).click()
  await page.locator('tr', { hasText: 'R2026SEED-001' }).first().click()
  const timeline2 = page.locator('.card', { hasText: '全过程时间线' })
  await timeline2.locator('.el-timeline-item', { hasText: '提交报修' }).waitFor()
  const seedNode = timeline2.locator('.el-timeline-item', { hasText: '提交报修' }).first()
  const seedNodeText = await seedNode.textContent()
  console.log('  种子工单「提交报修」节点文本:', seedNodeText.replace(/\s+/g, ' ').trim())
  // R2026SEED-001：空调/格力/not_cooling → 应显示「不制冷 / 制冷差」
  check('种子工单节点显示「不制冷 / 制冷差」', seedNodeText.includes('不制冷 / 制冷差'))
  const timeline2Text = await timeline2.textContent()
  check('种子工单时间线不出现「不通电 / 显示异常」', !timeline2Text.includes('不通电 / 显示异常'))
  await timeline2.screenshot({ path: `${SHOTS}/t2-timeline-archive-seed.png` })

  await browser.close()
  console.log(failures ? `\n时间线验收：${failures} 项失败` : '\n时间线验收：全部通过 ✔')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error('验收异常：', e.message); process.exit(1) })
