<template>
  <div class="card mb">
    <div class="flex-between">
      <div class="section-title">师傅到达轨迹（{{ tracks.length }} 个轨迹点）</div>
      <el-button v-if="canTrack" type="primary" plain size="small" :icon="Position" :loading="locating" @click="recordTrack">
        记录当前位置
      </el-button>
    </div>
    <div v-if="tracks.length" class="flex" style="align-items: flex-start; gap: 18px; flex-wrap: wrap">
      <svg :viewBox="`0 0 320 200`" class="track-map">
        <rect width="320" height="200" rx="8" fill="#eef3fb" />
        <polyline :points="polyPoints" fill="none" stroke="#2f6fed" stroke-width="2.5" stroke-dasharray="5 4" />
        <g v-for="(p, i) in plotPoints" :key="i">
          <circle :cx="p.x" :cy="p.y" :r="i === 0 ? 6 : i === plotPoints.length - 1 ? 7 : 4.5"
            :fill="i === plotPoints.length - 1 ? '#d4380d' : '#2f6fed'" />
          <text :x="p.x + 8" :y="p.y + 4" font-size="10" fill="#4a5568">{{ i + 1 }}</text>
        </g>
        <text x="12" y="188" font-size="10" fill="#8a94a6">蓝点=途经点，红点=最新位置（示意投影，非真实地图）</text>
      </svg>
      <div style="flex: 1; min-width: 260px">
        <div v-for="(t, i) in tracks" :key="t.id" class="track-row">
          <el-tag size="small" :type="i === tracks.length - 1 ? 'danger' : 'primary'" effect="plain">{{ i + 1 }}</el-tag>
          <span class="track-note">{{ t.note || '轨迹点' }}</span>
          <span class="muted">({{ t.lat.toFixed(5) }}, {{ t.lng.toFixed(5) }})</span>
          <span class="muted">{{ t.created_by_name }} · {{ fmtTime(t.created_at) }}</span>
        </div>
        <div v-if="order.checkin_lat" class="muted" style="margin-top: 6px">
          签到坐标：({{ order.checkin_lat.toFixed(5) }}, {{ order.checkin_lng.toFixed(5) }})
        </div>
      </div>
    </div>
    <el-empty v-else description="暂无轨迹记录（师傅签到或手动记录后生成）" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Position } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, fmtTime } from '../api'

const props = defineProps<{ order: any; tracks: any[]; canTrack: boolean }>()
const emit = defineEmits(['refresh'])
const locating = ref(false)

const plotPoints = computed(() => {
  const ts = props.tracks
  if (!ts.length) return [] as { x: number; y: number }[]
  const lats = ts.map(t => t.lat)
  const lngs = ts.map(t => t.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = maxLat - minLat || 0.001
  const spanLng = maxLng - minLng || 0.001
  return ts.map(t => ({
    x: 20 + ((t.lng - minLng) / spanLng) * 280,
    y: 180 - ((t.lat - minLat) / spanLat) * 160,
  }))
})
const polyPoints = computed(() => plotPoints.value.map(p => `${p.x},${p.y}`).join(' '))

async function recordTrack() {
  locating.value = true
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('浏览器不支持定位'))
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
    })
    await api.post(`/orders/${props.order.id}/track`, {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      note: '师傅手动记录位置',
    })
    ElMessage.success('轨迹点已记录')
    emit('refresh')
  } catch (e: any) {
    if (e?.code === 1) ElMessage.warning('定位被拒绝，请在浏览器授权后重试')
    else if (!e?.response) ElMessage.error(e.message || '定位失败')
  } finally {
    locating.value = false
  }
}
</script>

<style scoped>
.track-map { width: 320px; height: 200px; flex-shrink: 0; }
.track-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; flex-wrap: wrap; }
.track-note { color: #2b3445; }
</style>
