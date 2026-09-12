<template>
  <div class="card mb">
    <div class="flex-between">
      <div class="section-title">报价单（{{ quotes.length }} 个版本）</div>
      <el-button v-if="canQuote" type="primary" plain size="small" :icon="DocumentAdd" @click="openCreate">
        {{ quotes.length ? '提交新报价版本' : '提交报价' }}
      </el-button>
    </div>

    <div v-for="qt in quotes" :key="qt.id" class="quote-box" :class="{ dimmed: qt.status !== 'pending' && qt.status !== 'confirmed' }">
      <div class="flex-between">
        <div>
          <b>V{{ qt.version }}</b>
          <el-tag size="small" style="margin-left: 8px" :type="quoteTag(qt.status)">{{ quoteLabel(qt.status) }}</el-tag>
          <span class="muted" style="margin-left: 8px">{{ qt.created_by_name }} · {{ fmtTime(qt.created_at) }}</span>
        </div>
        <div class="money" style="font-size: 18px">¥{{ fen(qt.total_cents) }}</div>
      </div>
      <el-table :data="qt.items" size="small" style="margin-top: 8px">
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.kind === 'part' ? 'success' : row.kind === 'labor' ? 'primary' : 'info'">
              {{ row.kind === 'part' ? '配件' : row.kind === 'labor' ? '工时' : '其他' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="项目" min-width="180" />
        <el-table-column prop="qty" label="数量" width="70" />
        <el-table-column label="单价" width="110">
          <template #default="{ row }">¥{{ fen(row.unit_price_cents) }}</template>
        </el-table-column>
        <el-table-column label="小计" width="110">
          <template #default="{ row }">¥{{ fen(row.qty * row.unit_price_cents) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="qt.remark" class="muted" style="margin-top: 6px">备注：{{ qt.remark }}</div>
      <div v-if="qt.status === 'confirmed'" class="muted" style="margin-top: 4px">
        已由 {{ qt.confirmed_by }} 于 {{ fmtTime(qt.confirmed_at) }} 确认
      </div>
      <div v-if="isResident && qt.status === 'pending' && order.status === 'quote_pending'" class="mt">
        <el-button type="success" size="small" @click="confirm(qt)">确认报价</el-button>
        <el-button type="danger" plain size="small" @click="dispute(qt)">对报价有异议</el-button>
      </div>
    </div>
    <el-empty v-if="!quotes.length" description="师傅尚未提交报价" :image-size="60" />

    <el-dialog v-model="dialog" title="提交报价" width="640px">
      <div v-for="(it, i) in items" :key="i" class="flex mb" style="align-items: flex-start">
        <el-select v-model="it.kind" style="width: 90px">
          <el-option label="工时" value="labor" />
          <el-option label="配件" value="part" />
          <el-option label="其他" value="other" />
        </el-select>
        <el-select v-if="it.kind === 'part'" v-model="it.part_id" placeholder="选择配件" style="width: 220px"
          @change="onPartPick(it)">
          <el-option v-for="p in partOptions" :key="p.id" :value="p.id"
            :label="`${p.name}（¥${fen(p.price_cents)} / 可用 ${p.available}）`" :disabled="p.available <= 0" />
        </el-select>
        <el-input v-model="it.name" placeholder="项目名称" style="width: 220px" :disabled="it.kind === 'part'" />
        <el-input-number v-model="it.qty" :min="1" :max="10" style="width: 90px" />
        <el-input-number v-model="it.priceYuan" :min="0" :precision="2" style="width: 130px" :disabled="it.kind === 'part'" />
        <el-button link type="danger" :icon="Delete" @click="items.splice(i, 1)" />
      </div>
      <el-button size="small" :icon="Plus" @click="items.push({ kind: 'labor', name: '', qty: 1, priceYuan: 0, part_id: null })">
        添加项目
      </el-button>
      <el-input v-model="remark" type="textarea" :rows="2" placeholder="报价备注（故障原因、建议方案）" class="mt" />
      <div class="mt" style="text-align: right">
        合计：<span class="money" style="font-size: 18px">¥{{ totalYuan.toFixed(2) }}</span>
      </div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitQuote">提交给居民确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { DocumentAdd, Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, fen, fmtTime } from '../api'

const props = defineProps<{
  order: any
  quotes: any[]
  isResident: boolean
  isTechnician: boolean
  partOptions: any[]
}>()
const emit = defineEmits(['refresh'])

const dialog = ref(false)
const saving = ref(false)
const remark = ref('')
const items = ref<any[]>([])

const canQuote = computed(() =>
  props.isTechnician && ['arrived', 'quote_pending', 'repairing'].includes(props.order.status)
)

const totalYuan = computed(() =>
  items.value.reduce((s, it) => s + (it.qty || 0) * (it.priceYuan || 0), 0)
)

function quoteLabel(s: string) {
  return { pending: '待确认', confirmed: '已确认', disputed: '争议中', superseded: '已作废' }[s] || s
}
function quoteTag(s: string) {
  return { pending: 'warning', confirmed: 'success', disputed: 'danger', superseded: 'info' }[s] || 'info'
}

function onPartPick(it: any) {
  const p = props.partOptions.find((x: any) => x.id === it.part_id)
  if (p) {
    it.name = p.name
    it.priceYuan = p.price_cents / 100
  }
}

function openCreate() {
  items.value = [{ kind: 'labor', name: '上门检测与维修工时费', qty: 1, priceYuan: 100, part_id: null }]
  remark.value = ''
  dialog.value = true
}

async function submitQuote() {
  const list = items.value.filter(it => it.name && (it.kind !== 'part' || it.part_id))
  if (!list.length) return ElMessage.warning('请至少填写一个报价项目')
  saving.value = true
  try {
    await api.post(`/orders/${props.order.id}/quotes`, {
      remark: remark.value,
      items: list.map(it => ({
        kind: it.kind,
        name: it.name,
        part_id: it.kind === 'part' ? it.part_id : undefined,
        qty: it.qty,
        unit_price_cents: Math.round(it.priceYuan * 100),
      })),
    })
    ElMessage.success('报价已提交，等待居民确认')
    dialog.value = false
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function confirm(qt: any) {
  await ElMessageBox.confirm(`确认按 V${qt.version} 报价 ¥${fen(qt.total_cents)} 维修吗？`, '确认报价', { type: 'warning' })
  await api.post(`/orders/${props.order.id}/quotes/${qt.id}/confirm`)
  ElMessage.success('报价已确认，师傅可开始维修')
  emit('refresh')
}

async function dispute(qt: any) {
  const { value } = await ElMessageBox.prompt('请说明异议原因（将转交客服协调）', '报价异议', {
    inputPlaceholder: '如：工时费高于社区均价',
    inputValidator: v => !!v || '请填写原因',
  })
  await api.post(`/orders/${props.order.id}/quotes/${qt.id}/dispute`, { reason: value })
  ElMessage.success('已提交异议，客服将介入协调')
  emit('refresh')
}
</script>

<style scoped>
.quote-box { border: 1px solid #e4e9f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.dimmed { opacity: 0.65; }
</style>
