import { FEATURES } from './features.ts'
import type { ToolId } from './types.ts'

/** 允许提交的图片后缀；Python 再次核对实际解码格式，不接受 SVG 等主动内容。 */
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'avif',
  'heic',
  'bmp',
  'gif',
  'tif',
  'tiff'
]
/** 当前开放 MP4、MOV、M4V 视频的画面修复。 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']
/** 与上游标准库解析器默认输入上限一致，单位字节。 */
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024
/** 单张图片允许的最大像素数，与 runtime/common/limits.py 保持一致。 */
export const MAX_IMAGE_PIXELS = 40_000_000
/** 单次会话最多登记的文件数。 */
export const MAX_SESSION_FILES = 500
/** Python 标准输出单行缓冲上限，单位字节。 */
export const MAX_PROTOCOL_BUFFER_BYTES = 65_536
/** 各工具在结果文件名中的固定标记，由功能清单统一维护。 */
export const OUTPUT_SUFFIXES: Readonly<Record<ToolId, string>> = Object.fromEntries(
  FEATURES.map((feature) => [feature.id, feature.outputSuffix])
) as Readonly<Record<ToolId, string>>
/**
 * 生成 Python 与主进程共用的结果文件名。
 * @param toolId 当前工具。
 * @param index 文件序号。
 * @param sourceExtension 源文件扩展名，需包含点且为小写。
 */
export function outputFileName(toolId: ToolId, index: number, sourceExtension: string): string {
  const extension = toolId === 'watermark-remover' ? sourceExtension : '.png'
  return `${index}${OUTPUT_SUFFIXES[toolId]}${extension}`
}
