<template>
  <div class="card mb">
    <div class="flex-between">
      <div class="section-title">异常与协同（{{ exceptions.length }}）</div>
      <el-dropdown v-if="canCreate" @command="createException">
        <el-button type="warning" plain size="small" :icon="Warning">发起异常</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="t in creatableTypes" :key="t.value" :command="t.value">{{ t.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-for="ex in exceptions" :key="ex.id" class="ex-box">
      <div class="flex-between">
        <div>
          <el-tag size="small" :type="ex.status === 'open' ? 'danger' : 'success'">
            {{ ex.status === 'open' ? '处理中' : '已解决' }}
          </el-tag>
          <b style="margin-left: 8px">{{ ex.title }}</b>
          <el-tag size="small" effect="plain" style="margin-left: 8px">{{ EXCEPTION_LABEL[ex.type] }}</el-tag>
        </div>
        <span class="muted">{{ ex.created_by_name }} · {{ fmtTime(ex.created_at) }}</span>
      </div>
      <div class="muted" style="margin-top: 6px">{{ ex.description }}</div>
      <div v-if="ex.status === 'resolved'" class="resolution">
        处理结果（{{ ex.handler_name }}）：{{ ex.resolution || '已处理' }}
      </div>
      <div v-if="ex.status === 'open' && canResolve" class="mt">
        <el-button size="small" type="primary" plain @click="openResolve(ex)">处理该异常</el-button>
      </div>
    </div>
    <el-empty v-if="!exceptions.length" description="暂无异常，工单协同正常" :image-size="60" />

    <el-dialog v-model="resolveDialog" title="处理异常" width="520px">
      <el-alert v-if="current" :title="`${EXCEPTION_LABEL[current.type]}：${current.description}`" type="warning"
        :closable="false" class="mb" />
      <el-form label-width="90px">
        <el-form-item label="处理说明">
          <el-input v-model="resolution" type="textarea" :rows="3" placeholder="记录处理过程与结论，将写入订单时间线" />
        </el-form-item>
        <el-form-item label="联动动作" v-if="current?.type === 'quote_dispute'">
          <el-radio-group v-model="action">
            <el-radio value="requote">要求师傅重新报价</el-radio>
            <el-radio value="cancel_order">取消订单</el-radio>
            <el-radio value="none">仅记录结论</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doResolve">确认处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, fmtTime, EXCEPTION_LABEL } from '../api'

const props = defineProps<{
  order: any
  exceptions: any[]
  role: string
  exceptionTypes: any[]
}>()
const emit = defineEmits(['refresh'])

const resolveDialog = ref(false)
const current = ref<any>(null)
const resolution = ref('')
const action = ref('none')
const saving = ref(false)

const canCreate = computed(() =>
  ['resident', 'technician'].includes(props.role) &&
  !['completed', 'paid', 'reviewed', 'archived', 'cancelled'].includes(props.order.status)
)

const creatableTypes = computed(() => {
  if (props.role === 'resident') {
    return (props.exceptionTypes || []).filter((t: any) => ['additional_item'].includes(t.value))
  }
  return (props.exceptionTypes || []).filter((t: any) => ['high_altitude', 'parts_mismatch'].includes(t.value))
})

const canResolve = computed(() => {
  if (props.role === 'cs' || props.role === 'admin') return true
  if (props.role === 'warehouse') return props.exceptions.some(e => e.type === 'parts_mismatch' && e.status === 'open')
  return false
})

async function createException(type: string) {
  const label = EXCEPTION_LABEL[type]
  const { value } = await ElMessageBox.prompt(`请描述「${label}」的具体情况`, '发起异常', {
    inputPlaceholder: type === 'additional_item' ? '如：希望顺便清洗空调内机' : '请描述现场情况',
    inputValidator: v => !!v || '请填写描述',
  })
  await api.post(`/orders/${props.order.id}/exceptions`, { type, description: value })
  ElMessage.success('异常已发起，相关角色将收到处理')
  emit('refresh')
}

function openResolve(ex: any) {
  current.value = ex
  resolution.value = ''
  action.value = ex.type === 'quote_dispute' ? 'requote' : 'none'
  resolveDialog.value = true
}

async function doResolve() {
  saving.value = true
  try {
    await api.post(`/exceptions/${current.value.id}/resolve`, {
      resolution: resolution.value,
      action: action.value === 'none' ? undefined : action.value,
    })
    ElMessage.success('异常已处理')
    resolveDialog.value = false
    emit('refresh')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ex-box { border: 1px solid #f0e6d2; background: #fffaf2; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
.resolution { margin-top: 6px; color: #3a7d44; font-size: 13px; }
</style>
