<script setup lang="ts">
import { Button as TButton } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import {
  Upload,
  Image,
  Film,
  X,
  Download,
  Square,
  ArrowLeft,
  LoaderCircle,
  RefreshCw,
  ShieldCheck
} from 'lucide-vue-next'
import {
  SOURCE_PLATFORMS,
  type CleanupOptions,
  type MediaKind,
  type RunToolRequest,
  type SourcePlatform,
  type TaskState
} from '../../../shared/types.ts'
import { useMediaWorkbench } from '../composables/use-media-workbench'

/** 主页面保留任务内存状态；此工作页只维护单文件输入和选项。 */
const props = defineProps<{
  task: TaskState | null
  run: (request: RunToolRequest) => Promise<void>
  cancel: () => Promise<void>
}>()
/** 返回工具库的操作。 */
const emit = defineEmits<{ back: [] }>()
/** 当前模式决定原生选择器过滤范围。 */
const mediaKind = ref<MediaKind>('image')
/** 图片和视频都只选一个平台，默认自动识别。 */
const platforms = ref<SourcePlatform[]>(['auto'])
/** 原生 radio 用字符串模型同步，避免复用节点后界面勾选与提交值不一致。 */
const selectedPlatform = computed({
  get: () => platforms.value[0] ?? 'auto',
  set: (id: SourcePlatform) => {
    platforms.value = [id]
  }
})
/** 画面修复与隐藏来源清理均默认启用，可独立选择。 */
const options = ref<CleanupOptions>({
  removeVisibleMarks: true,
  removeSourceMetadata: true
})
/** 当前预览原文件还是本次处理结果。 */
const previewMode = ref<'original' | 'result'>('original')
/** 图片或视频解码不可用时提供替代说明，不阻止后端检查格式。 */
const previewError = ref(false)
/** 任一清理操作有效时才可提交。 */
const hasOperation = computed(
  () => options.value.removeVisibleMarks || options.value.removeSourceMetadata
)
/** 单文件输入、提交与保存由共享工作页管理。 */
const {
  file,
  choosing,
  saving,
  message,
  messageError,
  busy,
  visibleTask,
  output,
  choose,
  remove,
  submit,
  save
} = useMediaWorkbench(props, {
  toolId: 'watermark-remover',
  kind: () => mediaKind.value,
  savedMessage: '结果已保存，原文件未修改',
  validate: (next) => (next.kind === mediaKind.value ? null : '请选择当前模式对应的单个文件'),
  onChange: () => {
    previewMode.value = 'original'
  },
  canSubmit: () => hasOperation.value,
  request: (next) => ({
    toolId: 'watermark-remover',
    mediaKind: mediaKind.value,
    platforms: [...platforms.value],
    fileIds: [next.id],
    options: { ...options.value }
  }),
  requireToolId: false,
  selectOutput: (task) => task.outputs[0] ?? null
})
/** 预览协议只接收主进程发放的文件凭证。 */
const previewUrl = computed(() =>
  previewMode.value === 'result' && output.value?.outputId
    ? `toolbox-media://local/${output.value.outputId}`
    : file.value?.previewUrl
)
/** 根据媒体类型优先展示常见来源，保持选项面板紧凑。 */
const commonIds = computed(() =>
  mediaKind.value === 'image'
    ? ['auto', 'doubao', 'jimeng', 'gemini', 'qwen', 'kling', 'yuanbao', 'wan']
    : ['auto', 'doubao', 'jimeng', 'sora', 'veo', 'kling', 'hailuo', 'vidu']
)
/** 常见平台采用确定顺序，不依赖配置文件中的排列。 */
const commonSources = computed(() =>
  commonIds.value.map((id) => SOURCE_PLATFORMS.find((source) => source.id === id)!).filter(Boolean)
)
/** 当前任务的简短中文状态。 */
const taskLabels = {
  running: '正在处理',
  success: '处理完成',
  failed: '请核对结果',
  cancelled: '已停止',
  timeout: '已超时'
}
/** 单文件结果标签。 */
const resultLabels = {
  cleaned: '已处理',
  unchanged: '未发现目标标记',
  partial: '需核对',
  failed: '处理失败'
}
/** 只展示实际执行过的画面规则，不把下拉平台选择当成识别结论。 */
const removedLabel = computed(() => {
  const keys = output.value?.removedMarks ?? []
  return SOURCE_PLATFORMS.filter((source) =>
    [...source.imageMarks, ...source.videoMarks].some((key) => keys.includes(key))
  )
    .map((source) => source.name)
    .join('、')
})

