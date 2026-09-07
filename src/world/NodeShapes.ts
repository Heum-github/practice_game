import * as THREE from 'three';

/**
 * 채집 대상의 형상.
 *
 * 원뿔 하나, 원판 하나로 두면 "흙"인지 "물"인지 아이콘을 봐야 안다.
 * 세계에 놓인 물건은 형태만으로 무엇인지 읽혀야 한다 —
 * 흙은 퍼낸 자국이 있는 둔덕이고, 잔해는 휘어진 철판이고,
 * 웅덩이는 가장자리가 고르지 않고 진흙 테가 둘려 있다.
 *
 * 인스턴싱이라 종류마다 재질이 하나뿐이다. 그래서 부품별 색은
 * 정점에 실어 보낸다.
 */

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  /** 위치 */
  x?: number;
  y?: number;
  z?: number;
  /** 회전 (rad) */
  rx?: number;
  ry?: number;
  rz?: number;
}

/**
 * 부품들을 하나의 지오메트리로 굽는다.
 *
 * mergeBoxes 는 축에 정렬된 상자만 다룬다. 여기서는 기울어진 철판과
 * 비스듬한 화면이 필요해서 회전을 받는 별도 굽기를 쓴다.
 */
function bake(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const normalMat = new THREE.Matrix3();
  const c = new THREE.Color();
  const v = new THREE.Vector3();

  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    e.set(part.rx ?? 0, part.ry ?? 0, part.rz ?? 0);
    m.makeRotationFromEuler(e);
    m.setPosition(part.x ?? 0, part.y ?? 0, part.z ?? 0);
    normalMat.getNormalMatrix(m);

    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute | undefined;
    c.setHex(part.color);

    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      if (n) {
        v.fromBufferAttribute(n, i).applyMatrix3(normalMat).normalize();
        nor.push(v.x, v.y, v.z);
      } else {
        nor.push(0, 1, 0);
      }
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** 눌러 만든 흙덩이 — 구를 납작하게 */
function clump(r: number, flat: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  g.scale(1, flat, 1);
  return g;
}

/**
 * 남은 흙 — 퍼내다 만 둔덕.
 * 큰 덩어리 하나에 작은 덩어리를 몇 개 붙여 "쌓인 것"으로 읽히게 한다.
 */
export function soilShape(): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: clump(0.52, 0.42), color: 0x6b4f2e, y: 0.12 },
    { geo: clump(0.3, 0.5), color: 0x765836, x: 0.3, y: 0.1, z: -0.2 },
    { geo: clump(0.26, 0.45), color: 0x5f4629, x: -0.3, y: 0.08, z: 0.24 },
    { geo: clump(0.2, 0.55), color: 0x7d5f3a, x: 0.05, y: 0.24, z: 0.3 },
    // 흩어진 알갱이
    { geo: clump(0.1, 0.7), color: 0x54402a, x: -0.42, y: 0.04, z: -0.34 },
  ];
  return bake(parts);
}

/**
 * 금속 잔해 — 휘어진 철판과 파이프.
 * 각도를 서로 어긋나게 두어야 "무너져 쌓인 것"으로 보인다.
 */
export function scrapShape(): THREE.BufferGeometry {
  const plate = (w: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, 0.045, d);
  const parts: Part[] = [
    { geo: plate(0.8, 0.55), color: 0x8a8478, y: 0.05, rz: 0.16, ry: 0.3 },
    { geo: plate(0.62, 0.44), color: 0x7b7568, y: 0.16, rz: -0.42, ry: -0.6 },
    { geo: plate(0.5, 0.36), color: 0x6f6a5f, y: 0.26, rx: 0.5, ry: 1.1 },
    // 녹슨 파이프
    {
      geo: new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8),
      color: 0x7a4a2c,
      x: 0.16,
      y: 0.12,
      z: 0.2,
      rz: Math.PI / 2,
      ry: 0.5,
    },
    // 비틀린 철근
    {
      geo: new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5),
      color: 0x6b422a,
      x: -0.2,
      y: 0.3,
      z: -0.1,
      rz: 0.9,
    },
  ];
  return bake(parts);
}

/**
 * 빗물 웅덩이 — 가장자리가 고르지 않은 물낯과 그 둘레의 진흙 테.
 * 완벽한 원은 자연에 없다. 반지름을 흔들어 놓는 것만으로 크게 달라 보인다.
 */
