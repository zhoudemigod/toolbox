import { execFile } from 'node:child_process'
import { cpus, totalmem, version, release, arch } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { systemInfoSchema } from '../../shared/contracts.ts'
import type { SystemInfo } from '../../shared/types.ts'
import { buildRuntimeEnvironment, getBundledRuntimePaths } from './paths.ts'

const execute = promisify(execFile)

/** 固定脚本只在本次启动读取一次；超时/缺少解释器时保留可用的系统信息。 */
export function createSystemInfoReader(
  resourcePath: string,
  timeout = 4000
): () => Promise<SystemInfo> {
  let cached: Promise<SystemInfo> | undefined
  return () =>
    (cached ??= (async () => {
      try {
        const { stdout } = await execute(
          getBundledRuntimePaths(resourcePath).python,
          ['-B', join(resourcePath, 'features/system_info/cli.py')],
          {
            windowsHide: true,
            timeout,
            maxBuffer: 64 * 1024,
            encoding: 'utf8',
            env: buildRuntimeEnvironment(resourcePath)
          }
        )
        return systemInfoSchema.parse(JSON.parse(stdout.trim()))
      } catch {
        const processors = cpus()
        return {
          osName: version().slice(0, 160),
          osVersion: release().slice(0, 160),
          architecture: arch(),
          cpuName: processors[0]?.model.slice(0, 200) || '未识别',
          logicalCores: processors.length || 1,
          gpus: [],
          memoryTotalBytes: totalmem() || null
        }
      }
    })())
}
