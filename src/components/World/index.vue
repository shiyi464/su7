<script setup>
/**
 * 页面与 3D 世界的连接点，建议从这里开始阅读。
 * Vue 负责容器和按钮；World 实例负责 canvas 中的场景、模型和逐帧渲染。
 * 阅读顺序：onMounted → World 构造函数 → addModle/render → handleClick。
 */
import World from './World'
import { onMounted } from 'vue'
// 展示模型保留车身材质；另一个 glTF 提供计算截面线所需的几何数据。
import su7Model from './model/su7blender/scene_editor.glb'
import su7ModelMerge from './model/su7blender/merge.gltf'
// Curves 是车身轮廓坐标；WindCurves 是当前流程未使用的气流路径数据。
import Curves from './model/output_file.json'
import WindCurves from './model/output_file_wind.json'
import { ShaderMaterial, DoubleSide, Color, AdditiveBlending, PlaneGeometry,Mesh } from 'three'

import fragmentRed from "./shader/fragment_line_red.glsl";
import fragmentWind from "./shader/fragment_line_wind.glsl";
import vertex from "./shader/vertex_line.glsl";

import WindMesh from './WindMesh.js'
// 当前气流使用这个模型，由 World.addWindLine() 返回的实例加载。
import windLine from './model/wind_line.glb'

// 普通 JS 对象即可：Three.js 自己更新画布，不依赖 Vue 模板重新渲染。
let su7world = {}
let windMode = false
// ShaderMaterial 允许编写显卡上的绘图规则，这里用于红色流光线条。
let redMaterial = new ShaderMaterial({
  extensions: {
    derivatives: '#extension GL_OES_standard_derivatives : enable'
  },
  side: DoubleSide,
  // uniforms 是 JS 向着色器传参的入口，vTime 表示秒数，color 是 RGB 颜色。
  // 只有 GLSL 实际读取的参数才影响画面；当前红色着色器没有使用 opacity/vProgress。
  uniforms: {
    vTime: { type: 'f', value: 0 },
    color: { value: new Color(1, 0, 0.13, 1) },
    vProgress: { type: 'f', value: 0.8 },
    opacity:{type:'f',value:1}
  },
  transparent: true,
  // depthTest: false,
  // 不写入深度，避免透明区域挡住后续物体；加法混合使叠加的线条更亮。
  depthWrite: false,
  blending: AdditiveBlending,
  vertexShader: vertex,
  fragmentShader: fragmentRed
})
// 保留的材质实验，当前未交给模型；实际气流材质在 WindMesh 中创建。
let windMaterial = redMaterial.clone()
windMaterial.fragmentShader = fragmentWind
windMaterial.uniforms.color.value = new Color(0x555555)
windMaterial.uniforms.random = {value:Math.random()}

onMounted(() => {
  // 容器已挂载，World 才能测量宽高并插入 renderer 的 canvas。
  su7world = new World('su7World', 'su7World')
  // 先建立裁剪、反射地面和后期效果，再异步加载用于截面求交的模型。
  // initPostGrocess/addModle 是作者自定义的方法，名称沿用原代码，不是 Three.js API。
  su7world.initPostGrocess(su7ModelMerge)
  su7world.addModle(su7Model)
  // 根据坐标点生成轮廓，初始隐藏，扫描开始时显示。
  let curvesInstence = su7world.addLineBloom(Curves)
  
  // 数据末尾的 5 条路径使用红色材质；回调在每帧更新这份材质的时间。
  curvesInstence.setMaterial(curvesInstence.allLinesMesh.length - 5,redMaterial,()=>{
    curvesInstence.otherMaterial.uniforms.vTime.value = curvesInstence.clock.getElapsedTime();
  })
 
  let windInstence = su7world.addWindLine()
  windInstence.addModel(windLine)
  // 气流与展示汽车使用相同缩放和偏移，以便在空间中对齐。
  windInstence.group.scale.set(2,2,2)
  windInstence.group.position.y = 0.2
})
// GSAP 驱动切换：气流出现 → 扫描车身 → 留下轮廓，再次点击则恢复。
// 当前按钮没有等待异步模型加载完成，也没有阻止动画期间再次点击。
const handleClick = () => {
  windMode = !windMode
  if (windMode) {
    su7world.changeWind()
  } else {
    su7world.changeNormal()
  }
}
</script>

<template>
  <!-- World 把 canvas 插入这个容器；上方按钮仍是普通 HTML 元素。 -->
  <div id="su7World">
    <div class="windBtn">
      <button class="btn" @click="handleClick">风阻</button>
    </div>
  </div>
</template>

<style scoped>
/* 容器撑满视口，其宽高决定 Three.js 画布尺寸和相机比例。 */
#su7World {
  padding: 0;
  margin: 0;
  height: 100vh;
  width: 100vw;
}
.windBtn {
  position: absolute;
  top: 10px;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.btn {
  width: 60px;
  height: 20px;
  padding: 0;
  border-color: #06576b;
  color: #ffffff;
  background: #06576b;
}
</style>
