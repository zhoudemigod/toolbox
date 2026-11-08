import { z } from 'zod'
import { MAX_IMAGE_PIXELS } from './constants.ts'
import { SOURCE_PLATFORMS, TOOL_IDS } from './types.ts'

/** 已注册的本地工具。 */
export const toolIdSchema = z.enum(TOOL_IDS)
/** 具有画面水印规则的平台。 */
const sourcePlatformIds = SOURCE_PLATFORMS.map((source) => source.id) as [string, ...string[]]
export const sourcePlatformSchema = z.enum(sourcePlatformIds)
/** 上传和实际输入校验统一使用的媒体类型。 */
export const mediaKindSchema = z.enum(['image', 'video'])
/** 画面角标与隐藏来源可分别处理，至少启用一项。 */
export const cleanupOptionsSchema = z
  .object({
    removeVisibleMarks: z.boolean(),
    removeSourceMetadata: z.boolean().default(false)
  })
  .strict()
  .refine(
    (options) => options.removeVisibleMarks || options.removeSourceMetadata,
    '请至少选择一项清理操作'
  )
/** 图片和视频均只能选择一个平台，自动识别也作为独立选项。 */
export const sourceSelectionSchema = z.array(sourcePlatformSchema).length(1, '生成平台只能选择一个')
/** 图片和视频平台均为单选；只接受本机选择器登记的单个文件。 */
export const watermarkRequestSchema = z
  .object({
    toolId: z.literal('watermark-remover'),
    mediaKind: mediaKindSchema,
    platforms: sourceSelectionSchema,
    fileIds: z.array(z.uuid()).length(1, '目前每次只处理一个文件'),
    options: cleanupOptionsSchema.default({
      removeVisibleMarks: true,
      removeSourceMetadata: true
    })
  })
  .strict()
/** 抠图只接受单张图片，不接受来源平台或去水印选项。 */
export const cutoutRequestSchema = z
  .object({
    toolId: z.literal('background-remover'),
    mediaKind: z.literal('image'),
    fileIds: z.array(z.uuid()).length(1, '目前每次只处理一张图片')
  })
  .strict()
export const cropBoxSchema = z
  .object({
    x: z.number().int().min(0).max(MAX_IMAGE_PIXELS),
    y: z.number().int().min(0).max(MAX_IMAGE_PIXELS),
    width: z.number().int().positive().max(MAX_IMAGE_PIXELS),
    height: z.number().int().positive().max(MAX_IMAGE_PIXELS)
  })
  .strict()
  .refine((box) => box.width * box.height <= MAX_IMAGE_PIXELS, '选区不能超过 4000 万像素')
export const cropRequestSchema = z
  .object({
    toolId: z.literal('image-crop'),
    mediaKind: z.literal('image'),
    fileIds: z.array(z.uuid()).length(1, '目前每次只裁剪一张图片'),
    crop: cropBoxSchema
  })
  .strict()
export const runToolSchema = z.discriminatedUnion('toolId', [
  watermarkRequestSchema,
  cutoutRequestSchema,
  cropRequestSchema
])
/** 功能脚本返回之外的启动期信息，字段范围与界面一致。 */
export const systemInfoSchema = z
  .object({
    osName: z.string().min(1).max(160),
    osVersion: z.string().max(160),
    architecture: z.string().min(1).max(32),
    cpuName: z.string().min(1).max(200),
    logicalCores: z.number().int().positive().max(65536),
    gpus: z.array(z.string().min(1).max(200)).max(16),
    memoryTotalBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable()
  })
  .strict()
