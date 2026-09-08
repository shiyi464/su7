import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
  },
  plugins: [vue(),glsl()],
  assetsInclude: ['**/*.hdr','**/*.jpg','**/*.glb','**/*.gltf'],
})
