<template>
  <div class="card mb">
    <div class="section-title">配件使用与追溯</div>
    <el-table :data="parts" size="small" v-if="parts.length">
      <el-table-column prop="part_name" label="配件" min-width="150" />
      <el-table-column prop="sku" label="SKU" width="130" />
      <el-table-column prop="batch_no" label="批次号" width="110" />
      <el-table-column prop="qty" label="数量" width="60" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="partTag(row.status)">{{ partLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" v-if="isTechnician && order.status === 'repairing'">
        <template #default="{ row }">
          <el-button v-if="row.status !== 'used'" size="small" type="primary" plain @click="usePart(row)">
            登记已更换
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else description="暂无配件记录（预约成功后按故障自动预留适配配件）" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'

const props = defineProps<{ order: any; parts: any[]; isTechnician: boolean }>()
const emit = defineEmits(['refresh'])

function partLabel(s: string) {
  return { reserved: '已预留', outbound: '已出库', used: '已更换', returned: '已退回' }[s] || s
}
function partTag(s: string) {
  return { reserved: 'info', outbound: 'warning', used: 'success', returned: 'danger' }[s] || 'info'
}

async function usePart(row: any) {
  await ElMessageBox.confirm(`确认已将「${row.part_name}」更换到设备上？`, '登记配件', { type: 'warning' })
  await api.post(`/orders/${props.order.id}/use-part`, { order_part_id: row.id })
  ElMessage.success('已登记更换')
  emit('refresh')
}
</script>
