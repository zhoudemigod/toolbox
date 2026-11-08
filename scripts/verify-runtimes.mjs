import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 项目内的独立解释器目录。 */
const runtimeRoot = fileURLToPath(new URL('../runtime/', import.meta.url))
/** 本次安装的目标平台。 */
const installed = JSON.parse(await readFile(join(runtimeRoot, 'installed.json'), 'utf8'))
if (installed.platform !== process.platform || installed.arch !== process.arch) {
  throw new Error('本机无法执行其他平台的运行环境')
}
/** 不继承宿主 Python 配置，并从 PATH 移除开发环境。 */
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !['PATH', 'PYTHONHOME', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONUSERBASE'].includes(
        key.toUpperCase()
      )
  )
)
environment.PATH =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32')
    : '/usr/bin:/bin'

/**
 * 验证完整路径可独立执行，错误输出也会保留以便定位缺失的系统组件。
 * @param executable 内置解释器的绝对路径。
 * @param args 只含本测试固定参数的数组。
 */
function verify(executable, args) {
  /** 使用资源目录以外的工作目录，验证解释器不依赖启动目录。 */
  const result = spawnSync(executable, args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `运行失败：${executable}`)
  console.log((result.stdout + result.stderr).trim())
}

verify(join(runtimeRoot, 'embedded/python.exe'), [
  '-c',
  'import sys, ssl, sqlite3, platform; print("Python", platform.python_version()); print("executable:", sys.executable); print("stdlib: ssl / sqlite3 OK")'
])
console.log('内置 Python 在隔离 PATH 下验证通过')
