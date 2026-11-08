import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type {
  MediaFile,
  MediaKind,
  MediaResult,
  RunToolRequest,
  TaskState,
  ToolId
} from '../../../shared/types.ts'

/** 工具工作页共用的任务属性。 */
export interface MediaWorkbenchProps {
  task: TaskState | null
  run: (request: RunToolRequest) => Promise<void>
}

/** 各工具之间只有校验、请求构造和结果选择不同。 */
export interface MediaWorkbenchOptions {
  /** 当前工具标识。 */
  toolId: ToolId
  /** 选择器媒体类型，可随界面模式变化。 */
  kind: () => MediaKind
  /** 保存成功后的提示。 */
  savedMessage: string
  /** 校验选择结果，返回错误提示。 */
  validate?: (file: MediaFile) => string | null
  /** 是否接受新文件；返回 false 时保持原输入。 */
  accept?: (file: MediaFile, current: MediaFile | null) => boolean
  /** 输入被替换或清除后的界面同步。 */
  onChange?: () => void
  /** 提交前同步界面状态。 */
  beforeSubmit?: (file: MediaFile) => void
  /** 额外提交条件。 */
  canSubmit?: () => boolean
  /** 构造工具请求。 */
  request: (file: MediaFile) => RunToolRequest
  /** 是否要求当前任务来自同一工具，默认 true。 */
  requireToolId?: boolean
  /** 额外判断任务是否对应当前输入。 */
  isVisible?: (task: TaskState, file: MediaFile) => boolean
  /** 从任务中挑选展示结果。 */
  selectOutput?: (task: TaskState) => MediaResult | null
}

/** 工作页共享的单文件输入、提交与保存状态。 */
export function useMediaWorkbench(
  props: MediaWorkbenchProps,
  options: MediaWorkbenchOptions
): {
  file: Ref<MediaFile | null>
  choosing: Ref<boolean>
  submitting: Ref<boolean>
  saving: Ref<boolean>
  message: Ref<string>
  messageError: Ref<boolean>
  busy: ComputedRef<boolean>
  visibleTask: ComputedRef<TaskState | null>
  output: ComputedRef<MediaResult | null>
  choose: () => Promise<void>
  remove: () => void
  submit: () => Promise<void>
  save: () => Promise<void>
} {
  /** 当前工作页唯一输入。 */
  const file = ref<MediaFile | null>(null)
  /** 原生选择器打开中。 */
  const choosing = ref(false)
  /** 请求发出后至状态推送前。 */
  const submitting = ref(false)
  /** 保存对话框占用中。 */
  const saving = ref(false)
  /** 本页操作反馈。 */
  const message = ref('')
  /** 区分错误与成功提示。 */
  const messageError = ref(false)
  /** 处理中禁止修改输入或重复启动。 */
  const busy = computed(() => submitting.value || props.task?.status === 'running')
  /** 隐藏其他文件或工具的旧任务。 */
  const visibleTask = computed<TaskState | null>(() => {
    const task = props.task
    if (!file.value || !task) return null
    if (options.requireToolId !== false && task.toolId !== options.toolId) return null
    if (!task.inputFileIds.includes(file.value.id)) return null
    if (options.isVisible && !options.isVisible(task, file.value)) return null
    return task
  })
  /** 当前输入对应的处理结果。 */
  const output = computed<MediaResult | null>(() => {
    const task = visibleTask.value
    if (!task) return null
    return options.selectOutput
      ? options.selectOutput(task)
      : (task.outputs.find((item) => item.outputId) ?? null)
  })

  /** 选择或替换单个本机文件。 */
  async function choose(): Promise<void> {
    if (busy.value || choosing.value || saving.value) return
    choosing.value = true
    message.value = ''
    try {
      const selected = await window.toolbox.chooseMedia(options.kind())
      const next = selected[0]
      if (!next) return
      const error = options.validate?.(next)
      if (error) throw new Error(error)
      if (options.accept && !options.accept(next, file.value)) return
      file.value = next
      options.onChange?.()
    } catch (cause) {
      messageError.value = true
      message.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      choosing.value = false
    }
  }

  /** 清空输入，不删除磁盘文件或已生成结果。 */
  function remove(): void {
    if (busy.value || saving.value) return
    file.value = null
    message.value = ''
    options.onChange?.()
  }

  /** 提交当前输入。 */
  async function submit(): Promise<void> {
    if (!file.value || busy.value || choosing.value || saving.value) return
    if (options.canSubmit && !options.canSubmit()) return
    submitting.value = true
    message.value = ''
    options.beforeSubmit?.(file.value)
    try {
      await props.run(options.request(file.value))
    } finally {
      submitting.value = false
    }
  }

  /** 导出当前结果，取消对话框不会显示保存成功。 */
  async function save(): Promise<void> {
    if (!output.value?.outputId || busy.value || saving.value) return
    saving.value = true
    message.value = ''
    try {
      if (await window.toolbox.saveOutput(output.value.outputId)) {
        messageError.value = false
        message.value = options.savedMessage
      }
    } catch (cause) {
      messageError.value = true
      message.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving.value = false
    }
  }

  return {
    file,
    choosing,
    submitting,
    saving,
    message,
    messageError,
    busy,
    visibleTask,
    output,
    choose,
    remove,
    submit,
    save
  }
}
