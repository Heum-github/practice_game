import * as THREE from 'three';

export interface BoxSpec {
  /** 중심 위치 */
  x: number;
  y: number;
  z: number;
  /** 크기 */
  w: number;
  h: number;
  d: number;
  /** 선택: 이 상자만 다른 색 (정점 색으로 들어간다) */
  color?: THREE.Color;
}

/** 축 정렬 단위 상자의 6면 — (법선, 네 모서리 오프셋) */
const FACES: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

/**
 * 여러 개의 축 정렬 상자를 하나의 지오메트리로 굽는다.
 *
 * 이랑처럼 작은 상자를 여럿 쌓아 만드는 형태를 인스턴싱 한 번으로 그리기 위한 것이다.
 * 외부 유틸(BufferGeometryUtils)에 의존하지 않으려고 직접 만든다.
 */
export function mergeBoxes(specs: BoxSpec[]): THREE.BufferGeometry {
  const triCount = specs.length * 12;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 9);

  let p = 0;
  let n = 0;
  let c = 0;

  const white = new THREE.Color(1, 1, 1);

  for (const box of specs) {
    const col = box.color ?? white;
    const hx = box.w / 2;
    const hy = box.h / 2;
    const hz = box.d / 2;

    for (const face of FACES) {
      // 사각형 하나를 삼각형 둘로 (0,1,2) (0,2,3)
      const order = [0, 1, 2, 0, 2, 3];
      for (const i of order) {
        const v = face.v[i]!;
        positions[p++] = box.x + v[0] * hx;
        positions[p++] = box.y + v[1] * hy;
        positions[p++] = box.z + v[2] * hz;

        normals[n++] = face.n[0];
        normals[n++] = face.n[1];
        normals[n++] = face.n[2];

        colors[c++] = col.r;
        colors[c++] = col.g;
        colors[c++] = col.b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}
