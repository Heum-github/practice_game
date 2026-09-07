import * as THREE from 'three';
import { GREENHOUSE, WORLD } from '../config';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import { Rng } from '../util/math';
import type { Aabb, ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 온실 잔해 (기획서 5장 남은 우선순위 4 · v0.5 「세계」).
 *
 * 첨탑과 종자고가 통했으니 같은 방식으로 손으로 세운 구조물을 하나 더 놓는다.
 * 요점은 **다른 이유를 줘야 한다**는 것이다 — 첨탑은 다음 탐험을 값으로 주고,
 * 종자고는 이야기의 끝을 준다. 온실이 주는 것은 **흙**이다.
 *
 * 무너진 재배동이라는 것이 배치의 전부를 정한다.
 *  - 지붕이 깨졌으므로 **안이 밝다.** 덮어 놓았다면 등을 달아야 했다
 *  - 지붕이 깨졌으므로 **흙이 밖으로 쏟아져 있다.** 그게 여기 오는 이유다
 *  - 허리벽만 남아 입구로만 든다. 안팎이 갈려야 "들어갔다"는 실감이 난다
 *
 * 초록 유리는 이 세계에서 유일하게 회색이 아닌 큰 면이다. 멀리서도
 * "무너진 건물"이 아니라 "무언가 자라던 곳"으로 읽혀야 걸음이 그쪽으로 돈다.
 *
 * 상태를 남기지 않는다. 여기서 얻는 것은 머리에 남는 지식이 아니라 손에
 * 담기는 흙이라, 유산의 기준대로 매 생 처음부터 다시 서 있다 — 그래서
 * `serialize`/`restore` 가 없다.
 */
export class Greenhouse {
  readonly group = new THREE.Group();
  /** 입구 앞 — 나침반이 가리키는 지점 */
  readonly x: number;
  readonly z: number;

  constructor(terrain: Terrain, colliders: ColliderWorld) {
    this.group.name = 'greenhouse';

    const cx = GREENHOUSE.x;
    const cz = GREENHOUSE.z;
    const rng = new Rng(WORLD.seed + 4211);

    const w = GREENHOUSE.width;
    const d = GREENHOUSE.depth;
    const h = GREENHOUSE.height;
    const knee = GREENHOUSE.kneeHeight;

    this.x = cx;
    this.z = cz - d / 2 - 1.6; // 입구는 -Z 면에 낸다

    // 뼈대는 수평으로 고정하고, 땅에 닿는 것만 제 발밑을 다시 잰다 (8.3)
    const deck = terrain.deckHeight(cx, cz, w, d);

    const frame = new THREE.Color(0x7c8079); // 바랜 알루미늄 새시
    const rust = new THREE.Color(0x74462a);
    const sill = new THREE.Color(0x6a6a61); // 허리벽 콘크리트
    const bed = new THREE.Color(0x5d564c); // 이랑 테두리
    const loam = new THREE.Color(0x4a3a2a); // 이랑에 남은 흙
    const pane = new THREE.Color(0x6f9a72); // 초록 유리

    const solid: BoxSpec[] = [];
    const glass: BoxSpec[] = [];

    /** 상자 하나. base 는 바닥의 월드 Y */
    const push = (
      x: number,
      z: number,
      base: number,
      bw: number,
      bh: number,
      bd: number,
      color: THREE.Color,
      collide = false,
    ): void => {
      solid.push({ x, y: base + bh / 2, z, w: bw, h: bh, d: bd, color });
      if (!collide) return;
      colliders.add({
        minX: x - bw / 2,
        maxX: x + bw / 2,
        minY: base,
        maxY: base + bh,
        minZ: z - bd / 2,
        maxZ: z + bd / 2,
      } satisfies Aabb);
    };

    // ---- 허리벽. 넘지 못하고 입구로만 든다.
    //
    // 지붕이 없는 폐허에서 안팎을 가르는 것은 이 한 줄뿐이다. 이게 없으면
    // 사방에서 걸어 들어오게 되고, 그러면 "들어갔다"는 순간이 없어진다.
    //
    // 벽은 **구간마다 제 발밑을 다시 잰다** (폐허의 `wall()` 과 같은 방식이다).
    // 윗변은 deck 에 맞춰 수평으로 두고 아랫변만 지면을 따라 내려가므로,
    // 경사진 자리에서는 기초가 그만큼 깊어질 뿐 뜨거나 파묻히지 않는다.
    const t = 0.5; // 벽 두께
    const doorW = GREENHOUSE.doorWidth;

    const wallRun = (x0: number, z0: number, x1: number, z1: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 2));
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const sx = x0 + (x1 - x0) * u;
        const sz = z0 + (z1 - z0) * u;
        // 바닥은 제 발밑보다 조금 더 내려가 지면과의 틈을 없앤다
        const base = Math.min(terrain.sampleHeight(sx, sz) - 0.35, deck);
        const top = deck + knee;
        push(
          sx,
          sz,
          base,
          alongX ? (len / n) * 1.04 : t,
          top - base,
          alongX ? t : (len / n) * 1.04,
          sill,
          true,
        );
      }
    };

    wallRun(cx - w / 2 + t / 2, cz - d / 2, cx - w / 2 + t / 2, cz + d / 2); // -X
    wallRun(cx + w / 2 - t / 2, cz - d / 2, cx + w / 2 - t / 2, cz + d / 2); // +X
    wallRun(cx - w / 2, cz + d / 2 - t / 2, cx + w / 2, cz + d / 2 - t / 2); // +Z 뒷벽
    // -Z 면 — 입구 좌우만 막는다. 문간에는 아무것도 걸지 않는다
    wallRun(cx - w / 2, cz - d / 2 + t / 2, cx - doorW / 2, cz - d / 2 + t / 2);
    wallRun(cx + doorW / 2, cz - d / 2 + t / 2, cx + w / 2, cz - d / 2 + t / 2);

    // ---- 아치 갈비뼈.
    //
    // 비스듬한 상자는 AABB 로 표현할 수 없으므로 계단으로 쌓아 곡선을 흉내낸다
    // (첨탑 계단과 같은 이유다). 머리 위라 콜라이더는 주지 않는다 —
    // 허리벽이 이미 몸을 막고 있고, 여기에 상자를 걸면 안이 걸어다닐 수 없게 된다.
    const ribs = Math.max(2, Math.round(d / GREENHOUSE.ribSpacing));
    const steps = GREENHOUSE.archSteps;
    const eaves = knee + (h - knee) * GREENHOUSE.eavesFrac; // 여기서부터 지붕이 휜다
    const halfW = w / 2 - t / 2;

    /**
     * 아치의 t(0=처마, 1=마루) 에서의 높이 — 타원이다.
     *
     * 처음에는 처마를 높게 잡고 계단을 다섯 칸만 놓았더니, 솟는 높이가 span 의
     * 3분의 1밖에 안 되고 마루 쪽이 거의 평평해서 **아치가 아니라 납작한
     * 차양**으로 읽혔다. 처마를 내려 솟을 자리를 주고 칸을 늘려야 곡선이 산다.
     */
    const archY = (u: number): number =>
      eaves + (h - eaves) * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)));

    for (let r = 0; r <= ribs; r++) {
      const rz = cz - d / 2 + (d * r) / ribs;
      // 갈비뼈 하나가 통째로 날아간 자리 — 온전히 서 있으면 폐허가 아니다
      const broken = rng.chance(0.22);

      for (const s of [-1, 1] as const) {
        // 기둥 — 허리벽 위에서 처마까지. 뼈대는 전부 deck 기준이라 수평이다
        push(cx + s * halfW, rz, deck + knee, 0.22, eaves - knee, 0.22, frame);
        if (broken) continue;

        let prevY = eaves;
        for (let k = 1; k <= steps; k++) {
          const u = k / steps;
          const y = archY(u);
          // 바깥에서 안으로 — 마루에 닿으면 x 는 0 이다
          const x0 = halfW * (1 - (k - 1) / steps);
          const x1 = halfW * (1 - u);
          const segW = x0 - x1;
          // 계단 한 칸을 아래 칸까지 늘여 붙인다. 안 그러면 끊긴 점선으로 보인다
          const bh = y - prevY + 0.2;
          push(
            cx + s * (x1 + segW / 2),
            rz,
            deck + y - bh + 0.2,
            segW + 0.14,
            bh,
            0.2,
            k > steps - 2 ? rust : frame,
          );
          prevY = y;
        }
      }
    }

    // 마루 도리 — 갈비뼈를 하나로 묶어야 뼈대로 읽힌다
    push(cx, cz, deck + h - 0.16, 0.26, 0.22, d, frame);

    // ---- 남아 있는 유리.
    //
    // 전부 성하면 폐허가 아니고 전부 깨졌으면 그냥 철골이다. 칸마다 주사위를
    // 굴려 듬성듬성 남긴다 — 성한 칸이 있어야 깨진 칸이 깨진 것으로 보인다.
    for (let r = 0; r < ribs; r++) {
      const rz = cz - d / 2 + (d * (r + 0.5)) / ribs;
      const bay = d / ribs - 0.24;
      for (const s of [-1, 1] as const) {
        for (let k = 1; k <= steps; k++) {
          if (!rng.chance(0.34)) continue;
          const u = k / steps;
          const uPrev = (k - 1) / steps;
          const y = (archY(u) + archY(uPrev)) / 2;
          const x = (halfW * (1 - u) + halfW * (1 - uPrev)) / 2;
          glass.push({
            x: cx + s * x,
            y: deck + y,
            z: rz,
            w: halfW / steps,
            h: 0.06,
            d: bay,
            color: pane,
          });
        }
        // 처마 아래 옆유리
        if (rng.chance(0.55)) {
          glass.push({
            x: cx + s * halfW,
            y: deck + (knee + eaves) / 2,
            z: rz,
            w: 0.06,
            h: eaves - knee - 0.2,
            d: bay,
            color: pane,
          });
        }
      }
    }

    // ---- 이랑.
    //
    // 흙이 왜 여기 몰려 있는지를 설명하는 물건이다. 자원 노드는 콜라이더를
    // 피해 깔리므로 이랑 위가 아니라 통로와 바깥에 앉는다 — 예외를 두지 않고
    // 기존 `blocked()` 검사에 맡긴다.
    // 이랑도 벽과 같다 — 제 발밑을 재지 않으면 경사에서 한쪽이 땅에 잠긴다.
    const bedW = 2.6;
    const bedL = d - 5;
    const bedSegs = Math.round(bedL / 2.4);
    for (const s of [-1, 1] as const) {
      const bx = cx + s * (w / 4 + 0.4);
      for (let i = 0; i < bedSegs; i++) {
        const bz = cz - bedL / 2 + (bedL * (i + 0.5)) / bedSegs;
        const seg = (bedL / bedSegs) * 1.04;
        const bg = terrain.sampleHeight(bx, bz);
        push(bx, bz, bg - 0.2, bedW, 0.64, seg, bed, true);
        // 테두리 안에 남은 흙 — 이랑이 빈 상자로 보이지 않게
        push(bx, bz, bg + 0.44, bedW - 0.5, 0.06, seg - 0.4, loam);
      }
    }

    // ---- 무너져 내린 유리 조각.
    //
    // 깨진 지붕이 어디로 갔는지가 바닥에 있어야 "무너졌다"가 사건이 된다.
    for (let i = 0; i < 34; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rad = Math.sqrt(rng.range(0, 1)) * (w * 0.75);
      const px = cx + Math.cos(a) * rad;
      const pz = cz + Math.sin(a) * rad * (d / w);
      glass.push({
        x: px,
        y: terrain.sampleHeight(px, pz) + 0.03,
        z: pz,
        w: rng.range(0.4, 1.3),
        h: 0.05,
        d: rng.range(0.4, 1.3),
        color: pane,
      });
    }

    const frameMesh = new THREE.Mesh(
      mergeBoxes(solid),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.86,
        metalness: 0.2,
        flatShading: true,
      }),
    );
    frameMesh.name = 'greenhouse:frame';
    frameMesh.castShadow = true;
    frameMesh.receiveShadow = true;
    this.group.add(frameMesh);

    // 유리는 금속이 아니다 — metalness 를 올리면 알베도가 반사색이 되어
    // 탁한 판이 된다. 0 으로 두고 거칠기만 낮춰야 프레넬이 산다.
    const glassMesh = new THREE.Mesh(
      mergeBoxes(glass),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0,
        roughness: 0.12,
        envMapIntensity: 1.3,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      }),
    );
    glassMesh.name = 'greenhouse:glass';
    glassMesh.receiveShadow = true;
    this.group.add(glassMesh);
  }

  /** 입구까지의 평면 거리 */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