/** 新的文件或结果切换后重新检查浏览器能否预览。 */
watch(previewUrl, () => {
  previewError.value = false
})
/** 新结果完成后直接展示处理结果，同时保留原文件切换入口。 */
watch(
  () => output.value?.outputId,
  (id) => {
    if (id) previewMode.value = 'result'
  }
)

/**
 * 格式化文件大小。
 * @param bytes 原始字节数。
 * @returns 可读的大小标签。
 */
function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 切换工作区模式，清除不兼容的输入及预览，不删除原文件。
 * @param kind 用户选择的图片或视频模式。
 */
function changeKind(kind: MediaKind): void {
  if (busy.value || choosing.value || kind === mediaKind.value) return
  mediaKind.value = kind
  file.value = null
  previewMode.value = 'original'
  platforms.value = ['auto']
  message.value = ''
}

/** 恢复安全的默认处理选项，不改动当前文件。 */
function resetOptions(): void {
  platforms.value = ['auto']
  options.value = { removeVisibleMarks: true, removeSourceMetadata: true }
}

/**
 * 展示检测到的来源，不能当作对真实作者的认证。
 * @param ids 画面规则实际命中的平台标识。
 * @returns 来源名称。
 */
function sourceLabel(ids: SourcePlatform[]): string {
  return ids.map((id) => SOURCE_PLATFORMS.find((source) => source.id === id)?.name ?? id).join('、')
}
</script>

