import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 启动 Vue 并挂载到 index.html 的 app 容器。
// 阅读主线：App.vue → World/index.vue → World.js → 各个模型和特效模块。
createApp(App).mount('#app')
