<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">
        <el-icon :size="22" color="#fff"><Tools /></el-icon>
        <span>社区维修平台</span>
      </div>
      <el-menu :default-active="$route.path" router background-color="#1d2b4f" text-color="#b8c2d9"
        active-text-color="#ffffff" class="menu">
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="muted">{{ roleLabel }}工作台</span>
        <div class="flex">
          <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
          <span>{{ auth.user?.name }}</span>
          <el-button link type="primary" @click="logout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { ROLE_LABEL } from '../api'

const auth = useAuth()
const router = useRouter()
const roleLabel = computed(() => ROLE_LABEL[auth.role] || '')

const MENUS: Record<string, { path: string; label: string; icon: string }[]> = {
  resident: [
    { path: '/my', label: '我的报修', icon: 'List' },
    { path: '/new', label: '发起报修', icon: 'Plus' },
    { path: '/exceptions', label: '我的异常', icon: 'Warning' },
  ],
  technician: [
    { path: '/agenda', label: '我的日程', icon: 'Calendar' },
    { path: '/exceptions', label: '相关异常', icon: 'Warning' },
  ],
  cs: [
    { path: '/exceptions', label: '异常处理中心', icon: 'Service' },
    { path: '/archives', label: '订单档案', icon: 'FolderOpened' },
    { path: '/dashboard', label: '统计看板', icon: 'DataAnalysis' },
  ],
  warehouse: [
    { path: '/parts', label: '配件库存', icon: 'Box' },
    { path: '/exceptions', label: '配件异常', icon: 'Warning' },
  ],
  admin: [
    { path: '/dashboard', label: '统计看板', icon: 'DataAnalysis' },
    { path: '/technicians', label: '师傅准入', icon: 'UserFilled' },
    { path: '/archives', label: '订单档案', icon: 'FolderOpened' },
    { path: '/parts', label: '配件库存', icon: 'Box' },
    { path: '/exceptions', label: '异常总览', icon: 'Warning' },
  ],
}

const menus = computed(() => MENUS[auth.role] || [])

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { height: 100%; }
.aside { background: #1d2b4f; }
.logo {
  height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 18px;
  color: #fff; font-weight: 700; font-size: 16px; letter-spacing: 1px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.menu { border-right: none; }
.header {
  background: #fff; display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 1px 4px rgba(30, 45, 80, 0.08); z-index: 2;
}
.main { background: #f3f5f8; padding: 0; overflow-y: auto; }
</style>
