import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, resolve, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** 固定以脚本所在项目为基准，支持从其他目录执行。 */
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
/** 已锁定的官方版本、下载来源和 SHA-256。 */
const lock = JSON.parse(await readFile(join(projectRoot, 'runtime/runtimes.lock.json'), 'utf8'))
/** 运行环境的最终目录。 */
const runtimeRoot = join(projectRoot, 'runtime')
/** 下载与解压缓存，只包含当前任务生成的文件。 */
const cacheRoot = join(projectRoot, '.artifacts/runtime-downloads')
/** 已安装版本的标识文件。 */
const installedPath = join(runtimeRoot, 'installed.json')

/**
 * 限制文件操作范围，避免解压后的路径指向工作区之外。
 * @param value 待检查的绝对路径。
 * @param base 允许写入的项目子目录。
 * @returns 已验证的绝对路径。
 */
function within(value, base) {
  /** 规范化后的目标路径。 */
  const target = resolve(value)
  if (!target.toLowerCase().startsWith((resolve(base) + sep).toLowerCase())) {
    throw new Error('目标路径不在预期目录内')
  }
  return target
}

/**
 * 获取网络响应，并在失败时提供明确反馈。
 * @param url 锁文件中的官方地址。
 * @param options HTTP 方法、范围及超时配置。
 * @returns 成功响应，不打印含临时签名的跳转地址。
 */
async function request(url, options = {}) {
  /** 每个下载请求最多等待 45 秒。 */
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) })
  if (!response.ok) throw new Error(`下载响应失败：HTTP ${response.status}`)
  return response
}

/**
 * 从官方地址下载固定版本，分段缓存并验证完整文件。
 * @param name 用于进度提示的环境名称。
 * @param artifact 下载元数据，包含 url 与 sha256。
 * @returns 已通过 SHA-256 校验的 ZIP 绝对路径。
 */
async function download(name, artifact) {
  // 1. 已有缓存必须重新校验，不能仅按文件名信任旧文件。
  /** 以校验值命名的本地压缩包。 */
  const archivePath = within(join(cacheRoot, `${artifact.sha256}.zip`), cacheRoot)
  if (existsSync(archivePath)) {
    /** 已下载文件内容。 */
    const cached = await readFile(archivePath)
    if (createHash('sha256').update(cached).digest('hex') === artifact.sha256) {
      console.log(`${name}：使用已校验缓存`)
      return archivePath
    }
    throw new Error(`${name} 缓存校验失败，请移走 ${archivePath} 后重试`)
  }
  // 2. 使用小块并发下载，单块失败可重试，整次中断可继续。
  /** 官方服务器提供的文件长度。 */
  const headers = await request(artifact.url, { method: 'HEAD' })
  /** 完整文件的字节数。 */
  const total = Number(headers.headers.get('content-length'))
  /** 大文件使用 1 MiB 范围，避免单个长连接中断后全部重下。 */
  const chunkSize = 1024 * 1024
  /** 尚未合并的文件块。 */
  const chunks = []
  if (total > chunkSize && headers.headers.get('accept-ranges') === 'bytes') {
    /** 本版本专用的断点缓存目录。 */
    const partDirectory = within(join(cacheRoot, artifact.sha256), cacheRoot)
    await mkdir(partDirectory, { recursive: true })
    /** 需要获取的块数。 */
    const count = Math.ceil(total / chunkSize)
    /** 下一块的序号；JavaScript 同步取号不会重复分配。 */
    let next = 0
    /** 已完成块数，用于有限频率的进度输出。 */
    let completed = 0

    /** 获取各自分配的下载块，并校验范围和长度。 */
    async function worker() {
      while (next < count) {
        /** 当前块索引。 */
        const index = next++
        /** 当前块在文件中的起止位置，单位字节。 */
        const start = index * chunkSize
        /** 最后一块可能不足 1 MiB。 */
        const end = Math.min(total - 1, start + chunkSize - 1)
        /** 本块的断点缓存文件。 */
        const partPath = join(partDirectory, `${index}.part`)
        if (existsSync(partPath) && (await stat(partPath)).size === end - start + 1) {
          chunks[index] = await readFile(partPath)
        } else {
          /** 最多尝试五次，之后保留已下载块供下次继续。 */
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              /** 必须收到与请求匹配的 206 范围响应。 */
              const response = await request(artifact.url, {
                headers: { Range: `bytes=${start}-${end}` }
              })
              if (
                response.status !== 206 ||
                !response.headers.get('content-range')?.startsWith(`bytes ${start}-${end}/`)
              ) {
                throw new Error('服务器没有返回请求的文件范围')
              }
              /** 当前下载块，长度必须匹配后才写入缓存。 */
              const content = Buffer.from(await response.arrayBuffer())
              if (content.length !== end - start + 1) throw new Error('下载块长度不匹配')
              await writeFile(partPath, content)
              chunks[index] = content
              break
            } catch (cause) {
              if (attempt === 4) throw cause
            }
          }
        }
        completed++
        if (completed % 32 === 0 || completed === count)
          console.log(`${name}：${completed}/${count} 块`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, count) }, worker))
  } else {
    chunks.push(Buffer.from(await (await request(artifact.url)).arrayBuffer()))
  }
  // 3. 只有完整校验通过的压缩包才能进入解压步骤。
  /** 合并后的原始 ZIP。 */
  const archive = Buffer.concat(chunks)
  if (createHash('sha256').update(archive).digest('hex') !== artifact.sha256) {
    throw new Error(`${name} SHA-256 不匹配，未安装下载内容`)
  }
  await writeFile(archivePath, archive)
  console.log(`${name}：SHA-256 校验通过`)
  return archivePath
}

