<template>
  <div class="page">
    <div class="flex-between mb">
      <div class="page-title">我的报修</div>
      <el-button type="primary" :icon="Plus" @click="$router.push('/new')">发起报修</el-button>
    </div>
    <div class="card">
      <el-table :data="orders" v-loading="loading" @row-click="(r: any) => $router.push(`/orders/${r.id}`)" style="cursor: pointer">
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column label="设备" width="150">
          <template #default="{ row }">{{ row.device_label }} · {{ row.brand }}</template>
        </el-table-column>
        <el-table-column prop="fault_label" label="故障" min-width="150" show-overflow-tooltip />
        <el-table-column prop="technician_name" label="师傅" width="90">
          <template #default="{ row }">{{ row.technician_name || '待指派' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="STATUS_TYPE[row.status] || 'info'" size="small">{{ row.status_label }}</el-tag>
            <el-tooltip v-if="row.open_exceptions > 0" content="有处理中的异常">
              <el-icon color="#e6a23c" style="margin-left: 4px; vertical-align: -2px"><Warning /></el-icon>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="返修单" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.is_warranty_rework" size="small" type="danger" effect="plain">返修</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="提交时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !orders.length" description="还没有报修记录，点击右上角发起报修" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus, Warning } from '@element-plus/icons-vue'
import { api, fmtTime, STATUS_TYPE } from '../../api'

const orders = ref<any[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const r = await api.get('/orders')
    orders.value = r.data
  } finally {
    loading.value = false
  }
})
</script>
