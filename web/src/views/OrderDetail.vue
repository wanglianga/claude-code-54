<template>
  <div class="page" v-loading="loading">
    <template v-if="data">
      <div class="flex-between mb">
        <div class="flex">
          <el-button :icon="ArrowLeft" circle @click="$router.back()" />
          <span class="page-title" style="margin: 0">工单 {{ data.order.order_no }}</span>
          <StatusTag :status="data.order.status" :label="data.order.status_label" />
          <el-tag v-if="data.order.is_warranty_rework" type="danger" size="small" effect="plain">质保返修单</el-tag>
          <el-tag v-if="data.order.safety_risk === 'high'" type="danger" size="small">高空作业风险</el-tag>
          <el-tag v-else-if="data.order.safety_risk === 'medium'" type="warning" size="small">中风险</el-tag>
        </div>
        <el-button v-if="canCancel" type="danger" plain size="small" @click="cancel">取消订单</el-button>
      </div>

      <div class="card mb">
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="设备">{{ data.order.device_label }} · {{ data.order.brand }} {{ data.order.model }}</el-descriptions-item>
          <el-descriptions-item label="故障">{{ data.order.fault_label }}</el-descriptions-item>
          <el-descriptions-item label="购买年限">{{ data.order.purchase_years }} 年</el-descriptions-item>
          <el-descriptions-item label="楼层">{{ data.order.floor }} 层{{ data.order.has_elevator ? '（有电梯）' : '（无电梯）' }}</el-descriptions-item>
          <el-descriptions-item label="居民">{{ data.order.resident_name }} {{ data.order.resident_phone }}</el-descriptions-item>
          <el-descriptions-item label="地址">{{ data.order.address }}</el-descriptions-item>
          <el-descriptions-item label="师傅">
            {{ data.order.technician_name || '待指派' }}
            <el-tag v-if="data.order.support_technician_name" size="small" type="warning" style="margin-left: 6px">
              加派：{{ data.order.support_technician_name }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="上门时间">
            {{ data.order.scheduled_date ? `${data.order.scheduled_date} ${data.order.scheduled_slot}` : '待预约' }}
          </el-descriptions-item>
          <el-descriptions-item label="故障描述" :span="4">{{ data.order.fault_desc || '—' }}</el-descriptions-item>
          <el-descriptions-item label="可上门时段" :span="4">
            <el-tag v-for="ts in data.order.time_slots" :key="ts.date + ts.slot" size="small" effect="plain"
              style="margin-right: 6px">{{ ts.date }} {{ ts.slot }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <RecommendPanel v-if="showRecommend" :order="data.order" @refresh="load" />
      <TechWorkbench :order="data.order" :is-technician="isAssignedTech" @refresh="load" />
      <RiskPanel :order="data.order" :risks="data.risk_assessments" :evidence="data.evidence" :role="auth.role"
        :anchor-conditions="anchorConditions" :risk-actions="riskActions" @refresh="load" />
      <EvidencePanel :order-id="data.order.id" :evidence="data.evidence" :can-upload="isAssignedTech"
        :stages="evidenceStages" @refresh="load" />
      <TrackPanel :order="data.order" :tracks="data.tracks" :can-track="isAssignedTech || isSupportTech" @refresh="load" />
      <QuotePanel :order="data.order" :quotes="data.quotes" :is-resident="isOwnerResident"
        :is-technician="isAssignedTech" :part-options="partOptions" @refresh="load" />
      <PartsPanel :order="data.order" :parts="data.parts" :is-technician="isAssignedTech" @refresh="load" />
      <ExceptionPanel :order="data.order" :exceptions="data.exceptions" :role="auth.role"
        :exception-types="exceptionTypes" @refresh="load" />
      <AfterSalePanel :order="data.order" :payment="data.payment" :warranty="data.warranty" :review="data.review"
        :reworks="data.reworks" :original="data.original" :quotes="data.quotes" :is-resident="isOwnerResident"
        @refresh="load" />
      <OrderTimeline :events="data.events" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMeta } from '../stores/meta'
import StatusTag from '../components/StatusTag.vue'
import OrderTimeline from '../components/OrderTimeline.vue'
import EvidencePanel from '../components/EvidencePanel.vue'
import QuotePanel from '../components/QuotePanel.vue'
import PartsPanel from '../components/PartsPanel.vue'
import ExceptionPanel from '../components/ExceptionPanel.vue'
import RecommendPanel from '../components/RecommendPanel.vue'
import TechWorkbench from '../components/TechWorkbench.vue'
import AfterSalePanel from '../components/AfterSalePanel.vue'
import RiskPanel from '../components/RiskPanel.vue'
import TrackPanel from '../components/TrackPanel.vue'

const route = useRoute()
const auth = useAuth()
const metaStore = useMeta()
const data = ref<any>(null)
const loading = ref(false)
const partOptions = ref<any[]>([])

const id = Number(route.params.id)

const isOwnerResident = computed(() => auth.role === 'resident' && data.value?.order.resident_id === auth.user?.id)
const isAssignedTech = computed(() => auth.role === 'technician' && data.value?.order.technician_id === auth.user?.id)
const isSupportTech = computed(() => auth.role === 'technician' && data.value?.order.support_technician_id === auth.user?.id)
const showRecommend = computed(() =>
  ['pending', 'recommended'].includes(data.value?.order.status) &&
  (isOwnerResident.value || ['admin', 'cs'].includes(auth.role))
)
const canCancel = computed(() => {
  const s = data.value?.order.status
  if (['completed', 'paid', 'reviewed', 'archived', 'cancelled'].includes(s)) return false
  return isOwnerResident.value || ['cs', 'admin'].includes(auth.role)
})
const evidenceStages = computed(() => metaStore.data?.evidence_stages || [])
const exceptionTypes = computed(() => metaStore.data?.exception_types || [])
const anchorConditions = computed(() => metaStore.data?.anchor_conditions || [])
const riskActions = computed(() => metaStore.data?.risk_actions || [])

async function load() {
  loading.value = true
  try {
    const r = await api.get(`/orders/${id}`)
    data.value = r.data
    if (auth.role === 'technician') {
      const p = await api.get('/parts')
      partOptions.value = p.data.filter((x: any) => x.device_type === r.data.order.device_type)
    }
  } finally {
    loading.value = false
  }
}

async function cancel() {
  const { value } = await ElMessageBox.prompt('请填写取消原因', '取消订单', { inputValidator: v => !!v || '请填写原因' })
  await api.post(`/orders/${id}/cancel`, { reason: value })
  ElMessage.success('订单已取消，预留配件与档期已释放')
  load()
}

onMounted(async () => {
  metaStore.load()
  await load()
})
</script>
