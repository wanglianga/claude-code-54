<template>
  <div class="card mb">
    <div class="flex-between">
      <div class="section-title">上门证据（{{ evidence.length }}）</div>
      <el-button v-if="canUpload" type="primary" plain size="small" :icon="Camera" @click="dialog = true">
        上传证据
      </el-button>
    </div>
    <div v-for="g in grouped" :key="g.stage" class="mb">
      <div class="muted" style="margin-bottom: 6px">{{ g.label }}</div>
      <div class="evidence-grid">
        <div v-for="e in g.items" :key="e.id">
          <el-image :src="e.file_path" :preview-src-list="g.items.map((x: any) => x.file_path)" fit="cover"
            style="width: 100%; height: 110px; border-radius: 6px" preview-teleported />
          <div class="muted" style="font-size: 12px; margin-top: 2px">
            {{ e.note || '—' }}<br />{{ e.uploaded_by_name }} · {{ fmtTime(e.created_at) }}
          </div>
        </div>
      </div>
    </div>
    <el-empty v-if="!evidence.length" description="尚未上传证据" :image-size="60" />

    <el-dialog v-model="dialog" title="上传上门证据" width="480px">
      <el-form label-width="90px">
        <el-form-item label="证据类型">
          <el-select v-model="stage" style="width: 100%">
            <el-option v-for="s in stages" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="note" placeholder="如：机身右下角旧划痕，已与用户确认" />
        </el-form-item>
        <el-form-item label="照片">
          <input type="file" accept="image/*" @change="onFile" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="doUpload">上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Camera } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, fmtTime, STAGE_LABEL } from '../api'

const props = defineProps<{ orderId: number; evidence: any[]; canUpload: boolean; stages: any[] }>()
const emit = defineEmits(['refresh'])

const dialog = ref(false)
const stage = ref('appearance')
const note = ref('')
const file = ref<File | null>(null)
const uploading = ref(false)

const grouped = computed(() => {
  const map = new Map<string, any[]>()
  for (const e of props.evidence) {
    if (!map.has(e.stage)) map.set(e.stage, [])
    map.get(e.stage)!.push(e)
  }
  return [...map.entries()].map(([st, items]) => ({ stage: st, label: STAGE_LABEL[st] || st, items }))
})

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
}

async function doUpload() {
  if (!file.value) return ElMessage.warning('请选择照片')
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    fd.append('stage', stage.value)
    fd.append('note', note.value)
    await api.post(`/orders/${props.orderId}/evidence`, fd)
    ElMessage.success('上传成功')
    dialog.value = false
    note.value = ''
    file.value = null
    emit('refresh')
  } finally {
    uploading.value = false
  }
}
</script>
