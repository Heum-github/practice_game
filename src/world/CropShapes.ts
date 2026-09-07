import * as THREE from 'three';

/**
 * 작물의 성장 단계별 형상.
 *
 * 작물이 원뿔 하나로 커지기만 하면 농사가 눈에 보이지 않는다.
 * 밭에 뭘 심었는지, 얼마나 자랐는지, 거둘 때가 됐는지를
 * 플레이어가 화면만 보고 알 수 있어야 한다.
 *
 * 그래서 단계마다 아예 다른 형상을 쓴다.
 *   0 새싹 — 땅에 붙은 짧은 떡잎 몇 장
 *   1 잎   — 길게 선 잎이 벌어진다
 *   2 이삭 — 잎 사이로 이삭이 서고, 색이 누렇게 익는다
 *
 * 색은 정점에 실어 보낸다. 한 재질로 초록 잎과 누런 이삭을 같이 그리려면
 * 그 방법뿐이다 (인스턴싱이라 재질을 나눌 수 없다).
 */

const LEAF = new THREE.Color(0x6f9440);
const LEAF_DARK = new THREE.Color(0x54763a);
const STALK = new THREE.Color(0x7d9a4b);
const EAR = new THREE.Color(0xc2a24e);

interface Build {
  pos: number[];
  col: number[];
  idx: number[];
}

/**
 * 잎 한 장. 밑동에서 끝으로 갈수록 좁아지고 바깥으로 휜다.
 *
 * @param azimuth 어느 방향으로 뻗는지 (rad)
 * @param length 길이
 * @param width 밑동 폭
 * @param droop 끝이 아래로 처지는 정도
 */
function blade(
  b: Build,
  azimuth: number,
  length: number,
  width: number,
  droop: number,
  color: THREE.Color,
  baseY = 0,
): void {
  const SEG = 5;
  const dirX = Math.cos(azimuth);
  const dirZ = Math.sin(azimuth);
  // 잎의 폭 방향 (수평면에서 뻗는 방향과 직각)
  const sideX = -dirZ;
  const sideZ = dirX;

  const start = b.pos.length / 3;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    // 위로 솟았다가 끝이 처진다
    const y = baseY + length * (t * 1.15 - droop * t * t);
    const out = length * 0.62 * t * t;
    const w = width * (1 - t) * (1 - t * 0.3);
    const cx = dirX * out;
    const cz = dirZ * out;
    b.pos.push(cx - sideX * w, y, cz - sideZ * w);
    b.pos.push(cx + sideX * w, y, cz + sideZ * w);
    // 끝으로 갈수록 살짝 어두워진다
    const c = color.clone().lerp(LEAF_DARK, t * 0.45);
    b.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i < SEG; i++) {
    const a = start + i * 2;
    b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    // 뒷면도 그린다 — 얇은 잎이라 뒤에서 보면 사라지면 안 된다
    b.idx.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
  }
}

/** 곧게 선 대 — 이삭을 받친다 */
function stalk(b: Build, x: number, z: number, height: number, color: THREE.Color): void {
  const r = 0.013;
  const start = b.pos.length / 3;
  const SIDES = 4;
  for (let level = 0; level < 2; level++) {
    const y = level === 0 ? 0 : height;
    const rr = level === 0 ? r : r * 0.7;
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      b.pos.push(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr);
      b.col.push(color.r, color.g, color.b);
    }
  }
  for (let j = 0; j < SIDES; j++) {
    const k = (j + 1) % SIDES;
    b.idx.push(start + j, start + SIDES + j, start + k);
    b.idx.push(start + k, start + SIDES + j, start + SIDES + k);
  }
}

/** 이삭 — 대 끝에 달린 알갱이 덩어리 */
function ear(b: Build, x: number, z: number, y: number, len: number): void {
  const start = b.pos.length / 3;
  const SIDES = 5;
  const rings: Array<[number, number]> = [
    [0, 0.018],
    [len * 0.3, 0.042],
    [len * 0.68, 0.038],
    [len, 0.009],
  ];
  for (const [dy, r] of rings) {
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      b.pos.push(x + Math.cos(a) * r, y + dy, z + Math.sin(a) * r);
      b.col.push(EAR.r, EAR.g, EAR.b);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = start + i * SIDES;
    const c = start + (i + 1) * SIDES;
    for (let j = 0; j < SIDES; j++) {
      const k = (j + 1) % SIDES;
      b.idx.push(a + j, c + j, a + k, a + k, c + j, c + k);
    }
  }
}

function finish(b: Build): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setIndex(b.idx);
  geo.computeVertexNormals();
  return geo;
}

/** 0 새싹 · 1 잎 · 2 이삭 순서의 형상 셋 */
export function cropStages(): THREE.BufferGeometry[] {
  // ── 새싹: 땅에 붙은 떡잎 셋
  const a: Build = { pos: [], col: [], idx: [] };
  for (let i = 0; i < 3; i++) {
    blade(a, (i / 3) * Math.PI * 2 + 0.4, 0.17, 0.034, 0.55, LEAF);
  }

  // ── 잎: 길게 선 잎이 벌어진다
  const c: Build = { pos: [], col: [], idx: [] };
  for (let i = 0; i < 6; i++) {
    const az = (i / 6) * Math.PI * 2 + 0.25;
    blade(c, az, 0.46 + (i % 2) * 0.09, 0.05, 0.42, LEAF);
  }

  // ── 이삭: 잎 사이로 대가 서고 그 끝에 이삭이 달린다
  const r: Build = { pos: [], col: [], idx: [] };
  for (let i = 0; i < 6; i++) {
    const az = (i / 6) * Math.PI * 2 + 0.25;
    blade(r, az, 0.5 + (i % 2) * 0.09, 0.055, 0.5, LEAF);
  }
  const ears: Array<[number, number, number]> = [
    [0, 0, 0.66],
    [0.075, 0.05, 0.57],
    [-0.065, -0.06, 0.61],
  ];
  for (const [x, z, h] of ears) {
    stalk(r, x, z, h, STALK);
    ear(r, x, z, h - 0.03, 0.18);
  }

  return [finish(a), finish(c), finish(r)];
}