export function waterShape(): THREE.BufferGeometry {
  const SEG = 14;
  const radii: number[] = [];
  for (let i = 0; i < SEG; i++) {
    // 결정적인 요철 — 시드가 같으면 항상 같은 모양이다
    radii.push(0.52 + Math.sin(i * 2.3) * 0.09 + Math.sin(i * 5.1) * 0.05);
  }

  /**
   * 잔물결.
   *
   * 물낯을 완벽한 평면으로 두면 하늘이 한 가지 색으로 통째로 비쳐서
   * 물이 아니라 파랗게 칠한 판이 된다. 실제로 그렇게 보였다.
   * 몇 밀리미터짜리 요철이라도 법선이 흔들리면 반사가 부서지면서
   * 그제야 물처럼 읽힌다.
   */
  const RIPPLE = 0.022;
  const wave = (x: number, z: number): number =>
    RIPPLE * (Math.sin(x * 7.3 + z * 2.1) + 0.7 * Math.sin(x * 4.1 - z * 6.7));
  const waveNormal = (x: number, z: number, out: number[]): void => {
    const a = x * 7.3 + z * 2.1;
    const b = x * 4.1 - z * 6.7;
    const dx = RIPPLE * (7.3 * Math.cos(a) + 0.7 * 4.1 * Math.cos(b));
    const dz = RIPPLE * (2.1 * Math.cos(a) - 0.7 * 6.7 * Math.cos(b));
    const len = Math.hypot(-dx, 1, -dz);
    out.push(-dx / len, 1 / len, -dz / len);
  };

  /**
   * 고리를 여러 겹 쌓아 만든다.
   *
   * 부채꼴 하나로 만들면 정점이 열다섯 개뿐이라 잔물결이 얼룩덜룩해진다.
   * 고리를 나눠야 물결이 고르게 퍼진다.
   */
  const surface = (scale: number, y: number, rings: number): THREE.BufferGeometry => {
    const pos: number[] = [];
    const nor: number[] = [];

    const at = (ring: number, i: number): [number, number, number] => {
      const t = ring / rings;
      const a = (i / SEG) * Math.PI * 2;
      const r = radii[i % SEG]! * scale * t;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      return [x, y + wave(x, z), z];
    };

    // 감김 방향에 주의한다.
    //
    // three 는 법선 속성이 아니라 정점의 감김 방향으로 앞뒷면을 가른다.
    // XZ 평면에서 각도를 늘려가며 찍으면 위에서 볼 때 시계 방향이 되어
    // 뒷면이 된다 — 기본 재질은 뒷면을 그리지 않으므로 통째로 사라진다.
    // 실제로 웅덩이가 안 보였다. 순서를 뒤집어 반시계로 만든다.
    const push = (p: [number, number, number]): void => {
      pos.push(p[0], p[1], p[2]);
      waveNormal(p[0], p[2], nor);
    };

    for (let ring = 0; ring < rings; ring++) {
      for (let i = 0; i < SEG; i++) {
        const j = i + 1;
        const inner0 = at(ring, i);
        const inner1 = at(ring, j);
        const outer0 = at(ring + 1, i);
        const outer1 = at(ring + 1, j);

        if (ring === 0) {
          // 한가운데는 삼각형 하나로 충분하다
          push(inner0);
          push(outer1);
          push(outer0);
        } else {
          push(inner0);
          push(outer1);
          push(outer0);
          push(inner0);
          push(inner1);
          push(outer1);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  };

  return bake([
    // 젖은 진흙 테가 먼저 깔리고 — 너무 넓으면 흙바닥으로 보여 물이 묻힌다
    { geo: surface(1.16, 0, 1), color: 0x53412d },
    // 물가에 젖어 짙어진 띠. 물과 마른 땅 사이에 한 겹이 있어야 고인 것으로 보인다
    { geo: surface(1.06, 0.004, 1), color: 0x2e2519 },
    // 물낯.
    //
    // 색을 어둡고 탁하게 둔다. 물의 인상은 제 색이 아니라 비친 하늘에서 온다 —
    // 알베도가 밝으면 반사가 묻혀서 파란 판이 되어버린다.
    { geo: surface(1.0, 0.016, 3), color: 0x16242b },
  ]);
}

/** 보급 상자 — 모서리를 덧댄 궤짝. 뚜껑이 어긋나 있다 */
export function supplyShape(): THREE.BufferGeometry {
  const wood = 0xa8863f;
  const dark = 0x8a6c31;
  const band = 0x6c6357;
  const parts: Part[] = [
    { geo: new THREE.BoxGeometry(0.78, 0.44, 0.58), color: wood, y: 0.22 },
    // 어긋나게 얹힌 뚜껑
    { geo: new THREE.BoxGeometry(0.82, 0.08, 0.62), color: dark, y: 0.47, z: 0.05, rx: -0.14 },
    // 모서리 보강대 넷
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => ({
        geo: new THREE.BoxGeometry(0.07, 0.46, 0.07),
        color: band,
        x: sx * 0.37,
        y: 0.22,
        z: sz * 0.27,
      })),
    ),
    // 허리를 두른 띠
    { geo: new THREE.BoxGeometry(0.8, 0.06, 0.6), color: band, y: 0.24 },
    // 떨어져 나온 판자
    { geo: new THREE.BoxGeometry(0.42, 0.05, 0.14), color: dark, x: 0.42, y: 0.03, z: -0.3, ry: 0.7 },
  ];
  return bake(parts);
}

/** 기록 단말 — 비스듬한 화면이 달린 받침대. 아직 희미하게 살아 있다 */
export function archiveShape(): THREE.BufferGeometry {
  const body = 0x3d4a5a;
  const dark = 0x2b3441;
  const screen = 0x69c6d8;
  return bake([
    // 받침
    { geo: new THREE.CylinderGeometry(0.3, 0.36, 0.12, 8), color: dark, y: 0.06 },
    // 기둥
    { geo: new THREE.BoxGeometry(0.2, 0.62, 0.18), color: body, y: 0.42 },
    // 비스듬히 선 화면 상자
    { geo: new THREE.BoxGeometry(0.46, 0.34, 0.1), color: body, y: 0.85, z: 0.02, rx: -0.32 },
    // 화면
    { geo: new THREE.BoxGeometry(0.36, 0.24, 0.02), color: screen, y: 0.868, z: 0.075, rx: -0.32 },
    // 안테나
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), color: dark, x: 0.16, y: 1.12, rz: 0.2 },
  ]);
}

