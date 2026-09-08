// 车身轮廓的片元着色器：计算每个片元的 RGB 颜色和 alpha 透明度。
// uniform 由 JS 传入；varying 来自顶点着色器，vTime 在每帧更新为经过的秒数。
uniform float vTime;
uniform vec3 color;
varying vec2 vUv;


// varying float vOpacity;
// 定义噪声函数
float random(vec2 st) {
	return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
void main() {
    // 沿线坐标与时间一起进入正弦函数，形成移动的亮暗波纹；12 控制空间频率，8 控制时间变化。
    // smoothstep 把指定区间平滑映射到 0～1；这里的 vProgress 是局部变量。
	float vProgress = smoothstep(-1.,1.,sin(vUv.x*12. + vTime*8.));
	vec3 finalColor = mix(color,color * 0.5,vProgress);

    // 两端透明度的设计意图是让线条柔和消失，避免硬切口。
    // 注意：原代码部分 smoothstep 的边界逆序，按 GLSL 规范结果未定义；规范写法用 1.-smoothstep(0.9,1.,vUv.x)。
	// end: x > 1 : 0  x < 0.9 : 1  0.9 < x < 1 : 1-->0  
	float hideCorners = smoothstep(1., 0.9, vUv.x);
	// begin: x < 0 : 0  x > 0.1 : 1  0 < x < 0.1 : 0--> 1
	float hideCorners1 = smoothstep(0., 0.1, vUv.x);

    // 最终颜色由位置和时间生成，下一行会覆盖前面基于 uniform color 计算的 finalColor。
	vec3 color2 = vec3(vUv.x + 0.1,1.- abs(sin(vTime*0.5))+ 0.1,abs(sin(vTime))+ 0.1);
	finalColor = mix(color2,color2 * 0.3,vProgress);
    // 以下噪声是保留的实验计算，nosie 没有参与最终输出。
	vec2 st = vUv;
	st = random(st)*st*500.;
	float nosie = (smoothstep(0.9,0.99,mod(st.x-vTime,1.))+smoothstep(0.2,0.1,mod(st.x-vTime,1.)));
    // vec4 的前三个分量是颜色，最后一个是透明度；加法混合由 JS 的材质设置控制。
	gl_FragColor = vec4(finalColor, hideCorners * hideCorners1);
}
