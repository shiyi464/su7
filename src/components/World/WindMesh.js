import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

import fragmentWind from "./shader/fragment_line_wind.glsl";
import vertex from "./shader/vertex_line.glsl";

/**
 * 气流演示：GLB 提供空间中的形状，自定义着色器负责流动和淡入淡出。
 * 虽然继承 Mesh，当前真正加入场景的是 group，以及加载到 group 中的模型。
 * 气流路径预先制作，不会根据汽车形状实时求解空气流场或风阻系数。
 */
export default class WindMesh extends THREE.Mesh {
    constructor(options = {}) {
        super()
        this.clock = new THREE.Clock()
        this.group = new THREE.Group()
        this.group.name = 'windMeshGroup'
        this.initMaterial()
    }
    initMaterial() {
        // 与普通材质不同，ShaderMaterial 的颜色、透明度由 GLSL 自己计算。
        this.material = new THREE.ShaderMaterial({
            extensions: {
                derivatives: '#extension GL_OES_standard_derivatives : enable'
              },
              side: THREE.DoubleSide,
              // vTime 驱动动画；opacity 由 GSAP 从 0 变到 1 再变回 0；random 影响流光速度。
              // color/vProgress 目前没有作为对应 uniform 参与最终气流颜色计算。
              uniforms: {
                vTime: { type: 'f', value: 0 },
                color: { value: new THREE.Color(1, 0, 0.13, 1) },
                vProgress: { type: 'f', value: 0.8 },
                opacity:{type:'f',value:0},
                random:{value:Math.random()}
              },
              transparent: true,
              // depthTest: false,
              // 不写深度以免透明部分遮挡后续物体，加法混合使气流叠加处更亮。
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              vertexShader: vertex,
              fragmentShader: fragmentWind

        })
    }
    // 每帧只更新时间，几何体保持不变；console.log 是原有的调试输出。
    renderThing() {
        console.log(123);
        this.material.uniforms.vTime.value = this.clock.getElapsedTime();
        this.cb && this.cb()
    }
    addModel(model) {
        // Draco 是模型几何压缩格式，解码器文件位于 public/draco/gltf。
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('draco/gltf/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.dracoLoader.dispose()
        // 加载是异步的。遍历所有网格后，用气流材质替换模型原有材质。
        loader.load(model, (gltf) => {
            gltf.scene.traverse(item => {
                if (item.isMesh) {
                    item.material = this.material
                    // 所有网格共享 this.material，因此最终共享最后一次赋的随机值。
                    // 这里不会产生每根气流独立的 random；独立参数需要各自的材质或顶点属性。
                    item.material.uniforms.random.value = Math.random()
                }
            })
            this.group.add(gltf.scene)
        })

        // let plane = new THREE.PlaneGeometry(1,1)
        // let planeMesh = new THREE.Mesh(plane,this.material)
        // planeMesh.position.z = 5
        // planeMesh.position.y = 1

        // this.group.add(planeMesh)
    }
}