/**
 * 마른 풀포기 — 벨 수 있을 만큼 자란 덤불.
 *
 * 지면을 덮는 장식 풀(Flora)과 헷갈리면 안 된다. 저쪽은 "여기 흙이 있다"는
 * 표지고 이쪽은 채집물이다. 그래서 훨씬 크고, 밑동을 묶어 세운 단이 있고,
 * 색이 한 단계 밝다 — 멀리서도 "저건 집을 수 있는 것"으로 읽혀야 한다.
 */
export function grassShape(): THREE.BufferGeometry {
  const dry = 0xa89a52;
  const pale = 0xc0b268;
  const stem = 0x7a6a34;
  const parts: Part[] = [
    // 밑동을 묶은 단
    { geo: new THREE.CylinderGeometry(0.14, 0.17, 0.16, 6), color: stem, y: 0.08 },
  ];

  // 사방으로 벌어진 줄기. 길이와 기울기를 어긋나게 두어야 한 덩어리로 뭉치지 않는다
  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const az = (i / blades) * Math.PI * 2 + (i % 3) * 0.4;
    const lean = 0.24 + (i % 4) * 0.13;
    const len = 0.52 + (i % 5) * 0.11;
    parts.push({
      geo: new THREE.CylinderGeometry(0.006, 0.022, len, 3),
      color: i % 3 === 0 ? pale : dry,
      x: Math.cos(az) * (0.06 + lean * len * 0.4),
      y: 0.12 + len * 0.46,
      z: Math.sin(az) * (0.06 + lean * len * 0.4),
      rx: Math.sin(az) * lean,
      rz: -Math.cos(az) * lean,
    });
  }

  // 끝에 달린 이삭 몇 개 — 마른 풀이라도 씨는 남았다
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * Math.PI * 2 + 0.7;
    parts.push({
      geo: new THREE.IcosahedronGeometry(0.05, 0),
      color: pale,
      x: Math.cos(az) * 0.26,
      y: 0.62 + (i % 2) * 0.12,
      z: Math.sin(az) * 0.26,
    });
  }

  return bake(parts);
}
