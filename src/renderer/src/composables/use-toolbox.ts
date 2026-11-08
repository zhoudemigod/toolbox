import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AppSnapshot, TaskState, RunToolRequest } from '../../../shared/types.ts'

/** 管理工具执行的当前状态，不读取配置或运行记录。 */
export function useToolbox() {
  /** 应用状态，初始化前为空。 */
  const snapshot = ref<AppSnapshot | null>(null)
  /** 刷新过程中避免重复请求。 */
  const loading = ref(true)
  /** 用户可读的操作错误。 */
  const error = ref('')
  /** 新工作区准备期间禁止重复打开，并忽略旧任务事件。 */
  const resetting = ref(false)
  /** 区分清空前后异步返回的运行请求。 */
  let stateVersion = 0
  /** 已被清空的任务不能因迟到事件重新出现在界面。 */
  const ignoredTasks = new Set<string>()
  /** 当前状态订阅的清理函数。 */
  let unsubscribe: (() => void) | undefined
  /** 当前或最近一次任务，只存在于本次应用会话。 */
  const currentTask = computed(() => snapshot.value?.currentTask ?? null)
  /** 当前正在运行的任务。 */
  const runningTask = computed(() =>
    currentTask.value?.status === 'running' ? currentTask.value : null
  )

  /**
   * 接收当前任务的更新，避免迟到的初态覆盖已完成状态。
   * @param task 主进程发送的任务状态。
   */
  function mergeTask(task: TaskState): void {
    if (resetting.value) {
      ignoredTasks.add(task.id)
      return
    }
    if (ignoredTasks.has(task.id)) return
    if (!snapshot.value) return
    /** 当前已经展示的状态。 */
    const previous = snapshot.value.currentTask
    if (previous?.id === task.id && previous.status !== 'running' && task.status === 'running')
      return
    snapshot.value.currentTask = task
  }

  /**
   * 将未知异常转换为可读消息。
   * @param cause 操作异常。
   */
  function reportError(cause: unknown): void {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }

  /** 刷新应用与当前任务状态。 */
  async function refresh(): Promise<void> {
    /** 打开新工作区前发出的刷新结果不能恢复旧任务。 */
    const version = stateVersion
    loading.value = true
    error.value = ''
    try {
      const next = await window.toolbox.snapshot()
      if (version !== stateVersion || (next.currentTask && ignoredTasks.has(next.currentTask.id)))
        next.currentTask = null
      snapshot.value = next
    } catch (cause) {
      reportError(cause)
    } finally {
      loading.value = false
    }
  }

  /**
   * 启动媒体清理，只提交来源平台和已授权文件凭证。
   * @param request 当前批次参数。
   */
  async function run(request: RunToolRequest): Promise<void> {
    /** 请求属于发起时的工作区，重开后的界面不再接收旧响应。 */
    const version = stateVersion
    error.value = ''
    try {
      const task = await window.toolbox.runTool(request)
      if (version !== stateVersion) {
        ignoredTasks.add(task.id)
        return
      }
      mergeTask(task)
    } catch (cause) {
      if (version === stateVersion) reportError(cause)
    }
  }

  /** 从列表重新打开工具时清空旧任务及提示，成功后才显示新的表单。 */
  async function reset(): Promise<boolean> {
    if (resetting.value) return false
    resetting.value = true
    stateVersion++
    if (currentTask.value) ignoredTasks.add(currentTask.value.id)
    error.value = ''
    try {
      // WHY: 同时清空主进程状态，刷新页面或重选同一文件时也不会取回旧结果。
      await window.toolbox.resetTool()
      if (snapshot.value) snapshot.value.currentTask = null
      return true
    } catch (cause) {
      reportError(cause)
      return false
    } finally {
      resetting.value = false
    }
  }

  /** 停止当前任务，由主进程确认最终状态。 */
  async function cancel(): Promise<void> {
    if (!runningTask.value) return
    try {
      await window.toolbox.cancelTask(runningTask.value.id)
    } catch (cause) {
      reportError(cause)
    }
  }

  onMounted(async () => {
    unsubscribe = window.toolbox?.onTask(mergeTask)
    await refresh()
  })
  onUnmounted(() => unsubscribe?.())
  return {
    snapshot,
    loading,
    error,
    resetting,
    currentTask,
    runningTask,
    refresh,
    run,
    cancel,
    reset
  }
}
