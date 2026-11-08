import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** Python 包由 uv.lock 管理；本锁只负责模型与原生媒体资源。 */
const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(await readFile(join(root, 'runtime/media-runtime.lock.json'), 'utf8'))
if (process.platform !== lock.platform || process.arch !== lock.arch)
  throw new Error(`当前资源锁适用于 ${lock.platform}/${lock.arch}，请准备匹配目标平台的资源锁`)

const cache = join(root, '.artifacts/media-runtime')
const executable = join(root, 'runtime/embedded/python.exe')
const sitePackages = join(root, 'runtime/embedded/Lib/site-packages')
const requirements = join(cache, 'requirements.txt')
const uvCache = join(root, '.artifacts/uv-cache')
await mkdir(cache, { recursive: true })

function run(command, args, message) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', UV_PYTHON_DOWNLOADS: 'never' },
    windowsHide: true,
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) throw new Error(message)
}

/** 下载并校验一个锁定资源，已校验缓存直接复用。 */
async function download(entry) {
  const target = join(cache, basename(new URL(entry.url).pathname))
  const digest = (value) => createHash('sha256').update(value).digest('hex')
  try {
    if (digest(await readFile(target)) === entry.sha256) return target
  } catch {
    /* 首次准备时没有缓存。 */
  }
  for (const url of [entry.url, entry.mirrorUrl].filter(Boolean)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (digest(bytes) !== entry.sha256) throw new Error('下载摘要不匹配')
      await writeFile(target, bytes)
      return target
    } catch (cause) {
      if (!entry.mirrorUrl || url === entry.mirrorUrl) throw cause
    }
  }
  throw new Error('资源未下载')
}

// uv 只在显式资源准备阶段下载，并直接安装进随包 Python，不创建项目 .venv。
run(
  'uv',
  [
    'export',
    '--frozen',
    '--no-dev',
    '--no-emit-project',
    '--format',
    'requirements.txt',
    '--output-file',
    requirements
  ],
  '无法从 uv.lock 导出 Python 依赖，请先安装 uv 并检查锁文件'
)
run(
  'uv',
  [
    'pip',
    'install',
    '--python',
    executable,
    '--target',
    sitePackages,
    '--requirements',
    requirements,
    '--exact',
    '--require-hashes',
    '--only-binary',
    ':all:',
    '--cache-dir',
    uvCache,
    '--no-python-downloads'
  ],
  'uv 安装随包 Python 依赖失败'
)

await Promise.all([
  download(lock.model),
  download(lock.ffprobe),
  download(lock.msvc),
  download(lock.extractor)
])
run(
  executable,
  ['-B', join(root, 'scripts/install-media-runtime.py')],
  '媒体资源安装失败，请检查随包 Python 与缓存'
)
