<template>
  <div class="card mb">
    <div class="section-title">全过程时间线</div>
    <el-timeline v-if="events.length" style="padding-left: 4px">
      <el-timeline-item v-for="e in events" :key="e.id" :timestamp="fmtTime(e.created_at)" placement="top"
        :type="e.actor_role === 'system' ? 'info' : 'primary'">
        <div>
          <b>{{ e.action }}</b>
          <span class="muted" style="margin-left: 8px">{{ e.actor_name }} · {{ roleLabel(e.actor_role) }}</span>
        </div>
        <div v-if="detailText(e.detail)" class="muted" style="margin-top: 2px">{{ detailText(e.detail) }}</div>
      </el-timeline-item>
    </el-timeline>
    <el-empty v-else description="暂无记录" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { fmtTime, ROLE_LABEL, fen } from '../api'

defineProps<{ events: any[] }>()

function roleLabel(r: string) {
  return ROLE_LABEL[r] || '系统'
}

function detailText(d: any): string {
  if (!d || typeof d !== 'object') return ''
  const parts: string[] = []
  if (d.order_no) parts.push(`工单 ${d.order_no}`)
  if (d.technician) parts.push(`师傅：${d.technician}`)
  if (d.date) parts.push(`${d.date} ${d.slot || ''}`)
  if (d.total_cents != null) parts.push(`金额 ¥${fen(d.total_cents)}`)
  if (d.amount_cents != null) parts.push(`实付 ¥${fen(d.amount_cents)}`)
  if (d.part) parts.push(`配件：${d.part}×${d.qty || 1}${d.batch_no ? `（批次 ${d.batch_no}）` : ''}`)
  if (d.reason) parts.push(`原因：${d.reason}`)
  if (d.resolution) parts.push(`处理：${d.resolution}`)
  if (d.note) parts.push(d.note)
  if (d.test_note) parts.push(`试机说明：${d.test_note}`)
  if (d.missing) parts.push(`缺货：${d.missing.join('、')}`)
  if (d.rework_order_no) parts.push(`返修单 ${d.rework_order_no}`)
  if (d.original_order_no) parts.push(`原工单 ${d.original_order_no}`)
  if (d.rating) parts.push(`评分 ${d.rating} 星`)
  if (d.comment) parts.push(d.comment)
  if (d.warranty_days) parts.push(`质保 ${d.warranty_days} 天`)
  if (d.title) parts.push(d.title)
  if (d.description) parts.push(d.description)
  return parts.join('；')
}
</script>
