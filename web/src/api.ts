import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from './router'

export const api = axios.create({ baseURL: '/api', timeout: 20000 })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    const msg = err.response?.data?.error || err.message || '请求失败'
    ElMessage.error(msg)
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (router.currentRoute.value.path !== '/login') router.push('/login')
    }
    return Promise.reject(err)
  }
)

/** 分 → 元 */
export function fen(cents: number | null | undefined): string {
  return ((cents || 0) / 100).toFixed(2)
}

export function fmtTime(t: string | null | undefined): string {
  if (!t) return '-'
  return t.replace('T', ' ').slice(0, 16)
}

export const STATUS_TYPE: Record<string, string> = {
  pending: 'info',
  recommended: 'info',
  scheduled: 'primary',
  arrived: 'primary',
  quote_pending: 'warning',
  quote_confirmed: 'warning',
  repairing: 'warning',
  completed: 'success',
  paid: 'success',
  reviewed: 'success',
  archived: 'success',
  cancelled: 'danger',
}

export const ROLE_LABEL: Record<string, string> = {
  resident: '居民',
  technician: '维修师傅',
  cs: '客服',
  warehouse: '配件仓库',
  admin: '社区平台',
}

export const EXCEPTION_LABEL: Record<string, string> = {
  additional_item: '用户临时增加项目',
  high_altitude: '高空作业风险',
  parts_mismatch: '配件不匹配',
  quote_dispute: '报价争议',
  fault_recurrence: '维修后故障复发',
}

export const STAGE_LABEL: Record<string, string> = {
  appearance: '设备外观',
  old_damage: '旧损记录',
  fault_check: '故障检测',
  risk: '高空风险照片',
  disassembly: '拆机照片',
  test_result: '试机结果',
  other: '其他补充',
}
