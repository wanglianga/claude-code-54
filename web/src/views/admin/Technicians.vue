<template>
  <div class="page">
    <div class="page-title">师傅准入管理</div>
    <el-alert type="info" :closable="false" class="mb"
      title="返修率统计直接影响师傅准入：完成 ≥3 单且返修率 >20% 建议暂停准入；返修率 ≤10% 且评分 ≥4.5 为优质师傅" />
    <div class="card">
      <el-table :data="list" v-loading="loading">
        <el-table-column prop="name" label="师傅" width="100" />
        <el-table-column label="技能" min-width="160">
          <template #default="{ row }">
            <el-tag v-for="s in row.skills" :key="s" size="small" effect="plain" style="margin-right: 4px">
              {{ deviceLabel(s) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="高空资质" width="110">
          <template #default="{ row }">
            <el-switch :model-value="row.high_altitude_cert" inline-prompt active-text="持证" inactive-text="无"
              @change="(v: boolean) => toggleCert(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="风险上报" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.risk_reports > 0" size="small" type="warning" effect="plain">{{ row.risk_reports }} 次</el-tag>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column prop="community" label="常驻社区" width="110" />
        <el-table-column label="完成单数" width="90">
          <template #default="{ row }">{{ row.stats?.done ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="返修率" width="140">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.stats?.rework_rate)" :stroke-width="10"
              :color="rateColor(row.stats?.rework_rate)" />
          </template>
        </el-table-column>
        <el-table-column label="评分" width="80">
          <template #default="{ row }">{{ row.stats?.avg_rating ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="准入建议" min-width="170">
          <template #default="{ row }">
            <el-tag size="small" :type="hintTag(row.stats?.admission_hint)">{{ row.stats?.admission_hint || '—' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'success' : 'danger'">
              {{ row.status === 'active' ? '接单中' : '已暂停' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130">
          <template #default="{ row }">
            <el-button v-if="row.status === 'active'" size="small" type="danger" plain @click="toggle(row, 'suspended')">
              暂停准入
            </el-button>
            <el-button v-else size="small" type="success" plain @click="toggle(row, 'active')">恢复准入</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api'
import { useMeta } from '../../stores/meta'

const metaStore = useMeta()
const list = ref<any[]>([])
const loading = ref(false)

function deviceLabel(v: string) {
  return metaStore.data?.device_types?.find((d: any) => d.value === v)?.label || v
}
function pct(r: number | null | undefined) {
  return r == null ? 0 : Math.round(r * 100)
}
function rateColor(r: number | null | undefined) {
  if (r == null) return '#c0c4cc'
  return r > 0.2 ? '#d4380d' : r > 0.1 ? '#e6a23c' : '#52c41a'
}
function hintTag(h: string | undefined) {
  if (!h) return 'info'
  if (h.includes('暂停')) return 'danger'
  if (h.includes('优质')) return 'success'
  return 'info'
}

async function load() {
  loading.value = true
  try {
    const r = await api.get('/technicians')
    list.value = r.data
  } finally {
    loading.value = false
  }
}

async function toggle(row: any, status: string) {
  await ElMessageBox.confirm(
    status === 'suspended' ? `暂停 ${row.name} 的接单准入？` : `恢复 ${row.name} 的接单准入？`,
    '准入变更', { type: 'warning' }
  )
  await api.patch(`/technicians/${row.id}`, { status })
  ElMessage.success('已更新')
  load()
}

async function toggleCert(row: any, cert: boolean) {
  await ElMessageBox.confirm(
    cert ? `授予 ${row.name} 高空作业资质？高空风险订单将可派给该师傅` : `吊销 ${row.name} 的高空作业资质？高空风险订单将不再派给该师傅`,
    '高空资质变更', { type: 'warning' }
  )
  await api.patch(`/technicians/${row.id}`, { high_altitude_cert: cert })
  ElMessage.success('高空资质已更新')
  load()
}

onMounted(async () => {
  metaStore.load()
  await load()
})
</script>
