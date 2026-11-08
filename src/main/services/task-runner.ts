import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { runToolSchema } from '../../shared/contracts.ts'
import { MAX_PROTOCOL_BUFFER_BYTES, OUTPUT_SUFFIXES } from '../../shared/constants.ts'
import { getFeature } from '../../shared/features.ts'
import type { RunToolRequest, TaskState, TaskStatus } from '../../shared/types.ts'
import { getFeatureRuntime, type FeatureRuntime } from '../features/runtimes.ts'
import { buildRuntimeEnvironment, getBundledRuntimePaths } from './paths.ts'
import { MediaLibrary, type MediaEntry } from './media-library.ts'

/** 当前任务的进程和临时清单，不持久化任务历史。 */
interface ActiveTask {
  /** 内存任务状态。 */
  state: TaskState
  /** 当前已授权输入。 */
  inputs: MediaEntry[]
  /** 当前工具的协议与清单策略。 */
  runtime: FeatureRuntime
  /** 输出目录，固定在应用相对 data 目录下。 */
  directory: string
  /** 原文件清单，退出后删除。 */
  manifest: string
  /** 按工具区分的已校验参数。 */
  request: RunToolRequest
  /** 直接 Python 进程。 */
  child: ChildProcess | null
  /** 超时回收。 */
  timer: ReturnType<typeof setTimeout> | null
  /** 用户取消或超时原因。 */
  stopStatus: 'cancelled' | 'timeout' | null
  /** 等待完整 JSON 行的有限缓冲。 */
  buffer: string
  /** 串行处理结果登记，避免 close 先于异步文件校验完成。 */
  pending: Promise<void>
}

/** 固定本地 Python 的批处理执行器，只保存本次会话中的简短结果。 */
export class TaskRunner {
  /** 运行中的任务。 */
  private active: ActiveTask | null = null
  /** 最近一次内存状态。 */
  private latest: TaskState | null = null

  /**
   * 创建本机执行器。
   * @param publish 状态更新回调。
   * @param resourcePath 内置资源目录。
   * @param applicationDirectory 数据文件的应用根目录。
   * @param media 已授权本机文件库。
   * @param timeoutMs 最大任务时长，默认五分钟。
   */
  constructor(
    private readonly publish: (task: TaskState) => void,
    private readonly resourcePath: string,
    private readonly applicationDirectory: string,
    private readonly media: MediaLibrary,
    private readonly timeoutMs = 300_000
  ) {}

  /** 返回不可变的当前任务副本。 */
  getCurrentTask(): TaskState | null {
    return this.latest ? structuredClone(this.latest) : null
  }

  /** 打开全新工作区时停止旧任务并清除会话状态，不删除磁盘文件。 */
  reset(): void {
    this.dispose()
    this.latest = null
  }

  /**
   * 校验单任务约束和文件凭证后启动清理。
   * @param input 平台与已登记文件标识。
   * @returns 初始任务状态。
   */
  run(input: RunToolRequest): TaskState {
    if (this.active) throw new Error('已有工具正在运行，请等待完成或先停止')
    /** 即使内部直接调用，也检查运行参数。 */
    const request = runToolSchema.parse(input)
    /** 当前会话授权的输入，不接受任意路径。 */
    const inputs = this.media.getInputs(request.fileIds)
    if (inputs[0]?.file.kind !== request.mediaKind)
      throw new Error('文件类型与当前模式不符，请重新选择')
    /** 每次处理使用全新目录，不覆盖原始文件或其他任务结果。 */
    const id = randomUUID()
    /** 应用相对输出目录。 */
    const directory = resolve(this.applicationDirectory, 'data/processed', id)
    /** 当前任务上下文。 */
    const active: ActiveTask = {
      state: {
        id,
        toolId: request.toolId,
        status: 'running',
        inputFileIds: request.fileIds,
        result: '正在准备文件',
        total: inputs.length,
        completed: 0,
        outputs: []
      },
      inputs,
      runtime: getFeatureRuntime(request.toolId),
      directory,
      manifest: join(directory, 'request.json'),
      request,
      child: null,
      timer: null,
      stopStatus: null,
      buffer: '',
      pending: Promise.resolve()
    }
    this.active = active
    this.update(active.state)
    setImmediate(() => {
      void this.execute(active)
    })
    return structuredClone(active.state)
  }

