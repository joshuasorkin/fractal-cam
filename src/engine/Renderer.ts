// GPU side: one full-screen quad, one material per effect, two ping-pong render
// targets for feedback, and a cheap copy pass that scales the internal render
// to the fixed-size output canvas. All GPU resources are allocated up front.

import * as THREE from 'three';
import vertexShader from '../shaders/fullscreen.vert?raw';
import copyShader from '../shaders/copy.frag?raw';
import { EFFECT_SHADERS } from './effects';
import { EFFECT_IDS, type EffectId, type EffectParams } from '../params/params';
import type { Palette } from '../params/palettes';
import type { CamUV } from './cameraMapping';

THREE.ColorManagement.enabled = false;

export interface FrameUniforms {
  time: number;
  params: EffectParams;
  palette: Palette;
  camUV: CamUV;
  motion: number;
  motionPos: [number, number];
  face: [number, number, number, number]; // mouth, brow, smile, present
  head: [number, number, number]; // yaw, pitch, roll
  facePos: [number, number, number];
  pulse: [number, number, number, number];
  hands: [number, number, number, number];
  pose: [number, number];
}

export class WebGLUnavailableError extends Error {}

function makeUniforms() {
  return {
    uCam: { value: null as THREE.Texture | null },
    uPrev: { value: null as THREE.Texture | null },
    uMotionTex: { value: null as THREE.Texture | null },
    uCamUV: { value: new THREE.Vector4(1, 1, 0, 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uComplexity: { value: 6 },
    uDistortion: { value: 1 },
    uSaturation: { value: 1 },
    uCamMix: { value: 0.5 },
    uFeedback: { value: 0.5 },
    uPalA: { value: new THREE.Vector3() },
    uPalB: { value: new THREE.Vector3() },
    uPalC: { value: new THREE.Vector3() },
    uPalD: { value: new THREE.Vector3() },
    uMotion: { value: 0 },
    uMotionPos: { value: new THREE.Vector2(0.5, 0.5) },
    uFace: { value: new THREE.Vector4() },
    uHead: { value: new THREE.Vector3() },
    uFacePos: { value: new THREE.Vector3(0.5, 0.5, 0.4) },
    uPulse: { value: new THREE.Vector4(0.5, 0.6, 0, 0) },
    uHands: { value: new THREE.Vector4(0.3, 0.2, 0.7, 0.2) },
    uPose: { value: new THREE.Vector2() },
  };
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly outputWidth: number;
  readonly outputHeight: number;
  renderWidth = 0;
  renderHeight = 0;
  readonly shaderErrors: string[] = [];
  contextLost = false;

  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;
  private uniforms = makeUniforms();
  private materials: Record<EffectId, THREE.RawShaderMaterial>;
  private copyMaterial: THREE.RawShaderMaterial;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private placeholder: THREE.DataTexture;
  private videoTexture: THREE.VideoTexture | null = null;
  private motionTexture: THREE.DataTexture;

  constructor(
    readonly canvas: HTMLCanvasElement,
    outputWidth: number,
    outputHeight: number,
    motionMap: { data: Uint8Array; width: number; height: number },
  ) {
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    try {
      this.gl = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (err) {
      throw new WebGLUnavailableError(`WebGL2 is not available: ${(err as Error).message}`);
    }
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.gl.setSize(outputWidth, outputHeight, false);
    this.gl.autoClear = false;
    this.gl.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (s: WebGLShader) => gl.getShaderInfoLog(s)?.trim();
      this.shaderErrors.push([gl.getProgramInfoLog(program)?.trim(), log(vs), log(fs)].filter(Boolean).join('\n'));
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.placeholder = new THREE.DataTexture(new Uint8Array([12, 10, 20, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.uniforms.uCam.value = this.placeholder;

    this.motionTexture = new THREE.DataTexture(motionMap.data, motionMap.width, motionMap.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.motionTexture.minFilter = this.motionTexture.magFilter = THREE.LinearFilter;
    this.motionTexture.needsUpdate = true;
    this.uniforms.uMotionTex.value = this.motionTexture;

    const makeMaterial = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });
    this.materials = Object.fromEntries(EFFECT_IDS.map((id) => [id, makeMaterial(EFFECT_SHADERS[id], this.uniforms)])) as Record<
      EffectId,
      THREE.RawShaderMaterial
    >;
    this.copyMaterial = makeMaterial(copyShader, { uSrc: { value: null } });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const rt = () =>
      new THREE.WebGLRenderTarget(1, 1, {
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        type: THREE.UnsignedByteType,
      });
    this.targets = [rt(), rt()];
    this.setRenderScale(1);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = () => {
    this.contextLost = false;
  };

  setRenderScale(scale: number) {
    const w = Math.max(64, Math.round((this.outputWidth * scale) / 2) * 2);
    const h = Math.max(36, Math.round((this.outputHeight * scale) / 2) * 2);
    if (w === this.renderWidth && h === this.renderHeight) return;
    this.renderWidth = w;
    this.renderHeight = h;
    for (const t of this.targets) t.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
  }

  setVideo(video: HTMLVideoElement | null) {
    this.videoTexture?.dispose();
    this.videoTexture = null;
    if (video) {
      const tex = new THREE.VideoTexture(video);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.videoTexture = tex;
    }
    this.uniforms.uCam.value = this.videoTexture ?? this.placeholder;
  }

  markMotionDirty() {
    this.motionTexture.needsUpdate = true;
  }

  /** Force-compile and run every effect once so shader errors surface at startup. */
  compileAll(): string[] {
    for (const id of EFFECT_IDS) this.renderEffect(id);
    this.gl.setRenderTarget(null);
    return this.shaderErrors;
  }

  private renderEffect(effect: EffectId) {
    const [read, write] = this.targets;
    this.uniforms.uPrev.value = read.texture;
    this.mesh.material = this.materials[effect];
    this.gl.setRenderTarget(write);
    this.gl.render(this.scene, this.camera);
    this.targets = [write, read];
  }

  render(effect: EffectId, f: FrameUniforms) {
    if (this.contextLost) return;
    const u = this.uniforms;
    u.uTime.value = f.time;
    u.uIntensity.value = f.params.intensity;
    u.uComplexity.value = f.params.complexity;
    u.uDistortion.value = f.params.distortion;
    u.uSaturation.value = f.params.saturation;
    u.uCamMix.value = f.params.camMix;
    u.uFeedback.value = f.params.feedback;
    u.uPalA.value.fromArray(f.palette.a);
    u.uPalB.value.fromArray(f.palette.b);
    u.uPalC.value.fromArray(f.palette.c);
    u.uPalD.value.fromArray(f.palette.d);
    u.uCamUV.value.set(f.camUV.scaleX, f.camUV.scaleY, f.camUV.offsetX, f.camUV.offsetY);
    u.uMotion.value = f.motion;
    u.uMotionPos.value.fromArray(f.motionPos);
    u.uFace.value.fromArray(f.face);
    u.uHead.value.fromArray(f.head);
    u.uFacePos.value.fromArray(f.facePos);
    u.uPulse.value.fromArray(f.pulse);
    u.uHands.value.fromArray(f.hands);
    u.uPose.value.fromArray(f.pose);

    this.renderEffect(effect);

    // Copy (and upscale) the freshly written target to the canvas.
    this.copyMaterial.uniforms.uSrc.value = this.targets[0].texture;
    this.mesh.material = this.copyMaterial;
    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
  }

  /** Read back a few pixels of the latest frame (used by automated tests). */
  sample(): { mean: [number, number, number]; variance: number } {
    const w = this.renderWidth;
    const h = this.renderHeight;
    const buf = new Uint8Array(w * h * 4);
    this.gl.readRenderTargetPixels(this.targets[0], 0, 0, w, h, buf);
    const n = w * h;
    let r = 0, g = 0, b = 0, sq = 0;
    for (let i = 0; i < buf.length; i += 4) {
      r += buf[i];
      g += buf[i + 1];
      b += buf[i + 2];
      const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      sq += l * l;
    }
    const mean: [number, number, number] = [r / n, g / n, b / n];
    const ml = (mean[0] + mean[1] + mean[2]) / 3;
    return { mean, variance: sq / n - ml * ml };
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.videoTexture?.dispose();
    this.placeholder.dispose();
    this.motionTexture.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.copyMaterial.dispose();
    this.mesh.geometry.dispose();
    for (const t of this.targets) t.dispose();
    this.gl.dispose();
  }
}
