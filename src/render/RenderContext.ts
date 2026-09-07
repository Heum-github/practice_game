import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA, RENDER } from '../config';

/**
 * 렌더러 · 씬 · 카메라의 수명 주기와 리사이즈를 관리한다.
 *
 * 후처리 파이프라인:
 *   RenderPass (MSAA 멀티샘플 타깃) → GTAO → OutputPass
 *
 * 앰비언트 오클루전이 형태 인식에 가장 크게 기여한다. 조명만으로는
 * 잔해가 땅에 "놓여" 있는지 "떠" 있는지가 읽히지 않는데, 접촉면의 그늘이
 * 생기는 순간 입체감이 살아난다.
 *
 * 톤 매핑과 색공간 변환은 마지막 OutputPass가 전담한다 —
 * 중간 타깃은 전부 선형이어야 AO가 밝기를 올바로 읽는다.
 */
export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private composer!: EffectComposer;
  private gtao!: GTAOPass;
  private postEnabled: boolean = RENDER.postProcessing;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      // 후처리를 쓰면 캔버스 MSAA는 무시된다. 멀티샘플 렌더 타깃이 대신한다.
      antialias: !RENDER.postProcessing,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.canvas = this.renderer.domElement;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

    if (this.postEnabled) this.buildComposer();

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private buildComposer(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    // 멀티샘플 타깃 — 후처리를 쓰면서도 가장자리 계단을 없앤다
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: RENDER.msaaSamples,
    });

    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.updateGtaoMaterial({
      radius: RENDER.aoRadius,
      distanceExponent: 1.0,
      thickness: 1.0,
      scale: RENDER.aoScale,
      samples: 16,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    this.composer.addPass(this.gtao);

    // 톤 매핑 + sRGB 변환은 여기서 한 번만
    this.composer.addPass(new OutputPass());
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.postEnabled) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(w, h);
      this.gtao.setSize(w * ratio, h * ratio);
    }
  };

  render(): void {
    // 후처리는 여러 패스를 돌린다. 자동 리셋을 그대로 두면 통계가
    // 마지막 전체화면 쿼드 하나만 남아 아무 의미가 없다 — 프레임 시작에 직접 비운다.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();

    if (this.postEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** 성능이 부족한 기기를 위한 탈출구 — 개발 훅에서 끌 수 있다 */
  setPostProcessing(on: boolean): void {
    if (on === this.postEnabled) return;
    if (on && !this.composer) this.buildComposer();
    this.postEnabled = on;
    this.resize();
  }

  get postProcessingEnabled(): boolean {
    return this.postEnabled;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.composer?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
