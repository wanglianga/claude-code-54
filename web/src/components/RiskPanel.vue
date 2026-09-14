<template>
  <div class="card mb">
    <div class="flex-between">
      <div class="section-title">高空风险确认（{{ risks.length }}）</div>
      <el-button v-if="canReport" type="danger" plain size="small" :icon="Warning" @click="openReport">
        上报高空风险
      </el-button>
    </div>

    <el-alert v-if="latest && latest.status === 'pending'" type="warning" :closable="false" class="mb"
      title="高空风险待客服确认：确认前请暂停外机作业" />

    <div v-for="ra in risks" :key="ra.id" class="risk-box">
      <div class="flex-between">
        <div>
          <el-tag size="small" :type="statusTag(ra.status)">{{ statusLabel(ra.status) }}</el-tag>
          <b style="margin-left: 8px">{{ ra.floor }} 层 · {{ ra.anchor_condition || '固定条件未填' }}</b>
          <el-tag v-if="ra.need_two_person" size="small" type="danger" effect="plain" style="margin-left: 6px">需双人作业</el-tag>
        </div>
        <span class="muted">{{ ra.technician_name }} 上报 · {{ fmtTime(ra.created_at) }}</span>
      </div>
      <div class="muted" style="margin-top: 6px">危险情况：{{ ra.danger_desc }}</div>
      <div v-if="ra.fee_adjust_cents" class="fee-line">
        高空作业费：+¥{{ fen(ra.fee_adjust_cents) }}
        <span v-if="ra.status !== 'pending'" class="muted">（已计入订单费用调整，居民支付时可见）</span>
        <span v-else class="muted">（待客服确认后计入）</span>
      </div>
      <div v-if="riskPhotos.length" class="flex wrap" style="margin-top: 6px">
        <el-image v-for="p in riskPhotos" :key="p.id" :src="p.file_path" :preview-src-list="riskPhotos.map((x: any) => x.file_path)"
          fit="cover" style="width: 90px; height: 64px; border-radius: 4px" preview-teleported />
      </div>
      <div v-if="ra.status !== 'pending'" class="resolution">
        客服处置（{{ ra.handler_name }}）：{{ actionLabel(ra.cs_action) }}
        <span v-if="ra.cs_action === 'reschedule'"> → {{ ra.new_date }} {{ ra.new_slot }}</span>
        <span v-if="ra.cs_action === 'reinforce' && ra.support_technician_name"> → 加派 {{ ra.support_technician_name }}</span>
        <span v-if="ra.cs_note">；{{ ra.cs_note }}</span>
      </div>
      <div v-if="ra.status === 'pending' && canResolve" class="mt">
        <el-button size="small" type="primary" plain @click="openResolve(ra)">客服处置</el-button>
      </div>
    </div>
    <el-empty v-if="!risks.length" description="暂无高空风险确认记录" :image-size="60" />

    <!-- 师傅上报风险 -->
    <el-dialog v-model="reportDialog" title="上报高空风险确认" width="560px">
      <el-alert type="error" :closable="false" class="mb"
        title="发现外机位置危险时请如实上报：需上传风险照片、填写楼层、固定条件与是否需要双人作业" />
      <el-form label-width="110px">
        <el-form-item label="风险照片" required>
          <div>
            <input type="file" accept="image/*" @change="onFile" />
            <div class="muted" style="margin-top: 4px">
              {{ riskPhotos.length ? `已上传 ${riskPhotos.length} 张风险照片` : '提交前将自动上传该照片作为证据' }}
            </div>
          </div>
        </el-form-item>
        <el-form-item label="楼层" required>
          <el-input-number v-model="reportForm.floor" :min="1" :max="60" />
        </el-form-item>
        <el-form-item label="固定条件" required>
          <el-select v-model="reportForm.anchor_condition" style="width: 100%">
            <el-option v-for="c in anchorConditions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="双人作业">
          <el-switch v-model="reportForm.need_two_person" active-text="需要双人作业" />
        </el-form-item>
        <el-form-item label="危险说明" required>
          <el-input v-model="reportForm.danger_desc" type="textarea" :rows="2"
            placeholder="如：外机支架锈蚀，悬空作业面无护栏" />
        </el-form-item>
        <el-form-item label="高空作业费">
          <el-input-number v-model="reportForm.feeYuan" :min="0" :precision="2" />
          <span class="muted" style="margin-left: 8px">元（客服确认后计入订单费用调整）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportDialog = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="submitReport">提交风险确认</el-button>
      </template>
    </el-dialog>

    <!-- 客服处置 -->
    <el-dialog v-model="resolveDialog" title="高空风险处置" width="560px">
      <el-alert v-if="current" type="warning" :closable="false" class="mb"
        :title="`${current.floor} 层 · ${current.anchor_condition}：${current.danger_desc}`" />
      <el-form label-width="90px">
        <el-form-item label="处置方式">
          <el-radio-group v-model="resolveForm.action">
            <el-radio v-for="a in riskActions" :key="a.value" :value="a.value" style="display: block; margin: 4px 0">
              {{ a.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="resolveForm.action === 'reschedule'">
          <el-form-item label="新日期">
            <el-select v-model="resolveForm.new_date" style="width: 100%">
              <el-option v-for="d in slotDates" :key="d" :label="d" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="新时段">
            <el-select v-model="resolveForm.new_slot" style="width: 100%">
              <el-option v-for="s in slotsForDate" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item v-if="resolveForm.action === 'reinforce'" label="支援师傅">
          <el-select v-model="resolveForm.support_technician_id" style="width: 100%"
            :placeholder="order.safety_risk === 'high' ? '高空风险单需持证师傅' : '选择支援师傅'">
            <el-option v-for="t in supportOptions" :key="t.id" :value="t.id"
              :label="`${t.name}（${t.high_altitude_cert ? '持高空证' : '无高空证'}）`"
              :disabled="order.safety_risk === 'high' && !t.high_altitude_cert" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置说明">
          <el-input v-model="resolveForm.note" type="textarea" :rows="2" placeholder="将同步给居民并写入时间线" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitResolve">确认处置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, fen, fmtTime } from '../api'

const props = defineProps<{
  order: any
  risks: any[]
  evidence: any[]
  role: string
  anchorConditions: string[]
  riskActions: any[]
}>()
const emit = defineEmits(['refresh'])

const reportDialog = ref(false)
const resolveDialog = ref(false)
const saving = ref(false)
const current = ref<any>(null)
const file = ref<File | null>(null)
const technicians = ref<any[]>([])

const reportForm = reactive({ floor: 1, anchor_condition: '', need_two_person: false, danger_desc: '', feeYuan: 200 })
const resolveForm = reactive({ action: 'continue', note: '', new_date: '', new_slot: '', support_technician_id: null as number | null })

const latest = computed(() => props.risks[0] || null)
const riskPhotos = computed(() => props.evidence.filter((e: any) => e.stage === 'risk'))
const canReport = computed(() =>
  props.role === 'technician' &&
  props.order.technician_id &&
  !['completed', 'paid', 'reviewed', 'archived', 'cancelled'].includes(props.order.status) &&
  !props.risks.some(r => r.status === 'pending')
)
const canResolve = computed(() => ['cs', 'admin'].includes(props.role))

const slotDates = computed(() => [...new Set((props.order.time_slots || []).map((t: any) => t.date))] as string[])
const slotsForDate = computed(() =>
  (props.order.time_slots || []).filter((t: any) => t.date === resolveForm.new_date).map((t: any) => t.slot)
)
const supportOptions = computed(() =>
  technicians.value.filter(t => t.id !== props.order.technician_id && t.status === 'active')
)

function statusLabel(s: string) {
  return { pending: '待客服确认', confirmed: '已确认继续维修', rescheduled: '已改期', reinforced: '已加派人员', cancelled: '已取消订单' }[s] || s
}
function statusTag(s: string) {
  return { pending: 'warning', confirmed: 'success', rescheduled: 'primary', reinforced: 'success', cancelled: 'danger' }[s] || 'info'
}
function actionLabel(a: string) {
  return { continue: '确认风险，继续维修（加收高空费）', reschedule: '改期上门', reinforce: '加派人员双人作业', cancel: '取消订单' }[a] || a
}

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
}

function openReport() {
  reportForm.floor = props.order.floor
  reportForm.anchor_condition = props.anchorConditions[0] || ''
  reportDialog.value = true
}

async function submitReport() {
  if (!reportForm.danger_desc) return ElMessage.warning('请填写危险情况说明')
  saving.value = true
  try {
    // 风险照片：若尚未上传过，则先上传本次选择的照片
    if (!riskPhotos.value.length) {
      if (!file.value) {
        saving.value = false
        return ElMessage.warning('请先选择一张高空风险照片')
      }
      const fd = new FormData()
      fd.append('file', file.value)
      fd.append('stage', 'risk')
      fd.append('note', `高空风险照片（${reportForm.floor} 层）`)
      await api.post(`/orders/${props.order.id}/evidence`, fd)
    }
    await api.post(`/orders/${props.order.id}/risk-assessment`, {
      floor: reportForm.floor,
      anchor_condition: reportForm.anchor_condition,
      need_two_person: reportForm.need_two_person,
      danger_desc: reportForm.danger_desc,
      fee_adjust_cents: Math.round(reportForm.feeYuan * 100),
    })
    ElMessage.success('风险确认已上报，等待客服处置')
    reportDialog.value = false
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function openResolve(ra: any) {
  current.value = ra
  resolveForm.action = 'continue'
  resolveForm.note = ''
  resolveForm.new_date = slotDates.value[0] || ''
  resolveForm.new_slot = ''
  resolveForm.support_technician_id = null
  if (!technicians.value.length) {
    const r = await api.get('/technicians')
    technicians.value = r.data
  }
  resolveDialog.value = true
}

async function submitResolve() {
  if (resolveForm.action === 'reschedule' && (!resolveForm.new_date || !resolveForm.new_slot)) {
    return ElMessage.warning('改期需选择新日期与时段')
  }
  if (resolveForm.action === 'reinforce' && !resolveForm.support_technician_id) {
    return ElMessage.warning('加派需选择支援师傅')
  }
  saving.value = true
  try {
    await api.post(`/risk-assessments/${current.value.id}/resolve`, { ...resolveForm })
    ElMessage.success('处置完成，已同步居民与师傅')
    resolveDialog.value = false
    emit('refresh')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.risk-box { border: 1px solid #f5d0b8; background: #fff7f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
.fee-line { margin-top: 6px; color: #d4380d; font-size: 13px; font-weight: 600; }
.resolution { margin-top: 6px; color: #3a7d44; font-size: 13px; }
</style>
