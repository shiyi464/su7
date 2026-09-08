// 气流片元着色器：在 GLB 表面的 UV 空间画出多条波动曲线，再控制亮暗和透明度。
// 改变的是表面颜色分布，不是重新计算真实空气轨迹。
uniform float vTime;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
varying vec4 vCoord;
uniform float random;


// 宏只是表达式缩写，IS 表示反向的平滑过渡，即 1 - smoothstep。
#define S smoothstep
#define IS(x,y,z) (1. - smoothstep(x,y,z))


// 按一条随时间变化的曲线偏移 uv.y，越接近曲线中心越亮，远离时平滑消失。
vec3 draw_line(vec2 uv,vec3 color, float shift, float freq){
	// 粗细
	 float line_thickness = 0.14;
	// 中心纵向scale     
    float amp_coef = 0.9;
    uv.y -=IS(1.1,1.9,abs(uv.x)) * sin(uv.x + shift * freq) * amp_coef * sin(uv.x + shift);
    return IS(0.,line_thickness*S(-0.9,.9,abs(uv.x)),abs(uv.y*1.2)) * color;
}

void main() {
    float speed = 0.5;
    
    float freq_coef = 1.5;
    // 把常见的 0～1 UV 映射到 -1～1，使曲线计算围绕中心展开。
	 	vec2 uv = vUv*2. - 1.;
    // uv.x *= vCoord.x/vCoord.y;
    
    // 时间驱动曲线相位，speed 越大，波动越快。
	float shift = vTime * speed;

    // random 影响亮暗波纹速度；当前所有气流网格共用同一个材质参数。
	float vProgress = smoothstep(-1.,1.,sin(vUv.x*12. + vTime*6.*random));
    // 首尾淡出沿用原公式；逆序 smoothstep 边界按规范结果未定义，需与标准用法区分。
	// end: x > 1 : 0  x < 0.9 : 1  0.9 < x < 1 : 1-->0  
	float hideCorners = smoothstep(1., 0.9, vUv.x);
	// begin: x < 0 : 0  x > 0.1 : 1  0 < x < 0.1 : 0--> 1
	float hideCorners1 = smoothstep(0., 0.1, vUv.x);
	
    // 这里的局部 color 遮蔽同名 uniform；实际气流基色取自下面写定的蓝色值。
	vec3 color = vec3(0.);
    // 叠加 4 条相位不同的曲线，在一片模型表面上形成多股流动细线。
	for (float idx = 0.; idx < 4.; idx += 1.){
			color += draw_line(uv,vec3(0.2,0.3,0.6),shift+idx,1.+freq_coef);
	}
	vec3 finalColor = mix(color,color * 0.25,vProgress);
    // opacity 由 World 的 GSAP 时间线控制，乘上首尾遮罩后得到整体淡入淡出。
	gl_FragColor = vec4(finalColor,opacity*hideCorners*hideCorners1);
}
