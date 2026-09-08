
// 车身轮廓和气流共用的顶点着色器：决定模型顶点最终画到屏幕哪里。
// varying 把数据传到片元着色器；光栅化时会在三角形内部自动插值。
varying vec2 vUv;
void main() {
  // uv 是模型的二维纹理坐标。TubeGeometry 的 uv.x 沿曲线从起点走向终点。
  vUv = uv;
  // position 是模型局部坐标；modelViewMatrix 将它变换到相机坐标空间。
  vec4 mvPosition = modelViewMatrix * vec4( position, 1. );
  // gl_PointSize = 10. * ( 1. / - mvPosition.z );
  // 投影矩阵产生裁剪空间坐标；之后由显卡完成透视除法及视口映射。
  gl_Position = projectionMatrix * mvPosition;
}
