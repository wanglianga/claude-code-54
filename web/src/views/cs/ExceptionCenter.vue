<template>
  <div class="page">
    <div class="page-title">{{ title }}</div>
    <div class="card">
      <div class="flex mb">
        <el-radio-group v-model="statusFilter" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="open">处理中</el-radio-button>
          <el-radio-button value="resolved">已解决</el-radio-button>
        </el-radio-group>
        <el-select v-model="typeFilter" placeholder="异常类型" clearable style="width: 200px" @change="load">
          <el-option v-for="t in exceptionTypes" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </div>
      <el-table :data="list" v-loading="loading">
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'open' ? 'danger' : 'success'">
              {{ row.status === 'open' ? '处理中' : '已解决' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="type_label" label="类型" width="140" />
        <el-table-column prop="title" label="标题" min-width="150" show-overflow-tooltip />
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column prop="resident_name" label="居民" width="90" />
        <el-table-column prop="technician_name" label="师傅" width="90" />
        <el-table-column prop="created_by_name" label="发起人" width="90" />
        <el-table-column prop="created_at" label="发起时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="$router.push(`/orders/${row.order_id}`)">
              进入工单
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="暂无异常记录" :image-size="60" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, fmtTime } from '../../api'
import { useAuth } from '../../stores/auth'
import { useMeta } from '../../stores/meta'

const auth = useAuth()
const metaStore = useMeta()
const list = ref<any[]>([])
const loading = ref(false)
const statusFilter = ref('')
const typeFilter = ref('')

const exceptionTypes = computed(() => metaStore.data?.exception_types || [])
const title = computed(() =>
  ({ cs: '异常处理中心', warehouse: '配件异常', admin: '异常总览', technician: '相关异常', resident: '我的异常' } as any)[auth.role] || '异常'
)

async function load() {
  loading.value = true
  try {
    const params: any = {}
    if (statusFilter.value) params.status = statusFilter.value
    if (typeFilter.value) params.type = typeFilter.value
    const r = await api.get('/exceptions', { params })
    list.value = r.data
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  metaStore.load()
  await load()
})
</script>
