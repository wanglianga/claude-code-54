<template>
  <el-tag :type="STATUS_TYPE[status] || 'info'" size="small">{{ label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_TYPE } from '../api'

const props = defineProps<{ status: string; label?: string }>()
const label = computed(() => props.label || props.status)
</script>
