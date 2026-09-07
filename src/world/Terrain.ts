import * as THREE from 'three';
import { makeGroundTextures } from './GroundTexture';
import { FARM, WORLD } from '../config';
import { Noise2D } from '../util/noise';
import { clamp, lerp, smoothstep } from '../util/math';

/**
 * 지형 팔레트.
 *
 * 반드시 16진(sRGB)으로 적는다. three.js는 Color의 실수 인자를 선형 값으로 해석하므로
 * 눈으로 고른 밝기를 그대로 쓰면 두 배 가까이 밝게 렌더된다.
 */
const CONCRETE_COLOR = new THREE.Color(0x73756b);
const PANEL_COLOR = new THREE.Color(0x2b323d);
const RUST_COLOR = new THREE.Color(0x6b3f24);
const CRACK_COLOR = new THREE.Color(0x2a2b28);
const SOIL_COLOR = new THREE.Color(0x4a3a26);
/** 밭이 되는 땅. 문턱을 넘으면 확실히 짙어져 멀리서도 구분된다 */
const RICH_SOIL_COLOR = new THREE.Color(0x3a3318);

/**
 * 폐허가 된 대지.
 *
 * 세계관 반영 (GAME_PLANNING 2.1):
 *  - AI가 흙을 걷어내고 덮은 금속 패널과 콘크리트가 지표를 이룬다.
 *  - 원점에는 폭발로 무너진 인류 보존 구역의 분화구가 있다. 플레이어는 여기서 눈을 뜬다.
 *  - 흙은 콘크리트가 갈라진 극소수 지점에만 남아 있다 → sampleSoilRichness 로 노출한다.
 *
 * 렌더 지오메트리와 높이 샘플링이 정확히 같은 삼각형 분할을 쓰기 때문에
 * 캐릭터가 지면에 떠 있거나 파묻히는 일이 없다.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly size: number;
  readonly cellSize: number;
  /** 한 변의 격자 칸 수 */
  readonly segments: number;
  /** 월드 좌표계의 최소 모서리 */
  readonly originX: number;
  readonly originZ: number;

  private readonly heights: Float32Array;
  private readonly soil: Float32Array;

  private readonly noise: Noise2D;
  private readonly detailNoise: Noise2D;
  private readonly soilNoise: Noise2D;

  constructor(seed = WORLD.seed) {
    this.size = WORLD.size;
    this.cellSize = WORLD.cellSize;
    this.segments = Math.round(this.size / this.cellSize);
    this.originX = -this.size / 2;
    this.originZ = -this.size / 2;

    this.noise = new Noise2D(seed);
    this.detailNoise = new Noise2D(seed + 977);
    this.soilNoise = new Noise2D(seed + 4231);

    const dim = this.segments + 1;
    this.heights = new Float32Array(dim * dim);
    this.soil = new Float32Array(dim * dim);

    this.buildFields();
    this.mesh = this.buildMesh();
  }

  // ---------------------------------------------------------------- 높이 함수

  /** 격자와 무관한 연속 높이 함수. 지형 생성에만 쓰고, 런타임 조회는 sampleHeight를 쓴다 */
  private heightAt(x: number, z: number): number {
    // 1. 완만한 기복
    const rolling = this.noise.fbm(x * 0.0105, z * 0.0105, 4) * 3.0;

    // 2. 포장 슬래브 — 깨진 판이 계단처럼 층을 이룬다.
    //
    // 예전에는 이 혼합을 0.92까지 밀어 넓은 면이 수학적으로 완전히 평평했다.
    // 각진 셰이딩에서는 면마다 색이 흔들려 가려졌지만, 매끄러운 셰이딩으로
    // 바꾸자 균일한 밝기 덩어리가 화면을 가르는 띠로 드러났다.
    // 슬래브의 인상은 남기되 완전한 평면은 만들지 않는다.
    const slabStep = 1.15;
    const slab = Math.round(rolling / slabStep) * slabStep;
    const intact = smoothstep(-0.08, 0.42, this.detailNoise.fbm(x * 0.028, z * 0.028, 2));
    let h = lerp(rolling, slab, intact * 0.55);

    // 3. 잔해 능선 — 무너진 구조물이 쌓여 만든 등성이
    const ridge = this.detailNoise.ridged(x * 0.034, z * 0.034, 3);
    h += (ridge - 0.42) * 2.6 * (1 - intact * 0.5);

    // 3b. 중간 규모의 기복 — 슬래브가 통째로 기울어 평면이 생기지 않게 한다
    h += this.noise.fbm(x * 0.072, z * 0.072, 2) * 0.62;

    // 4. 보존 구역 폭발 분화구 (원점)
    h += this.craterProfile(Math.hypot(x, z));

    // 5. 월드 경계 — 잔해 둔덕으로 막아 지평선의 끝을 감춘다
    const m = Math.max(Math.abs(x), Math.abs(z));
    const half = this.size / 2;
    const edge = smoothstep(half - 30, half - 3, m);
    h += edge * edge * 11;

    // 6. 미세 요철 — 격자가 촘촘해진 만큼 더 잘게 나눈다
    h += this.detailNoise.noise(x * 0.19, z * 0.19) * 0.2;
    h += this.detailNoise.noise(x * 0.47, z * 0.47) * 0.085;
    h += this.soilNoise.noise(x * 1.05, z * 1.05) * 0.03;

    return h;
  }

  private craterProfile(d: number): number {
    if (d > 52) return 0;
    // 중심부 사발
    const bowl = -3.6 * (1 - smoothstep(3, 32, d));
    // 융기된 테두리
    const rimT = Math.exp(-((d - 34) * (d - 34)) / 118);
    return bowl + 2.2 * rimT;
  }

  /**
   * 흙이 남아 있을 확률 (0..1).
   * 갈라진 틈과 분화구 주변, 즉 콘크리트가 깨진 곳에만 흙이 있다.
   */
  private soilAt(x: number, z: number): number {
    const patch = this.soilNoise.fbm(x * 0.019, z * 0.019, 3);
    // 상위 구간만 흙으로 — 희소성이 이 게임의 자원 경제다.
    // 다만 너무 조이면 월드 전체에 몇 곳밖에 남지 않아 농사가 성립하지 않는다.
    let v = smoothstep(0.16, 0.5, patch);

    // 분화구 안쪽은 보존 구역의 인공 토양이 흩어져 있어 상대적으로 풍부하다.
    // 시작 지점이므로 첫 농사를 지을 만큼은 보장한다.
    const d = Math.hypot(x, z);
    v = Math.max(v, smoothstep(30, 6, d) * 0.78);

    return clamp(v, 0, 1);
  }

  private buildFields(): void {
    const dim = this.segments + 1;
    for (let j = 0; j < dim; j++) {
      const z = this.originZ + j * this.cellSize;
      for (let i = 0; i < dim; i++) {
        const x = this.originX + i * this.cellSize;
        const idx = j * dim + i;
        this.heights[idx] = this.heightAt(x, z);
        this.soil[idx] = this.soilAt(x, z);
      }
    }
  }

  // ---------------------------------------------------------------- 지오메트리

  /**
   * 지형 메시.
   *
   * 인덱스 지오메트리로 만들어 정점을 공유한다 — 공유된 정점의 노멀은
   * 주변 면의 평균이 되므로 표면이 부드럽게 이어진다.
   * 비인덱스 + flatShading으로 만들던 각진 면이 "픽셀이 크다"는 인상의 주범이었다.
   *
   * 대신 색은 정점마다 계산해 보간시킨다. 콘크리트·금속 패널·흙의 경계가
   * 면 단위로 끊기지 않고 자연스럽게 섞인다.
   *
   * 삼각형 분할(대각선 B–C)은 그대로 유지한다 — sampleHeight()가 이 분할에 의존한다.
   */
  private buildMesh(): THREE.Mesh {
    const n = this.segments;
    const dim = n + 1;
    const cell = this.cellSize;

    const vertCount = dim * dim;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    // 표면 텍스처용 UV. 월드 미터를 그대로 넣고 반복 횟수로 타일 크기를 정한다.
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint32Array(n * n * 6);

    const color = new THREE.Color();

    for (let j = 0; j < dim; j++) {
      for (let i = 0; i < dim; i++) {
        const idx = j * dim + i;
        const x = this.originX + i * cell;
        const z = this.originZ + j * cell;
        const h = this.heights[idx]!;

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;

        uvs[idx * 2] = x - this.originX;
        uvs[idx * 2 + 1] = z - this.originZ;

        this.vertexColor(color, x, z, h, this.slopeAt(i, j));
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
      }
    }

    let t = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * dim + i;
        const b = j * dim + i + 1;
        const c = (j + 1) * dim + i;
        const d = (j + 1) * dim + i + 1;
        // 삼각형 1: A, C, B  /  삼각형 2: B, C, D
        indices[t++] = a;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals(); // 정점 공유 → 부드러운 노멀
    geo.computeBoundingSphere();

    // 표면 질감.
    //
    // 정점 색이 넓은 지역의 색조를 정하고, 이 맵들이 그 위에 자잘한 요철을 얹는다.
    // 노멀맵이 실제 일을 한다 — 빛이 닿는 각도가 픽셀마다 달라지면서
    // 평평한 삼각형이 오톨도톨한 땅으로 보인다.
    const ground = makeGroundTextures(WORLD.seed);
    const TILE = 3; // 텍스처 한 장이 덮는 크기 (m)
    for (const tex of [ground.map, ground.normalMap, ground.roughnessMap]) {
      tex.repeat.set(1 / TILE, 1 / TILE);
    }

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      map: ground.map,
      normalMap: ground.normalMap,
      roughnessMap: ground.roughnessMap,
      // 요철의 세기. 더 키우면 자갈밭처럼 보이지만 멀리서 지글거린다.
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 1,
      metalness: 0.02,
      dithering: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    // 지형은 그림자를 받기만 한다. 200m 지면이 46m 그림자 절두체 안에서
    // 자기 자신에게 그림자를 던지면 절두체 경계가 화면을 가르는 띠로 드러난다.
    mesh.castShadow = false;
    mesh.name = 'terrain';
    return mesh;
  }

  /** 격자점 주변의 기울기 (0=평지, 1=수직에 가까움) */
  private slopeAt(i: number, j: number): number {
    const c = this.cellSize;
    const dx = (this.heightIndex(i + 1, j) - this.heightIndex(i - 1, j)) / (2 * c);
    const dz = (this.heightIndex(i, j + 1) - this.heightIndex(i, j - 1)) / (2 * c);
    return clamp(Math.hypot(dx, dz) / 1.6, 0, 1);
  }

  /**
   * 폐허 팔레트.
   * 콘크리트 회색 바탕에 AI가 깔았던 금속 패널, 녹슨 철골, 그리고 극소량의 흙.
   */
  private vertexColor(
    out: THREE.Color,
    x: number,
    z: number,
    h: number,
    slope: number,
  ): void {
    const soil = this.soil[this.clampIndex(x, z)]!;
    const panel = smoothstep(0.28, 0.52, this.detailNoise.fbm(x * 0.055, z * 0.055, 2));
    const rust = smoothstep(0.42, 0.7, this.soilNoise.fbm(x * 0.09 + 40, z * 0.09 - 15, 2));

    // 바탕: 콘크리트 — 따뜻한 흙빛이 아니라 차갑고 죽은 회색이어야 한다
    out.copy(CONCRETE_COLOR);

    // 높은 곳은 바래고 낮은 곳은 그늘져 어둡다
    out.multiplyScalar(clamp(0.84 + h * 0.016, 0.66, 1.05));

    // AI의 금속 패널 — 차갑고 어두운 청회색
    if (panel > 0) out.lerp(PANEL_COLOR, panel * 0.86);

    // 녹슨 철골 노출
    if (rust > 0) out.lerp(RUST_COLOR, rust * 0.5);

    // 갈라진 틈 — 경사면은 파단면이라 어둡다
    out.lerp(CRACK_COLOR, slope * 0.72);

    // 흙 — 이 세계에서 가장 귀한 것
    // 흙 — 이 세계에서 가장 귀한 것.
    //
    // 완만한 그라데이션으로만 두면 어디가 밭이 되는 땅인지 화면으로는 알 수 없다.
    // 밭을 놓을 수 있는 비옥도를 넘는 순간 눈에 띄게 짙어지도록 문턱을 세운다.
    if (soil > 0.02) {
      out.lerp(SOIL_COLOR, soil * 0.55);
      const usable = smoothstep(FARM.minFertility - 0.06, FARM.minFertility + 0.1, soil);
      if (usable > 0) out.lerp(RICH_SOIL_COLOR, usable * 0.6);
    }

    // 미세한 얼룩 — 넓은 면이 단색으로 밋밋해지는 것을 막는다
    const grain = 1 + this.detailNoise.noise(x * 0.63, z * 0.63) * 0.045;
    out.multiplyScalar(grain);
  }

  private clampIndex(x: number, z: number): number {
    const dim = this.segments + 1;
    const i = clamp(Math.round((x - this.originX) / this.cellSize), 0, this.segments);
    const j = clamp(Math.round((z - this.originZ) / this.cellSize), 0, this.segments);
    return j * dim + i;
  }

  // ---------------------------------------------------------------- 샘플링 API

  private heightIndex(i: number, j: number): number {
    const dim = this.segments + 1;
    const ci = clamp(i, 0, this.segments);
    const cj = clamp(j, 0, this.segments);
    return this.heights[cj * dim + ci]!;
  }

  /**
   * 렌더된 삼각형 표면의 정확한 높이.
   * buildMesh()의 분할(대각선 B–C)과 동일한 보간을 쓴다.
   */
  sampleHeight(x: number, z: number): number {
    const fi = (x - this.originX) / this.cellSize;
    const fj = (z - this.originZ) / this.cellSize;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;

    const hA = this.heightIndex(i, j);
    const hB = this.heightIndex(i + 1, j);
    const hC = this.heightIndex(i, j + 1);
    const hD = this.heightIndex(i + 1, j + 1);

    if (u + v <= 1) {
      // 삼각형 A(0,0) B(1,0) C(0,1)
      return hA + u * (hB - hA) + v * (hC - hA);
    }
    // 삼각형 D(1,1) C(0,1) B(1,0)
    return hD + (1 - u) * (hC - hD) + (1 - v) * (hB - hD);
  }

  /**
   * 손으로 세운 구조물의 뼈대를 앉힐 기준 높이 (기획서 8.3).
   *
   * **건물은 딱딱한데 땅은 아니다.** 중심 한 점만 재서 통째로 앉히면, 기복이
   * 3m 인 자리에서 한쪽 벽은 땅에 완전히 파묻히고 반대쪽은 허공에 뜬다 —
   * 화면에는 건물이 통째로 안 보이고, 콜라이더는 땅속이라 벽을 그냥 통과한다.
   * 평탄한 자리를 찾는 것은 답이 아니다. 이 잔해밭에서 가장 나은 곳도
   * 14×22m 안에서 2.33m 가 출렁인다 — 평지는 없다.
   *
   * 그래서 **발자국 안의 가장 높은 지점**을 돌려준다. 뼈대를 여기에 수평으로
   * 고정하면 어디도 파묻히지 않고, 땅에 닿는 것(벽·기둥)만 구간마다 제 발밑을
   * 다시 재어 내려보내면 뜨지도 않는다.
   */
  deckHeight(cx: number, cz: number, width: number, depth: number, step = 2.2): number {
    let top = -Infinity;
    for (let z = cz - depth / 2; z <= cz + depth / 2; z += step) {
      for (let x = cx - width / 2; x <= cx + width / 2; x += step) {
        top = Math.max(top, this.sampleHeight(x, z));
      }
    }
    return top;
  }

  /** 해당 지점 삼각형의 면 노멀 (경사 판정용) */
  sampleNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.cellSize;
    const fi = (x - this.originX) / c;
    const fj = (z - this.originZ) / c;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;

    const hA = this.heightIndex(i, j);
    const hB = this.heightIndex(i + 1, j);
    const hC = this.heightIndex(i, j + 1);
    const hD = this.heightIndex(i + 1, j + 1);

    let dhdx: number;
    let dhdz: number;
    if (u + v <= 1) {
      dhdx = (hB - hA) / c;
      dhdz = (hC - hA) / c;
    } else {
      dhdx = (hD - hC) / c;
      dhdz = (hD - hB) / c;
    }
    return out.set(-dhdx, 1, -dhdz).normalize();
  }

  /** 이 지점에서 채집 가능한 흙의 양 (0..1). v0.2 자원 시스템이 쓸 API */
  sampleSoilRichness(x: number, z: number): number {
    return this.soil[this.clampIndex(x, z)]!;
  }

  /** 월드 경계 안으로 좌표를 가둔다 */
  clampToWorld(v: THREE.Vector3, margin = 4): void {
    const half = this.size / 2 - margin;
    v.x = clamp(v.x, -half, half);
    v.z = clamp(v.z, -half, half);
  }

  /**
   * 광선을 따라 지형과 처음 만나는 거리. 없으면 Infinity.
   * 정밀 교차 대신 행진 샘플링 — 카메라 충돌 용도로는 충분하고 훨씬 싸다.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, step = 0.35): number {
    let t = step;
    while (t < maxDist) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (y < this.sampleHeight(x, z)) return t;
      t += step;
    }
    return Infinity;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
