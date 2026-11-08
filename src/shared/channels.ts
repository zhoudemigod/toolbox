/** 固定 IPC 通道；独立模块避免沙箱 preload 引入运行时验证依赖。 */
export const CHANNELS = {
  snapshot: 'toolbox:snapshot',
  chooseMedia: 'toolbox:choose-media',
  saveOutput: 'toolbox:save-output',
  runTool: 'toolbox:run-tool',
  resetTool: 'toolbox:reset-tool',
  cancelTask: 'toolbox:cancel-task',
  taskChanged: 'toolbox:task-changed'
} as const
