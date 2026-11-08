import { contextBridge, ipcRenderer } from 'electron'
import type { ToolboxApi, TaskState } from '../shared/types.ts'
import { CHANNELS } from '../shared/channels.ts'

/** 沙箱 preload 只导出白名单操作和可移除的事件订阅。 */
const api: ToolboxApi = {
  snapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  chooseMedia: (kind) => ipcRenderer.invoke(CHANNELS.chooseMedia, kind),
  saveOutput: (id) => ipcRenderer.invoke(CHANNELS.saveOutput, id),
  runTool: (id) => ipcRenderer.invoke(CHANNELS.runTool, id),
  resetTool: () => ipcRenderer.invoke(CHANNELS.resetTool),
  cancelTask: (id) => ipcRenderer.invoke(CHANNELS.cancelTask, id),
  onTask: (listener) => {
    /** 去除 Electron 事件对象，界面只能接收任务数据。 */
    const handler = (_event: Electron.IpcRendererEvent, task: TaskState): void => listener(task)
    ipcRenderer.on(CHANNELS.taskChanged, handler)
    return () => ipcRenderer.removeListener(CHANNELS.taskChanged, handler)
  }
}
contextBridge.exposeInMainWorld('toolbox', api)