  /**
   * 准备临时清单，启动离线脚本并消费有限的业务事件。
   * @param active 当前任务。
   */
  private async execute(active: ActiveTask): Promise<void> {
    if (this.active !== active) return
    try {
      // 1. 输入路径只写入本地临时清单，不进入页面和历史存储。
      await mkdir(active.directory, { recursive: true })
      await writeFile(
        active.manifest,
        JSON.stringify(active.runtime.buildManifest(active.request, active.inputs)),
        { flag: 'wx', mode: 0o600 }
      )
      if (this.active !== active) {
        await this.clearManifest(active)
        return
      }
      /** 固定内置解释器。 */
      const paths = getBundledRuntimePaths(this.resourcePath)
      /** 功能入口只能来自共享功能清单，不接受页面传入脚本路径。 */
      const feature = getFeature(active.request.toolId)
      active.child = spawn(
        paths.python,
        [
          '-B',
          '-u',
          resolve(this.resourcePath, feature.pythonEntrypoint),
          ...active.runtime.buildArgs(active.request),
          '--manifest',
          active.manifest
        ],
        {
          cwd: this.resourcePath,
          env: buildRuntimeEnvironment(this.resourcePath),
          shell: false,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      )
      // 2. 只解析结构化业务数据，错误流不采集、不显示。
      active.child.stdout?.setEncoding('utf8')
      active.child.stdout?.on('data', (chunk: string) => {
        active.buffer += chunk
        if (Buffer.byteLength(active.buffer, 'utf8') > MAX_PROTOCOL_BUFFER_BYTES) {
          this.failProtocol(active)
          return
        }
        /** 已完整到达的 JSON 行。 */
        const lines = active.buffer.split('\n')
        active.buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          active.pending = active.pending
            .then(() => this.acceptFile(active, line))
            .catch(() => this.failProtocol(active))
        }
      })
      active.child.once('error', () => {
        void this.clearManifest(active)
        this.finish(active, 'failed', '内置 Python 或工具文件不可用，请检查应用文件')
      })
      active.child.once('close', (code) => {
        void this.close(active, code)
      })
      active.timer = setTimeout(() => this.stop(active, 'timeout'), this.timeoutMs)
    } catch {
      await this.clearManifest(active)
      this.finish(active, 'failed', '无法准备处理文件，请检查应用目录的写入权限')
    }
  }

  /**
   * 登记一个文件结果，输出路径始终由主进程指定。
   * @param active 当前任务。
   * @param line 一行 JSON 业务事件。
   */
  private async acceptFile(active: ActiveTask, line: string): Promise<void> {
    if (this.active !== active || active.stopStatus) return
    /** 已校验结构化事件。 */
    const event = active.runtime.parseEvent(line)
    if (event.index !== active.state.completed || event.index >= active.inputs.length)
      throw new Error('文件事件顺序错误')
    /** 对应的原始文件。 */
    const source = active.inputs[event.index]!
    /** Python 与主进程约定的固定结果位置。 */
    const outputPath = join(
      active.directory,
      active.runtime.outputName(event.index, extname(source.path).toLowerCase())
    )
    /** 校验文件存在后才向界面发放导出凭证。 */
    const outputId =
      event.status === 'failed'
        ? null
        : await this.media.registerOutput(
            outputPath,
            source,
            OUTPUT_SUFFIXES[active.request.toolId]
          )
    if (this.active !== active || active.stopStatus) return
    /** 只保留用户需要的业务结果。 */
    const result = active.runtime.toResult(event, source, outputId)
    active.state.outputs.push(result)
    active.state.completed++
    active.state.result = `已处理 ${active.state.completed} / ${active.state.total} 个文件`
    this.update(active.state)
  }