/**
 * 在新的缓存目录中解压 ZIP，不覆盖现有运行环境。
 * @param archivePath 已校验的 ZIP 文件。
 * @returns 本次解压的独立目录。
 */
async function extract(archivePath) {
  /** 本次解压专用目录。 */
  const destination = within(join(cacheRoot, `extract-${randomUUID()}`), cacheRoot)
  await mkdir(destination, { recursive: true })
  /** 文件路径通过独立环境变量传入，避免 Shell 拼接路径。 */
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:TOOLBOX_ARCHIVE -DestinationPath $env:TOOLBOX_EXTRACT -Force'
    ],
    {
      env: { ...process.env, TOOLBOX_ARCHIVE: archivePath, TOOLBOX_EXTRACT: destination },
      stdio: 'inherit',
      windowsHide: true
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`解压失败：${basename(archivePath)}`)
  return destination
}

/** 安装固定的 Windows x64 环境，已有环境不做自动删除或覆盖。 */
async function main() {
  if (process.platform !== lock.platform || process.arch !== lock.arch) {
    throw new Error('当前锁文件为 Windows x64，需先准备目标平台对应的运行环境和锁文件')
  }
  await mkdir(runtimeRoot, { recursive: true })
  await mkdir(cacheRoot, { recursive: true })
  if (existsSync(installedPath)) {
    /** 已安装版本的校验记录。 */
    const installed = JSON.parse(await readFile(installedPath, 'utf8'))
    if (
      installed.pythonSha256 === lock.python.sha256 &&
      existsSync(join(runtimeRoot, 'embedded/python.exe'))
    ) {
      console.log('运行环境已准备完成，与锁文件版本一致')
      return
    }
    throw new Error('已有 Python 与锁文件不一致，请先将旧 runtime/embedded 移至备份位置')
  }
  if (existsSync(join(runtimeRoot, 'embedded'))) {
    throw new Error('发现已有 Python 目录，为避免覆盖，请先移至备份位置再下载')
  }
  // 1. 下载并完整校验 Python，失败时不替换现有目录。
  const pythonArchive = await download('Python', lock.python)
  /** Python ZIP 本身就是解释器目录。 */
  const pythonDirectory = await extract(pythonArchive)
  if (!existsSync(join(pythonDirectory, 'python.exe')))
    throw new Error('压缩包缺少预期的 Python 解释器')
  // 2. 扩展嵌入式 Python 的隔离搜索路径，用于应用脚本与预置第三方依赖。
  /** 官方嵌入式包的隔离路径配置文件。 */
  const pathFile = (await readdir(pythonDirectory)).find((name) => name.endsWith('._pth'))
  if (!pathFile) throw new Error('Python 嵌入式路径配置缺失')
  /** 官方标准库 ZIP 文件名。 */
  const libraryZip = (await readFile(join(pythonDirectory, pathFile), 'utf8'))
    .split(/\r?\n/)
    .find((line) => line.endsWith('.zip'))
  if (!libraryZip) throw new Error('Python 标准库路径缺失')
  await mkdir(join(pythonDirectory, 'Lib/site-packages'), { recursive: true })
  await writeFile(
    join(pythonDirectory, pathFile),
    `${libraryZip}\n.\n..\nLib/site-packages\nimport site\n`
  )
  // 3. 只移动本次生成的目录，保留上游 Python 许可证。
  await rename(
    within(pythonDirectory, cacheRoot),
    within(join(runtimeRoot, 'embedded'), runtimeRoot)
  )
  await writeFile(
    installedPath,
    JSON.stringify(
      {
        platform: lock.platform,
        arch: lock.arch,
        pythonSha256: lock.python.sha256
      },
      null,
      2
    ) + '\n'
  )
  console.log(`已准备 Python ${lock.python.version}`)
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
