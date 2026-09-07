import * as THREE from 'three';
import { RENDER } from '../config';
import { GameTime } from '../core/GameTime';
import { clamp, lerp, smoothstep } from '../util/math';
import { Rng } from '../util/math';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uDaylight;
  uniform float uNight;

  varying vec3 vDir;

  void main() {
    float h = vDir.y;

    // 지평선 → 천정 그라데이션
    vec3 col = mix(uHorizon, uZenith, smoothstep(-0.04, 0.46, h));
    // 지평선 아래는 흙먼지에 잠긴다
    col = mix(col, uGround, smoothstep(0.0, -0.26, h));

    // 태양: 넓은 광륜 + 선명한 원반
    float sd = max(dot(vDir, uSunDir), 0.0);
    col += uSunColor * pow(sd, 6.0) * 0.16 * uDaylight;
    col += uSunColor * pow(sd, 64.0) * 0.42 * uDaylight;
    col += uSunColor * pow(sd, 1400.0) * 4.5;

    // 달: 창백한 원반과 옅은 무리
    float md = max(dot(vDir, uMoonDir), 0.0);
    col += vec3(0.70, 0.76, 0.92) * pow(md, 2600.0) * 3.0 * uNight;
    col += vec3(0.16, 0.21, 0.32) * pow(md, 24.0) * 0.30 * uNight;

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 시간대별 색 팔레트. 오염된 대기라 하늘이 맑지 않다 */
const PALETTE = {
  dayZenith: new THREE.Color(0x5d7ea6),
  dayHorizon: new THREE.Color(0xb3ab93),
  duskZenith: new THREE.Color(0x453f5e),
  duskHorizon: new THREE.Color(0xc4713f),
  nightZenith: new THREE.Color(0x080c17),
  nightHorizon: new THREE.Color(0x151d2c),

  sunHigh: new THREE.Color(0xfff1d8),
  sunLow: new THREE.Color(0xff8f42),
  moon: new THREE.Color(0x8296c6),
};

/**
 * 하늘, 태양·달 조명, 별, 그리고 대기 중을 떠다니는 잔류 포자.
 *
 * 조명은 그림자를 드리우는 keyLight 하나와 채움광 hemiLight 하나로 단순화했다.
 * 낮에는 태양 방향, 밤에는 달 방향을 쓴다.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.Fog;

  /** 렌더러 배경색으로도 쓰이는 현재 지평선 색 */
  readonly horizonColor = new THREE.Color();

  private readonly dome: THREE.Mesh;
  /** 환경맵 굽기 전용 축소판 돔 (같은 머티리얼을 공유한다) */
  private readonly envScene = new THREE.Scene();
  private pmrem?: THREE.PMREMGenerator;
  private envTarget?: THREE.WebGLRenderTarget;
  private envAccum = Infinity;
  private readonly uniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uGround: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uMoonDir: { value: THREE.Vector3 };
    uDaylight: { value: number };
    uNight: { value: number };
  };

  private readonly stars: THREE.Points;
  private readonly starMat: THREE.PointsMaterial;

  private readonly motes: THREE.Points;
  private readonly moteMat: THREE.PointsMaterial;
  private readonly motePos: Float32Array;
  private readonly moteVel: Float32Array;
  private static readonly MOTE_COUNT = 700;
  private static readonly MOTE_RANGE = 34;

  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();

  constructor() {
    this.group.name = 'sky';

    // ------------------------------------------------------------ 하늘 돔
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x5d7ea6) },
      uHorizon: { value: new THREE.Color(0xb3ab93) },
      uGround: { value: new THREE.Color(0x2a2822) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff1d8) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uDaylight: { value: 1 },
      uNight: { value: 0 },
    };

    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      // 톤 매핑은 후처리의 OutputPass가 전담한다. 여기서도 하면 두 번 적용된다.
      toneMapped: false,
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 20), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.group.add(this.dome);

    // 셰이더가 정규화된 방향만 쓰므로 축소판으로도 같은 하늘이 나온다.
    // PMREM의 기본 far 평면(100) 안에 들어와야 해서 반지름을 작게 잡는다.
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), domeMat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);

    // ------------------------------------------------------------ 별
    const starCount = 1600;
    const starPos = new Float32Array(starCount * 3);
    const rng = new Rng(9182736);
    for (let i = 0; i < starCount; i++) {
      // 상반구에 치우치게 분포시킨다 (지평선 아래 별은 어차피 안 보인다)
      const u = rng.range(-0.25, 1);
      const phi = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      starPos[i * 3] = Math.cos(phi) * r * 650;
      starPos[i * 3 + 1] = u * 650;
      starPos[i * 3 + 2] = Math.sin(phi) * r * 650;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xdfe6f2,
      size: 1.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.group.add(this.stars);

    // ------------------------------------------------------------ 잔류 포자
    const n = Sky.MOTE_COUNT;
    const range = Sky.MOTE_RANGE;
    this.motePos = new Float32Array(n * 3);
    this.moteVel = new Float32Array(n * 3);
    const mrng = new Rng(5150);
    for (let i = 0; i < n; i++) {
      this.motePos[i * 3] = mrng.range(-range, range);
      this.motePos[i * 3 + 1] = mrng.range(0, 14);
      this.motePos[i * 3 + 2] = mrng.range(-range, range);
      this.moteVel[i * 3] = mrng.range(-0.22, 0.22);
      this.moteVel[i * 3 + 1] = mrng.range(-0.06, 0.14);
      this.moteVel[i * 3 + 2] = mrng.range(-0.22, 0.22);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), range * 2);
    this.moteMat = new THREE.PointsMaterial({
      color: 0xc9d9a8,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: true,
    });
    this.motes = new THREE.Points(moteGeo, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    // ------------------------------------------------------------ 조명
    this.keyLight = new THREE.DirectionalLight(0xfff1d8, 2.6);
    this.keyLight.castShadow = true;
    const cam = this.keyLight.shadow.camera;
    const e = RENDER.shadowExtent;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = 260;
    this.keyLight.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.keyLight.shadow.bias = -0.0006;
    this.keyLight.shadow.normalBias = 0.035;
    this.group.add(this.keyLight);
    this.group.add(this.keyLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9db3c6, 0x554e42, 0.75);
    this.group.add(this.hemiLight);

    this.fog = new THREE.Fog(0xb3ab93, RENDER.fogNear, RENDER.fogFar);
  }

  /**
   * 하늘로부터 환경맵을 굽는다.
   *
   * 금속 재질(태양광 패널, 철골)은 환경 반사가 없으면 새까맣게 보인다.
   * 하늘 색이 시간에 따라 변하므로 주기적으로 다시 굽는다 — 매번 굽기엔 비싸고,
   * 한 번만 굽기엔 밤이 되어도 한낮의 반사가 남는다.
   */
  attachEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.refreshEnvironment(scene);
  }

  private refreshEnvironment(scene: THREE.Scene): void {
    if (!this.pmrem) return;
    const next = this.pmrem.fromScene(this.envScene);
    scene.environment = next.texture;
    this.envTarget?.dispose();
    this.envTarget = next;
    this.envAccum = 0;
  }

  /** 환경맵 재굽기 간격 (s) */
  private static readonly ENV_INTERVAL = 1.6;

  /**
   * @param focus 카메라/플레이어 위치 — 하늘과 그림자 절두체가 따라간다
   */
  update(time: GameTime, focus: THREE.Vector3, dt: number, scene?: THREE.Scene): void {
    const angle = time.sunAngle;
    const daylight = time.daylight;
    const night = 1 - daylight;
    const elev = time.sunElevation;

    // 태양은 동(+X)에서 떠서 서(-X)로 진다. Z 성분으로 궤도를 약간 기울인다.
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.32).normalize();
    this.moonDir.copy(this.sunDir).negate();

    // ---------------------------------------------------------- 하늘 색
    // 일출·일몰 부근에서 최대가 되는 종 모양 가중치
    const dusk = Math.exp(-(elev * elev) / 0.028);

    const zenith = this.uniforms.uZenith.value;
    zenith.copy(PALETTE.nightZenith).lerp(PALETTE.dayZenith, daylight);
    zenith.lerp(PALETTE.duskZenith, dusk * 0.75);

    const horizon = this.uniforms.uHorizon.value;
    horizon.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, daylight);
    horizon.lerp(PALETTE.duskHorizon, dusk * 0.85);

    this.uniforms.uGround.value
      .copy(horizon)
      .multiplyScalar(lerp(0.35, 0.55, daylight));

    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uMoonDir.value.copy(this.moonDir);
    this.uniforms.uDaylight.value = daylight;
    this.uniforms.uNight.value = night;

    const sunColor = this.uniforms.uSunColor.value;
    sunColor.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, smoothstep(0.02, 0.34, elev));

    this.horizonColor.copy(horizon);

    // ---------------------------------------------------------- 안개
    // 밤에는 안개를 조금 걷어 별과 실루엣이 보이게 한다
    this.fog.color.copy(horizon).multiplyScalar(lerp(0.62, 1.0, daylight));
    this.fog.near = lerp(RENDER.fogNear * 0.55, RENDER.fogNear, daylight);
    this.fog.far = lerp(RENDER.fogFar * 0.72, RENDER.fogFar, daylight);

    // ---------------------------------------------------------- 조명
    const isDayKey = elev > -0.05;
    const dir = isDayKey ? this.sunDir : this.moonDir;

    // 태양 고도가 낮을수록 어둡고 붉다
    const sunIntensity = smoothstep(-0.06, 0.26, elev) * 2.05;
    const moonIntensity = night * 0.58;

    if (isDayKey) {
      this.keyLight.color.copy(sunColor);
      this.keyLight.intensity = Math.max(sunIntensity, 0.02);
    } else {
      this.keyLight.color.copy(PALETTE.moon);
      this.keyLight.intensity = moonIntensity;
    }

    this.keyLight.target.position.copy(focus);
    this.keyLight.position.copy(focus).addScaledVector(dir, 110);
    this.keyLight.target.updateMatrixWorld();

    // 채움광: 낮에는 하늘빛, 밤에는 서늘한 푸른빛
    // 환경맵이 이미 확산광을 보태므로 세게 줄 필요가 없다
    this.hemiLight.intensity = lerp(0.36, 0.62, daylight);
    this.hemiLight.color.copy(zenith).lerp(new THREE.Color(0xa8bccd), daylight * 0.6);
    this.hemiLight.groundColor.copy(horizon).multiplyScalar(0.32);

    // ---------------------------------------------------------- 별
    this.starMat.opacity = clamp(night * night * 1.15 - 0.12, 0, 0.95);
    this.stars.rotation.y += dt * 0.0035;
    this.stars.rotation.z = 0.32;

    // ---------------------------------------------------------- 포자
    this.updateMotes(focus, dt, daylight);

    // 하늘과 별은 항상 카메라를 따라다닌다
    this.dome.position.copy(focus);
    this.stars.position.copy(focus);

    // ---------------------------------------------------------- 환경맵
    this.envAccum += dt;
    if (scene && this.envAccum >= Sky.ENV_INTERVAL) this.refreshEnvironment(scene);
  }

  /** 포자는 플레이어 주변 상자 안에서 순환한다 — 무한한 대기를 흉내내는 가장 싼 방법 */
  private updateMotes(focus: THREE.Vector3, dt: number, daylight: number): void {
    const n = Sky.MOTE_COUNT;
    const range = Sky.MOTE_RANGE;
    const pos = this.motePos;
    const vel = this.moteVel;

    // 절대 좌표로 관리하고, 플레이어에서 멀어지면 반대편으로 감는다
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      pos[ix]! += vel[ix]! * dt;
      pos[ix + 1]! += vel[ix + 1]! * dt;
      pos[ix + 2]! += vel[ix + 2]! * dt;

      const dx = pos[ix]! - focus.x;
      const dy = pos[ix + 1]! - focus.y;
      const dz = pos[ix + 2]! - focus.z;

      if (dx > range) pos[ix]! -= range * 2;
      else if (dx < -range) pos[ix]! += range * 2;

      if (dz > range) pos[ix + 2]! -= range * 2;
      else if (dz < -range) pos[ix + 2]! += range * 2;

      if (dy > 16) pos[ix + 1]! -= 20;
      else if (dy < -4) pos[ix + 1]! += 20;
    }

    (this.motes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.motes.position.set(0, 0, 0);

    // 밤에 포자가 옅게 발광한다 — 생체 EMP의 흔적
    this.moteMat.opacity = lerp(0.42, 0.22, daylight);
    this.moteMat.color.setRGB(
      lerp(0.62, 0.79, daylight),
      lerp(0.78, 0.85, daylight),
      lerp(0.58, 0.66, daylight),
    );
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.motes.geometry.dispose();
    this.moteMat.dispose();
  }
}
