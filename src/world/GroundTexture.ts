import * as THREE from 'three';

/**
 * 지면의 표면 질감.
 *
 * 지형 색은 정점에 실려 있고 정점 간격은 0.85m 다. 그래서 멀리서는 그럴듯해도
 * 발밑을 보면 아무 무늬 없는 매끈한 그라데이션이다 — 땅이 아니라 천처럼 보인다.
 *
 * 정점을 늘려 해결하려면 격자를 수십 배로 키워야 하고, 그러면 물리와 메모리가
 * 같이 무너진다. 그래서 잔무늬는 텍스처로 옮긴다. 정점 색이 넓은 지역의
 * 색조를 정하고, 텍스처가 그 위에 자잘한 요철과 얼룩을 얹는 분담이다.
 *
 * 이미지 파일을 두지 않고 코드로 굽는다. 이어 붙였을 때 경계가 보이면 안 되므로
 * 격자 인덱스를 나머지 연산으로 감아 태생적으로 이어지는 잡음을 쓴다.
 */

const SIZE = 256;

/**
 * 감기는 값 잡음.
 *
 * 격자 한 변이 `lattice` 인 난수판을 만들고 부드럽게 보간한다.
 * 인덱스를 `% lattice` 로 감기 때문에 타일 경계가 저절로 맞는다.
 */
function tileableNoise(lattice: number, rand: () => number): (u: number, v: number) => number {
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const at = (i: number, j: number): number =>
    grid[(((j % lattice) + lattice) % lattice) * lattice + (((i % lattice) + lattice) % lattice)]!;

  // 3t²-2t³ — 가장자리에서 기울기가 0이라 격자 자국이 남지 않는다
  const fade = (t: number): number => t * t * (3 - 2 * t);

  return (u, v) => {
    const x = u * lattice;
    const y = v * lattice;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = fade(x - i);
    const fy = fade(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** 작은 난수 생성기 — 같은 시드는 항상 같은 무늬를 만든다 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTexture(data: Uint8Array, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // 비스듬히 보는 지면이 뭉개지지 않게 한다. 하드웨어 한도로 알아서 잘린다.
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface GroundTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

/**
 * 색·노멀·거칠기 세 장을 한 번에 굽는다.
 * 세 장 모두 같은 높이장에서 나오므로 얼룩과 요철이 서로 어긋나지 않는다.
 */
export function makeGroundTextures(seed: number): GroundTextures {
  const r = rng(seed);
  // 굵은 얼룩부터 잔모래까지 — 옥타브를 겹친다
  const octaves: Array<{ f: (u: number, v: number) => number; amp: number }> = [
    { f: tileableNoise(4, r), amp: 0.5 },
    { f: tileableNoise(8, r), amp: 0.26 },
    { f: tileableNoise(16, r), amp: 0.14 },
    { f: tileableNoise(32, r), amp: 0.07 },
    { f: tileableNoise(64, r), amp: 0.035 },
  ];

  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      let h = 0;
      let sum = 0;
      for (const o of octaves) {
        h += o.f(u, v) * o.amp;
        sum += o.amp;
      }
      height[y * SIZE + x] = h / sum;
    }
  }

  const colorData = new Uint8Array(SIZE * SIZE * 4);
  const normalData = new Uint8Array(SIZE * SIZE * 4);
  const roughData = new Uint8Array(SIZE * SIZE * 4);

  const at = (x: number, y: number): number =>
    height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)]!;

  // 요철의 세기. 크면 자갈밭, 작으면 다져진 흙.
  const RELIEF = 2.4;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const h = at(x, y);

      // ── 색: 정점 색에 곱해지는 값이다.
      //
      // 셰이더는 이 맵을 선형으로 되돌린 뒤 곱한다. 그래서 "보기에 회색"인 값을
      // 그대로 쓰면 지면 전체가 눈에 띄게 어두워진다. 선형에서 1.0 근처가 되도록
      // 잡은 뒤 sRGB 로 인코딩해서 넣어야 밝기가 흔들리지 않는다.
      const shadeLinear = Math.min(1, 0.88 + h * 0.15);
      const c = Math.round(clamp255(linearToSrgb(shadeLinear) * 255));
      colorData[i] = c;
      colorData[i + 1] = c;
      colorData[i + 2] = c;
      colorData[i + 3] = 255;

      // ── 노멀: 높이장의 기울기에서 뽑는다
      const dx = (at(x + 1, y) - at(x - 1, y)) * RELIEF;
      const dy = (at(x, y + 1) - at(x, y - 1)) * RELIEF;
      const len = Math.hypot(dx, dy, 1);
      normalData[i] = Math.round(clamp255(((-dx / len) * 0.5 + 0.5) * 255));
      normalData[i + 1] = Math.round(clamp255(((-dy / len) * 0.5 + 0.5) * 255));
      normalData[i + 2] = Math.round(clamp255((1 / len) * 0.5 * 255 + 127.5));
      normalData[i + 3] = 255;

      // ── 거칠기: 파인 곳은 먼지가 앉아 더 거칠다
      const rough = 0.86 + (1 - h) * 0.14;
      const rv = Math.round(clamp255(rough * 255));
      roughData[i] = rv;
      roughData[i + 1] = rv;
      roughData[i + 2] = rv;
      roughData[i + 3] = 255;
    }
  }

  return {
    map: makeTexture(colorData, true),
    normalMap: makeTexture(normalData, false),
    roughnessMap: makeTexture(roughData, false),
  };
}

/** 선형 값을 sRGB 로 인코딩한다 (three 가 map 을 읽을 때 되돌리는 것과 짝이다) */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
