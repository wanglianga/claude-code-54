<template>
  <div class="card mb">
    <div class="section-title">智能推荐师傅（按技能 / 距离 / 配件库存 / 安全风险 / 档期综合评分）</div>
    <div v-loading="loading">
      <div v-for="(r, i) in list" :key="r.technician_id" class="rec-box">
        <div class="flex-between">
          <div class="flex">
            <el-tag v-if="i === 0" type="danger" size="small" effect="dark">推荐</el-tag>
            <b style="font-size: 16px">{{ r.name }}</b>
            <span class="muted">{{ r.community }} · 距您 {{ r.distance_km }}km</span>
            <el-tag v-if="r.high_altitude_cert" size="small" type="success" effect="plain">高空作业证</el-tag>
            <el-tag v-if="r.avg_rating" size="small" type="warning" effect="plain">★{{ r.avg_rating }}</el-tag>
            <el-tag v-if="r.rework_rate !== null" size="small" effect="plain"
              :type="r.rework_rate > 0.2 ? 'danger' : 'info'">
              返修率 {{ (r.rework_rate * 100).toFixed(0) }}%
            </el-tag>
          </div>
          <div class="score-num">{{ r.score }}<span class="muted" style="font-size: 12px"> 分</span></div>
        </div>
        <div class="flex wrap" style="margin: 8px 0">
          <span class="dim">技能 {{ r.breakdown.skill }}</span>
          <span class="dim">距离 {{ r.breakdown.distance }}</span>
          <span class="dim">配件 {{ r.breakdown.parts }}</span>
          <span class="dim">安全 {{ r.breakdown.safety }}</span>
          <span class="dim">档期 {{ r.breakdown.schedule }}</span>
        </div>
        <el-alert v-if="r.safety_warning" type="error" :title="r.safety_warning" :closable="false" class="mb" />
        <el-alert v-if="!r.parts_ok" type="warning" :closable="false" class="mb"
          :title="`配件未到货：${r.parts_needed.filter((p: any) => !p.ok).map((p: any) => p.name).join('、') || '适配配件'}，暂不能安排上门`" />
        <div v-if="r.parts_needed.length" class="muted mb">
          适配配件：
          <span v-for="p in r.parts_needed" :key="p.part_id">
            {{ p.name }}（{{ p.ok ? `库存 ${p.available}` : '缺货' }}）
          </span>
        </div>
        <div class="flex wrap">
          <span class="muted">可约时段：</span>
          <el-radio-group v-model="picked[r.technician_id]" size="small">
            <el-radio-button v-for="s in r.available_slots" :key="s.date + s.slot" :value="s.date + '|' + s.slot">
              {{ s.date.slice(5) }} {{ s.slot.slice(0, 2) }}
            </el-radio-button>
          </el-radio-group>
          <span v-if="!r.available_slots.length" class="muted">该师傅在您期望时段均无档期</span>
          <el-button type="primary" size="small" :disabled="!picked[r.technician_id] || !r.parts_ok || r.dispatchable === false"
            :loading="scheduling === r.technician_id" @click="schedule(r)">
            {{ r.dispatchable === false ? '无高空资质不可派' : '预约上门' }}
          </el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" description="暂无可用师傅" :image-size="60" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'

const props = defineProps<{ order: any }>()
const emit = defineEmits(['refresh'])

const list = ref<any[]>([])
const picked = ref<Record<number, string>>({})
const loading = ref(false)
const scheduling = ref<number | null>(null)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const r = await api.get(`/orders/${props.order.id}/recommendations`)
    list.value = r.data
    for (const item of r.data) {
      if (item.available_slots.length) {
        picked.value[item.technician_id] = item.available_slots[0].date + '|' + item.available_slots[0].slot
      }
    }
  } finally {
    loading.value = false
  }
}

async function schedule(r: any) {
  const [date, slot] = (picked.value[r.technician_id] || '').split('|')
  if (!date) return
  scheduling.value = r.technician_id
  try {
    await api.post(`/orders/${props.order.id}/schedule`, { technician_id: r.technician_id, date, slot })
    ElMessage.success(`已预约 ${r.name} ${date} ${slot} 上门，适配配件已为您预留`)
    emit('refresh')
  } catch {
    await load()
  } finally {
    scheduling.value = null
  }
}
</script>

<style scoped>
.rec-box { border: 1px solid #e4e9f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.dim { color: #8a94a6; font-size: 12px; background: #f3f5f8; border-radius: 4px; padding: 2px 8px; }
</style>
