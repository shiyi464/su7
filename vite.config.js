import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

// https://vitejs.dev/config/
export default defineConfig({
  // 相对资源路径方便把构建结果部署到站点的子目录下。
  base: './',
  build: {
    // docs 是打包输出目录，日常阅读和修改的是 src 中的源码。
    outDir: 'docs',
  },
  // vue() 处理 .vue 文件，glsl() 让着色器能够作为字符串导入 JS。
  plugins: [vue(),glsl()],
  // 模型和贴图按静态资源处理，import 后得到供加载器使用的 URL。
  assetsInclude: ['**/*.hdr','**/*.jpg','**/*.glb','**/*.gltf'],
})
