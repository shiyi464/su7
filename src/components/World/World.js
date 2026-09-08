import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/addons/libs/stats.module.js';
import {
  BlendFunction,
  EffectPass,
  EffectComposer,
  SelectiveBloomEffect,
  RenderPass,
} from "postprocessing";

import * as THREE from 'three'
import { gsap } from 'gsap'

import bg from './textures/t_env_light.hdr'
import ReflectFloorMesh from './ReflectFloor';
import OutLineClip from './OutLineClip';
import LineBloom from './LineBloom';

import WindMesh from './WindMesh'

/**
 * SU7 展示场景的组织者，由 World/index.vue 创建。
 * Scene 装物体，Camera 决定观察视角，Renderer 把场景绘制到 canvas。
 * 本项目用 EffectComposer 添加后期效果，最终每帧调用 composer.render()。
 * lineBloom 是提前准备的车身轮廓，clipedge 是平面切过模型时实时计算的截面线。
 */
export default class World {
  bloomEffect;
  // 截面计算模型的缩放值，用于与展示模型对齐，不是 Three.js 的固定单位。
  scaleValue = 4.8;
  lineBloom;
  windLineBloom;
  constructor(selector, name = 'world') {
    // selector 是容器的 HTML id，不含 #；name 用作场景名称，方便调试。
    this.domId = selector
    this.scene = new THREE.Scene()
    this.scene.name = name
    // 指数雾让支持雾的材质随距离融入黑色背景，density 越大，雾越浓。
    this.scene.fog = new THREE.FogExp2(0x000000, 0.01);
    // 移动整个场景会连同汽车、地板和线条一起移动。Three.js 默认 Y 轴朝上。
    this.scene.position.y = -2.8
    this.clock = new THREE.Clock()
    this.container = document.getElementById(selector)
    this.width = this.container.offsetWidth
    this.height = this.container.offsetHeight

    // WebGLRenderer 调用显卡绘图，antialias 用于平滑物体边缘。
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.width = this.width
    this.height = this.height
    // 像素比决定实际像素密度，高分屏更清晰，但也需要更多渲染工作。
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(this.width, this.height)
    this.renderer.setClearColor(0x000000, 1)
    // sRGB 用于屏幕颜色输出；ACES 把高亮度范围压缩到屏幕可显示的范围。
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1;
    // 开启材质级裁剪，让汽车材质的 clippingPlanes 能隐藏平面一侧的片元。
    this.renderer.localClippingEnabled = true

    // 左上角的帧率面板，用于观察渲染性能。
    this.stats = new Stats();
    this.container.appendChild(this.stats.dom);

    this.composer = ''
    // domElement 就是 renderer 创建的 <canvas>，加入页面后才能显示。
    this.container.appendChild(this.renderer.domElement)

    // 透视相机有近大远小的效果，参数依次为垂直视角（度）、宽高比、近裁面、远裁面。
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      1,
      100
    )
    this.camera.position.set(0, 0, 22);
    // 鼠标控制相机绕目标观察；距离限制控制缩放，极角限制避免看向地板底部。
    // 阻尼需要每帧 controls.update()；当前代码只在初始化时调用了一次。
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.update()
    this.time = 0
    this.paused = false

