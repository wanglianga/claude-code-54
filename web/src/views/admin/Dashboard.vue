<template>
  <div class="page">
    <div class="page-title">平台统计看板</div>

    <el-row :gutter="14" class="mb">
      <el-col :span="6"><div class="card stat"><div class="muted">累计工单</div><div class="num">{{ overview.total }}</div></div></el-col>
      <el-col :span="6"><div class="card stat"><div class="muted">已完成</div><div class="num">{{ overview.done }}</div></div></el-col>
      <el-col :span="6"><div class="card stat"><div class="muted">返修工单</div><div class="num" style="color:#d4380d">{{ overview.rework_orders }}</div></div></el-col>
      <el-col :span="6"><div class="card stat"><div class="muted">待处理异常</div><div class="num" style="color:#e6a23c">{{ overview.open_exceptions }}</div></div></el-col>
    </el-row>

    <el-row :gutter="14" class="mb">
      <el-col :span="12">
        <div class="card">
          <div class="section-title">师傅返修率（影响准入）</div>
          <div ref="techChart" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="card">
          <div class="section-title">品类返修率（快修 / 转品牌售后决策）</div>
          <div ref="catChart" style="height: 300px"></div>
        </div>
      </el-col>
    </el-row>

    <div class="card mb">
      <div class="section-title">品类维修策略建议</div>
      <el-table :data="byCategory" size="small">
        <el-table-column label="品类" width="120">
          <template #default="{ row }">{{ deviceLabel(row.key) }}</template>
        </el-table-column>
        <el-table-column prop="done" label="完成单数" width="100" />
        <el-table-column prop="rework" label="返修单数" width="100" />
        <el-table-column label="返修率" width="120">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.rework_rate)" :stroke-width="10"
              :color="rateColor(row.rework_rate)" />
          </template>
        </el-table-column>
        <el-table-column label="平台建议">
          <template #default="{ row }">
            <el-tag size="small" :type="suggestTag(row.suggestion)">{{ row.suggestion }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <div class="section-title">配件质量追溯（按配件统计返修）</div>
      <el-table :data="byPart" size="small">
        <el-table-column prop="sku" label="SKU" width="130" />
        <el-table-column prop="name" label="配件" min-width="150" />
        <el-table-column prop="used" label="使用次数" width="90" />
        <el-table-column prop="rework" label="关联返修" width="90" />
        <el-table-column label="返修率" width="120">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.rework_rate)" :stroke-width="10" :color="rateColor(row.rework_rate)" />
          </template>
        </el-table-column>
        <el-table-column prop="suggestion" label="建议" min-width="180" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import { api } from '../../api'
import { useMeta } from '../../stores/meta'

const metaStore = useMeta()
const overview = ref<any>({})
const byCategory = ref<any[]>([])
const byPart = ref<any[]>([])
const techChart = ref<HTMLElement>()
const catChart = ref<HTMLElement>()

function pct(r: number | null) {
  return r === null || r === undefined ? 0 : Math.round(r * 100)
}
function rateColor(r: number | null) {
  if (r === null || r === undefined) return '#c0c4cc'
  return r > 0.15 ? '#d4380d' : r > 0.05 ? '#e6a23c' : '#52c41a'
}
function suggestTag(s: string) {
  if (s?.includes('品牌售后')) return 'danger'
  if (s?.includes('谨慎')) return 'warning'
  return 'success'
}
function deviceLabel(v: string) {
  return metaStore.data?.device_types?.find((d: any) => d.value === v)?.label || v
}

onMounted(async () => {
  metaStore.load()
  const [ov, tech, cat, part] = await Promise.all([
    api.get('/stats/overview'),
    api.get('/stats/rework', { params: { group: 'technician' } }),
    api.get('/stats/rework', { params: { group: 'category' } }),
    api.get('/stats/rework', { params: { group: 'part' } }),
  ])
  overview.value = ov.data
  byCategory.value = cat.data
  byPart.value = part.data

  const tc = echarts.init(techChart.value!)
  tc.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: tech.data.map((x: any) => x.name) },
    yAxis: { type: 'value', name: '返修率%', max: 60 },
    series: [{
      type: 'bar', barWidth: 40,
      data: tech.data.map((x: any) => ({
        value: pct(x.rework_rate),
        itemStyle: { color: rateColor(x.rework_rate) },
      })),
      label: { show: true, position: 'top', formatter: '{c}%' },
    }],
  })

  const cc = echarts.init(catChart.value!)
  cc.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: cat.data.map((x: any) => deviceLabel(x.key)) },
    yAxis: { type: 'value', name: '返修率%', max: 60 },
    series: [{
      type: 'bar', barWidth: 40,
      data: cat.data.map((x: any) => ({
        value: pct(x.rework_rate),
        itemStyle: { color: rateColor(x.rework_rate) },
      })),
      label: { show: true, position: 'top', formatter: '{c}%' },
    }],
  })
})
</script>

<style scoped>
.stat { text-align: center; }
.num { font-size: 28px; font-weight: 700; color: #2f6fed; margin-top: 6px; }
</style>
