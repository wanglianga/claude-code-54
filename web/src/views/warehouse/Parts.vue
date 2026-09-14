<template>
  <div class="page">
    <div class="flex-between mb">
      <div class="page-title">配件库存与追溯</div>
      <el-button v-if="auth.role === 'warehouse' || auth.role === 'admin'" type="primary" :icon="Plus"
        @click="addDialog = true">新增配件</el-button>
    </div>

    <div class="card mb">
      <div class="section-title">库存（可用 = 实物库存 − 已预留/已出库）</div>
      <el-table :data="parts" v-loading="loading" size="default">
        <el-table-column prop="sku" label="SKU" width="130" />
        <el-table-column prop="name" label="配件名称" min-width="150" />
        <el-table-column prop="model" label="型号" width="130">
          <template #default="{ row }">{{ row.model || '—' }}</template>
        </el-table-column>
        <el-table-column label="品类" width="90">
          <template #default="{ row }">{{ deviceLabel(row.device_type) }}</template>
        </el-table-column>
        <el-table-column label="适配品牌" width="140">
          <template #default="{ row }">{{ row.brands?.length ? row.brands.join('、') : '通用' }}</template>
        </el-table-column>
        <el-table-column prop="batch_no" label="批次号" width="110" />
        <el-table-column prop="supplier" label="供应商" width="110" />
        <el-table-column label="单价" width="90">
          <template #default="{ row }">¥{{ fen(row.price_cents) }}</template>
        </el-table-column>
        <el-table-column label="实物库存" width="90">
          <template #default="{ row }">
            <el-tag :type="row.stock === 0 ? 'danger' : row.stock <= 3 ? 'warning' : 'success'" size="small">
              {{ row.stock }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可用" width="80">
          <template #default="{ row }">
            <b :style="{ color: row.available <= 0 ? '#d4380d' : '#2b3445' }">{{ row.available }}</b>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="restock(row)">补货</el-button>
            <el-button size="small" type="primary" plain @click="trace(row)">追溯</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <div class="section-title">出入库流水（预约预留 → 出库 → 师傅更换）</div>
      <el-radio-group v-model="flowFilter" @change="loadFlow" class="mb">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="reserved">已预留</el-radio-button>
        <el-radio-button value="outbound">已出库</el-radio-button>
        <el-radio-button value="used">已更换</el-radio-button>
      </el-radio-group>
      <el-table :data="flow" size="small">
        <el-table-column prop="order_no" label="工单号" width="150" />
        <el-table-column prop="part_name" label="配件" min-width="150" />
        <el-table-column prop="batch_no" label="批次" width="110" />
        <el-table-column prop="qty" label="数量" width="60" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="{ reserved: 'info', outbound: 'warning', used: 'success', returned: 'danger' }[row.status] as any">
              {{ { reserved: '已预留', outbound: '已出库', used: '已更换', returned: '已退回' }[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="technician_name" label="师傅" width="90" />
        <el-table-column prop="updated_at" label="更新时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button v-if="row.status === 'reserved' && canOperate" size="small" type="warning" plain
              @click="outbound(row)">出库</el-button>
            <el-button size="small" link type="primary" @click="$router.push(`/orders/${row.order_id}`)">工单</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="addDialog" title="新增配件" width="520px">
      <el-form label-width="90px">
        <el-form-item label="SKU"><el-input v-model="addForm.sku" placeholder="如 P-AC-FAN" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="addForm.name" /></el-form-item>
        <el-form-item label="型号"><el-input v-model="addForm.model" placeholder="如 GR-REMOTE-2.4G" /></el-form-item>
        <el-form-item label="品类">
          <el-select v-model="addForm.device_type" style="width: 100%">
            <el-option v-for="d in deviceTypes" :key="d.value" :label="d.label" :value="d.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="适配品牌">
          <el-select v-model="addForm.brands" multiple style="width: 100%" placeholder="不选表示通用件">
            <el-option v-for="b in brandOptions" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="适配故障">
          <el-select v-model="addForm.faults" multiple style="width: 100%">
            <el-option v-for="f in faultOptions" :key="f.value" :label="f.label" :value="f.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="库存"><el-input-number v-model="addForm.stock" :min="0" /></el-form-item>
        <el-form-item label="单价(元)"><el-input-number v-model="addForm.priceYuan" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="批次号"><el-input v-model="addForm.batch_no" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="addForm.supplier" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialog = false">取消</el-button>
        <el-button type="primary" @click="createPart">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="traceDialog" :title="`配件追溯：${traceData?.part?.name || ''}`" width="760px">
      <el-descriptions v-if="traceData" :column="3" border size="small" class="mb">
        <el-descriptions-item label="SKU">{{ traceData.part.sku }}</el-descriptions-item>
        <el-descriptions-item label="批次号">{{ traceData.part.batch_no }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ traceData.part.supplier }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="traceData" :data="traceData.usage" size="small" max-height="380">
        <el-table-column prop="order_no" label="工单号" width="140" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            {{ { reserved: '已预留', outbound: '已出库', used: '已更换', returned: '已退回' }[row.part_status as string] }}
          </template>
        </el-table-column>
        <el-table-column prop="technician_name" label="师傅" width="80" />
        <el-table-column prop="resident_name" label="居民" width="80" />
        <el-table-column label="是否返修" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.rework_count > 0" type="danger" size="small">返修 ×{{ row.rework_count }}</el-tag>
            <span v-else class="muted">否</span>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="traceDialog = false; $router.push(`/orders/${row.order_id}`)">
              工单
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, fen, fmtTime } from '../../api'
import { useAuth } from '../../stores/auth'
import { useMeta } from '../../stores/meta'

const auth = useAuth()
const metaStore = useMeta()
const parts = ref<any[]>([])
const flow = ref<any[]>([])
const loading = ref(false)
const flowFilter = ref('')
const addDialog = ref(false)
const traceDialog = ref(false)
const traceData = ref<any>(null)

const addForm = reactive({
  sku: '', name: '', model: '', device_type: 'ac', brands: [] as string[], faults: [] as string[],
  stock: 0, priceYuan: 0, batch_no: '', supplier: '',
})

const canOperate = computed(() => ['warehouse', 'admin'].includes(auth.role))
const deviceTypes = computed(() => metaStore.data?.device_types || [])
const brandOptions = computed(() => Object.values(metaStore.data?.brands || {}).flat() as string[])
const faultOptions = computed(() => (metaStore.data?.faults || {})[addForm.device_type] || [])

function deviceLabel(v: string) {
  return deviceTypes.value.find((d: any) => d.value === v)?.label || v
}

async function load() {
  loading.value = true
  try {
    const r = await api.get('/parts')
    parts.value = r.data
  } finally {
    loading.value = false
  }
}

async function loadFlow() {
  const r = await api.get('/order-parts', { params: flowFilter.value ? { status: flowFilter.value } : {} })
  flow.value = r.data
}

async function restock(row: any) {
  const { value } = await ElMessageBox.prompt(`为「${row.name}」补货，请输入数量`, '补货', {
    inputPattern: /^[1-9]\d*$/, inputErrorMessage: '请输入正整数',
  })
  await api.post(`/parts/${row.id}/restock`, { qty: parseInt(value) })
  ElMessage.success('补货成功')
  load()
}

async function outbound(row: any) {
  await api.post(`/order-parts/${row.id}/outbound`)
  ElMessage.success('已出库')
  loadFlow()
  load()
}

async function trace(row: any) {
  const r = await api.get(`/parts/${row.id}/trace`)
  traceData.value = r.data
  traceDialog.value = true
}

async function createPart() {
  if (!addForm.sku || !addForm.name) return ElMessage.warning('请填写 SKU 和名称')
  await api.post('/parts', {
    ...addForm,
    price_cents: Math.round(addForm.priceYuan * 100),
  })
  ElMessage.success('已新增')
  addDialog.value = false
  load()
}

onMounted(async () => {
  metaStore.load()
  await Promise.all([load(), loadFlow()])
})
</script>
