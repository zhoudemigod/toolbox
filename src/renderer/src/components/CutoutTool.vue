<script setup lang="ts">
import { Button as TButton } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import {
  ArrowLeft,
  Upload,
  FileUp,
  Maximize,
  Scissors,
  Download,
  Square,
  LoaderCircle,
  X,
  ShieldCheck
} from 'lucide-vue-next'
import type { RunToolRequest, TaskState } from '../../../shared/types.ts'
import { useImagePreview } from '../composables/use-image-preview'
import { useMediaWorkbench } from '../composables/use-media-workbench'

const props = defineProps<{
  task: TaskState | null
  run: (request: RunToolRequest) => Promise<void>
  cancel: () => Promise<void>
}>()
const emit = defineEmits<{ back: [] }>()
const previewError = ref(false),
  mode = ref<'original' | 'result'>('original')
const {
  viewport,
  zoom,
  canPan,
  drag,
  imageStyle,
  fit,
  loaded,
  start,
  move,
  endDrag,
  wheel,
  keyboard
} = useImagePreview()
/** 单文件输入、提交与保存由共享工作页管理。 */
const { file, choosing, saving, message, busy, visibleTask, output, choose, remove, submit, save } =
  useMediaWorkbench(props, {
    toolId: 'background-remover',
    kind: () => 'image',
    savedMessage: 'PNG 已保存，原文件未修改',
    validate: (next) =>
      /\.(png|jpe?g|webp)$/i.test(next.name) ? null : '抠图暂支持 PNG、JPG 和 WebP，请重新选择',
    onChange: () => {
      previewError.value = false
      mode.value = 'original'
      fit()
    },
    beforeSubmit: () => {
      mode.value = 'original'
    },
    request: (next) => ({ toolId: 'background-remover', mediaKind: 'image', fileIds: [next.id] })
  })
const url = computed(() =>
  mode.value === 'result' && output.value?.outputId
    ? `toolbox-media://local/${output.value.outputId}`
    : file.value?.previewUrl
)
watch(url, () => {
  previewError.value = false
})
watch(
  () => output.value?.outputId,
  (id) => {
    if (id) {
      mode.value = 'result'
      fit()
    }
  }
)
</script>

