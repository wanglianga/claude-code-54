<template>
  <div class="card mb" v-if="isTechnician">
    <div class="section-title">师傅工作台</div>
    <el-steps :active="step" align-center finish-status="success" style="margin-bottom: 16px">
      <el-step title="到场签到" />
      <el-step title="取证与报价" />
      <el-step title="居民确认" />
      <el-step title="维修作业" />
      <el-step title="试机完成" />
    </el-steps>
    <div class="flex wrap">
      <el-button v-if="order.status === 'scheduled'" type="primary" :icon="Location" :loading="acting"
        @click="checkin">到场签到</el-button>
      <template v-if="order.status === 'arrived'">
        <el-alert type="info" :closable="false" style="width: 100%"
          title="请先在下方「上门证据」上传设备外观、旧损、故障检测照片，再提交报价" />
      </template>
      <el-button v-if="order.status === 'quote_confirmed'" type="primary" :icon="Tools" :loading="acting"
        @click="startRepair">开始维修</el-button>
      <el-button v-if="order.status === 'repairing'" type="success" :icon="CircleCheck" :loading="acting"
        @click="completeDialog = true">完成维修并试机</el-button>
      <el-tag v-if="order.status === 'quote_pending'" type="warning">等待居民确认报价…</el-tag>
    </div>

    <el-dialog v-model="completeDialog" title="完成维修" width="520px">
      <el-form label-width="100px">
        <el-form-item label="试机结果">
          <el-radio-group v-model="completeForm.test_result">
            <el-radio value="pass">试机通过</el-radio>
            <el-radio value="fail">未通过，继续维修</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="试机说明">
          <el-input v-model="completeForm.test_note" placeholder="如：制冷 10 分钟出风口 12℃，运行电流正常" />
        </el-form-item>
        <el-form-item label="费用调整">
          <el-input-number v-model="adjustYuan" :precision="2" style="width: 160px" />
          <span class="muted" style="margin-left: 8px">元（可为负，如减免）</span>
        </el-form-item>
        <el-form-item label="调整说明">
          <el-input v-model="completeForm.fee_note" placeholder="如：未更换配件，减免配件费" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="complete">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Location, Tools, CircleCheck } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'

const props = defineProps<{ order: any; isTechnician: boolean }>()
const emit = defineEmits(['refresh'])

const acting = ref(false)
const completeDialog = ref(false)
const completeForm = reactive({ test_result: 'pass', test_note: '', fee_note: '' })
const adjustYuan = ref(0)

const step = computed(() => {
  const s = props.order.status
  if (s === 'scheduled') return 0
  if (s === 'arrived' || s === 'quote_pending') return 1
  if (s === 'quote_confirmed') return 2
  if (s === 'repairing') return 3
  return 5
})

async function run(fn: () => Promise<any>, msg: string) {
  acting.value = true
  try {
    await fn()
    ElMessage.success(msg)
    emit('refresh')
  } finally {
    acting.value = false
  }
}

const checkin = () => run(() => api.post(`/orders/${props.order.id}/checkin`), '已签到，请上传现场证据')
const startRepair = () => run(() => api.post(`/orders/${props.order.id}/start-repair`), '开始维修')

async function complete() {
  completeDialog.value = false
  await run(
    () => api.post(`/orders/${props.order.id}/complete`, {
      test_result: completeForm.test_result,
      test_note: completeForm.test_note,
      fee_adjust_cents: Math.round(adjustYuan.value * 100),
      fee_note: completeForm.fee_note,
    }),
    completeForm.test_result === 'pass' ? '维修完成，等待居民支付' : '已记录试机未通过，请继续维修'
  )
}
</script>
