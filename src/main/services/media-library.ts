import { randomUUID } from 'node:crypto'
import { copyFile, lstat, realpath, stat } from 'node:fs/promises'
import { basename, extname, resolve, parse } from 'node:path'
import {
  IMAGE_EXTENSIONS,
  MAX_MEDIA_BYTES,
  MAX_SESSION_FILES,
  VIDEO_EXTENSIONS
} from '../../shared/constants.ts'
import type { MediaFile, MediaKind } from '../../shared/types.ts'

/** 允许提交的全部媒体后缀，先按后缀过滤，Python 再核对实际内容。 */
const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

/** 主进程持有真实路径，界面只能使用不透明凭证。 */
export interface MediaEntry {
  /** 可展示的媒体信息。 */
  file: MediaFile
  /** 已解析的本机文件路径。 */
  path: string
  /** 原始输入位置；导出时防止覆盖它。 */
  sourcePath: string
  /** 区分用户输入与已完成输出。 */
  output: boolean
}

/** 本次会话内的文件授权与结果导出，不持久化上传记录。 */
export class MediaLibrary {
  /** 当前会话可访问的输入及输出。 */
  private readonly entries = new Map<string, MediaEntry>()

  /**
   * 检查用户选择的文件，并登记可用于运行和预览的访问凭证。
   * @param paths 原生文件选择器返回的路径，不能来自普通 IPC 参数。
   * @param kind 当前选择的图片或视频；测试及内部授权可省略。
   * @returns 可展示的文件信息；任务存在无效文件时整个选择失败。
   */
  async select(paths: string[], kind?: MediaKind): Promise<MediaFile[]> {
    if (paths.length > 1) throw new Error('目前一次只能选择一个文件')
    if (this.entries.size + paths.length > MAX_SESSION_FILES)
      throw new Error('本次会话已选择过多文件，请重启应用')
    // 1. 完整验证任务，避免只登记一半文件。
    /** 当前选择的已验证信息。 */
    const validated: MediaEntry[] = []
    for (const path of paths) {
      /** 真实文件位置，兼容用户明确选择的快捷挂载目录。 */
      const canonical = await realpath(path)
      /** 文件系统实际属性。 */
      const info = await stat(canonical)
      /** 扩展名只决定允许范围，Python 还会根据文件内容检查格式。 */
      const extension = extname(canonical).slice(1).toLowerCase()
      if (!ALL_EXTENSIONS.includes(extension))
        throw new Error(`不支持的文件格式：${basename(canonical)}`)
      if (kind && (VIDEO_EXTENSIONS.includes(extension) ? 'video' : 'image') !== kind)
        throw new Error(kind === 'image' ? '请在图片模式选择图片' : '请在视频模式选择视频')
      if (!info.isFile() || info.size === 0 || info.size > MAX_MEDIA_BYTES)
        throw new Error(`文件必须非空且不超过 256 MB：${basename(canonical)}`)
      /** 重复选择相同原文件时复用凭证。 */
      const existing = [...this.entries.values()].find(
        (entry) => !entry.output && entry.path === canonical
      )
      /** 由主进程生成的访问标识。 */
      const id = existing?.file.id ?? randomUUID()
      validated.push({
        path: canonical,
        sourcePath: canonical,
        output: false,
        file: {
          id,
          name: basename(canonical),
          size: info.size,
          kind: VIDEO_EXTENSIONS.includes(extension) ? 'video' : 'image',
          previewUrl: `toolbox-media://local/${id}`
        }
      })
    }
    // 2. 只开放验证通过的文件，URL 本身不接受文件系统路径。
    for (const entry of validated) this.entries.set(entry.file.id, entry)
    return validated.map((entry) => ({ ...entry.file }))
  }

  /**
   * 解析已授权输入，输出凭证不能重新当作上传参数使用。
   * @param ids 当前任务的文件凭证。
   * @returns 主进程内部使用的文件副本。
   */
  getInputs(ids: string[]): MediaEntry[] {
    return ids.map((id) => {
      /** 查找原生选择器登记的授权。 */
      const entry = this.entries.get(id)
      if (!entry || entry.output) throw new Error('文件选择已失效，请重新选择')
      return { ...entry, file: { ...entry.file } }
    })
  }

  /**
   * 为固定任务目录内的已完成文件登记导出凭证。
   * @param path 主进程预先指定的结果路径，不接受 Python 回传路径。
   * @param source 本次原文件，用于保护原始内容。
   * @param suffix 结果展示名中的工具标记，由共享命名协议定义。
   * @returns 可导出的结果凭证。
   */
  async registerOutput(path: string, source: MediaEntry, suffix: string): Promise<string> {
    /** 实际完成文件的属性。 */
    const info = await stat(path)
    if (!info.isFile() || info.size === 0 || info.size > MAX_MEDIA_BYTES)
      throw new Error('生成的结果文件不完整')
    /** 单个结果的新凭证。 */
    const id = randomUUID()
    this.entries.set(id, {
      path,
      sourcePath: source.sourcePath,
      output: true,
      file: {
        ...source.file,
        name: `${parse(source.file.name).name}${suffix}${extname(path)}`,
        id,
        size: info.size,
        previewUrl: `toolbox-media://local/${id}`
      }
    })
    return id
  }

  /**
   * 为受限预览协议解析已授权文件。
   * @param id URL 中的不透明凭证。
   * @returns 本机位置；未授权时为空。
   */
  getPreviewPath(id: string): string | undefined {
    return this.entries.get(id)?.path
  }

  /**
   * 获取当前会话已完成结果，禁止任意路径导出。
   * @param id 结果凭证。
   * @returns 已完成输出。
   */
  getOutput(id: string): MediaEntry {
    /** 只接受处理器登记的结果。 */
    const entry = this.entries.get(id)
    if (!entry?.output) throw new Error('结果不存在，请重新处理文件')
    return entry
  }

  /**
   * 将结果复制到用户通过保存对话框确认的位置，禁止覆盖已选择的原文件。
   * @param id 结果凭证。
   * @param destination 系统保存对话框返回的位置。
   */
  async exportOutput(id: string, destination: string): Promise<void> {
    /** 当前结果与目标文件的实际位置。 */
    const output = this.getOutput(id)
    /** 已存在目标的真实位置；新文件使用绝对路径。 */
    const target = await realpath(destination).catch(() => resolve(destination))
    /** 目标属性用于识别硬链接与符号链接。 */
    const targetInfo = await lstat(destination).catch(() => null)
    if (targetInfo?.isSymbolicLink()) throw new Error('不能保存到符号链接，请选择新文件名')
    // WHY: 保存对话框允许覆盖，但清理工具必须保留用户的原始媒体。
    for (const entry of this.entries.values()) {
      if (entry.output) continue
      /** 原文件的身份，用于防止硬链接绕过路径比较。 */
      const originalInfo = await stat(entry.sourcePath).catch(() => null)
      if (
        target === entry.sourcePath ||
        (targetInfo &&
          originalInfo &&
          targetInfo.ino === originalInfo.ino &&
          targetInfo.dev === originalInfo.dev)
      )
        throw new Error('请使用新文件名，不能覆盖原文件')
    }
    if (target === output.path) return
    await copyFile(output.path, destination)
  }
}
