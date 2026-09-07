import * as THREE from 'three';

/**
 * 사람 몸을 만드는 형상 도구.
 *
 * 캐릭터가 "블록 인형"처럼 보이는 이유는 폴리곤이 적어서가 아니라
 * 두 가지 때문이다.
 *
 *   1. 팔다리가 굵기가 일정한 상자다. 사람 팔다리는 위가 굵고 아래가 가늘며,
 *      단면이 원이 아니라 타원이다 (앞뒤보다 좌우가 넓거나 그 반대).
 *   2. flatShading 이라 면마다 밝기가 뚝뚝 끊긴다.
 *
 * 그래서 여기서는 높이별 타원 단면을 쌓아 매끄럽게 이어 붙인다.
 * 장비(가방·마스크·버클)는 원래 각진 물건이므로 상자를 그대로 쓴다 —
 * 몸은 부드럽고 장비는 각진 대비가 오히려 사람처럼 읽히게 만든다.
 */

/** 단면 하나: [높이, 좌우 반지름, 앞뒤 반지름] */
export type Ring = readonly [y: number, rx: number, rz: number];

/**
 * 타원 단면을 쌓아 만든 매끄러운 통.
 *
 * @param rings 아래에서 위로 정렬된 단면들
 * @param radial 원둘레 분할 수. 12면 실루엣이 충분히 둥글고 가볍다
 * @param capBottom 아래를 막을지 (관절로 가려지는 곳은 막지 않는다)
 */
export function tube(rings: readonly Ring[], radial = 12, capBottom = true, capTop = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];

  for (const [y, rx, rz] of rings) {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, y, Math.sin(a) * rz);
    }
  }

  // 옆면
  for (let i = 0; i < rings.length - 1; i++) {
    const a = i * radial;
    const b = (i + 1) * radial;
    for (let j = 0; j < radial; j++) {
      const k = (j + 1) % radial;
      idx.push(a + j, b + j, a + k);
      idx.push(a + k, b + j, b + k);
    }
  }

  // 뚜껑 — 중심점 하나를 두고 부채꼴로 잇는다
  const cap = (ringIndex: number, up: boolean): void => {
    const r = rings[ringIndex]!;
    const center = pos.length / 3;
    pos.push(0, r[0], 0);
    const base = ringIndex * radial;
    for (let j = 0; j < radial; j++) {
      const k = (j + 1) % radial;
      if (up) idx.push(center, base + j, base + k);
      else idx.push(center, base + k, base + j);
    }
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rings.length - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 타원체. 머리·어깨처럼 둥근 덩어리에 쓴다.
 * 위아래를 따로 눌러 달걀 모양으로 만들 수 있다.
 */
export function blob(rx: number, ry: number, rz: number, squashTop = 1): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const s = y > 0 ? 1 - (1 - squashTop) * y : 1;
    p.setXYZ(i, p.getX(i) * rx * s, y * ry, p.getZ(i) * rz * s);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 신발. 뒤꿈치에서 발끝으로 갈수록 낮아지고 살짝 들린다.
 * 발끝이 들려 있어야 걸을 때 발끝으로 미는 동작이 눈에 보인다.
 */
export function boot(): THREE.BufferGeometry {
  // [z(앞이 +), 폭 반지름, 바닥 높이, 윗면 높이]
  const profile: Array<[number, number, number, number]> = [
    [-0.085, 0.048, -0.062, 0.055],
    [-0.045, 0.058, -0.07, 0.045],
    [0.02, 0.06, -0.072, 0.01],
    [0.08, 0.055, -0.068, -0.01],
    [0.125, 0.043, -0.055, -0.018],
    [0.155, 0.026, -0.035, -0.022],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  // 각 단면을 사각 링(좌하-우하-우상-좌상)으로 만든다
  for (const [z, w, lo, hi] of profile) {
    pos.push(-w, lo, z, w, lo, z, w, hi, z, -w, hi, z);
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      idx.push(a + j, b + j, a + k, a + k, b + j, b + k);
    }
  }
  // 앞뒤 막음
  const n = profile.length;
  idx.push(0, 2, 1, 0, 3, 2);
  const e = (n - 1) * 4;
  idx.push(e, e + 1, e + 2, e, e + 2, e + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
