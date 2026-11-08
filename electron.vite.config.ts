import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/** 桌面主进程、隔离桥接和界面分别构建，生产环境无需 Web 服务。 */
export default defineConfig({
  // 应用依赖全部编入产物，安装包无需再携带近 100 MB 的前端 node_modules。
  main: { build: { externalizeDeps: false } },
  preload: { build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs' } } } },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    plugins: [vue(), tailwindcss()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
