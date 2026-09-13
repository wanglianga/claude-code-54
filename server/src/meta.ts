/** 领域常量：设备品类、品牌、故障、社区、时段、证据阶段、异常类型 */

export const DEVICE_TYPES = [
  { value: 'fridge', label: '冰箱' },
  { value: 'washer', label: '洗衣机' },
  { value: 'ac', label: '空调' },
  { value: 'water_heater', label: '热水器' },
]

export const DEVICE_LABEL: Record<string, string> = Object.fromEntries(DEVICE_TYPES.map(d => [d.value, d.label]))

export const BRANDS: Record<string, string[]> = {
  fridge: ['海尔', '美的', '西门子', '容声', '其他'],
  washer: ['海尔', '小天鹅', '美的', '西门子', '其他'],
  ac: ['格力', '美的', '海尔', '奥克斯', '其他'],
  water_heater: ['AO史密斯', '美的', '海尔', '万和', '其他'],
}

export const FAULTS: Record<string, { value: string; label: string }[]> = {
  fridge: [
    { value: 'not_cooling', label: '不制冷 / 制冷效果差' },
    { value: 'leaking', label: '漏水 / 积水' },
    { value: 'noisy', label: '噪音异常' },
    { value: 'no_power', label: '不通电 / 不启动' },
  ],
  washer: [
    { value: 'no_spin', label: '不脱水 / 不运转' },
    { value: 'leaking', label: '漏水' },
    { value: 'no_power', label: '不通电 / 程序错乱' },
    { value: 'noisy', label: '震动噪音大' },
  ],
  ac: [
    { value: 'not_cooling', label: '不制冷 / 制冷差' },
    { value: 'leaking', label: '内机漏水' },
    { value: 'no_power', label: '不启动 / 遥控失灵' },
    { value: 'noisy', label: '外机噪音大' },
  ],
  water_heater: [
    { value: 'no_heat', label: '不加热 / 水温低' },
    { value: 'leaking', label: '漏水 / 泄压阀滴水' },
    { value: 'no_ignite', label: '点火失败' },
    { value: 'no_power', label: '不通电 / 显示异常' },
  ],
}

/** 故障标签按「品类 + 故障码」嵌套：同一故障码在不同品类下文案不同（如 no_power：空调=不启动/遥控失灵，热水器=不通电/显示异常） */
export const FAULT_LABEL: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(FAULTS).map(([dt, faults]) => [dt, Object.fromEntries(faults.map(f => [f.value, f.label]))])
)

export function faultLabel(deviceType: string, faultType: string): string {
  return FAULT_LABEL[deviceType]?.[faultType] || faultType
}

export const COMMUNITIES = [
  { name: '阳光社区', lat: 31.2395, lng: 121.4998 },
  { name: '滨江花园', lat: 31.2252, lng: 121.5123 },
  { name: '梧桐里', lat: 31.2487, lng: 121.4862 },
  { name: '江南水岸', lat: 31.2189, lng: 121.4755 },
]

export const SLOTS = ['上午 9:00-12:00', '下午 14:00-17:00', '晚上 18:00-21:00']

/** 每个时段师傅最大接单数 */
export const SLOT_CAPACITY = 2

export const EVIDENCE_STAGES = [
  { value: 'appearance', label: '设备外观', phase: 'arrival' },
  { value: 'old_damage', label: '旧损记录', phase: 'arrival' },
  { value: 'fault_check', label: '故障检测', phase: 'arrival' },
  { value: 'disassembly', label: '拆机照片', phase: 'repair' },
  { value: 'test_result', label: '试机结果', phase: 'repair' },
  { value: 'other', label: '其他补充', phase: 'any' },
]

export const EXCEPTION_TYPES = [
  { value: 'additional_item', label: '用户临时增加项目' },
  { value: 'high_altitude', label: '高空作业风险' },
  { value: 'parts_mismatch', label: '配件不匹配' },
  { value: 'quote_dispute', label: '报价争议' },
  { value: 'fault_recurrence', label: '维修后故障复发' },
]

export const EXCEPTION_LABEL: Record<string, string> = Object.fromEntries(EXCEPTION_TYPES.map(e => [e.value, e.label]))

export const ORDER_STATUS: Record<string, string> = {
  pending: '待推荐师傅',
  recommended: '待居民预约',
  scheduled: '已预约待上门',
  arrived: '师傅已到场',
  quote_pending: '报价待确认',
  quote_confirmed: '报价已确认',
  repairing: '维修中',
  completed: '维修完成待支付',
  paid: '已支付质保中',
  reviewed: '已评价',
  archived: '已归档',
  cancelled: '已取消',
}

/** 订单完成态集合（用于返修率统计分母） */
export const DONE_STATUS = ['completed', 'paid', 'reviewed', 'archived']

export const WARRANTY_DAYS = 90
