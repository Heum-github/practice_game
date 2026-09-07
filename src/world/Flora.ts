import * as THREE from 'three';
import { FARM, WORLD } from '../config';
import { Rng } from '../util/math';
import type { ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 비옥한 땅에 남은 마른 풀.
 *
 * 밭을 놓을 수 있는 땅인지 아닌지를 화면만 보고 알 수 있어야 한다.
 * 색만 살짝 바꾸면 시간대와 그림자에 묻혀 구분이 안 된다 —
 * 형태가 있어야 멀리서도 눈에 걸린다.
 *
 * 그래서 비옥도가 기준을 넘는 자리에만 마른 풀포기를 흩어 놓는다.
 * "풀이 남아 있는 곳 = 흙이 남아 있는 곳"이라는 규칙이 한 번 읽히면,
 * 그 뒤로는 설명 없이도 어디로 가야 할지 알게 된다.
 */

const TUFT = new THREE.Color(0x8b8446);
const TUFT_DRY = new THREE.Color(0x6d6634);

/** 풀포기 하나 — 밑동에서 갈라져 나온 마른 잎 몇 장 */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const SEG = 3;
  const blades = 5;

  for (let b = 0; b < blades; b++) {
    const az = (b / blades) * Math.PI * 2 + 0.3;
    const len = 0.16 + (b % 2) * 0.07;
    const dirX = Math.cos(az);
    const dirZ = Math.sin(az);
    const sideX = -dirZ;
    const sideZ = dirX;
    const start = pos.length / 3;

    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      // 위로 섰다가 끝이 말려 처진다
      const y = len * (t * 1.2 - 0.55 * t * t);
      const out = len * 0.75 * t * t;
      const w = 0.012 * (1 - t);
      const cx = dirX * out;
      const cz = dirZ * out;
      pos.push(cx - sideX * w, y, cz - sideZ * w);
      pos.push(cx + sideX * w, y, cz + sideZ * w);
      const c = TUFT.clone().lerp(TUFT_DRY, t);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < SEG; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      // 얇아서 뒤에서도 보여야 한다
      idx.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class Flora {
  readonly mesh: THREE.InstancedMesh;
  /** 실제로 심은 포기 수 */
  readonly count: number;

  constructor(terrain: Terrain, colliders: ColliderWorld, seed: number) {
    const rng = new Rng(seed ^ 0x5eed);
    const geo = tuftGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });

    const MAX = 2600;
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.name = 'flora:tuft';
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const hits: Array<{ minY: number; maxY: number }> = [];

    const half = WORLD.size / 2 - 6;
    let n = 0;

    // 격자를 훑으며 비옥한 자리에만 심는다
    for (let x = -half; x <= half && n < MAX; x += 1.6) {
      for (let z = -half; z <= half && n < MAX; z += 1.6) {
        const fert = terrain.sampleSoilRichness(x, z);
        if (fert < FARM.minFertility) continue;

        // 비옥할수록 빽빽하게 — 밀도 자체가 비옥도를 읽는 단서가 된다
        const density = (fert - FARM.minFertility) / (1 - FARM.minFertility);
        if (!rng.chance(0.18 + density * 0.5)) continue;

        const px = x + rng.range(-0.7, 0.7);
        const pz = z + rng.range(-0.7, 0.7);
        const py = terrain.sampleHeight(px, pz);

        // 구조물 안에 박히지 않게 한다
        hits.length = 0;
        colliders.query(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, hits as never[]);
        let blocked = false;
        for (const h of hits) {
          if (h.maxY > py - 0.1 && h.minY < py + 0.4) { blocked = true; break; }
        }
        if (blocked) continue;

        v.set(px, py, pz);
        q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
        const k = 0.75 + density * 0.6;
        s.set(k, k * rng.range(0.8, 1.25), k);
        m.compose(v, q, s);
        mesh.setMatrixAt(n++, m);
      }
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    this.mesh = mesh;
    this.count = n;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
