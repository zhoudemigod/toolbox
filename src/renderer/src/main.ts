import { createApp } from 'vue'
import App from './App.vue'
import 'tdesign-vue-next/es/style/index.css'
import './tailwind.css'
import './styles.css'

// 1. 挂载本地界面，所有持久化操作通过 preload 桥接。
createApp(App).mount('#app')
