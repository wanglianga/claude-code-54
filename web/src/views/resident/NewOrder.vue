<template>
  <div class="page">
    <div class="page-title">发起报修</div>
    <div class="card" style="max-width: 860px">
      <el-form :model="form" label-width="110px" v-loading="!meta">
        <el-form-item label="设备品类" required>
          <el-radio-group v-model="form.device_type" @change="form.brand = ''; form.fault_type = ''">
            <el-radio-button v-for="d in meta?.device_types || []" :key="d.value" :value="d.value">
              {{ d.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="品牌" required>
          <el-select v-model="form.brand" placeholder="选择品牌" style="width: 240px">
            <el-option v-for="b in brands" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号">
          <el-input v-model="form.model" placeholder="如 KFR-35GW（机身铭牌可查）" style="width: 320px" />
        </el-form-item>
        <el-form-item label="故障现象" required>
          <el-select v-model="form.fault_type" placeholder="选择故障类型" style="width: 240px">
            <el-option v-for="f in faults" :key="f.value" :label="f.label" :value="f.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="故障描述">
          <el-input v-model="form.fault_desc" type="textarea" :rows="2" maxlength="200" show-word-limit
            placeholder="补充描述故障表现，如：开机两小时不制冷，出风口温度偏高" style="width: 480px" />
        </el-form-item>
        <el-form-item label="购买年限">
          <el-input-number v-model="form.purchase_years" :min="0" :max="30" />
          <span class="muted" style="margin-left: 8px">年</span>
        </el-form-item>
        <el-form-item label="所在社区" required>
          <el-select v-model="form.community" placeholder="选择社区" style="width: 240px">
            <el-option v-for="c in meta?.communities || []" :key="c.name" :label="c.name" :value="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细地址" required>
          <el-input v-model="form.address" placeholder="如 阳光社区7栋802室" style="width: 480px" />
        </el-form-item>
        <el-form-item label="楼层" required>
          <el-input-number v-model="form.floor" :min="1" :max="60" />
          <el-checkbox v-model="form.has_elevator" style="margin-left: 16px">有电梯</el-checkbox>
          <el-alert v-if="form.device_type === 'ac' && form.floor >= 4" type="warning" :closable="false"
            style="margin-top: 8px; width: 480px"
            title="高楼层空调外机作业属于高空作业，平台将优先匹配持高空作业证的师傅" />
        </el-form-item>
        <el-form-item label="可上门时段" required>
          <div>
            <div v-for="d in nextDays" :key="d" class="slot-row">
              <span class="slot-date">{{ d }}（{{ weekday(d) }}）</span>
              <el-checkbox-group v-model="slotChecks[d]">
                <el-checkbox v-for="s in meta?.slots || []" :key="s" :value="s">{{ s }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="muted" style="margin-top: 4px">已选 {{ chosenSlots.length }} 个时段，系统将按师傅档期与配件库存推荐</div>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" @click="submit">提交报修并推荐师傅</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../api'
import { useMeta } from '../../stores/meta'

const metaStore = useMeta()
const router = useRouter()
const meta = computed(() => metaStore.data)

const form = reactive({
  device_type: 'fridge',
  brand: '',
  model: '',
  fault_type: '',
  fault_desc: '',
  purchase_years: 3,
  community: '',
  address: '',
  floor: 3,
  has_elevator: true,
})

const slotChecks = reactive<Record<string, string[]>>({})
const nextDays = Array.from({ length: 7 }, (_, i) => dayjs().add(i + 1, 'day').format('YYYY-MM-DD'))
nextDays.forEach(d => (slotChecks[d] = []))

const brands = computed(() => (meta.value?.brands || {})[form.device_type] || [])
const faults = computed(() => (meta.value?.faults || {})[form.device_type] || [])
const chosenSlots = computed(() =>
  nextDays.flatMap(d => (slotChecks[d] || []).map(slot => ({ date: d, slot })))
)

function weekday(d: string) {
  return ['日', '一', '二', '三', '四', '五', '六'][dayjs(d).day()]
}

const submitting = ref(false)

onMounted(() => metaStore.load())

async function submit() {
  if (!form.brand) return ElMessage.warning('请选择品牌')
  if (!form.fault_type) return ElMessage.warning('请选择故障现象')
  if (!form.community) return ElMessage.warning('请选择社区')
  if (!form.address) return ElMessage.warning('请填写详细地址')
  if (!chosenSlots.value.length) return ElMessage.warning('请至少选择一个可上门时段')
  submitting.value = true
  try {
    const r = await api.post('/orders', { ...form, time_slots: chosenSlots.value })
    ElMessage.success(`报修成功，工单号 ${r.data.order_no}`)
    router.push(`/orders/${r.data.id}`)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.slot-row { display: flex; align-items: center; gap: 14px; padding: 4px 0; }
.slot-date { width: 150px; color: #4a5568; font-size: 13px; }
</style>
