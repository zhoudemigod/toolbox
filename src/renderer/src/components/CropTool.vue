<script setup lang="ts">
import { Button as TButton } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import { ArrowLeft, Crop, Upload, X, Scan, Download, LoaderCircle, Square } from 'lucide-vue-next'
import { MAX_IMAGE_PIXELS } from '../../../shared/constants.ts'
import type { RunToolRequest, TaskState } from '../../../shared/types.ts'
import { useImagePreview } from '../composables/use-image-preview'
import { useMediaWorkbench } from '../composables/use-media-workbench'
import {
  initialCrop,
  dragCrop,
  pixelCrop,
  type CropRect,
  type CropHandle
} from '../utils/crop-geometry'

const props = defineProps<{
  task: TaskState | null
  run: (request: RunToolRequest) => Promise<void>
  cancel: () => Promise<void>
}>()
const emit = defineEmits<{ back: [] }>()
const size = ref({ width: 0, height: 0 }),
  rect = ref<CropRect>({ x: 0, y: 0, width: 0, height: 0 })
const ratioValue = ref('16:9'),
  submittedKey = ref('')
const ratioOptions = ['16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '1:1']
  .map((value) => {
    const [w, h] = value.split(':').map(Number)
    const scale = Math.min(28 / w!, 22 / h!)
    return { label: value, value, width: w! * scale, height: h! * scale }
  })
  .concat([{ label: '自由', value: 'free', width: 0, height: 0 }])
const ratio = computed(() => {
  if (ratioValue.value === 'free') return null
  const [w, h] = ratioValue.value.split(':').map(Number)
  return w! / h!
})
const frame = ref<HTMLElement | null>(null)
const {
  viewport,
  imageStyle,
  fit,
  loaded: measureImage,
  wheel,
  start: startPan,
  move: movePan,
  endDrag: endPan
} = useImagePreview()
const ready = computed(() => size.value.width > 0 && size.value.height > 0)
const pixels = computed(() =>
  ready.value ? pixelCrop(rect.value, size.value) : { x: 0, y: 0, width: 0, height: 0 }
)
const key = computed(() => JSON.stringify(pixels.value))
/** 单文件输入、提交与保存由共享工作页管理。 */
const { file, choosing, saving, message, busy, visibleTask, output, choose, remove, submit, save } =
  useMediaWorkbench(props, {
    toolId: 'image-crop',
    kind: () => 'image',
    savedMessage: '裁剪图片已保存，原文件未修改',
    validate: (next) =>
      /\.(png|jpe?g|webp)$/i.test(next.name) ? null : '请选择 PNG、JPG 或 WebP 图片',
    accept: (next, current) => !(current?.id === next.id && ready.value),
    onChange: () => {
      size.value = { width: 0, height: 0 }
      submittedKey.value = ''
    },
    beforeSubmit: () => {
      submittedKey.value = key.value
    },
    canSubmit: () => ready.value,
    request: (next) => ({
      toolId: 'image-crop',
      mediaKind: 'image',
      fileIds: [next.id],
      crop: { ...pixels.value }
    }),
    isVisible: () => submittedKey.value === key.value,
    selectOutput: (task) => task.outputs.find((result) => result.outputId) ?? null
  })
const selectionStyle = computed(() =>
  ready.value
    ? {
        left: `${(rect.value.x / size.value.width) * 100}%`,
        top: `${(rect.value.y / size.value.height) * 100}%`,
        width: `${(rect.value.width / size.value.width) * 100}%`,
        height: `${(rect.value.height / size.value.height) * 100}%`
      }
    : {}
)
const handles = [
  { id: 'nw', label: '左上角' },
  { id: 'ne', label: '右上角' },
  { id: 'sw', label: '左下角' },
  { id: 'se', label: '右下角' }
] as const
let drag: {
  id: number
  x: number
  y: number
  handle: CropHandle
  start: CropRect
  scale: number
} | null = null

function resetCrop(): void {
  if (ready.value) rect.value = initialCrop(size.value, ratio.value)
}
function failedImage(): void {
  message.value = '图片无法读取，请更换图片'
  size.value = { width: 0, height: 0 }
}
watch(ratio, resetCrop)
function loaded(event: Event): void {
  const image = event.target as HTMLImageElement
  if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
    size.value = { width: 0, height: 0 }
    message.value = '图片不能超过 4000 万像素，请更换图片'
    return
  }
  size.value = { width: image.naturalWidth, height: image.naturalHeight }
  fit()
  measureImage(event)
  resetCrop()
}
function start(event: PointerEvent, handle: CropHandle): void {
  if (!ready.value || busy.value || event.button !== 0 || !event.isPrimary || !frame.value) return
  const scale = frame.value.getBoundingClientRect().width / size.value.width
  if (!scale) return
  event.preventDefault()
  frame.value.setPointerCapture(event.pointerId)
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    handle,
    start: { ...rect.value },
    scale
  }
}
function zoomImage(event: WheelEvent): void {
  if (ready.value && !busy.value && !drag) wheel(event)
}
function panImage(event: PointerEvent): void {
  if (ready.value && !busy.value && !drag) startPan(event)
}
function move(event: PointerEvent): void {
  if (!drag || drag.id !== event.pointerId) return
  rect.value = dragCrop(
    drag.start,
    drag.handle,
    (event.clientX - drag.x) / drag.scale,
    (event.clientY - drag.y) / drag.scale,
    size.value,
    ratio.value
  )
}
function finish(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return
  const id = drag.id
  drag = null
  if (frame.value?.hasPointerCapture(id)) frame.value.releasePointerCapture(id)
}
function keyboard(event: KeyboardEvent, handle: CropHandle): void {
  if (!ready.value || busy.value) return
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ]
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  const step = event.shiftKey ? 10 : 1
  rect.value = dragCrop(
    rect.value,
    handle,
    delta[0]! * step,
    delta[1]! * step,
    size.value,
    ratio.value
  )
}
</script>

