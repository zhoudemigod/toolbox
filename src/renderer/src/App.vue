<script setup lang="ts">
import { Button as TButton, Input as TInput } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowRight, Search, RotateCw } from 'lucide-vue-next'
import { useToolbox } from './composables/use-toolbox'
import SidebarRail from './components/SidebarRail.vue'
import SystemInfoBar from './components/SystemInfoBar.vue'
import type { ToolId } from '../../shared/types.ts'
import { getRendererFeature } from './features/registry'

/** 工具搜索词。 */
const search = ref('')
// TDesign 通过 expose 提供 focus，当前版本的组件实例声明未包含该方法。
const searchInput = ref<{ focus: () => void } | null>(null)
const searchShortcut = navigator.platform.toLowerCase().includes('mac') ? '⌘ K' : 'Ctrl K'
/** 当前是否打开正式工具的工作页。 */
const toolOpen = ref<ToolId | null>(null)
const openedName = computed(
  () => snapshot.value?.tools.find((tool) => tool.id === toolOpen.value)?.name ?? '工具库'
)
const openedFeature = computed(() => (toolOpen.value ? getRendererFeature(toolOpen.value) : null))
/** 页面只保留工具状态及执行操作。 */
const { snapshot, loading, error, resetting, currentTask, refresh, run, cancel, reset } =
  useToolbox()
/** 按名称、说明和类型过滤工具。 */
const filteredTools = computed(
  () =>
    snapshot.value?.tools.filter((tool) =>
      `${tool.name} ${tool.description} ${tool.runtime} ${getRendererFeature(tool.id).mediaLabels.join(' ')}`
        .toLowerCase()
        .includes(search.value.trim().toLowerCase())
    ) ?? []
)

/** 每次从工具列表进入都创建空白工作区，旧文件和结果不会跟随进入。 */
async function openTool(id: ToolId): Promise<void> {
  if (await reset()) toolOpen.value = id
}

function focusSearch(event: KeyboardEvent): void {
  if (toolOpen.value || event.isComposing || event.altKey || event.shiftKey) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && searchInput.value) {
    event.preventDefault()
    searchInput.value.focus()
  }
}
onMounted(() => window.addEventListener('keydown', focusSearch))
onUnmounted(() => window.removeEventListener('keydown', focusSearch))
</script>

<template>
  <div class="app-shell">
    <SidebarRail :version="snapshot?.version ?? '0.1.0'" @home="toolOpen = null" />
    <main id="main-content" class="main-content">
      <header class="topbar">
        <div class="breadcrumb">
          所有工具 <span>/</span> <strong>{{ openedName }}</strong>
        </div>
        <SystemInfoBar :info="snapshot?.systemInfo ?? null" />
      </header>
      <div class="page-content">
        <div v-if="error" class="error-banner" role="alert">
          {{ error
          }}<TButton
            theme="primary"
            variant="text"
            type="button"
            class="text-button"
            @click="refresh"
            >重新加载</TButton
          >
        </div>
        <div v-if="loading && !snapshot" class="panel empty-state" role="status">
          正在打开工具箱…
        </div>
        <template v-if="snapshot">
          <template v-if="!toolOpen">
            <div class="tools-toolbar">
              <div class="tools-heading">
                <h1>
                  工具库 <span>{{ snapshot.tools.length }}</span>
                </h1>
                <p>图片与视频处理，一处完成。</p>
              </div>
              <div class="toolbar-actions">
                <label class="tool-search">
                  <span class="sr-only">搜索工具</span>
                  <TInput
                    ref="searchInput"
                    v-model="search"
                    clearable
                    placeholder="搜索工具…"
                    aria-label="搜索工具"
                    aria-keyshortcuts="Control+k Meta+k"
                  >
                    <template #prefixIcon><Search :size="16" aria-hidden="true" /></template>
                    <template #suffix
                      ><kbd v-if="!search">{{ searchShortcut }}</kbd></template
                    >
                  </TInput>
                </label>
                <TButton
                  theme="default"
                  variant="outline"
                  shape="square"
                  type="button"
                  class="icon-button refresh-button"
                  aria-label="刷新工具"
                  title="刷新工具"
                  :disabled="loading"
                  @click="refresh"
                >
                  <RotateCw :size="17" :class="{ spin: loading }" aria-hidden="true" />
                </TButton>
              </div>
            </div>
            <div class="tool-grid">
              <div
                v-for="(tool, index) in filteredTools"
                :key="tool.id"
                class="tool-card-entry"
                :style="{ '--entry-delay': `${Math.min(index, 5) * 45}ms` }"
              >
                <article class="tool-card" :class="{ 'is-disabled': resetting }">
                  <div class="tool-card-top">
                    <span class="tool-icon" :class="tool.id"
                      ><component
                        :is="getRendererFeature(tool.id).icon"
                        :size="20"
                        aria-hidden="true"
                    /></span>
                    <h2>{{ tool.name }}</h2>
                  </div>
                  <p>{{ tool.description }}</p>
                  <div class="tool-card-footer">
                    <div class="tool-badges">
                      <span
                        v-for="label in getRendererFeature(tool.id).mediaLabels"
                        :key="label"
                        class="runtime-label"
                        :class="{ 'video-badge': label === '视频' }"
                        >{{ label }}</span
                      >
                    </div>
                    <span class="tool-run" aria-hidden="true">
                      打开工具<ArrowRight :size="16" />
                    </span>
                  </div>
                  <TButton
                    theme="primary"
                    variant="text"
                    type="button"
                    class="tool-card-action"
                    :aria-label="`打开${tool.name}`"
                    :disabled="resetting"
                    @click="openTool(tool.id)"
                  >
                    <span class="sr-only">打开{{ tool.name }}</span>
                  </TButton>
                </article>
              </div>
            </div>
            <div v-if="!filteredTools.length" class="panel empty-state">
              没有找到匹配的工具，试试其他关键词。
            </div>
          </template>
          <component
            v-else-if="openedFeature"
            :is="openedFeature.component"
            :task="currentTask"
            :run="run"
            :cancel="cancel"
            @back="toolOpen = null"
          />
        </template>
      </div>
    </main>
  </div>
</template>
