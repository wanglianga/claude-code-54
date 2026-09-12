<template>
  <div class="page">
    <div class="page-title">订单档案库（纠纷 / 投诉可还原维修全过程）</div>
    <div class="card">
      <div class="flex mb wrap">
        <el-input v-model="keyword" placeholder="工单号 / 地址 / 品牌" clearable style="width: 220px"
          @keyup.enter="load" />
        <el-select v-model="status" placeholder="状态" clearable style="width: 150px" @change="load">
          <el-option v-for="(l, v) in statusOptions" :key="v" :label="l" :value="v" />
        </el-select>
        <el-select v-model="deviceType" placeholder="品类" clearable style="width: 130px" @change="load">
          <el-option v-for="d in deviceTypes" :key="d.value" :label="d.label" :value="d.value" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="load">查询</el-button>
      </div>
      <el-table :data="list" v-loading="loading" @row-click="(r: any) => $router.push(`/orders/${r.id}`)"
        style="cursor: pointer">
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column label="设备" width="140">
          <template #default="{ row }">{{ deviceLabel(row.device_type) }} · {{ row.brand }}</template>
        </el-table-column>
        <el-table-column prop="resident_name" label="居民" width="90" />
        <el-table-column prop="technician_name" label="师傅" width="90" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <StatusTag :status="row.status" :label="statusLabel(row.status)" />
          </template>
        </el-table-column>
        <el-table-column label="证据" width="70">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.evidence_count >= 4 ? 'success' : 'warning'">
              {{ row.evidence_count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="异常" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.exception_count" size="small" type="danger" effect="plain">{{ row.exception_count }}</el-tag>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column label="返修" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.is_warranty_rework" size="small" type="danger">返修单</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { api, fmtTime } from '../../api'
import { useMeta } from '../../stores/meta'
import StatusTag from '../../components/StatusTag.vue'

const metaStore = useMeta()
const list = ref<any[]>([])
const loading = ref(false)
const keyword = ref('')
const status = ref('')
const deviceType = ref('')

const deviceTypes = computed(() => metaStore.data?.device_types || [])
const statusOptions = computed(() => metaStore.data?.order_status || {})

function deviceLabel(v: string) {
  return deviceTypes.value.find((d: any) => d.value === v)?.label || v
}
function statusLabel(s: string) {
  return statusOptions.value[s] || s
}

async function load() {
  loading.value = true
  try {
    const params: any = {}
    if (keyword.value) params.keyword = keyword.value
    if (status.value) params.status = status.value
    if (deviceType.value) params.device_type = deviceType.value
    const r = await api.get('/archives', { params })
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
