import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { Refractor } from 'three/examples/jsm/objects/Refractor.js'

import fragment from './shader/fragment.glsl'
import vertex from './shader/vertex.glsl'
import tNormalMap0 from './textures/t_floor_normal.webp'
import tNormalMap1 from './textures/t_floor_normal.webp'
import tRoughness from './textures/t_floor_roughness.webp'

/**
 * 反射地板：额外渲染镜像视角得到纹理，再将该纹理画到水平地面上。
 * 法线贴图扰动倒影采样位置，粗糙度贴图参与当前着色器的反射强度计算。
 * 此实现沿用水面/玻璃效果结构，保留了折射与流动代码；当前最终输出主要采用反射。
 * 进阶阅读顺序：材质 uniforms → onBeforeRender → shader/vertex.glsl → fragment.glsl。
 */
export default class ReflectFloorMesh extends THREE.Mesh {
  constructor(geometry, options = {}) {
    super(geometry);

    // 从水面实现保留下来的标识，不表示地板在执行真实的水体模拟。
    this.isWater = true;

    this.type = 'Water';

    const scope = this

    const color =
      options.color !== undefined
        ? new THREE.Color(options.color)
        : new THREE.Color(0xffffff)
    // 反射/折射缓冲区的分辨率，不是地板的物理尺寸；越高通常越清晰，也越耗资源。
    const textureWidth =
      options.textureWidth !== undefined ? options.textureWidth : 1024
    const textureHeight =
      options.textureHeight !== undefined ? options.textureHeight : 1024
    const clipBias = options.clipBias !== undefined ? options.clipBias : 0
    const flowDirection =
      options.flowDirection !== undefined
        ? options.flowDirection
        : new THREE.Vector2(1, 0)
    const flowSpeed = options.flowSpeed !== undefined ? options.flowSpeed : 0.03
    const reflectivity =
      options.reflectivity !== undefined ? options.reflectivity : 0.02
    const scale = options.scale !== undefined ? options.scale : 1
    const shader =
      options.shader !== undefined ? options.shader : ReflectFloorMesh.GlassShader

    // 法线贴图描述微小表面朝向，让倒影呈现凹凸扰动，而不用增加地板顶点。
    const textureLoader = new THREE.TextureLoader()

    const flowMap = options.flowMap || undefined
    const normalMap0 =
      options.normalMap0 ||
      textureLoader.load(tNormalMap0)
    const normalMap1 =
      options.normalMap1 ||
      textureLoader.load(tNormalMap1)
    const roughness = options.roughness || textureLoader.load(tRoughness)

    // 两组错开的纹理偏移原本用于平滑循环水流，当前没有调用 updateFlow。
    const cycle = 0.15 // a cycle of a flow map phase
    const halfCycle = cycle * 0.5
    const textureMatrix = new THREE.Matrix4()
    const clock = new THREE.Clock()

    // internal components
    // Reflector 用关于平面对称的虚拟相机拍摄场景，结果写入自己的渲染目标纹理。
    const reflector = new Reflector(geometry, {
      textureWidth: textureWidth,
      textureHeight: textureHeight,
      clipBias: clipBias
    })

    // Refractor 也产生一张离屏纹理；当前片元着色器保留计算但未用它输出最终混合色。
    const refractor = new Refractor(geometry, {
      textureWidth: textureWidth,
      textureHeight: textureHeight,
      clipBias: clipBias
    })

    reflector.matrixAutoUpdate = false
    refractor.matrixAutoUpdate = false

    // material

    // 使用自定义 GLSL 组合反射纹理和表面贴图，并接入场景的雾参数。
    this.material = new THREE.ShaderMaterial({
      name: shader.name,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib['fog'],
        shader.uniforms
      ]),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      transparent: true,
      fog: true
    })

    // defines 决定编译哪段 GLSL：可选流向贴图，默认使用固定二维流向。
    if (flowMap !== undefined) {
      this.material.defines.USE_FLOWMAP = ''
      this.material.uniforms['tFlowMap'] = {
        type: 't',
        value: flowMap
      }
    } else {
      this.material.uniforms['flowDirection'] = {
        type: 'v2',
        value: flowDirection
      }
    }

    // maps

    // UV 超出 0～1 时重复采样纹理，便于平铺表面细节。
    normalMap0.wrapS = normalMap0.wrapT = THREE.RepeatWrapping
    normalMap1.wrapS = normalMap1.wrapT = THREE.RepeatWrapping
    roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping

    // RenderTarget 是“画到纹理上”的缓冲区；把纹理交给地板材质，才能显示倒影。
    this.material.uniforms['tReflectionMap'].value =
      reflector.getRenderTarget().texture
    this.material.uniforms['tRefractionMap'].value =
      refractor.getRenderTarget().texture
    this.material.uniforms['tNormalMap0'].value = normalMap0
    this.material.uniforms['tNormalMap1'].value = normalMap1
    this.material.uniforms['tRoughness'].value = roughness

    // water

    this.material.uniforms['color'].value = color
    this.material.uniforms['reflectivity'].value = reflectivity
    this.material.uniforms['textureMatrix'].value = textureMatrix

    // inital values

    this.material.uniforms['config'].value.x = 0 // flowMapOffset0
    this.material.uniforms['config'].value.y = halfCycle // flowMapOffset1
    this.material.uniforms['config'].value.z = halfCycle // halfCycle
    this.material.uniforms['config'].value.w = scale // scale

    // functions

    function updateTextureMatrix(camera) {
      // 先建立把裁剪空间 -1～1 映射到纹理空间 0～1 的矩阵。
      // 随后乘投影、观察和模型矩阵，使地板顶点可对应到倒影纹理中的采样位置。
      textureMatrix.set(
        0.5,
        0.0,
        0.0,
        0.5,
        0.0,
        0.5,
        0.0,
        0.5,
        0.0,
        0.0,
        0.5,
        0.5,
        0.0,
        0.0,
        0.0,
        1.0
      )

      textureMatrix.multiply(camera.projectionMatrix)
      textureMatrix.multiply(camera.matrixWorldInverse)
      textureMatrix.multiply(scope.matrixWorld)
    }

    function updateFlow() {
      // 原有流动算法按帧间隔推进两组偏移，错开半个周期，混合时避免明显的循环跳变。
      const delta = clock.getDelta()
      const config = scope.material.uniforms['config']

      config.value.x += flowSpeed * delta // flowMapOffset0
      config.value.y = config.value.x + halfCycle // flowMapOffset1

      // Important: The distance between offsets should be always the value of "halfCycle".
      // Moreover, both offsets should be in the range of [ 0, cycle ].
      // This approach ensures a smooth water flow and avoids "reset" effects.

      if (config.value.x >= cycle) {
        config.value.x = 0
        config.value.y = halfCycle
      } else if (config.value.y >= cycle) {
        config.value.y = config.value.y - cycle
      }
    }

    // Three.js 在绘制地板之前调用此钩子，先更新本帧所需的倒影纹理。
    this.onBeforeRender = function (renderer, scene, camera) {
      updateTextureMatrix(camera)
      // updateFlow()

      // 拍倒影时临时隐藏地板，避免地板再次触发自己的反射渲染，形成递归。
      scope.visible = false

      // 两个辅助对象不直接挂入场景，每帧复制地板的世界变换以保持位置和朝向一致。
      reflector.matrixWorld.copy(scope.matrixWorld)
      refractor.matrixWorld.copy(scope.matrixWorld)

      reflector.onBeforeRender(renderer, scene, camera)
      refractor.onBeforeRender(renderer, scene, camera)

      // 离屏纹理准备好后，恢复地板可见性，让主画面绘制使用新纹理的地板。
      scope.visible = true
    }

  }
}
// uniform 默认值表；构造函数克隆这些参数，再填入当前地板的纹理、颜色和矩阵。
ReflectFloorMesh.GlassShader = {
  name: 'groundGlassShader',
  uniforms: {
    color: {
      type: 'c',
      value: null
    },
    reflectivity: {
      type: 'f',
      value: 0
    },
    tReflectionMap: {
      type: 't',
      value: null
    },
    tRefractionMap: {
      type: 't',
      value: null
    },
    tNormalMap0: {
      type: 't',
      value: null
    },
    tNormalMap1: {
      type: 't',
      value: null
    },
    tRoughness:{
      type: 't',
      value: null
    },
    textureMatrix: {
      type: 'm4',
      value: null
    },
    config: {
      type: 'v4',
      value: new THREE.Vector4()
    }
  },
  vertexShader: vertex,
  fragmentShader: fragment
}
