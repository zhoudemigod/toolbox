import type { ToolboxApi } from '../../shared/types.ts'

declare global {
  /** 界面仅通过隔离桥访问桌面业务接口。 */
  interface Window {
    /** preload 提供的有限业务操作。 */
    toolbox: ToolboxApi
  }
}
export {}
