<template>
  <div class="login-bg">
    <div class="login-card">
      <div class="login-title">社区家电维修服务平台</div>
      <div class="login-sub">预约上门 · 证据留档 · 配件追溯 · 质保返修</div>
      <el-form @submit.prevent="doLogin">
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password
            :prefix-icon="Lock" @keyup.enter="doLogin" />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="doLogin">
          登 录
        </el-button>
      </el-form>
      <el-divider content-position="left"><span class="muted">演示账号（点击填充）</span></el-divider>
      <div class="demo-accounts">
        <el-tag v-for="a in accounts" :key="a.u" class="acc-tag" :type="a.type" @click="fill(a)">
          {{ a.label }} {{ a.u }}
        </el-tag>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuth } from '../stores/auth'

const auth = useAuth()
const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)

const accounts = [
  { label: '居民', u: 'user01', p: 'user123456', type: 'primary' },
  { label: '居民2', u: 'user02', p: 'user123456', type: 'primary' },
  { label: '师傅·王', u: 'tech01', p: 'tech123456', type: 'success' },
  { label: '师傅·李', u: 'tech02', p: 'tech123456', type: 'success' },
  { label: '师傅·赵', u: 'tech03', p: 'tech123456', type: 'success' },
  { label: '客服', u: 'cs01', p: 'cs123456', type: 'warning' },
  { label: '仓库', u: 'wh01', p: 'wh123456', type: 'warning' },
  { label: '平台', u: 'admin', p: 'admin123', type: 'danger' },
] as const

function fill(a: any) {
  username.value = a.u
  password.value = a.p
}

async function doLogin() {
  if (!username.value || !password.value) return ElMessage.warning('请输入用户名和密码')
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    ElMessage.success(`欢迎，${auth.user?.name}`)
    router.push(auth.homePath)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-bg {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2f6fed 0%, #1d4fb8 55%, #173a8a 100%);
}
.login-card {
  width: 400px;
  background: #fff;
  border-radius: 14px;
  padding: 34px 34px 26px;
  box-shadow: 0 12px 40px rgba(10, 30, 80, 0.35);
}
.login-title { font-size: 22px; font-weight: 700; text-align: center; color: #1d2b4f; }
.login-sub { text-align: center; color: #8a94a6; font-size: 13px; margin: 8px 0 22px; }
.demo-accounts { display: flex; flex-wrap: wrap; gap: 8px; }
.acc-tag { cursor: pointer; }
</style>
