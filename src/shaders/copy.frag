// Final pass: upscale the internal render target to the output canvas.
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;

void main() {
  fragColor = vec4(texture(uSrc, vUv).rgb, 1.0);
}
