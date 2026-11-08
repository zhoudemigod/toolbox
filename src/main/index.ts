import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { mkdirSync } from 'node:fs'
import { resolve, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { runToolSchema, mediaKindSchema } from '../shared/contracts.ts'
import type { AppSnapshot } from '../shared/types.ts'
import { CHANNELS } from '../shared/channels.ts'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../shared/constants.ts'
import { TOOLS } from '../shared/features.ts'
import { TaskRunner } from './services/task-runner.ts'
import { MediaLibrary } from './services/media-library.ts'
import { createSystemInfoReader } from './services/system-info.ts'

// WHY: 本地预览只读取用户选择的媒体凭证，不开放 file:// 任意文件访问。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'toolbox-media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

/** 编译产物目录，用于定位 preload 与静态界面。 */
const directory = fileURLToPath(new URL('.', import.meta.url))
/** 开发期由 Electron 默认应用启动；打包后该标记不存在。 */
const isDevelopment = Boolean(process.defaultApp)
/** 安装包图标以界面资源为唯一源，打包时复制到应用资源目录。 */
const applicationIcon = isDevelopment
  ? resolve(directory, '../../src/renderer/src/assets/icon.ico')
  : join(process.resourcesPath, 'toolbox/icon.ico')
/** 测试使用独立根目录，同时隔离浏览器缓存和处理结果。 */
const dataOverride = process.env.TOOLBOX_DATA_DIR
if (dataOverride) {
  mkdirSync(resolve(dataOverride), { recursive: true })
  app.setPath('userData', resolve(dataOverride))
}
/** 当前主窗口，关闭后置空以支持 macOS 重新打开。 */
let window: BrowserWindow | null = null
/** 应用级任务执行器。 */
let runner: TaskRunner | null = null

/** 创建隔离窗口，只允许加载本应用页面。 */
async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: '开源好物',
    icon: applicationIcon,
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  window.on('closed', () => {
    window = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(join(directory, '../renderer/index.html'))
  }
}

/** 初始化本地存储、固定 IPC 操作和应用窗口。 */
async function initialize(): Promise<void> {
  // 1. 解释器从只读资源目录加载，处理结果写入 Electron 的用户数据目录。
  /** 打包后和开发期采用不同的稳定资源基准。 */
  const resourcePath = isDevelopment
    ? resolve(directory, '../../runtime')
    : join(process.resourcesPath, 'toolbox')
  const readSystemInfo = createSystemInfoReader(resourcePath)
  // 异步开始采集，不阻塞窗口创建；刷新复用同一份启动信息。
  void readSystemInfo()
  /** 测试通过 TOOLBOX_DATA_DIR 覆盖 userData；正式环境始终使用可写用户目录。 */
  const applicationDirectory = app.getPath('userData')
  /** 文件授权只保留在主进程本次会话中。 */
  const media = new MediaLibrary()
  protocol.handle('toolbox-media', async (request) => {
    /** 限定域名、UUID 和读取方法，路径本身不能指向文件系统。 */
    const url = new URL(request.url)
    if (
      url.hostname !== 'local' ||
      !['GET', 'HEAD'].includes(request.method) ||
      !z.uuid().safeParse(url.pathname.slice(1)).success
    )
      return new Response(null, { status: 404 })
    /** 主进程登记的唯一文件位置。 */
    const file = media.getPreviewPath(url.pathname.slice(1))
    if (!file) return new Response(null, { status: 404 })
    try {
      return await net.fetch(pathToFileURL(file).href, {
        method: request.method,
        headers: request.headers
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  /** 实时更新只发往仍然存在的主窗口。 */
  const executor = new TaskRunner(
    (task) => {
      if (window && !window.isDestroyed()) window.webContents.send(CHANNELS.taskChanged, task)
    },
    resourcePath,
    applicationDirectory,
    media
  )
  runner = executor
  // 2. 固定业务通道，校验调用来源与所有外部参数。
  /** 校验消息是否来自应用当前顶层页面。 */
  function assertSender(event: Electron.IpcMainInvokeEvent): void {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('不允许的调用来源')
    }
  }
  /** 注册固定业务通道；所有入口统一校验来源，避免新增通道漏掉检查。 */
  function handleSecure(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      assertSender(event)
      return handler(event, ...args)
    })
  }
  handleSecure(CHANNELS.snapshot, async (): Promise<AppSnapshot> => ({
    version: app.getVersion(),
    platform: `${process.platform} / ${process.arch}`,
    systemInfo: await readSystemInfo(),
    tools: TOOLS,
    currentTask: executor.getCurrentTask()
  }))
  handleSecure(CHANNELS.runTool, (_event, input) => executor.run(runToolSchema.parse(input)))
  handleSecure(CHANNELS.resetTool, () => {
    executor.reset()
  })
  handleSecure(CHANNELS.chooseMedia, async (_event, input) => {
    /** 图片与视频分别过滤，运行前还会检查真实授权文件类型。 */
    const kind = mediaKindSchema.parse(input)
    /** 由操作系统返回真实选择，不允许网页直接传入本机路径。 */
    const selection = await dialog.showOpenDialog(window!, {
      title: kind === 'image' ? '选择一张图片' : '选择一个视频',
      properties: ['openFile'],
      filters: [
        {
          name: kind === 'image' ? '图片' : '视频',
          extensions: kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS
        }
      ]
    })
    return selection.canceled ? [] : media.select(selection.filePaths, kind)
  })
  handleSecure(CHANNELS.saveOutput, async (_event, input) => {
    /** 仅接受已完成结果的访问凭证。 */
    const id = z.uuid().parse(input)
    /** 已完成输出的展示名称。 */
    const output = media.getOutput(id)
    /** 默认使用不同文件名，避免覆盖原文件。 */
    const name = parse(output.file.name)
    /** 系统保存对话框确认的目标位置。 */
    const selection = await dialog.showSaveDialog(window!, {
      title: '另存处理结果',
      defaultPath: name.base,
      filters: [
        {
          name: name.ext.toLowerCase() === '.png' ? 'PNG 图片' : '媒体文件',
          extensions: [name.ext.slice(1)]
        }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (selection.canceled || !selection.filePath) return false
    await media.exportOutput(id, selection.filePath)
    return true
  })
  handleSecure(CHANNELS.cancelTask, (_event, input) => {
    executor.cancel(z.uuid().parse(input))
  })
  await createWindow()
}

// WHY: 同一用户数据目录只允许一个应用实例，避免重复窗口和并行启动工具。
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app
    .whenReady()
    .then(initialize)
    .catch((error: unknown) => {
      console.error('应用初始化失败', error)
      dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    runner?.dispose()
    runner = null
  })
}
