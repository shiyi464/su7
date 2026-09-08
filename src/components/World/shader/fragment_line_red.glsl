// 红色轮廓材质：使用 JS 传入的 color，并随时间在原色与较暗的颜色之间变化。
uniform float vTime;
uniform vec3 color;
varying vec2 vUv;


// varying float vOpacity;
// 定义噪声函数
float random(vec2 st) {
	return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
void main() {
    // 与普通轮廓原理相同，这里的时间系数为 12，让亮暗波纹变化得更快。
	float vProgress = smoothstep(-1.,1.,sin(vUv.x*12. + vTime*12.));
	vec3 finalColor = mix(color,color * 0.0,vProgress);
    // 两端淡出的意图与普通轮廓相同；逆序 smoothstep 边界在规范中未定义，原表达式保留。
	// end: x > 1 : 0  x < 0.9 : 1  0.9 < x < 1 : 1-->0  
	float hideCorners = smoothstep(1., 0.9, vUv.x);
	// begin: x < 0 : 0  x > 0.1 : 1  0 < x < 0.1 : 0--> 1
	float hideCorners1 = smoothstep(0., 0.1, vUv.x);
    // mix(a,b,t) 按 t 在两种颜色间插值；此赋值覆盖上面第一次计算的 finalColor。
	finalColor = mix(color,color * 0.25,vProgress);
    // 噪声实验结果 nosie 未用于输出，因此目前不影响显示。
	vec2 st = vUv;
	st = random(st)*st*500.;
	float nosie = (smoothstep(0.9,0.99,mod(st.x-vTime,1.))+smoothstep(0.2,0.1,mod(st.x-vTime,1.)));
    // 透明度仅来自首尾遮罩；JS 中设置的 opacity uniform 当前没有在本文件中使用。
	gl_FragColor = vec4(finalColor, hideCorners * hideCorners1);
}