  /**
   * 等待已到达结果完成校验，再形成准确终态。
   * @param active 当前任务。
   * @param code Python 退出码。
   */
  private async close(active: ActiveTask, code: number | null): Promise<void> {
    await active.pending
    await this.clearManifest(active)
    if (active.stopStatus) {
      this.finish(
        active,
        active.stopStatus,
        active.stopStatus === 'timeout' ? '处理超时，已停止' : '处理已停止'
      )
      return
    }
    /** 是否每个文件都完整处理且没有残留。 */
    const complete =
      code === 0 && active.buffer.trim() === '' && active.state.completed === active.state.total
    /** 不把部分成功或存在残留的任务报告成全部完成。 */
    const clean =
      complete &&
      active.state.outputs.every(
        (output) => output.status === 'cleaned' || output.status === 'unchanged'
      )
    this.finish(
      active,
      clean ? 'success' : 'failed',
      clean
        ? '处理完成，原文件已保留，可预览或另存结果'
        : (active.state.outputs.find((output) => output.status === 'failed')?.message ??
            active.runtime.incompleteMessage)
    )
  }

  /**
   * 发现无效业务协议时停止进程，不展示原始数据。
   * @param active 当前任务。
   */
  private failProtocol(active: ActiveTask): void {
    if (this.active !== active) return
    this.killProcessTree(active)
    this.finish(active, 'failed', '处理结果不完整，请重新尝试')
  }

  /**
   * 删除包含原始路径的临时清单，不删除用户生成的结果。
   * @param active 当前任务。
   */
  private async clearManifest(active: ActiveTask): Promise<void> {
    await rm(active.manifest, { force: true }).catch(() => {})
  }

  /**
   * 向界面推送独立副本，避免共享可变结果列表。
   * @param state 当前任务状态。
   */
  private update(state: TaskState): void {
    this.latest = structuredClone(state)
    this.publish(structuredClone(state))
  }

  /**
   * 完成任务并释放并发占用，迟到事件不能覆盖终态。
   * @param active 当前任务。
   * @param status 终态。
   * @param result 简短用户提示。
   */
  private finish(active: ActiveTask, status: TaskStatus, result: string): void {
    if (this.active !== active) return
    if (active.timer) clearTimeout(active.timer)
    active.state = { ...active.state, status, result }
    this.active = null
    this.update(active.state)
  }

  /**
   * 停止离线 Python，未启动时直接完成取消。
   * @param active 当前任务。
   * @param status 停止原因。
   */
  private stop(active: ActiveTask, status: 'cancelled' | 'timeout'): void {
    if (this.active !== active || active.stopStatus) return
    active.stopStatus = status
    if (active.child) this.killProcessTree(active)
    else this.finish(active, status, status === 'timeout' ? '处理超时，已停止' : '处理已停止')
  }

  /**
   * 回收 Python 及其视频编码进程，防止取消后 FFmpeg 继续运行。
   * @param active 本次授权任务，进程号来自实际创建的子进程。
   */
  private killProcessTree(active: ActiveTask): void {
    if (!active.child?.pid) return
    if (process.platform === 'win32') {
      /** 固定使用系统工具及参数数组，不执行用户命令。 */
      const killer = spawn(
        resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
        ['/pid', String(active.child.pid), '/T', '/F'],
        { windowsHide: true, shell: false, stdio: 'ignore' }
      )
      killer.once('error', () => active.child?.kill('SIGKILL'))
    } else {
      // WHY: 非 Windows 将 Python 与 FFmpeg 放入独立进程组统一回收。
      try {
        process.kill(-active.child.pid, 'SIGKILL')
      } catch {
        active.child.kill('SIGKILL')
      }
    }
  }

  /**
   * 取消匹配的当前任务。
   * @param id 当前任务 UUID。
   */
  cancel(id: string): void {
    if (this.active?.state.id === id) this.stop(this.active, 'cancelled')
  }

  /** 应用退出时回收唯一的直接 Python 进程。 */
  dispose(): void {
    if (!this.active) return
    /** 退出时仍在进行的任务。 */
    const active = this.active
    this.stop(active, 'cancelled')
    this.finish(active, 'cancelled', '处理已停止')
  }
}
