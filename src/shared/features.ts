import featureCatalog from './features.json'
import type { MediaKind, ToolDefinition, ToolId } from './types.ts'

/** 功能清单中的单项定义；主进程注册、契约校验和打包清单共用这一份数据。 */
export interface FeatureDefinition extends ToolDefinition {
  /** Python 入口，相对于安装包的 runtime 目录。 */
  pythonEntrypoint: string
  /** 该工具接受的媒体类型。 */
  mediaKinds: readonly MediaKind[]
  /** 结果文件名中的固定标记。 */
  outputSuffix: string
  /** 是否接收来源平台参数。 */
  supportsPlatforms: boolean
  /** Python 结果协议类型。 */
  eventKind: 'watermark' | 'image'
}

export const FEATURES: readonly FeatureDefinition[] = featureCatalog.map((feature) => ({
  ...feature,
  id: feature.id as ToolId,
  runtime: 'Python' as const,
  mediaKinds: feature.mediaKinds as MediaKind[],
  eventKind: feature.eventKind as FeatureDefinition['eventKind']
}))

/** 按工具标识索引，供主进程查询 Python 入口。 */
export const FEATURE_BY_ID = Object.fromEntries(
  FEATURES.map((feature) => [feature.id, feature])
) as Readonly<Record<ToolId, FeatureDefinition>>

/** 界面使用的工具列表，只暴露展示字段。 */
export const TOOLS: ToolDefinition[] = FEATURES.map(({ id, name, description, runtime }) => ({
  id,
  name,
  description,
  runtime
}))

export function getFeature(id: ToolId): FeatureDefinition {
  return FEATURE_BY_ID[id]
}
