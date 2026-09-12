<template>
  <div class="card mb">
    <div class="section-title">支付 · 质保 · 评价 · 返修</div>

    <el-descriptions :column="3" border size="small" class="mb">
      <el-descriptions-item label="支付">
        <span v-if="payment" class="money">¥{{ fen(payment.amount_cents) }}（已支付）</span>
        <span v-else class="muted">未支付</span>
      </el-descriptions-item>
      <el-descriptions-item label="质保">
        <span v-if="warranty">{{ warranty.start_date }} ~ {{ warranty.end_date }}（{{ warranty.period_days }} 天）</span>
        <span v-else class="muted">维修完成后生效</span>
      </el-descriptions-item>
      <el-descriptions-item label="评价">
        <span v-if="review">
          <el-rate :model-value="review.rating" disabled size="small" style="display: inline-flex; vertical-align: -4px" />
          {{ review.comment }}
        </span>
        <span v-else class="muted">未评价</span>
      </el-descriptions-item>
    </el-descriptions>

    <div v-if="order.test_result" class="muted mb">
      试机结果：{{ order.test_result === 'pass' ? '通过' : '未通过' }} {{ order.test_note }}
      <span v-if="order.fee_adjust_cents">；费用调整 ¥{{ fen(order.fee_adjust_cents) }}（{{ order.fee_note }}）</span>
    </div>

    <div v-if="reworks.length" class="mb">
      <span class="muted">关联返修单：</span>
      <el-link v-for="rw in reworks" :key="rw.id" type="primary" style="margin-right: 12px"
        @click="$router.push(`/orders/${rw.id}`)">
        {{ rw.order_no }}（{{ statusLabel(rw.status) }}）
      </el-link>
    </div>
    <div v-if="original" class="mb">
      <span class="muted">本单为质保返修单，原工单：</span>
      <el-link type="primary" @click="$router.push(`/orders/${original.id}`)">{{ original.order_no }}</el-link>
      <el-tag size="small" type="success" style="margin-left: 8px">质保期内免费</el-tag>
    </div>

    <div v-if="isResident" class="flex wrap">
      <el-button v-if="order.status === 'completed'" type="primary" :icon="Wallet" @click="pay">
        支付 ¥{{ fen(payAmount) }}
      </el-button>
      <el-button v-if="order.status === 'paid'" type="warning" :icon="Star" @click="reviewDialog = true">
        评价师傅
      </el-button>
      <el-button v-if="canRework" type="danger" plain :icon="RefreshLeft" @click="reworkDialog = true">
        质保期内故障复发，申请返修
      </el-button>
    </div>

    <el-dialog v-model="reviewDialog" title="评价本次维修" width="480px">
      <el-form label-width="80px">
        <el-form-item label="评分">
          <el-rate v-model="reviewForm.rating" />
        </el-form-item>
        <el-form-item label="标签">
          <el-checkbox-group v-model="reviewForm.tags">
            <el-checkbox v-for="t in ['服务及时', '技术专业', '收费透明', '态度好', '证据齐全']" :key="t" :value="t">
              {{ t }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="评价">
          <el-input v-model="reviewForm.comment" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialog = false">取消</el-button>
        <el-button type="primary" @click="submitReview">提交评价并归档</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reworkDialog" title="申请质保返修" width="480px">
      <el-alert type="warning" :closable="false" class="mb"
        title="质保期内同一故障复发可免费返修，将生成关联返修单并通知平台与客服" />
      <el-input v-model="reworkDesc" type="textarea" :rows="3" placeholder="描述故障复发情况" />
      <template #footer>
        <el-button @click="reworkDialog = false">取消</el-button>
        <el-button type="danger" @click="submitRework">提交返修申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Wallet, Star, RefreshLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, fen } from '../api'

const props = defineProps<{
  order: any
  payment: any
  warranty: any
  review: any
  reworks: any[]
  original: any
  quotes: any[]
  isResident: boolean
}>()
const emit = defineEmits(['refresh'])
const router = useRouter()

const reviewDialog = ref(false)
const reworkDialog = ref(false)
const reworkDesc = ref('')
const reviewForm = reactive({ rating: 5, tags: [] as string[], comment: '' })

const payAmount = computed(() => {
  if (props.order.is_warranty_rework) return 0
  const confirmed = (props.quotes || []).find((q: any) => q.status === 'confirmed')
  return (confirmed?.total_cents || 0) + (props.order.fee_adjust_cents || 0)
})

const canRework = computed(() => {
  if (!props.warranty) return false
  const today = new Date().toISOString().slice(0, 10)
  return ['paid', 'reviewed', 'archived', 'completed'].includes(props.order.status) && props.warranty.end_date >= today
})

function statusLabel(s: string) {
  return s
}

async function pay() {
  await api.post(`/orders/${props.order.id}/pay`, { method: 'online' })
  ElMessage.success('支付成功，质保已生效')
  emit('refresh')
}

async function submitReview() {
  await api.post(`/orders/${props.order.id}/review`, reviewForm)
  ElMessage.success('评价成功，订单已归档')
  reviewDialog.value = false
  emit('refresh')
}

async function submitRework() {
  if (!reworkDesc.value) return ElMessage.warning('请描述故障复发情况')
  const r = await api.post(`/orders/${props.order.id}/rework`, { fault_desc: reworkDesc.value })
  ElMessage.success(`返修单 ${r.data.order_no} 已生成`)
  reworkDialog.value = false
  router.push(`/orders/${r.data.id}`)
}
</script>
