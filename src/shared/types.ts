import featureCatalog from './features.json'
import sourceCatalog from '../../runtime/config/source-platforms.json'

/** 已注册的本地工具。 */
export type ToolId = 'watermark-remover' | 'background-remover' | 'image-crop'
/** 功能清单中的工具标识，供运行时枚举与参数校验共用。 */
export const TOOL_IDS = featureCatalog.map((feature) => feature.id as ToolId) as [
  ToolId,
  ...ToolId[]
]
/** 允许选择的内容来源。 */
export type SourcePlatform = string
/** 上传和实际输入校验统一使用的媒体类型。 */
export type MediaKind = 'image' | 'video'
/** 清理选项，不包含尚未安装的模型功能。 */
export interface CleanupOptions {
  /** 是否处理画面角标。 */
  removeVisibleMarks: boolean
  /** 是否清理隐藏来源信息。 */
  removeSourceMetadata: boolean
}
/** 单个来源平台在离线规则清单中的定义。 */
export interface SourcePlatformDefinition {
  id: SourcePlatform
  name: string
  imageMarks: string[]
  videoMarks: string[]
  common?: boolean
}
/** 前后端共用同一份离线规则清单，保留上游的格式适用范围。 */
export const SOURCE_PLATFORMS: readonly SourcePlatformDefinition[] = sourceCatalog
/** 单张图片的裁剪选区。 */
export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}
/** 图片或视频去水印请求。 */
export interface WatermarkRequest {
  toolId: 'watermark-remover'
  mediaKind: MediaKind
  platforms: SourcePlatform[]
  fileIds: string[]
  options: CleanupOptions
}
/** 图片抠图请求。 */
export interface CutoutRequest {
  toolId: 'background-remover'
  mediaKind: 'image'
  fileIds: string[]
}
/** 图片裁剪请求。 */
export interface CropRequest {
  toolId: 'image-crop'
  mediaKind: 'image'
  fileIds: string[]
  crop: CropBox
}
/** 单文件处理请求。 */
export type RunToolRequest = WatermarkRequest | CutoutRequest | CropRequest
/** 当前任务生命周期，不保存运行历史。 */
export type TaskStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'timeout'
/** 工具列表信息。 */
export interface ToolDefinition {
  /** 工具标识。 */
  id: ToolId
  /** 展示名称。 */
  name: string
  /** 用途说明。 */
  description: string
  /** 使用的内置运行环境。 */
  runtime: 'Python'
}
/** 已登记的本地媒体；不向界面暴露真实文件路径。 */
export interface MediaFile {
  /** 文件访问凭证。 */
  id: string
  /** 原文件名。 */
  name: string
  /** 字节数。 */
  size: number
  /** 决定预览控件的媒体类型。 */
  kind: 'image' | 'video'
  /** 仅限已登记文件的本地预览地址。 */
  previewUrl: string
}
/** 单个文件的业务处理结果，不包含原始进程日志。 */
export interface MediaResult {
  /** 裁剪后实际图片尺寸。 */
  crop?: { width: number; height: number }
  /** 抠图结果尺寸，仅抠图任务返回。 */
  cutout?: { width: number; height: number }
  /** 画面修复状态；未命中不等于已移除。 */
  visibleStatus:
    'not_requested' | 'no_watermark' | 'cleaned' | 'partial' | 'unvalidated' | 'unsupported'
  /** 实际已执行区域修复的上游规则标识。 */
  removedMarks: string[]
  /** 对应的上传文件。 */
  fileId: string
  /** 原文件名。 */
  name: string
  /** 清理完成、原本干净、仍有残留或处理失败。 */
  status: 'cleaned' | 'unchanged' | 'partial' | 'failed'
  /** 简短中文提示。 */
  message: string
  /** 用于导出的结果凭证；失败时为空。 */
  outputId: string | null
  /** 实际结果大小。 */
  bytesOut: number
  /** 根据实际修复的画面规则识别平台，不能证明文件的真实创作者。 */
  detectedPlatforms: SourcePlatform[]
  /** 是否匹配任一已选来源；自动模式为空。 */
  platformMatch: boolean | null
}
/** 仅在本次会话内保存的任务状态。 */
export interface TaskState {
  /** 任务 UUID。 */
  id: string
  /** 工具标识。 */
  toolId: ToolId
  /** 生命周期。 */
  status: TaskStatus
  /** 当前输入凭证，用于切换文件后隐藏旧结果。 */
  inputFileIds: string[]
  /** 当前简短提示。 */
  result: string | null
  /** 文件总数。 */
  total: number
  /** 已完成数量。 */
  completed: number
  /** 已完成文件的结果。 */
  outputs: MediaResult[]
}
/** 启动时采集的基础配置，不包含设备序列号或用户信息。 */
export interface SystemInfo {
  osName: string
  osVersion: string
  architecture: string
  cpuName: string
  logicalCores: number
  gpus: string[]
  memoryTotalBytes: number | null
}
/** 桌面启动和刷新时的状态。 */
export interface AppSnapshot {
  /** 应用版本。 */
  version: string
  /** 系统和架构。 */
  platform: string
  /** 同一应用会话内缓存的系统基础信息。 */
  systemInfo: SystemInfo
  /** 正式工具列表。 */
  tools: ToolDefinition[]
  /** 当前任务，不恢复历史。 */
  currentTask: TaskState | null
}
/** 白名单安全桥，不接收任意文件路径或命令。 */
export interface ToolboxApi {
  /** 读取桌面状态。 */
  snapshot: () => Promise<AppSnapshot>
  /** 打开系统文件选择器，文件始终保留在本地。 */
  chooseMedia: (kind: MediaKind) => Promise<MediaFile[]>
  /** 执行平台指定的媒体清理。 */
  runTool: (request: RunToolRequest) => Promise<TaskState>
  /** 停止旧任务并清除当前工作区的内存状态，不删除原文件或导出结果。 */
  resetTool: () => Promise<void>
  /** 将已完成结果另存到用户选择的位置，取消时返回 false。 */
  saveOutput: (outputId: string) => Promise<boolean>
  /** 停止任务。 */
  cancelTask: (id: string) => Promise<void>
  /** 订阅内存状态，返回退订函数。 */
  onTask: (listener: (task: TaskState) => void) => () => void
}