<template>
  <section class="watermark-tool" aria-labelledby="watermark-heading">
    <TButton theme="primary" variant="text" class="back-button" type="button" @click="emit('back')">
      <ArrowLeft :size="15" />返回工具库
    </TButton>
    <div class="workbench-heading flex-wrap">
      <div>
        <h1 id="watermark-heading">图片视频去水印</h1>
        <p>上传一个文件，选择处理方式，预览并保存结果。</p>
      </div>
      <span class="local-processing"><ShieldCheck :size="14" />本地处理</span>
    </div>
    <form
      class="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] 2xl:grid-cols-[minmax(0,1fr)_360px]"
      @submit.prevent="submit"
    >
      <section class="preview-panel panel" aria-labelledby="upload-heading">
        <div class="preview-panel-header flex-wrap">
          <h2 id="upload-heading">上传文件</h2>
          <span>每次 1 个 · 最大 256 MB</span>
        </div>
        <div class="media-kind-selector" role="group" aria-label="文件类型">
          <TButton
            theme="primary"
            :variant="mediaKind === 'image' ? 'base' : 'text'"
            size="small"
            type="button"
            :aria-pressed="mediaKind === 'image'"
            :disabled="busy || choosing"
            @click="changeKind('image')"
          >
            <Image :size="16" />图片</TButton
          ><TButton
            theme="primary"
            :variant="mediaKind === 'video' ? 'base' : 'text'"
            size="small"
            type="button"
            :aria-pressed="mediaKind === 'video'"
            :disabled="busy || choosing"
            @click="changeKind('video')"
          >
            <Film :size="16" />视频
          </TButton>
        </div>
        <TButton
          theme="default"
          variant="dashed"
          v-if="!file"
          class="single-upload-area"
          type="button"
          :aria-label="mediaKind === 'image' ? '选择一张图片' : '选择一个视频'"
          :disabled="busy || choosing"
          @click="choose"
        >
          <span class="upload-icon"><Upload :size="30" /></span
          ><strong>{{
            choosing ? '正在选择…' : mediaKind === 'image' ? '选择一张图片' : '选择一个视频'
          }}</strong
          ><span>点击选择本地文件</span
          ><small>{{
            mediaKind === 'image' ? 'PNG、JPG、WebP、AVIF、HEIC、BMP、GIF、TIFF' : 'MP4、MOV、M4V'
          }}</small>
        </TButton>
        <template v-else>
          <div class="preview-switch flex-wrap" role="group" aria-label="预览内容">
            <TButton
              theme="primary"
              :variant="previewMode === 'original' ? 'base' : 'text'"
              size="small"
              type="button"
              :aria-pressed="previewMode === 'original'"
              @click="previewMode = 'original'"
            >
              原文件</TButton
            ><TButton
              theme="primary"
              :variant="previewMode === 'result' ? 'base' : 'text'"
              size="small"
              type="button"
              :aria-pressed="previewMode === 'result'"
              :disabled="!output?.outputId"
              @click="previewMode = 'result'"
            >
              处理结果</TButton
            ><span>{{ previewMode === 'result' ? '结果预览' : '原文件预览' }}</span>
          </div>
          <div class="single-media-stage">
            <div v-if="previewError" class="preview-unavailable">
              <component :is="mediaKind === 'image' ? Image : Film" :size="32" /><strong
                >当前格式暂不能预览</strong
              ><span>仍可提交文件检查与处理</span>
            </div>
            <img
              v-else-if="mediaKind === 'image'"
              class="single-media-preview"
              :src="previewUrl"
              :alt="file.name"
              @error="previewError = true"
            />
            <video
              v-else
              class="single-media-preview"
              :src="previewUrl"
              controls
              preload="metadata"
              :aria-label="`预览${file.name}`"
              @error="previewError = true"
            ></video>
          </div>
          <div class="single-file-info">
            <span class="single-file-icon"
              ><component :is="mediaKind === 'image' ? Image : Film" :size="18"
            /></span>
            <div>
              <strong class="truncate" :title="file.name">{{ file.name }}</strong
              ><span
                >{{ sizeLabel(previewMode === 'result' && output ? output.bytesOut : file.size) }} ·
                {{ previewMode === 'result' ? '处理结果' : '原文件保留' }}</span
              >
            </div>
            <TButton
              theme="default"
              variant="outline"
              shape="square"
              class="icon-button"
              type="button"
              :disabled="busy || choosing"
              :title="mediaKind === 'image' ? '更换图片' : '更换视频'"
              :aria-label="mediaKind === 'image' ? '更换图片' : '更换视频'"
              @click="choose"
            >
              <LoaderCircle v-if="choosing" class="spin" :size="17" aria-hidden="true" /><Upload
                v-else
                :size="17"
                :stroke-width="1.8"
                aria-hidden="true" /></TButton
            ><TButton
              theme="default"
              variant="outline"
              shape="square"
              class="icon-button"
              type="button"
              :disabled="busy"
              aria-label="移除文件"
              @click="remove"
            >
              <X :size="15" />
            </TButton>
          </div>
        </template>
        <p class="preview-footnote">
          <ShieldCheck :size="13" />文件只在本机读取，处理结果单独保存。
        </p>
        <section
          v-if="visibleTask"
          class="single-task-result"
          :class="visibleTask.status"
          aria-labelledby="result-heading"
        >
          <div class="single-result-heading">
            <strong id="result-heading">{{ taskLabels[visibleTask.status] }}</strong
            ><span v-if="output" class="result-tag" :class="output.status">{{
              resultLabels[output.status]
            }}</span>
          </div>
          <progress
            v-if="busy"
            :value="visibleTask.completed"
            :max="visibleTask.total"
            aria-label="文件处理进度"
          ></progress>
          <p role="status">{{ output?.message ?? visibleTask.result }}</p>
          <small v-if="removedLabel">画面修复：{{ removedLabel }}</small>
          <small v-if="output?.detectedPlatforms.length"
            >识别平台：{{ sourceLabel(output.detectedPlatforms) }}</small
          >
          <TButton
            theme="primary"
            variant="outline"
            v-if="output?.outputId"
            class="secondary-button save-result-button"
            type="button"
            :disabled="saving || busy"
            @click="save"
          >
            <Download :size="15" />{{ saving ? '正在保存…' : '另存处理结果' }}
          </TButton>
        </section>
        <p
          v-if="message"
          class="operation-message"
          :class="{ 'is-error': messageError }"
          :role="messageError ? 'alert' : 'status'"
        >
          {{ message }}
        </p>
      </section>

      <section class="processing-panel panel" aria-labelledby="options-heading">
        <div class="processing-panel-header">
          <h2 id="options-heading">处理选项</h2>
          <TButton
            theme="primary"
            variant="text"
            class="text-button"
            type="button"
            :disabled="busy"
            @click="resetOptions"
          >
            重置
          </TButton>
        </div>
        <fieldset
          class="source-field compact-source-field"
          :disabled="busy"
          aria-describedby="source-help"
        >
          <legend>
            {{ mediaKind === 'image' ? '图片生成平台' : '视频生成平台' }}<span>单选</span>
          </legend>
          <div class="common-source-grid">
            <label v-for="source in commonSources" :key="source.id" class="source-option"
              ><input
                v-model="selectedPlatform"
                type="radio"
                :value="source.id"
                name="source-platform"
                :aria-label="source.name"
              /><span>{{ source.name }}</span></label
            >
          </div>
          <p id="source-help">
            {{
              mediaKind === 'video'
                ? '检测连续帧中稳定出现的已知水印；即梦对应 Seedance AI 角标。'
                : '自动识别检测全部已支持的角标；单选平台只检测该平台的画面水印。'
            }}
          </p>
        </fieldset>
        <fieldset class="cleanup-choice-field" :disabled="busy">
          <legend>清理内容</legend>
          <label class="cleanup-choice"
            ><input
              v-model="options.removeVisibleMarks"
              type="checkbox"
              aria-label="去除画面水印"
            /><span
              ><strong>去除画面水印</strong
              ><small>定位已知 AI 角标并修复局部画面；复杂背景可能留下痕迹。</small></span
            ></label
          >
          <label class="cleanup-choice"
            ><input
              v-model="options.removeSourceMetadata"
              type="checkbox"
              aria-label="清理隐藏来源信息"
            /><span
              ><strong>清理隐藏来源信息</strong
              ><small>清理 C2PA、EXIF、XMP 等元数据中的 AI 来源标记。</small></span
            ></label
          >
        </fieldset>
        <div class="single-submit-area">
          <p v-if="!hasOperation" class="selection-hint">请至少选择一项清理操作</p>
          <p v-else-if="!file" class="selection-hint">
            请先选择一个{{ mediaKind === 'image' ? '图片' : '视频' }}文件
          </p>
          <TButton
            theme="default"
            variant="outline"
            v-if="busy"
            class="secondary-button"
            type="button"
            @click="cancel"
          >
            <Square :size="14" />停止处理</TButton
          ><TButton
            theme="primary"
            variant="base"
            class="primary-button"
            type="submit"
            :disabled="busy || choosing || !file || !hasOperation"
          >
            <LoaderCircle v-if="busy" :size="16" class="spin" />{{
              busy ? '正在处理…' : '开始处理'
            }}</TButton
          ><small>原文件不会被覆盖 · 保持原格式</small>
        </div>
      </section>
    </form>
  </section>
</template>