<template>
  <section aria-labelledby="cutout-heading">
    <TButton theme="primary" variant="text" class="back-button" type="button" @click="emit('back')">
      <ArrowLeft :size="15" />返回工具库
    </TButton>
    <div class="workbench-heading">
      <div>
        <h1 id="cutout-heading">图片抠图</h1>
        <p>保留主体，让背景透明。</p>
      </div>
      <span class="local-processing"><ShieldCheck :size="14" />本地处理</span>
    </div>
    <form class="workbench-grid" @submit.prevent="submit">
      <section class="preview-panel panel" aria-labelledby="cutout-upload-heading">
        <div class="preview-panel-header">
          <h2 id="cutout-upload-heading">图片预览</h2>
          <span>PNG、JPG、WebP · 每次 1 张</span>
        </div>
        <TButton
          theme="default"
          variant="dashed"
          v-if="!file"
          class="single-upload-area"
          type="button"
          :disabled="choosing || busy"
          @click="choose"
        >
          <span class="upload-icon"><Upload :size="30" /></span
          ><strong>{{ choosing ? '正在选择…' : '选择一张图片' }}</strong
          ><span>自动识别主体，导出透明背景 PNG</span
          ><small>最大 256 MB · 不超过 4000 万像素</small>
        </TButton>
        <template v-else>
          <div class="preview-switch" role="group" aria-label="预览内容">
            <TButton
              theme="primary"
              :variant="mode === 'original' ? 'base' : 'text'"
              size="small"
              type="button"
              :aria-pressed="mode === 'original'"
              @click="mode = 'original'"
            >
              原图</TButton
            ><TButton
              theme="primary"
              :variant="mode === 'result' ? 'base' : 'text'"
              size="small"
              type="button"
              :aria-pressed="mode === 'result'"
              :disabled="!output"
              @click="mode = 'result'"
            >
              抠图结果</TButton
            ><span>{{ mode === 'result' ? '棋盘格表示透明区域' : '原图预览' }}</span>
          </div>
          <div
            ref="viewport"
            class="cutout-preview"
            :class="{ 'is-pannable': canPan && !previewError, 'is-dragging': drag }"
            tabindex="0"
            aria-label="图片预览，滚轮缩放，放大后拖动或使用方向键移动，双击适应窗口"
            @wheel.prevent="wheel"
            @pointerdown="start"
            @pointermove="move"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @lostpointercapture="endDrag"
            @dblclick="fit"
            @keydown="keyboard"
          >
            <div v-if="previewError" class="preview-unavailable">
              <strong>图片暂时无法预览</strong><span>仍可提交处理，或更换图片</span>
            </div>
            <template v-else>
              <img
                :src="url"
                class="cutout-image"
                :style="imageStyle"
                :draggable="false"
                :alt="mode === 'result' ? '透明背景抠图结果' : file.name"
                @error="previewError = true"
                @load="loaded"
              />
            </template>
          </div>
          <div class="cutout-zoom">
            <label for="cutout-zoom">预览缩放 {{ zoom }}%</label
            ><input
              id="cutout-zoom"
              v-model.number="zoom"
              type="range"
              min="50"
              max="300"
              step="10"
            />
            <TButton
              theme="default"
              variant="outline"
              shape="square"
              class="icon-button cutout-fit"
              type="button"
              title="适应窗口"
              aria-label="适应窗口"
              @click="fit"
            >
              <Maximize :size="16" :stroke-width="1.8" aria-hidden="true" />
            </TButton>
          </div>
          <div class="single-file-info">
            <span class="single-file-icon"><Scissors :size="18" /></span>
            <div>
              <strong>{{ file.name }}</strong
              ><span>{{
                output?.cutout
                  ? `${output.cutout.width} × ${output.cutout.height} px · PNG`
                  : '原图尺寸保留'
              }}</span>
            </div>
            <TButton
              theme="default"
              variant="outline"
              shape="square"
              class="icon-button"
              type="button"
              title="更换图片"
              aria-label="更换图片"
              :disabled="busy || choosing || saving"
              @click="choose"
            >
              <LoaderCircle v-if="choosing" class="spin" :size="17" aria-hidden="true" /><Upload
                v-else
                :size="17"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </TButton>
            <TButton
              theme="default"
              variant="outline"
              shape="square"
              class="icon-button"
              type="button"
              aria-label="移除图片"
              :disabled="busy || saving"
              @click="remove"
            >
              <X :size="17" />
            </TButton>
          </div>
        </template>
      </section>
      <aside class="panel cutout-settings">
        <h2>抠图设置</h2>
        <div class="cutout-setting"><span>处理方式</span><strong>自动识别主体</strong></div>
        <div class="cutout-setting"><span>导出格式</span><strong>PNG · 透明背景</strong></div>
        <div class="cutout-setting"><span>图片尺寸</span><strong>保持原始尺寸</strong></div>
        <p class="cutout-hint">适用于人像、商品和动物。发丝、玻璃及复杂背景可能需要进一步修整。</p>
        <TButton
          theme="primary"
          variant="base"
          class="primary-button"
          type="submit"
          :disabled="!file || busy || choosing || saving"
        >
          <LoaderCircle v-if="busy" class="spin" :size="16" /><Scissors v-else :size="16" />{{
            busy ? '正在抠图…' : '开始抠图'
          }}
        </TButton>
        <TButton
          theme="default"
          variant="outline"
          v-if="busy"
          class="secondary-button"
          type="button"
          @click="cancel"
        >
          <Square :size="15" />停止处理
        </TButton>
        <TButton
          theme="default"
          variant="outline"
          class="secondary-button"
          type="button"
          :disabled="!output || busy || saving"
          @click="save"
        >
          <Download :size="16" />{{ saving ? '正在保存…' : '另存 PNG' }}
        </TButton>
        <div
          v-if="visibleTask"
          class="single-task-result"
          :class="visibleTask.status"
          role="status"
        >
          <strong>{{
            visibleTask.status === 'running'
              ? '正在分离主体与背景'
              : visibleTask.status === 'success'
                ? '抠图完成'
                : '处理未完成'
          }}</strong>
          <p>{{ visibleTask.result }}</p>
          <small v-if="visibleTask.status === 'running'">首次处理需要加载模型，请稍候。</small>
        </div>
        <p v-if="message" class="operation-message" role="status">{{ message }}</p>
      </aside>
    </form>
  </section>
</template>

<style scoped>
.cutout-preview {
  position: relative;
  height: 400px;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  border: 1px solid #dce3ee;
  border-radius: 8px;
  background: repeating-conic-gradient(#e7ebf1 0% 25%, #fff 0% 50%) 50%/20px 20px;
}
.cutout-image {
  position: absolute;
  left: 50%;
  top: 50%;
  display: block;
  max-width: none;
  pointer-events: none;
  transform-origin: center;
}
.cutout-preview.is-pannable {
  cursor: grab;
}
.cutout-preview.is-dragging {
  cursor: grabbing;
}
.cutout-fit {
  flex: none;
  width: 30px;
  height: 30px;
}
.single-file-info strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cutout-preview .preview-unavailable {
  height: 100%;
}
.single-file-info .icon-button {
  width: 32px;
  height: 32px;
}
.cutout-zoom {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: #73849f;
  margin-top: 14px;
}
.cutout-zoom input {
  flex: 1;
  min-width: 0;
  accent-color: #6077c9;
}
.cutout-settings {
  padding: 24px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cutout-settings h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.cutout-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid #edf0f5;
}
.cutout-setting span {
  color: #8190a7;
}
.cutout-setting strong {
  font-weight: 500;
  color: #435674;
}
.cutout-hint {
  color: #8190a7;
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
}
.cutout-settings .primary-button,
.cutout-settings .secondary-button {
  width: 100%;
  justify-content: center;
}
@media (max-width: 1000px) {
  .cutout-preview {
    height: 340px;
  }
}
</style>
