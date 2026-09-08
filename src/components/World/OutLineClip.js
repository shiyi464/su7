import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH, MeshBVHHelper, CONTAINED } from 'three-mesh-bvh';
import * as THREE from "three";

/**
 * 实时扫描截面：让数学平面与汽车三角形求交，把交点组成 LineSegments。
 * 可以想成用一张纸切过模型，显示纸与车身相交的那一圈线。
 * BVH 将三角形按空间分组，加速寻找可能与平面相交的区域。
 * 本类的 localPlane 用于局部空间求交；World.localPlane 则用于裁剪展示汽车。
 * 提前保存的整车轮廓在 LineBloom 中，这里只计算当前扫描位置的截面。
 */
export default class OutLineClip {
  // 右上角 GUI 的调试状态；SPIN 旋转截面，默认模式由 World 的时间线推动平面。
  params = {
    useBVH: true,
    helperDisplay: false,
    helperDepth: 10,

    wireframeDisplay: false,
    displayModel: false,

    animate: true,
    animation: 'OSCILLATE',
    invert: false,
  };
  planeMesh;
  outlineLines;
  time = 0;
  initialClip=false;
  constructor(scaleValue, gltf, scene, gui, renderer) {
    this.clock = new THREE.Clock();
    // 复用向量、线段和矩阵，避免每帧求交时为大量三角形反复创建临时对象。
    this.tempVector = new THREE.Vector3();
    this.tempVector1 = new THREE.Vector3();
    this.tempVector2 = new THREE.Vector3();
    this.tempVector3 = new THREE.Vector3();
    this.tempLine = new THREE.Line3();
    this.inverseMatrix = new THREE.Matrix4();
    this.localPlane = new THREE.Plane();
    this.clippingPlanes = [
      new THREE.Plane(),
    ];
    renderer.localClippingEnabled = true;
    this.group = new THREE.Group()
    this.group.name = 'outLineClip'
    scene.add(this.group)

    this.initClipPlane(this.group)

    // 复制并合并模型几何体，为后续统一建立 BVH 和计算交线做准备。
    let model = this.dealModel(scaleValue, gltf, this.group)

    // color the surface of the geometry with an EQUAL depth to limit the amount of
    // fragment shading that has to run.
    const surfaceModel = model.clone();
    surfaceModel.material = new THREE.MeshStandardMaterial({
      depthFunc: THREE.EqualDepth,
    });
    surfaceModel.renderOrder = 1;

    let outlineLines = this.initLines(model)
    let frontSideModel = this.iniFrontModel(model)
    this.frontSideModel = frontSideModel
    let backSideModel = this.iniBackModel(model)
    this.backSideModel = backSideModel
    let { colliderBvh, colliderMesh, bvhHelper } = this.initBvh(model)
    this.colliderBvh = colliderBvh
    this.colliderMesh = colliderMesh
    this.bvhHelper = bvhHelper
    this.outlineLines = outlineLines;
    // 正反面、表面和 BVH 辅助对象是保留的调试方案，当前没有全部加入 group。
    // 因此部分 GUI 开关仅改变对象属性，并不一定让这些未挂载对象出现在画面中。
    // if debug use 
    // this.group.add(frontSideModel, backSideModel, surfaceModel, colliderMesh, bvhHelper, outlineLines);
    this.group.add(colliderMesh,outlineLines);

    // 用包围盒中心的相反数平移整个组，使这套截面计算对象居中。
    const box = new THREE.Box3();
    box.setFromObject(this.frontSideModel);
    box.getCenter(this.group.position).multiplyScalar(- 1);
    this.group.updateMatrixWorld(true);

    if(gui){
      this.initGui(gui)
    }
    
  }
  // World 每帧调用：更新辅助平面 → 转换坐标空间 → 求交 → 更新线段的顶点缓冲。
  renderThing() {
    if (this.bvhHelper) {

      this.bvhHelper.visible = this.params.helperDisplay;
      this.colliderMesh.visible = this.params.wireframeDisplay;

      this.frontSideModel.visible = this.params.displayModel;
      this.backSideModel.visible = this.params.displayModel;

    }

    // make the outlines darker if the model is shown
    this.outlineLines.material.color
      .set(this.params.displayModel ? 0x3fffff : 0x3fffff)
    // delta 为帧间隔（秒），上限避免页面卡顿后旋转时间一下跳得过大。
    const delta = Math.min(this.clock.getDelta(), 0.03);
    if (this.params.animate) {

      this.time += delta;

      if (this.params.animation === 'SPIN') {

        this.planeMesh.rotation.x = 0.25 * this.time;
        this.planeMesh.rotation.y = 0.25 * this.time;
        this.planeMesh.rotation.z = 0.25 * this.time;
        this.planeMesh.position.set(0, 0, 0);

      } else {

        // 默认分支只设朝向；平面的 X 位移由 World.changeWind/changeNormal 或 GUI 设置。
        // this.planeMesh.position.set(0, 0, 0);
        this.planeMesh.rotation.set(0, Math.PI / 2, 0);

      }

      this.planeMesh.updateMatrixWorld();

    }

    // 从辅助对象的局部平面出发，利用 matrixWorld 转到世界坐标；invert 翻转法线。
    const clippingPlane = this.clippingPlanes[0];
    clippingPlane.normal.set(0, 0, this.params.invert ? 1 : - 1);
    clippingPlane.constant = 0;
    clippingPlane.applyMatrix4(this.planeMesh.matrixWorld);

    // Perform the clipping
    if (this.colliderBvh && (this.params.animate || !this.initialClip)) {

      this.initialClip = true;

      // get the clipping plane in the local space of the BVH
      // 三角形顶点位于 colliderMesh 的局部空间，平面也必须转换到同一空间才能求交。
      // matrixWorld 把局部坐标变到世界坐标，其逆矩阵执行反向转换。
      this.inverseMatrix.copy(this.colliderMesh.matrixWorld).invert();
      this.localPlane.copy(clippingPlane).applyMatrix4(this.inverseMatrix);

      // index 记录本帧写入的顶点数，每两个顶点构成一条独立线段。
      let index = 0;
      const posAttr = this.outlineLines.geometry.attributes.position;
      const startTime = window.performance.now();
      // shapecast 遍历空间树：先判断包围盒，再检查候选盒中的三角形。
      this.colliderBvh.shapecast({
        intersectsBounds: box => {
          // if we're not using the BVH then skip straight to iterating over all triangles
          if (!this.params.useBVH) {
            return CONTAINED;
          }
          // 平面不经过此包围盒，就可跳过这一整组三角形。
          return this.localPlane.intersectsBox(box);
        },
        intersectsTriangle: tri => {
          // check each triangle edge to see if it intersects with the plane. If so then
          // add it to the list of segments.
          // 分别检查 a-b、b-c、c-a 三条边，正常相交会得到两个端点。
          let count = 0;
          this.tempLine.start.copy(tri.a);
          this.tempLine.end.copy(tri.b);
          if (this.localPlane.intersectLine(this.tempLine, this.tempVector)) {
            posAttr.setXYZ(index, this.tempVector.x, this.tempVector.y, this.tempVector.z);
            index++;
            count++;

          }

          this.tempLine.start.copy(tri.b);
          this.tempLine.end.copy(tri.c);
          if (this.localPlane.intersectLine(this.tempLine, this.tempVector)) {

            posAttr.setXYZ(index, this.tempVector.x, this.tempVector.y, this.tempVector.z);
            count++;
            index++;

          }

          this.tempLine.start.copy(tri.c);
          this.tempLine.end.copy(tri.a);
          if (this.localPlane.intersectLine(this.tempLine, this.tempVector)) {

            posAttr.setXYZ(index, this.tempVector.x, this.tempVector.y, this.tempVector.z);
            count++;
            index++;

          }

          // When the plane passes through a vertex and one of the edges of the triangle, there will be three intersections, two of which must be repeated
          // 平面恰好经过顶点时，相邻两条边可能记录重复交点，需要尝试去重。
          if (count === 3) {

            this.tempVector1.fromBufferAttribute(posAttr, index - 3);
            this.tempVector2.fromBufferAttribute(posAttr, index - 2);
            this.tempVector3.fromBufferAttribute(posAttr, index - 1);
            // If the last point is a duplicate intersection
            if (this.tempVector3.equals(this.tempVector1) || this.tempVector3.equals(this.tempVector2)) {

              count--;
              index--;

            } else if (this.tempVector1.equals(this.tempVector2)) {

              // If the last point is not a duplicate intersection
              // Set the penultimate point as a distinct point and delete the last point
              posAttr.setXYZ(index - 2, this.tempVector3);
              count--;
              index--;

            }

          }

          // If we only intersected with one or three sides then just remove it. This could be handled
          // more gracefully.
          // 无法组成一条有效线段时，撤回刚才写入的点，不计入绘制范围。
          if (count !== 2) {

            index -= count;

          }

        },

      });

      // set the draw range to only the new segments and offset the lines so they don't intersect with the geometry
      // 缓冲区预先分配得较大，只绘制本帧实际写入的顶点，并微移交线减少深度重叠。
      this.outlineLines.geometry.setDrawRange(0, index);
      this.outlineLines.position.copy(clippingPlane.normal).multiplyScalar(- 0.00001);
      // 通知 Three.js 将 CPU 上修改过的顶点数据重新上传到显卡。
      posAttr.needsUpdate = true;

      const delta = window.performance.now() - startTime;
      // outputElement.innerText = `${parseFloat(delta.toFixed(3))}ms`;

    }
  }
  // 这里的 GUI 用于观察求交算法及辅助对象，与展示汽车自身的材质控制相互独立。
  initGui(gui) {
    let params = this.params
    gui.add(params, 'invert').name('反转裁剪');
    gui.add(params, 'animate').name('启用动画');
    gui.add(params, 'animation', {
      '旋转': 'SPIN',
      '往复': 'OSCILLATE',
    }).name('动画模式').onChange(() => {

      this.time = 0;

    });
    gui.add(params, 'displayModel').name('显示模型');
    gui.add(params, 'useBVH').name('使用 BVH');

    const helperFolder = gui.addFolder('辅助显示');
    helperFolder.add(params, 'wireframeDisplay').name('显示线框');
    helperFolder.add(params, 'helperDisplay').name('显示 BVH 辅助');
    helperFolder.add(params, 'helperDepth', 1, 20, 1).name('辅助层级').onChange(v => {

      if (this.bvhHelper) {

        this.bvhHelper.depth = parseInt(v);
        this.bvhHelper.update();

      }

    });
    helperFolder.open();

    gui.open();
  }
  initClipPlane(scene) {
    // 几何体为空，因此不会直接画出一张可见的纸；借用 Mesh 的位置/旋转/矩阵表示平面。
    // stencil（模板缓冲）配置是保留的截面填充实验，实时交线本身通过 CPU 求交生成。
    this.planeMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ZeroStencilOp,
      stencilZFail: THREE.ZeroStencilOp,
      stencilZPass: THREE.ZeroStencilOp,
    }));
    this.planeMesh.scale.setScalar(1.5);
    this.planeMesh.material.color.set(0x80deea).convertLinearToSRGB();
    this.planeMesh.renderOrder = 2;
    scene.add(this.planeMesh);
  }

  initLines(model) {
    // 300000 个浮点数，每点 x/y/z 共 3 个数，可容纳 100000 个顶点，即 50000 条线段。
    const lineGeometry = new THREE.BufferGeometry();
    const linePosAttr = new THREE.BufferAttribute(new Float32Array(300000), 3, false);
    // 顶点会频繁改变，使用动态缓冲区提示；LineSegments 按每两个顶点连接一段。
    linePosAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeometry.setAttribute('position', linePosAttr);
    let outlineLines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial());
    outlineLines.material.color.set(0x00acc1)
    // 交线不断变化，关闭根据旧包围体进行的视锥剔除，避免有效线段被误判为不可见。
    outlineLines.frustumCulled = false;
    outlineLines.renderOrder = 3;

    outlineLines.scale.copy(model.scale);
    outlineLines.position.set(0, 0, 0);
    outlineLines.quaternion.identity();

    return outlineLines
  }

  // 为当前模型准备统一几何体，避免逐个网格分别建立求交流程。
  dealModel(scaleValue, gltf, scene) {
    let mergedGeometry = new THREE.BufferGeometry();
    // 存储所有模型的几何体
    let geometries = [];
    gltf.scene.traverse(item => {
      if (item.isMesh) {
        // clone 避免改动传入模型，applyMatrix4 把该节点的局部变换烘焙进顶点。
        // 当前只使用 item.matrix；更复杂的多层模型还需要考虑祖先节点的变换。
        const instanceGeo = item.geometry.clone();
        instanceGeo.applyMatrix4(item.matrix);
        geometries.push(instanceGeo);
      }
    });

    // 合并几何体
    if (geometries.length > 0) {
      mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    }

    // 创建一个新的 Mesh 对象并设置合并后的几何体
    let mergedMesh = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
    mergedMesh.scale.set(scaleValue, scaleValue, scaleValue)
    mergedMesh.position.y = -3.3
    mergedMesh.quaternion.identity();
    mergedMesh.applyMatrix4(gltf.scene.matrix)
    mergedMesh.updateMatrixWorld(true);
    // scene.add(mergedMesh)
    
    return mergedMesh
  }

  // 保留的正面模板缓冲方案：正面计数递增；当前结果未添加到显示组。
  iniFrontModel(model) {
    const matSet = new Set();
    const materialMap = new Map();
    let frontSideModel = model;
    frontSideModel.updateMatrixWorld(true);
    frontSideModel.traverse(c => {
      if (c.isMesh) {
        if (materialMap.has(c.material)) {
          c.material = materialMap.get(c.material);
          return;
        }
        matSet.add(c.material);
        const material = c.material.clone();
        material.color.set(0xffffff);
        material.roughness = 1.0;
        material.metalness = 0.0;
        material.side = THREE.FrontSide;
        material.stencilWrite = true;
        material.stencilFail = THREE.IncrementWrapStencilOp;
        material.stencilZFail = THREE.IncrementWrapStencilOp;
        material.stencilZPass = THREE.IncrementWrapStencilOp;
        material.clippingPlanes = this.clippingPlanes;

        materialMap.set(c.material, material);
        c.material = material;
      }
    });

    return frontSideModel
  }

  // 背面计数递减，且不写颜色/深度；与正面配合可用于截面填充实验。
  iniBackModel() {
    const matSet = new Set();
    const materialMap = new Map();
    let backSideModel = this.frontSideModel.clone();
    backSideModel.traverse(c => {

      if (c.isMesh) {

        if (materialMap.has(c.material)) {

          c.material = materialMap.get(c.material);
          return;

        }

        const material = c.material.clone();
        material.color.set(0xffffff);
        material.roughness = 1.0;
        material.metalness = 0.0;
        material.colorWrite = false;
        material.depthWrite = false;
        material.side = THREE.BackSide;
        material.stencilWrite = true;
        material.stencilFail = THREE.DecrementWrapStencilOp;
        material.stencilZFail = THREE.DecrementWrapStencilOp;
        material.stencilZPass = THREE.DecrementWrapStencilOp;
        material.clippingPlanes = this.clippingPlanes;

        materialMap.set(c.material, material);
        c.material = material;

      }

    });

    return backSideModel
  }

  // BVH 是包围体层级树，先划分空间，求交时就不必每次检查全部三角形。
  initBvh(model) {
    let mergedGeometry = model.geometry
    let colliderBvh = new MeshBVH(mergedGeometry, { maxLeafTris: 3 });
    mergedGeometry.boundsTree = colliderBvh;

    // colliderMesh 保存求交对象的空间变换，默认隐藏，不负责正常车漆展示。
    let colliderMesh = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial({
      wireframe: false,
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
    }));
    colliderMesh.renderOrder = 2;
    colliderMesh.position.copy(model.position);
    colliderMesh.rotation.copy(model.rotation);
    colliderMesh.visible = false
    colliderMesh.scale.copy(model.scale);

    let bvhHelper = new MeshBVHHelper(colliderMesh, parseInt(this.params.helperDepth));
    bvhHelper.depth = parseInt(this.params.helperDepth);
    bvhHelper.update();

    return { colliderBvh, colliderMesh, bvhHelper }
  }
}
