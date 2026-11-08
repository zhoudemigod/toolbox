<script setup lang="ts">
import { computed } from 'vue'
import { Cpu, CircuitBoard, MemoryStick, Monitor } from 'lucide-vue-next'
import type { SystemInfo } from '../../../shared/types.ts'

const props = defineProps<{ info: SystemInfo | null }>()
const fields = computed(() => {
  const info = props.info
  const cpu = info?.cpuName
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+CPU\b/i, '')
    .replace(/\s+@\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const gpu = info?.gpus[0]
    ?.replace(/^NVIDIA GeForce\s+/i, '')
    .replace(/\((R|TM)\)/gi, '')
    .trim()
  const memory = info?.memoryTotalBytes
    ? `${Math.round((info.memoryTotalBytes / 1024 ** 3) * 10) / 10} GB`
    : '未识别'
  return [
    {
      label: '系统',
      icon: Monitor,
      text: info ? `${info.osName} · ${info.architecture}` : '读取中…',
      detail: info ? `${info.osName} ${info.osVersion} · ${info.architecture}` : '正在读取系统信息'
    },
    {
      label: 'CPU',
      icon: Cpu,
      text: cpu ?? '读取中…',
      detail: info ? `${info.cpuName} · ${info.logicalCores} 逻辑核心` : '正在读取 CPU 信息'
    },
    {
      label: 'GPU',
      icon: CircuitBoard,
      text: info
        ? gpu
          ? `${gpu}${info.gpus.length > 1 ? ` +${info.gpus.length - 1}` : ''}`
          : '未识别'
        : '读取中…',
      detail: info ? info.gpus.join(' / ') || '未获取到显卡信息' : '正在读取显卡信息'
    },
    {
      label: '内存',
      icon: MemoryStick,
      text: info ? memory : '读取中…',
      detail: info ? `启动时读取的内存总容量：${memory}` : '正在读取内存信息'
    }
  ]
})
</script>

<template>
  <dl class="system-info" aria-label="本机基础配置">
    <div
      v-for="field in fields"
      :key="field.label"
      class="system-info-item"
      :title="field.detail"
      tabindex="0"
      :aria-label="`${field.label}：${field.detail}`"
    >
      <component :is="field.icon" :size="14" aria-hidden="true" />
      <div class="system-info-copy">
        <dt>{{ field.label }}</dt>
        <dd>{{ field.text }}</dd>
      </div>
    </div>
  </dl>
</template>

<style scoped>
.system-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 1 auto;
  min-width: 0;
  margin: 0 0 0 auto;
  padding: 0;
}
.system-info-item {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  border-radius: 4px;
}
.system-info-item > svg {
  flex-shrink: 0;
  color: var(--muted);
}
.system-info-copy {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.system-info-copy dt {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
}
.system-info-copy dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink);
  font-size: 11px;
  line-height: 1.6;
}
@media (max-width: 767px) {
  .system-info {
    display: grid;
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 10px;
  }
}
</style>
