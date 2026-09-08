// 反射地板的片元着色器：采样倒影纹理，并用表面法线、粗糙度和雾改变最终显示。
#include <common>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>

// sampler2D 表示二维纹理，texture2D(texture, uv) 用纹理坐标读取其中的颜色。
uniform sampler2D tReflectionMap;
uniform sampler2D tRefractionMap;
uniform sampler2D tNormalMap0;
uniform sampler2D tNormalMap1;
uniform sampler2D tRoughness;

		#ifdef USE_FLOWMAP
uniform sampler2D tFlowMap;
		#else
uniform vec2 flowDirection;
		#endif

uniform vec3 color;
uniform float reflectivity;
uniform vec4 config;

varying vec4 vCoord;
varying vec2 vUv;
varying vec3 vToEye;

void main() {

			#include <logdepthbuf_fragment>

    // config 保存两组流动偏移、半周期和纹理缩放；当前 JS 没有启用偏移的逐帧推进。
	float flowMapOffset0 = config.x;
	float flowMapOffset1 = config.y;
	float halfCycle = config.z;
	float scale = config.w;

	vec3 toEye = normalize(vToEye);

			// determine flow direction
	vec2 flow;
			#ifdef USE_FLOWMAP
	flow = texture2D(tFlowMap, vUv).rg * 2.0 - 1.0;
			#else
	flow = flowDirection;
			#endif
	flow.x *= -1.0;

			// sample normal maps (distort uvs with flowdata)
    // 两次采样表面法线纹理，用不同偏移混合；原本用于平滑循环的水面效果。
	vec4 normalColor0 = texture2D(tNormalMap0, (vUv * scale) + flow * flowMapOffset0);
	vec4 normalColor1 = texture2D(tNormalMap1, (vUv * scale) + flow * flowMapOffset1);

			// linear interpolate to get the final normal color
	float flowLerp = abs(halfCycle - flowMapOffset0) / halfCycle;
	vec4 normalColor = mix(normalColor0, normalColor1, flowLerp);

			// calculate normal vector
	vec3 normal = normalize(vec3(normalColor.r * 2.0 - 1.0, normalColor.b, normalColor.g * 2.0 - 1.0));

			// calculate the fresnel term to blend reflection and refraction maps
    // Fresnel 项描述观察角度对反射比例的影响；这里的混合计算被保留，但最终输出未采用 mixedColor。
	float theta = max(dot(toEye, normal), 0.0);
	float reflectance = reflectivity + (1.0 - reflectivity) * pow((1.0 - theta), 5.0);

			// calculate final uv coords
    // 对投影坐标做透视除法，再根据表面法线偏移采样点，产生凹凸倒影。
	vec3 coord = vCoord.xyz / vCoord.w;
	vec2 uv = coord.xy + coord.z * normal.xz * 0.05;

    // 灰度贴图读取红通道即可；这里用作强度权重，没有实现基于粗糙度的倒影模糊。
	float roughness = texture2D(tRoughness, vUv).r;
	float mixRatio = 1. - roughness; // 这里简单地假设粗糙度贴图是灰度图像
	vec4 reflectColor = texture2D(tReflectionMap, vec2(1.0 - uv.x, uv.y));
	vec4 refractColor = texture2D(tRefractionMap, uv);

	// 根据混合比例混合反射和折射颜色
	vec4 mixedColor = mix(refractColor, reflectColor, reflectance) * mixRatio +
		reflectColor * (1.0 - mixRatio);
			// multiply water color with the mix of both textures
    // 当前实际输出：地板底色 × 反射颜色 × 贴图权重。上面的折射混合并未用于此行。
	gl_FragColor = vec4(color, 1.0) * reflectColor * (0.78 - mixRatio);
	// gl_FragColor = vec4(color, 1.0) * mixedColor;

    // 接回 Three.js 的色调映射、颜色空间转换和场景雾，让地板融入主画面。
			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>

}
