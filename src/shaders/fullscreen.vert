// Full-screen quad: PlaneGeometry(2, 2) already spans clip space.
in vec3 position;
in vec2 uv;
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
