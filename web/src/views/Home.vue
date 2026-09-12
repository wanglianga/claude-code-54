<template>
  <div class="page">
    <div class="card" style="text-align: center; padding: 60px 20px">
      <el-icon :size="48" color="#2f6fed"><Tools /></el-icon>
      <h2>社区家电维修服务平台</h2>
      <p class="muted">正在进入您的工作台…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'

const auth = useAuth()
const router = useRouter()
onMounted(() => router.replace(auth.homePath))
</script>
