import { defineStore } from 'pinia'
import { api } from '../api'

/** 表单元数据（设备/品牌/故障/社区/时段） */
export const useMeta = defineStore('meta', {
  state: () => ({ data: null as any | null }),
  actions: {
    async load() {
      if (this.data) return
      const r = await api.get('/meta')
      this.data = r.data
    },
  },
})
