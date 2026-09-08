// 地板顶点着色器。#include 引用 Three.js 内置片段，接入公共函数、雾和深度处理。
#include <common>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>

// JS 每帧更新的纹理投影矩阵，用于把地板顶点对应到反射纹理的采样位置。
uniform mat4 textureMatrix;

varying vec4 vCoord;
varying vec2 vUv;
varying vec3 vToEye;

void main() {

  vUv = uv;
  // vUv 用于地板表面贴图；vCoord 是用于反射纹理的投影坐标，两者用途不同。
  vCoord = textureMatrix * vec4(position, 1.0);

  // 局部位置乘 modelMatrix 得到世界位置；相机位置减去它，得到指向观察者的向量。
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vToEye = cameraPosition - worldPosition.xyz;

  // 世界空间 → 相机空间 → 裁剪空间，最后交给显卡完成屏幕映射。
  vec4 mvPosition = viewMatrix * worldPosition; // used in fog_vertex
  gl_Position = projectionMatrix * mvPosition;

			#include <logdepthbuf_vertex>
			#include <fog_vertex>

}
