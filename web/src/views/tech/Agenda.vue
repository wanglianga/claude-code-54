<template>
  <div class="page">
    <div class="page-title">我的日程与工单</div>
    <div class="card mb">
      <div class="section-title">上门日程</div>
      <el-table :data="schedule" size="default" v-loading="loading">
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="slot" label="时段" width="150" />
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column label="设备" width="140">
          <template #default="{ row }">{{ deviceLabel(row.device_type) }} · {{ row.brand }}</template>
        </el-table-column>
        <el-table-column prop="resident_name" label="居民" width="90" />
        <el-table-column prop="address" label="地址" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <StatusTag :status="row.order_status" :label="statusLabel(row.order_status)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="$router.push(`/orders/${row.order_id}`)">
              工作台
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !schedule.length" description="暂无日程安排" :image-size="60" />
    </div>

    <div class="card">
      <div class="section-title">全部工单</div>
      <el-table :data="orders" size="default">
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column label="设备" width="140">
          <template #default="{ row }">{{ row.device_label }} · {{ row.brand }}</template>
        </el-table-column>
        <el-table-column prop="fault_label" label="故障" min-width="140" show-overflow-tooltip />
        <el-table-column prop="address" label="地址" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :status="row.status" :label="row.status_label" />
            <el-tooltip v-if="row.open_exceptions > 0" content="有处理中的异常">
              <el-icon color="#e6a23c" style="margin-left: 4px; vertical-align: -2px"><Warning /></el-icon>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="$router.push(`/orders/${row.id}`)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { api, fmtTime } from '../../api'
import { useMeta } from '../../stores/meta'
import StatusTag from '../../components/StatusTag.vue'

const schedule = ref<any[]>([])
const orders = ref<any[]>([])
const loading = ref(false)
const metaStore = useMeta()

function deviceLabel(v: string) {
  return metaStore.data?.device_types?.find((d: any) => d.value === v)?.label || v
}
function statusLabel(s: string) {
  return metaStore.data?.order_status?.[s] || s
}

onMounted(async () => {
  loading.value = true
  try {
    await metaStore.load()
    const [s, o] = await Promise.all([api.get('/schedule'), api.get('/orders')])
    schedule.value = s.data
    orders.value = o.data
  } finally {
    loading.value = false
  }
})
</script>
