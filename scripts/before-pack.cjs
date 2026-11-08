const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

/**
 * 在构建安装包前验证环境完整性及目标架构，防止误分发其他平台的运行环境。
 * @param context electron-builder 提供的应用目录及平台信息。
 */
module.exports = async function verifyRuntimeTarget(context) {
  /** 资源目录固定在项目中，读取本次实际准备的版本记录。 */
  const resourceRoot = join(context.packager.projectDir, 'runtime')
  const applicationIcon = join(context.packager.projectDir, 'src/renderer/src/assets/icon.ico')
  if (!existsSync(applicationIcon)) throw new Error('Windows 安装包图标缺失')
  /** 官方下载版本锁。 */
  const lock = JSON.parse(readFileSync(join(resourceRoot, 'runtimes.lock.json'), 'utf8'))
  /** 安装完成后才会存在的环境标记。 */
  const installedPath = join(resourceRoot, 'installed.json')
  /** electron-builder Arch 枚举到资源清单的映射。 */
  const architectures = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
  if (!existsSync(installedPath)) throw new Error('运行环境未下载，请先执行 pnpm runtime:download')
  /** 已准备的运行环境，不能只凭锁文件认定下载完成。 */
  const installed = JSON.parse(readFileSync(installedPath, 'utf8'))
  if (
    lock.platform !== context.electronPlatformName ||
    lock.arch !== architectures[context.arch] ||
    installed.platform !== lock.platform ||
    installed.arch !== lock.arch
  ) {
    throw new Error(
      `运行环境为 ${lock.platform}/${lock.arch}，请准备与 ${context.electronPlatformName}/${architectures[context.arch]} 匹配的 Python`
    )
  }
  if (installed.pythonSha256 !== lock.python.sha256) {
    throw new Error('运行环境版本与锁文件不一致，请重新准备环境')
  }
  /** 目标平台必须包含可执行的内置 Python。 */
  const expectedFiles =
    lock.platform === 'win32' ? ['embedded/python.exe'] : ['embedded/bin/python3']
  for (const file of expectedFiles) {
    if (!existsSync(join(resourceRoot, file))) throw new Error(`随包运行环境不完整：${file}`)
  }
  /** 正式工具的脚本与标准库依赖必须一起分发，不在用户机器上临时下载。 */
  const features = JSON.parse(
    readFileSync(join(context.packager.projectDir, 'src/shared/features.json'), 'utf8')
  )
  const toolFiles = [
    ...new Set([
      ...features.map((feature) => feature.pythonEntrypoint),
      'features/watermark/service.py',
      'features/system_info/cli.py',
      'cutout-model.lock.json',
      'config/source-platforms.json',
      'media-runtime.lock.json'
    ])
  ]
  for (const file of toolFiles) {
    if (!existsSync(join(resourceRoot, file))) throw new Error(`媒体清理依赖缺失：${file}`)
  }
  /** 可见修复依赖必须随安装包准备完成，禁止运行时联网补装。 */
  const mediaLock = JSON.parse(readFileSync(join(resourceRoot, 'media-runtime.lock.json'), 'utf8'))
  if (mediaLock.platform !== lock.platform || mediaLock.arch !== lock.arch)
    throw new Error('画面修复依赖与目标平台不匹配，请准备目标平台的依赖锁')
  /** 原生程序和模型摘要由下载锁确定。 */
  const cutoutLock = JSON.parse(readFileSync(join(resourceRoot, 'cutout-model.lock.json'), 'utf8'))
  const requiredBinaries = [
    [cutoutLock.path, cutoutLock.sha256],
    [mediaLock.model.path, mediaLock.model.sha256],
    ['ffmpeg/ffmpeg.exe', mediaLock.ffmpegSha256],
    ['ffmpeg/ffprobe.exe', mediaLock.ffprobe.binarySha256],
    ...Object.entries(mediaLock.msvc.files).map(([name, hash]) => [`native/msvc/${name}`, hash])
  ]
  for (const [file, hash] of requiredBinaries) {
    if (
      !existsSync(join(resourceRoot, file)) ||
      createHash('sha256')
        .update(readFileSync(join(resourceRoot, file)))
        .digest('hex') !== hash
    )
      throw new Error(`工具资源缺失或损坏：${file}，请运行对应工具的资源准备命令`)
  }
  /** 实际导入原生依赖，防止只携带源文件却遗漏 DLL。 */
  const nativeCheck = spawnSync(
    join(resourceRoot, 'embedded/python.exe'),
    [
      '-B',
      '-c',
      'import os,sys; h=os.add_dll_directory(sys.argv[1]); import cv2,numpy,PIL,onnxruntime,av,c2pa,remove_ai_watermarks; print("ok")',
      join(resourceRoot, 'native/msvc')
    ],
    { encoding: 'utf8', windowsHide: true }
  )
  if (nativeCheck.status !== 0)
    throw new Error('内置 Python 画面修复依赖不能导入，请运行 pnpm watermark:prepare')
}
