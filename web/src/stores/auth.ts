import { defineStore } from 'pinia'
import { api } from '../api'

export interface UserInfo {
  id: number
  username: string
  name: string
  role: string
  phone?: string
  technician?: any
}

export const useAuth = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null') as UserInfo | null,
    token: localStorage.getItem('token') || '',
  }),
  getters: {
    role: s => s.user?.role || '',
    homePath: s => {
      const r = s.user?.role
      return r === 'resident' ? '/my'
        : r === 'technician' ? '/agenda'
        : r === 'cs' ? '/exceptions'
        : r === 'warehouse' ? '/parts'
        : '/dashboard'
    },
  },
  actions: {
    async login(username: string, password: string) {
      const r = await api.post('/auth/login', { username, password })
      this.token = r.data.token
      this.user = r.data.user
      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))
    },
    logout() {
      this.user = null
      this.token = ''
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
  },
})
