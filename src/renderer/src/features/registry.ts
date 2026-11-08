import type { Component } from 'vue'
import { Crop, Eraser, Scissors, type LucideIcon } from 'lucide-vue-next'
import type { ToolId } from '../../../shared/types.ts'
import CropTool from '../components/CropTool.vue'
import CutoutTool from '../components/CutoutTool.vue'
import WatermarkTool from '../components/WatermarkTool.vue'

/** 前端功能描述；页面组件、图标与媒体能力集中注册，避免入口组件持续增长分支。 */
export interface RendererFeature {
  component: Component
  icon: LucideIcon
  mediaLabels: readonly string[]
}

export const RENDERER_FEATURES: Readonly<Record<ToolId, RendererFeature>> = {
  'watermark-remover': {
    component: WatermarkTool,
    icon: Eraser,
    mediaLabels: ['图片', '视频']
  },
  'background-remover': {
    component: CutoutTool,
    icon: Scissors,
    mediaLabels: ['图片']
  },
  'image-crop': {
    component: CropTool,
    icon: Crop,
    mediaLabels: ['图片']
  }
}

export function getRendererFeature(id: ToolId): RendererFeature {
  return RENDERER_FEATURES[id]
}
