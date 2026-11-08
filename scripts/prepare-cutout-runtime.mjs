import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = join(root, 'runtime')
const lock = JSON.parse(await readFile(join(runtime, 'cutout-model.lock.json'), 'utf8'))
const target = join(runtime, lock.path)
async function valid(path) {
  try {
    if ((await stat(path)).size !== lock.size) return false
    const sha = createHash('sha256'),
      md5 = createHash('md5')
    for await (const chunk of createReadStream(path)) {
      sha.update(chunk)
      md5.update(chunk)
    }
    return sha.digest('hex') === lock.sha256 && md5.digest('hex') === lock.md5
  } catch {
    return false
  }
}
await mkdir(dirname(target), { recursive: true })
if (!(await valid(target))) {
  const cached = join(root, '.artifacts/cutout/birefnet-lite-mirror.onnx')
  if (await valid(cached)) {
    const { copyFile } = await import('node:fs/promises')
    await copyFile(cached, `${target}.download`)
    await rename(`${target}.download`, target)
  } else {
    let ready = false
    for (const url of [lock.url, lock.fallbackUrl, lock.mirrorUrl]) {
      const pending = `${target}.download`
      try {
        console.log('正在准备 BiRefNet Lite 模型（约 214 MB）…')
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        let transferred = 0,
          reported = 0
        await pipeline(
          Readable.fromWeb(response.body),
          async function* (chunks) {
            for await (const chunk of chunks) {
              transferred += chunk.length
              if (transferred > lock.size) throw new Error('模型大小超出锁定值')
              const percent = Math.floor(((transferred / lock.size) * 100) / 10) * 10
              if (percent > reported) {
                console.log(`模型下载 ${percent}%`)
                reported = percent
              }
              yield chunk
            }
          },
          createWriteStream(pending, { flags: 'w' })
        )
        if (!(await valid(pending))) throw new Error('模型摘要不匹配')
        await rename(pending, target)
        ready = true
        break
      } catch (error) {
        await rm(pending, { force: true })
        console.warn(`当前来源不可用：${error.message}`)
      }
    }
    if (!ready) throw new Error('模型准备失败，请检查网络后重新执行 pnpm cutout:prepare')
  }
}
const result = spawnSync(
  join(runtime, 'embedded/python.exe'),
  ['-B', join(runtime, 'features/cutout/cli.py'), '--verify'],
  { cwd: root, windowsHide: true, stdio: 'inherit' }
)
if (result.error || result.status !== 0)
  throw new Error(
    '抠图环境验证失败，请先执行 runtime:download 和 watermark:prepare 准备现有 Python 依赖'
  )
console.log('离线抠图模型及运行环境已就绪')
