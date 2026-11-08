import { extname } from 'node:path'
import { z } from 'zod'
import { sourcePlatformSchema } from '../../shared/contracts.ts'
import { MAX_IMAGE_PIXELS, MAX_MEDIA_BYTES, outputFileName } from '../../shared/constants.ts'
import {
  SOURCE_PLATFORMS,
  type CropRequest,
  type CutoutRequest,
  type MediaResult,
  type RunToolRequest,
  type ToolId,
  type WatermarkRequest
} from '../../shared/types.ts'
import type { MediaEntry } from '../services/media-library.ts'

/** 去水印工具的单行业务事件。 */
const watermarkEventSchema = z
  .object({
    type: z.literal('file'),
    index: z.literal(0),
    status: z.enum(['cleaned', 'unchanged', 'partial', 'failed']),
    message: z.string().max(500),
    bytesOut: z.number().int().min(0).max(MAX_MEDIA_BYTES),
    detectedPlatforms: z.array(sourcePlatformSchema).max(SOURCE_PLATFORMS.length - 1),
    platformMatch: z.boolean().nullable(),
    visibleStatus: z
      .enum(['not_requested', 'no_watermark', 'cleaned', 'partial', 'unvalidated', 'unsupported'])
      .default('not_requested'),
    removedMarks: z.array(z.string().max(80)).max(32).default([])
  })
  .strict()

/** 抠图与裁剪共用的图片结果事件。 */
const imageEventSchema = z
  .object({
    type: z.literal('file'),
    index: z.literal(0),
    status: z.enum(['cleaned', 'failed']),
    message: z.string().max(500),
    bytesOut: z.number().int().min(0).max(MAX_MEDIA_BYTES),
    width: z.number().int().min(0).max(MAX_IMAGE_PIXELS),
    height: z.number().int().min(0).max(MAX_IMAGE_PIXELS)
  })
  .strict()
  .refine(
    (event) =>
      event.status === 'failed' ||
      (event.width > 0 &&
        event.height > 0 &&
        event.width * event.height <= MAX_IMAGE_PIXELS &&
        event.bytesOut > 0),
    '无效图片结果'
  )

type WatermarkEvent = z.infer<typeof watermarkEventSchema>
type ImageEvent = z.infer<typeof imageEventSchema>
/** 任一工具返回的已校验业务事件。 */
export type FileEvent = WatermarkEvent | ImageEvent

/** 单个工具的临时清单、命令参数与结果策略。 */
export interface FeatureRuntime {
  /** 校验一行 Python 标准输出。 */
  parseEvent(line: string): FileEvent
  /** 生成不包含真实用户数据的临时清单。 */
  buildManifest(request: RunToolRequest, inputs: readonly MediaEntry[]): Record<string, unknown>
  /** 生成入口脚本之外的命令参数。 */
  buildArgs(request: RunToolRequest): string[]
  /** 生成 Python 与主进程共用的结果文件名。 */
  outputName(index: number, sourcePath: string): string
  /** 把业务事件转换为界面结果。 */
  toResult(event: FileEvent, source: MediaEntry, outputId: string | null): MediaResult
  /** 任务未完成或存在残留时的兜底提示。 */
  incompleteMessage: string
}

/**
 * 在策略内部还原具体请求类型，调用方只需要按工具选择一次策略。
 * @param request 已校验的联合请求。
 */
function requireWatermark(request: RunToolRequest): WatermarkRequest {
  if (request.toolId !== 'watermark-remover') throw new Error('工具与请求不匹配')
  return request
}

/**
 * 抠图与裁剪共享图片请求字段。
 * @param request 已校验的联合请求。
 */
function requireImage(request: RunToolRequest): CutoutRequest | CropRequest {
  if (request.toolId === 'watermark-remover') throw new Error('工具与请求不匹配')
  return request
}

/**
 * 还原去水印事件类型。
 * @param event 已校验的业务事件。
 */
function requireWatermarkEvent(event: FileEvent): WatermarkEvent {
  if ('width' in event) throw new Error('工具与结果不匹配')
  return event
}

/**
 * 还原图片事件类型。
 * @param event 已校验的业务事件。
 */
function requireImageEvent(event: FileEvent): ImageEvent {
  if (!('width' in event)) throw new Error('工具与结果不匹配')
  return event
}

/** 临时清单只写入输入路径，不携带用户展示名称。 */
function manifestFiles(inputs: readonly MediaEntry[]): { input: string }[] {
  return inputs.map((entry) => ({ input: entry.path }))
}

/** 去水印策略：平台参数、完整来源结果字段。 */
const watermarkRuntime: FeatureRuntime = {
  incompleteMessage: '画面修复未完成或仍需核对，请查看处理结果',
  parseEvent(line) {
    return watermarkEventSchema.parse(JSON.parse(line))
  },
  buildManifest(request, inputs) {
    const watermark = requireWatermark(request)
    return {
      files: manifestFiles(inputs),
      mediaKind: watermark.mediaKind,
      outputName: outputFileName('watermark-remover', 0, extname(inputs[0]!.path).toLowerCase()),
      options: watermark.options
    }
  },
  buildArgs(request) {
    return ['--platforms', ...requireWatermark(request).platforms]
  },
  outputName(index, sourcePath) {
    return outputFileName('watermark-remover', index, sourcePath)
  },
  toResult(event, source, outputId) {
    const result = requireWatermarkEvent(event)
    return {
      fileId: source.file.id,
      name: source.file.name,
      status: result.status,
      message: result.message,
      outputId,
      bytesOut: result.bytesOut,
      detectedPlatforms: result.detectedPlatforms,
      platformMatch: result.platformMatch,
      visibleStatus: result.visibleStatus,
      removedMarks: result.removedMarks
    }
  }
}

/**
 * 创建图片类工具策略，只保留结果字段名的差异。
 * @param toolId 抠图或裁剪。
 * @param resultKey 结果尺寸字段。
 */
function createImageRuntime(
  toolId: 'background-remover' | 'image-crop',
  resultKey: 'cutout' | 'crop'
): FeatureRuntime {
  return {
    incompleteMessage: '图片处理未完成，请重新尝试',
    parseEvent(line) {
      return imageEventSchema.parse(JSON.parse(line))
    },
    buildManifest(request, inputs) {
      const image = requireImage(request)
      return {
        files: manifestFiles(inputs),
        mediaKind: image.mediaKind,
        outputName: outputFileName(toolId, 0, extname(inputs[0]!.path).toLowerCase()),
        ...(image.toolId === 'image-crop' ? { crop: image.crop } : {})
      }
    },
    buildArgs() {
      return []
    },
    outputName(index, sourcePath) {
      return outputFileName(toolId, index, sourcePath)
    },
    toResult(event, source, outputId) {
      const result = requireImageEvent(event)
      const size = { width: result.width, height: result.height }
      return {
        fileId: source.file.id,
        name: source.file.name,
        status: result.status,
        message: result.message,
        outputId,
        bytesOut: result.bytesOut,
        detectedPlatforms: [],
        platformMatch: null,
        visibleStatus: 'not_requested',
        removedMarks: [],
        ...(resultKey === 'crop' ? { crop: size } : { cutout: size })
      }
    }
  }
}

export const FEATURE_RUNTIMES: Readonly<Record<ToolId, FeatureRuntime>> = {
  'watermark-remover': watermarkRuntime,
  'background-remover': createImageRuntime('background-remover', 'cutout'),
  'image-crop': createImageRuntime('image-crop', 'crop')
}

export function getFeatureRuntime(id: ToolId): FeatureRuntime {
  return FEATURE_RUNTIMES[id]
}
