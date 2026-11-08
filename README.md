<div align="center">

# 开源好物集 · Toolbox

一款在 Windows 本机运行的图片与视频处理工具箱。

![Platform](https://img.shields.io/badge/Platform-Windows%20x64-3E75C3.svg)
![Electron](https://img.shields.io/badge/Electron-44-47848F.svg)
![Vue](https://img.shields.io/badge/Vue-3-42B883.svg)
![Python](https://img.shields.io/badge/Python-3.13-3776AB.svg)

[官方网站](https://www.huima123.com) · [GitHub](https://github.com/zhoudemigod/toolbox) · [Gitee](https://gitee.com/HD85512b/tools)

</div>

## 项目简介

开源好物集 Toolbox 使用 Electron、Vue 3、TypeScript 和 Python 构建，把常用的图片与视频处理能力集中到一个桌面应用中。媒体文件留在本机，原文件始终保持只读。

- **本地处理**：图片、视频和系统信息由本机程序处理。
- **安装后离线运行**：Python、模型、FFmpeg 和原生运行库随安装包提供。
- **资源可复现**：解释器、Python 包和模型均由锁文件固定版本与摘要。
- **功能分包**：每项工具拥有独立的前端组件、后端注册和 Python 功能包。

当前版本只支持 Windows x64。

## 项目入口

| 入口     | 地址                                                          | 说明                            |
| -------- | ------------------------------------------------------------- | ------------------------------- |
| 官方网站 | [www.huima123.com](https://www.huima123.com)                  | 了解更多产品与服务              |
| GitHub   | [zhoudemigod/toolbox](https://github.com/zhoudemigod/toolbox) | 查看源码、提交 Issue 和参与贡献 |
| Gitee    | [HD85512b/tools](https://gitee.com/HD85512b/tools)            | 国内镜像与源码访问              |

## 功能目录

| 工具           | Python 功能包                                                 | 功能介绍                                                          |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 图片视频去水印 | [`runtime/features/watermark`](./runtime/features/watermark/) | 检测并修复受支持的画面角标，清理 C2PA、EXIF、XMP 等隐藏来源信息。 |
| 图片抠图       | [`runtime/features/cutout`](./runtime/features/cutout/)       | 使用 BiRefNet Lite ONNX 模型分离主体与背景，导出透明 PNG。        |
| 图片裁剪       | [`runtime/features/crop`](./runtime/features/crop/)           | 支持常用比例和自由选区，保留透明度并导出 PNG。                    |

应用还会在本机读取操作系统、CPU、显卡、内存与架构信息，用于顶部状态栏展示。相关信息只保留在当前会话。

## 环境要求

- Windows 10/11 x64
- Node.js 24 或更高版本
- pnpm 11（版本由 `packageManager` 字段固定）
- uv
- 至少 1 GB 可用磁盘空间

项目不使用 Java。开发和打包也不依赖系统 Python 或系统 FFmpeg。

安装后先确认命令可用：

```powershell
node --version
pnpm --version
uv --version
```

## 快速开始

### 使用 GitHub

```powershell
git clone https://github.com/zhoudemigod/toolbox.git
cd toolbox
pnpm install
pnpm runtime:prepare
pnpm dev
```

### 使用 Gitee

```powershell
git clone https://gitee.com/HD85512b/tools.git
cd tools
pnpm install
pnpm runtime:prepare
pnpm dev
```

首次执行 `pnpm runtime:prepare` 时会下载并校验：

- Python 3.13 嵌入式解释器。
- `uv.lock` 中固定的 Python 依赖。
- BiRefNet Lite 和 MI-GAN 模型。
- FFmpeg、FFprobe 和 MSVC 原生运行库。

准备过程不会创建项目 `.venv`。uv 会把 Python 包安装到 `runtime/embedded/Lib/site-packages`。

完整运行资源解压后约为 800 MB，具体时间取决于网络和磁盘速度。后续启动直接执行：

```powershell
pnpm dev
```

## 分步准备运行资源

需要定位下载问题时，可以分步执行：

```powershell
pnpm runtime:download
pnpm watermark:prepare
pnpm cutout:prepare
pnpm runtime:verify
```

| 命令                | 作用                                               |
| ------------------- | -------------------------------------------------- |
| `runtime:download`  | 下载并校验内置 Python                              |
| `watermark:prepare` | 通过 uv 安装媒体依赖，准备 MI-GAN、FFmpeg 和原生库 |
| `cutout:prepare`    | 下载并校验 BiRefNet Lite 模型                      |
| `runtime:verify`    | 在隔离环境中验证内置 Python                        |

## 构建与打包

构建应用代码：

```powershell
pnpm build
```

生成 Windows 可运行目录：

```powershell
pnpm pack
```

生成 NSIS 安装程序：

```powershell
pnpm dist:win
```

产物位于 `dist/`。打包机器需要先完成：

```powershell
pnpm runtime:prepare
```

打包钩子会验证 Python、模型、FFmpeg、FFprobe、原生 DLL、目标架构和应用入口。缺少资源或摘要不一致时，构建会停止。

## 运行资源

大型二进制和模型不进入 Git。准备脚本会创建以下目录：

```text
runtime/embedded/   Python 解释器和 uv 安装的包
runtime/models/     BiRefNet Lite、MI-GAN 模型
runtime/ffmpeg/     FFmpeg、FFprobe
runtime/native/     MSVC 原生运行库
.artifacts/         下载缓存和临时文件
```

资源版本、下载来源和 SHA-256 保存在：

- [`runtime/runtimes.lock.json`](./runtime/runtimes.lock.json)
- [`runtime/media-runtime.lock.json`](./runtime/media-runtime.lock.json)
- [`runtime/cutout-model.lock.json`](./runtime/cutout-model.lock.json)
- [`uv.lock`](./uv.lock)

当前安装包包含完整运行环境，安装完成后可以离线处理媒体。后续若提供轻量安装包，应用应把资源下载到用户数据目录并完成摘要校验。

## 项目结构

```text
src/
  main/
    features/runtimes.ts       按工具拆分的清单与结果策略
    services/                  文件授权、任务执行和运行路径
  preload/                     安全 IPC 桥接
  renderer/src/
    features/registry.ts       前端功能注册表
    components/                工具页面和通用组件
  shared/                      功能清单、类型、协议和 IPC 通道

runtime/
  common/                      Python 公共路径、限制和配置读取
  config/                      前后端共享的平台配置
  features/                    按功能拆分的 Python 后端
  *.lock.json                  解释器、媒体资源和模型锁

scripts/                       资源准备、验证和打包检查
```

## 增加工具

新增工具时建议遵循以下约定：

1. 在 `src/shared/features.json` 增加工具条目，并同步 `src/shared/types.ts` 的 `ToolId` 联合类型。
2. 在 `src/shared/contracts.ts` 增加该工具的请求校验并加入 `runToolSchema`。
3. 在 `src/main/features/runtimes.ts` 提供对应工具的结果策略。
4. 在 `runtime/features/<feature>/` 创建独立功能包。
5. 在 `src/renderer/src/features/registry.ts` 注册页面组件、图标和媒体能力。
6. 更新必要的资源锁和打包前检查；打包脚本会自动读取功能清单中的 Python 入口。

跨功能公共代码放入 `runtime/common/`。功能包通过公共接口协作，避免读取其他功能的内部实现。

## 隐私与安全

- 用户选择的媒体由主进程登记为会话内标识。
- Renderer 只能通过白名单 IPC 调用本机能力。
- Python 子进程使用独立参数数组启动。
- 处理结果写入 Electron 用户数据目录。
- 模型、解释器和原生程序在准备及打包阶段校验 SHA-256。

应用不会接收远程 URL 作为媒体输入。预览协议只能读取当前会话已经授权的文件。

## TODO

- [ ] 批量处理
- [ ] 在线资源按需下载模式
- [ ] macOS 与 Linux 运行环境
- [ ] 更多经过校准的图片和视频规则
- [ ] 手动修补和背景替换

欢迎通过 [GitHub Issues](https://github.com/zhoudemigod/toolbox/issues) 提交功能建议和使用反馈。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交修改时建议：

1. 每个 PR 只处理一个明确问题。
2. Python 功能按照目录分包，前端与后端通过注册表接入。
3. 媒体处理优先在本机完成，新增联网行为需要在 PR 中说明。
4. 不提交模型、内置解释器、构建产物或用户媒体。
5. 提交前执行类型检查、格式检查和构建。

```powershell
pnpm typecheck
pnpm format:check
pnpm build
uv lock --check
```

## 开源许可

项目采用 Apache License 2.0，详见根目录 [LICENSE](./LICENSE)。

安装包随附的第三方组件（Python 解释器、FFmpeg、模型与原生运行库）遵循各自的上游许可，分发时需要保留对应声明。

---

<div align="center">

如果这个项目对你有帮助，欢迎 Star、分享或参与共建。

</div>