    this.gui = ''
    // 异步加载 HDR 全景环境，提供车漆等材质的环境光照和反射，不直接用作背景。
    new RGBELoader().load(bg, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      this.scene.environment = texture
    })

    this.setupResize()
    // this.initLight()
    // this.addObjects()
    // 先启动循环，Vue 随后调用 initPostGrocess/addModle 继续组装场景。
    this.render()
  }
  // Geometry 决定地板形状，ReflectFloorMesh 内部创建反射材质。
  initReflector() {
    let geo = new THREE.PlaneGeometry(64, 64)
    let floor = new ReflectFloorMesh(geo, {
      textureWidth: 512,
      textureHeight: 512
    })
    // 平面默认位于 XY 平面，绕 X 轴旋转 -90° 后成为地板；旋转单位是弧度。
    floor.rotation.x = - Math.PI / 2;
    floor.position.y = - 0.0001;
    this.scene.add(floor)
  }
  // 后期流程：RenderPass 绘制场景 → EffectPass 添加 Bloom 光晕 → 输出画面。
  initComposer() {
    const effect = new SelectiveBloomEffect(this.scene, this.camera, {
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0,
      luminanceSmoothing: 0.8,
      opacity: 0.6,
      intensity: 3.0
    });
    // 使用反向选择，selection 在这里用于排除对象，并非“只有选中物体发光”。
    effect.inverted = true;
    effect.ignoreBackground = true
    effect.selection.set([])
    // 以下两个平面是保留的实验对象，未实际添加到场景。
    let material = new THREE.MeshBasicMaterial({ color: 0x3fffff });
    let geometry = new THREE.PlaneGeometry(5, 5, 10, 10);
    let plane = new THREE.Mesh(geometry, material);
    let plane2 = new THREE.Mesh(geometry, material);
    plane2.position.x = 6
    plane2.position.y = 6
    plane.position.y = 6
    plane.scale.set(0.01, 0.01, 0.01)
    plane2.scale.set(0.01, 0.01, 0.01)
    // this.scene.add(plane, plane2)


    effect.selection.set([plane])
    this.bloomEffect = effect
    let composerBloom = new EffectComposer(this.renderer);
    // 添加renderPass
    composerBloom.addPass(new RenderPass(this.scene, this.camera))
    const effectPass = new EffectPass(this.camera, effect);
    composerBloom.addPass(effectPass);
    this.composer = composerBloom
  }
  // 数学平面满足 normal·position + constant = 0，这里初始为 -x + 13 = 0。
  // 修改 constant 会移动边界，只改变显示，不会删除模型顶点或三角形。
  initClipPlane() {
    this.localPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.localPlane.constant = 13
  }
  // path 是用于截面计算的 glTF，正常展示车漆的 GLB 由 addModle 单独加载。
  initPostGrocess(path) {
    this.initClipPlane()
    this.initReflector()
    // GLTFLoader 解析模型，DRACOLoader 解码模型中可能存在的压缩几何数据。
    // public 中的资源从站点根目录访问，因此解码器路径没有 public/ 前缀。
    this.initComposer()
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('draco/gltf/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.dracoLoader.dispose()
    // load 不阻塞后面的 JS，资源解析完成后才执行回调，此时 clipedge 才存在。
    loader.load(path, (gltf) => {
      this.initGui()
      this.clipedge = new OutLineClip(this.scaleValue, gltf, this.scene, this.gui, this.renderer)
      this.clipedge.planeMesh.position.x = 13
      // this.bloomEffect.selection.set([])

    })
  }
  /**
   * 风阻演示：旋转场景并显示气流，随后扫描隐藏车身，最后气流淡出。
   * GSAP 修改属性数值，Three.js 每帧显示结果；这里没有空气动力学求解。
   * 时间线位置：'<' 与前一个动画同时开始，'>' 在前一个动画结束时开始，
   * '>+2.5' 则再等 2.5 秒；duration 的单位是秒，ease 控制变化的快慢节奏。
   */
  changeWind() {
    this.localPlane.constant = 13
    this.lineBloom.group.visible = false
    this.t1 = new gsap.timeline()
    /**
     * 1、scene rotation 
     * 2、clip transform 、cilpOutLine tansform scene fog 
     * **/
    this.windLineBloom.group.visible = true
    this.t1.to(this.scene.rotation, {
      y: Math.PI * 1.3,
      duration: 2,
      ease: 'power2.out',
      onComplete: () => {
        // 场景旋转后更新世界矩阵，再把裁剪平面变换到对应的世界空间。
        this.scene.updateMatrixWorld(true)
        this.localPlane.normal.set(0, 0, - 1);
        this.clipedge.clippingPlanes[0].normal.set(0, 0, - 1)
        this.localPlane.applyMatrix4(this.clipedge.planeMesh.matrixWorld);
      }
    }).to(this.windLineBloom.material.uniforms.opacity, {
        value: 1,
        duration: 1,
        ease: 'power2.in',
      }, '<')
      // topLight 是模型中名为 topLigt 的发光网格，这里控制它的自发光强度。
      .to(this.topLight.material, {
        emissiveIntensity: 0,
        duration: 1,
        ease: 'power2.out',
      }, "<")
      .to(this.scene.fog, {
        density: 0.06,
        duration: 1,
        ease: 'power2.out',
      }, "<")
      .to(this.camera.position, {
        z: 24,
        duration: 1,
        ease: 'power2.out',
      })

      // 移动实体车身的裁剪边界，onUpdate 同时推动计算截面线的辅助平面。
      .to(this.localPlane, {
        constant: -13,
        duration: 2,
        ease: 'power2.out',
        onUpdate: () => {
          this.clipedge.planeMesh.position.x = this.localPlane.constant
        },
        onStart: () => {

          // 显示提前生成的轮廓；实体车身尚未隐藏时，深度测试会遮住车身后面的线。
          this.isWindMode = true
          this.lineBloom.group.visible = true
          this.bloomEffect.selection.set([this.clipedge.outlineLines, ...this.lineBloom.allLinesMesh])
        }
      }, ">+2.5")
      .to(this.windLineBloom.material.uniforms.opacity, {
        value: 0,
        duration: 1,
        ease: 'power2.out',
        onComplete: () => {
          // 淡出后隐藏整个组，避免继续提交这组物体的绘制。
          this.windLineBloom.group.visible = false
        }
      })
  }
  // 恢复：移回裁剪边界显露车身，再还原相机距离、雾、顶部发光和场景角度。
  changeNormal() {
    this.topLight.material.emissiveIntensity = 0
    this.localPlane.normal.set(0, 0, - 1);
    this.localPlane.applyMatrix4(this.clipedge.planeMesh.matrixWorld);
    this.t2 = new gsap.timeline()
    this.t2.to(this.localPlane, {
      constant: 13,
      duration: 2,
      ease: 'power2.out',
      onUpdate: () => {
        this.clipedge.planeMesh.position.x = this.localPlane.constant
      },
      onComplete: () => {
        this.lineBloom.group.visible = false
      },
    })
      .to(this.camera.position, {
        z: 22,
        duration: 1,
        ease: 'power2.out',
      }, ">")
      .to(this.scene.fog, {
        density: 0.01,
        ease: 'power2.out'
      }, "<")
      .to(this.topLight.material, {
        emissiveIntensity: 0.52,
        ease: 'power2.out',
      }, "<")
      .to(this.scene.rotation, {
        // '-=' 是 GSAP 的相对变化语法，表示从当前角度减去指定弧度。
        y: `-=${Math.PI * 1.3}`,
        duration: 2,
        ease: 'power2.out',
        onComplete: () => {
          this.lineBloom.group.visible = false
          this.localPlane.normal.set(0, 0, - 1);
          this.localPlane.applyMatrix4(this.clipedge.planeMesh.matrixWorld);
          this.scene.updateMatrixWorld(true)
        }
      }, ">+1")
  }
  // Group 统一管理多个物体，可以整体移动、缩放和隐藏；初始不显示车身轮廓。
  addLineBloom(Curves) {
    let lineBloom = new LineBloom(Curves)
    lineBloom.group.visible = false
    this.lineBloom = lineBloom
    this.scene.add(lineBloom.group)
    return lineBloom
  }
  // 创建气流实例，实际 GLB 由调用者再执行返回实例的 addModel() 加载。
  addWindLine(Curves, option) {
    let lineBloom = new WindMesh(Curves, option)
    lineBloom.group.visible = false
    this.windLineBloom = lineBloom
    this.scene.add(lineBloom.group)
    return lineBloom
  }
  // GLB 是 glTF 的二进制形式，可以打包几何体、材质和纹理。
  addModle(path) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('draco/gltf/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.dracoLoader.dispose()
    loader.load(path, (gltf) => {
      // gltf.scene 是模型的场景子树，之后加入 this.scene，并不是另开一个画布。
      gltf.scene.scale.set(2, 2, 2)
      gltf.scene.position.y = 0.2
      gltf.scene.name = 'carScene'
      // remove light
      // 按此模型的固定子节点顺序移除对象；换模型后不能假设第 2 个节点仍是灯。
      gltf.scene.remove(gltf.scene.children[1])
      // traverse 递归访问模型节点，isMesh 区分可绘制网格与普通分组等节点。
      gltf.scene.traverse((item) => {
        if (item.isMesh) {
          // 零件共享同一个平面对象，动画修改平面时就能同步裁剪整辆车。
          item.material.clippingPlanes = [this.localPlane]
          // 保留的模板缓冲设置；这些开关属于 Material，直接写在 Mesh 上不会生效。
          item.stencilRef = 1
          item.stencilWrite = true
          item.stencilWriteMask = 0xff
          item.stencilZPass = THREE.ReplaceStencilOp
          // 法线描述表面朝向，是光照计算判断表面明暗的重要输入。
          item.geometry.computeVertexNormals()
          if (item.name === '平面') {
            item.visible = false
          }
          // 顶部发光网格不参与车身裁剪，模式切换时单独控制亮度。
          if (item.name === 'topLigt') {
            item.material.clippingPlanes = []
            item.position.y = 6
            item.scale.set(12, 0.04, 6)
            // item.visible = false
            item.material.emissiveIntensity = 0.52
            // item.material.emissiveIntensity = 0
            this.topLight = item
          }
        }
      })
      this.scene.add(gltf.scene)
      console.log(this.scene);
    });

  }
  // 保留的普通平行光示例，构造函数中未启用。
  initLight() {
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.scene.add(directionalLight);
  }
  // 保留的普通地板示例，当前页面实际使用 initReflector 创建反射地板。
  addObjects() {
    const groundGeometry = new THREE.PlaneGeometry(20, 20, 10, 10)
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = Math.PI * -0.5
    this.scene.add(ground)
  }
  // 每帧先更新特效数据，再绘制画面；条件判断会跳过尚未加载完成的模块。
  render() {
    if (this.paused) return
    this.stats.begin();
    if (this.clipedge) {
      this.clipedge.renderThing()
    }
    if (this.lineBloom) {
      this.lineBloom.renderThing()
    }
    if (this.windLineBloom) {
      this.windLineBloom.renderThing()
    }
    // composer 包含场景绘制步骤，通过它输出带后期效果的最终画面。
    this.composer && this.composer.render()
    // this.renderer.render(this.scene, this.camera)
    this.stats.end();
    // 请求下次浏览器刷新继续绘制，bind 保证回调中的 this 仍是当前 World。
    requestAnimationFrame(this.render.bind(this))
  }
  setupResize() {
    window.addEventListener('resize', this.resize.bind(this))
  }
  resize() {
    this.container = document.getElementById(this.domId)
    this.width = this.container.offsetWidth
    this.height = this.container.offsetHeight
    this.renderer.setSize(this.width, this.height)
    this.camera.aspect = this.width / this.height
    // aspect 改变后需重算投影矩阵，避免比例失真。
    // 当前未同步 composer.setSize；扩展适配时还要考虑后期缓冲区的尺寸。
    this.camera.updateProjectionMatrix()
  }
  // lil-gui 把属性绑定到右上角控件，onChange 将用户输入同步到 3D 场景。
  initGui() {
    this.gui = new GUI({ width: 260, title: '控制面板' });
    let folderLocal = this.gui.addFolder('局部裁剪')
    let propsLocal = {
      Enabled: true,
      Plane: 0
    }
    this.propsLocal = propsLocal
    folderLocal.add(propsLocal, 'Enabled').name('启用裁剪').onChange((v) => {
      this.renderer.localClippingEnabled = v
    });
    folderLocal.add(propsLocal, 'Plane').name('裁剪平面').min(-13).max(13).step(.001).onChange((v) => {
      this.localPlane.constant = v;
      // 手动调节使用额外比例和偏移，与 GSAP 时间线中的赋值方式不同。
      this.clipedge.planeMesh.position.x = v / this.scaleValue + 0.05
    });
  }
}