<template>
  <section aria-labelledby="crop-heading">
    <TButton class="back-button" theme="primary" variant="text" type="button" @click="emit('back')"
      ><ArrowLeft :size="15" />返回工具库</TButton
    >
    <div class="workbench-heading">
      <div>
        <h1 id="crop-heading">图片裁剪</h1>
        <p>选择比例，拖动选区，留下合适的画面。</p>
      </div>
    </div>
    <form class="workbench-grid" @submit.prevent="submit">
      <section class="preview-panel panel" aria-label="图片裁剪预览">
        <div class="preview-panel-header">
          <h2>裁剪预览</h2>
          <span>PNG、JPG、WebP · 每次 1 张</span>
        </div>
        <TButton
          v-if="!file"
          class="single-upload-area"
          theme="default"
          variant="dashed"
          type="button"
          :disabled="choosing || busy"
          @click="choose"
          ><span class="upload-icon"><Upload :size="30" /></span
          ><strong>{{ choosing ? '正在选择…' : '选择一张图片' }}</strong
          ><span>拖动四角调整选区，拖动选区移动位置</span
          ><small>最大 256 MB · 不超过 4000 万像素</small></TButton
        >
        <template v-else>
          <div
            ref="viewport"
            class="crop-stage"
            @wheel.prevent="zoomImage"
            @pointerdown="panImage"
            @pointermove="movePan"
            @pointerup="endPan"
            @pointercancel="endPan"
            @lostpointercapture="endPan"
          >
            <div
              ref="frame"
              class="crop-image"
              :style="imageStyle"
              @pointermove="move"
              @pointerup="finish"
              @pointercancel="finish"
              @lostpointercapture="finish"
            >
              <img
                :key="file.id"
                :src="file.previewUrl"
                :alt="file.name"
                :draggable="false"
                @load="loaded"
                @error="failedImage"
              />
              <div
                v-if="ready"
                class="crop-selection"
                :class="{ 'is-disabled': busy }"
                :style="selectionStyle"
                tabindex="0"
                role="group"
                aria-label="裁剪选区，可使用方向键移动"
                @pointerdown.stop="start($event, 'move')"
                @keydown="keyboard($event, 'move')"
              >
                <span class="crop-grid" aria-hidden="true"></span>
                <TButton
                  v-for="handle in handles"
                  :key="handle.id"
                  class="crop-handle"
                  :class="handle.id"
                  shape="circle"
                  theme="primary"
                  variant="base"
                  type="button"
                  :disabled="busy"
                  :aria-label="`调整${handle.label}，可使用方向键`"
                  @pointerdown.stop="start($event, handle.id)"
                  @keydown="keyboard($event, handle.id)"
                />
              </div>
            </div>
          </div>
          <div class="single-file-info">
            <span class="single-file-icon"><Crop :size="18" /></span>
            <div>
              <strong>{{ file.name }}</strong
              ><span>{{ ready ? `${size.width} × ${size.height} px` : '正在读取图片' }}</span>
            </div>
            <TButton
              class="icon-button"
              shape="square"
              theme="default"
              variant="outline"
              type="button"
              title="更换图片"
              aria-label="更换图片"
              :disabled="busy || choosing || saving"
              @click="choose"
              ><Upload :size="17" /></TButton
            ><TButton
              class="icon-button"
              shape="square"
              theme="default"
              variant="outline"
              type="button"
              title="移除图片"
              aria-label="移除图片"
              :disabled="busy || saving"
              @click="remove"
              ><X :size="17"
            /></TButton>
          </div>
        </template>
      </section>
      <aside class="panel crop-settings">
        <h2>裁剪设置</h2>
        <div class="crop-ratio" role="group" aria-labelledby="crop-ratio-label">
          <span id="crop-ratio-label">裁剪比例</span>
          <div class="crop-ratio-options">
            <TButton
              v-for="option in ratioOptions"
              :key="option.value"
              class="crop-ratio-option"
              :class="{ 'is-selected': ratioValue === option.value }"
              type="button"
              theme="default"
              variant="outline"
              :aria-pressed="ratioValue === option.value"
              :disabled="busy"
              @click="ratioValue = option.value"
            >
              <span class="crop-ratio-content">
                <Scan v-if="option.value === 'free'" :size="18" aria-hidden="true" />
                <svg
                  v-else
                  width="22"
                  height="18"
                  viewBox="0 0 32 26"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    :x="(32 - option.width) / 2"
                    :y="(26 - option.height) / 2"
                    :width="option.width"
                    :height="option.height"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                </svg>
                <span>{{ option.label }}</span>
              </span>
            </TButton>
          </div>
        </div>
        <TButton
          class="primary-button"
          theme="primary"
          type="submit"
          :disabled="!ready || busy || saving"
          ><LoaderCircle v-if="busy" class="spin" :size="16" /><Crop v-else :size="16" />{{
            busy ? '正在裁剪…' : '生成裁剪图片'
          }}</TButton
        >
        <TButton v-if="busy" theme="default" variant="outline" type="button" @click="cancel"
          ><Square :size="15" />停止处理</TButton
        >
        <TButton
          theme="default"
          variant="outline"
          type="button"
          :disabled="!output || busy || saving"
          @click="save"
          ><Download :size="16" />{{ saving ? '正在保存…' : '另存 PNG' }}</TButton
        >
        <figure v-if="output && !busy" class="crop-result">
          <img :src="`toolbox-media://local/${output.outputId}`" alt="裁剪结果" />
          <figcaption>{{ output.crop?.width }} × {{ output.crop?.height }} px · PNG</figcaption>
        </figure>
        <div
          v-if="visibleTask"
          class="single-task-result"
          :class="visibleTask.status"
          role="status"
        >
          <p>{{ visibleTask.result }}</p>
        </div>
        <p v-if="message" class="operation-message" role="status">{{ message }}</p>
      </aside>
    </form>
  </section>
