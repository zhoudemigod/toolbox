import { resolve, dirname, delimiter } from 'node:path'

/** 主进程使用的固定运行环境绝对路径，不对界面开放配置。 */
export interface BundledRuntimePaths {
  /** 内置 Python 可执行文件。 */
  python: string
}

/**
 * 以资源目录解析固定相对路径，不依赖启动目录或用户设置。
 * @param resourcePath 应用资源目录。
 * @param targetPlatform 目标系统，默认使用当前系统。
 * @returns 内置解释器的绝对路径。
 */
export function getBundledRuntimePaths(
  resourcePath: string,
  targetPlatform: NodeJS.Platform = process.platform
): BundledRuntimePaths {
  /** Windows 可执行文件使用 exe 扩展名。 */
  const isWindows = targetPlatform === 'win32'
  return {
    python: resolve(resourcePath, isWindows ? './embedded/python.exe' : './embedded/bin/python3')
  }
}

/**
 * 生成固定的子进程环境，屏蔽宿主解释器配置对内置环境的影响。
 * @param resourcePath 应用资源目录。
 * @param inherited 父进程变量，测试时可传入隔离环境。
 * @returns 不修改父进程的新环境。
 */
export function buildRuntimeEnvironment(
  resourcePath: string,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  // 1. 保留通用变量，去除可能覆盖内置 Python 行为的宿主变量。
  /** 受应用固定控制的环境变量名。 */
  const controlledNames = new Set(['PATH', 'PYTHONHOME', 'PYTHONPATH', 'PYTHONUSERBASE'])
  /** 独立的工具环境副本。 */
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !controlledNames.has(key.toUpperCase()))
  )
  /** 宿主 PATH 只作为系统辅助程序的后备位置。 */
  const inheritedPath = Object.entries(inherited).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
  // 2. Python 入口只由资源目录确定。
  /** 当前应用的固定解释器位置。 */
  const paths = getBundledRuntimePaths(resourcePath)
  environment.PATH = [dirname(paths.python), inheritedPath].filter(Boolean).join(delimiter)
  environment.PYTHONIOENCODING = 'utf-8'
  return environment
}
