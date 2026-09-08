import * as THREE from "three";
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import fragment from "./shader/fragment_line.glsl";
import vertex from "./shader/vertex_line.glsl";

/**
 * 用提前保存的坐标点绘制车身轮廓。
 * 数据流：JSON 路径 → Vector3 坐标 → CatmullRomCurve3 平滑曲线 → TubeGeometry 细管。
 * 这里生成的是车身轮廓，不是 OutLineClip 实时求交产生的扫描截面线。
 * 流动来自着色器改变颜色；Geometry 不需要在每帧重新生成。
 */
export default class LineBloom {
  // 保存每根管子的 Mesh，方便批量换材质或交给后期效果的选择列表。
  allLinesMesh = []
  otherMaterial;
  constructor(data,option) {
    this.data = data
    this.clock = new THREE.Clock()
    // 整个轮廓挂在同一组下，World 可以通过 group.visible 一次控制所有线条。
    this.group = new THREE.Group()
    this.group.name = 'lineBloom'
    this.initCurves(option);
  }
  // 释放显卡资源的预留方法，当前页面未调用；this.parent 也尚未在本类中赋值。
  // 仅从场景移除物体不会自动释放几何体和材质占用的显存。
  destory() {
    this.group.traverse(item => {
      if (item.isMesh) {
        item.geometry.dispose()
        item.material.dispose()
      }
    })
    this.parent.remove(this.group)
  }
  initCurves(option) {
    this.curves = []
    // data.points 是二维数组：外层为多条路径，内层为一条路径上的 { x, y, z }。
    this.data.points.forEach(path => {
      let points = []
      for (let i = 0; i < path.length; i++) {
        points.push(
          new THREE.Vector3(
            path[i].x,
            path[i].y,
            path[i].z
          )
        )
      }
      // 根据输入点插值得到平滑的三维曲线，便于沿曲线生成连续管道。
      let tempcurve = new THREE.CatmullRomCurve3(points)
      this.curves.push(tempcurve)
    })

    // 多根管子共享同一个材质，更新一次 vTime 就能让它们一起产生流光。
    const material = new THREE.ShaderMaterial({
      extensions: {
        derivatives: "#extension GL_OES_standard_derivatives : enable"
      },
      side: THREE.DoubleSide,
      // uniform 只有在 GLSL 中被读取才生效，当前 vProgress/uSize 是保留参数。
      uniforms: {
        vTime: { type: "f", value: 0 },
        color: { value: new THREE.Color(0.2, 0.8, 1, 1) },
        vProgress: { type: "f", value: 0.8 },
        uSize: { type: "f", value: 7 }
      },
      transparent: true,
      // depthTest: false,
      // 仍保留深度测试，被实体车身挡住的线不会穿透；这里只关闭深度写入。
      depthWrite: false,
      // 加法混合让颜色叠加变亮；周围的光晕还由 World 的后期处理控制。
      blending: THREE.AdditiveBlending,
      vertexShader: vertex,
      fragmentShader: fragment
    });
    
    let len = this.curves.length
    this.material = material
    let radius = option?.radius || 0.005
    let radialSegments = option?.radialSegments || 3
    this.curves.forEach((path, index) => {
      // 参数：路径、沿路径的分段数、半径、截面边数、是否首尾闭合。
      // 半径越大线越粗，分段越多通常越平滑，但顶点也越多。
      const geometry = new THREE.TubeGeometry(path, 32, radius, radialSegments, false);
      // Mesh = 几何体（形状）+ 材质（颜色/透明度等绘图规则）。
      let line = new THREE.Mesh(geometry, material);
      // 与展示汽车保持相同缩放和偏移，让轮廓贴合车身。
      this.group.scale.set(2, 2, 2)
      this.group.position.y = 0.2
      // line.scale.set(0.1, 0.1, 0.1)
      this.group.add(line);
      this.allLinesMesh.push(line)
    })

  }
  // 从 index 到末尾使用另一份材质；页面用它把末尾 5 条路径设为红色。
  // cb 是逐帧回调，用来更新这份额外材质的时间。
  setMaterial(index,material,cb){
    this.otherMaterial = material
    this.cb = cb
    for (let i = index; i < this.allLinesMesh.length; i++) {
      this.allLinesMesh[i].material = this.otherMaterial
    }
  }
  // 由 World.render() 每帧调用。Clock 返回经过的秒数，uniform 将它传给 GPU。
  renderThing() {
    this.material.uniforms.vTime.value = this.clock.getElapsedTime();
    this.cb && this.cb()
  }
}