</template>

<style scoped>
.crop-stage {
  position: relative;
  height: 420px;
  overflow: hidden;
  touch-action: none;
  border: 1px solid #dce3ee;
  border-radius: 8px;
  background: repeating-conic-gradient(#e7ebf1 0% 25%, #fff 0% 50%) 50%/20px 20px;
}
.crop-image {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  touch-action: none;
  user-select: none;
}
.crop-image > img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.crop-selection {
  position: absolute;
  border: 1px solid white;
  outline: 1px solid var(--accent);
  box-shadow: 0 0 0 2000px #18223580;
  cursor: move;
  touch-action: none;
}
.crop-selection.is-disabled {
  cursor: default;
}
.crop-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(
      to right,
      transparent calc(33.333% - 0.5px),
      #ffffff80 33.333%,
      transparent calc(33.333% + 0.5px),
      transparent calc(66.666% - 0.5px),
      #ffffff80 66.666%,
      transparent calc(66.666% + 0.5px)
    ),
    linear-gradient(
      to bottom,
      transparent calc(33.333% - 0.5px),
      #ffffff80 33.333%,
      transparent calc(33.333% + 0.5px),
      transparent calc(66.666% - 0.5px),
      #ffffff80 66.666%,
      transparent calc(66.666% + 0.5px)
    );
}
.crop-handle.t-button {
  position: absolute;
  width: 14px;
  height: 14px;
  min-width: 14px;
  padding: 0;
  z-index: 1;
}
.crop-handle.nw {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}
.crop-handle.ne {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}
.crop-handle.sw {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}
.crop-handle.se {
  right: -7px;
  bottom: -7px;
  cursor: nwse-resize;
}
.crop-settings {
  padding: 24px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.crop-settings h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.crop-ratio {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  color: #738096;
}
.crop-ratio-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.crop-ratio-option.t-button {
  margin: 0;
  height: auto;
  min-height: 42px;
  justify-content: flex-start;
  padding: 10px;
  border: 1px solid #dce3ee;
  border-radius: 8px;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.crop-ratio-option.is-selected {
  border-color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}
.crop-ratio-content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #435674;
}
.crop-ratio-content > svg {
  flex-shrink: 0;
}
.crop-ratio-option.is-selected .crop-ratio-content {
  color: var(--td-brand-color);
}
.crop-result {
  margin: 0;
}
.crop-result img {
  display: block;
  max-width: 100%;
  max-height: 180px;
  margin: auto;
  object-fit: contain;
  background: repeating-conic-gradient(#e7ebf1 0% 25%, #fff 0% 50%) 50%/16px 16px;
}
.crop-result figcaption {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: #8190a7;
}
.single-file-info strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 1000px) {
  .crop-stage {
    height: 360px;
  }
}
</style>
