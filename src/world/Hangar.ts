import * as THREE from 'three';
import { HANGAR, WORLD } from '../config';
import { Rng } from '../util/math';
import { StructureShell } from './StructureShell';
import type { ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 정비 격납고 (기획서 5장 남은 우선순위 4 · v0.5 「세계」).
 *
 * 폐허 구조물 셋째이자, 처음으로 **대가가 붙은** 것이다.
 * 온실은 흙을, 급수탑은 물을 그냥 준다. 여기는 잔해 산더미를 주는 대신
 * **낮에 로봇이 깨어난다** — 정착지 등급과 무관하게.
 *
 * 로봇은 원래 등급 2부터 온다 (3.6 — 거점이 커지면 눈에 띈다). 격납고는 그
 * 조건을 건너뛴다. 아직 야영지뿐인 사람도 여기 발을 들이면 낮에 물린다.
 * **거점이 아니라 장소가 부르는 것**이라, 이 구조물만은 "갈까"가 아니라
 * "언제 갈까"를 묻는다.
 *
 * 그 질문이 성립하려면 안이 보여야 한다. 그래서 앞면을 통째로 열어 둔다 —
 * 문턱에서 안을 들여다보며 "지금 들어갈 것인가"를 재는 순간이 이 장소의 값이다.
 * 지붕이 반쯤 내려앉아 **안이 밝은 것**도 같은 이유다. 어두우면 아무것도
 * 재지 못하고 그냥 안 들어간다.
 */
export class Hangar {
  readonly group = new THREE.Group();
  /** 문 앞 — 나침반이 가리키는 지점 */
  readonly x = HANGAR.x;
  readonly z = HANGAR.z - HANGAR.depth / 2 - 2;

  constructor(terrain: Terrain, colliders: ColliderWorld) {
    this.group.name = 'hangar';

    const cx = HANGAR.x;
    const cz = HANGAR.z;
    const w = HANGAR.width;
    const d = HANGAR.depth;
    const h = HANGAR.height;
    const t = HANGAR.wallThickness;
    const rng = new Rng(WORLD.seed + 9931);

    const shell = new StructureShell(terrain, colliders, cx, cz, w, d);
    const deck = shell.deck;
    const top = deck + h;

    const steel = new THREE.Color(0x5f666d);
    const panel = new THREE.Color(0x4a5057);
    const rust = new THREE.Color(0x74462a);
    const concrete = new THREE.Color(0x6a6a61);
    const hulk = new THREE.Color(0x3f444b);
    const lamp = new THREE.Color(0xc4564e);

    // ---- 벽 셋. 앞(-Z)은 통째로 열려 있다 — 격납고니까.
    shell.wallRun(cx - w / 2 + t / 2, cz - d / 2, cx - w / 2 + t / 2, cz + d / 2, t, top, concrete);
    shell.wallRun(cx + w / 2 - t / 2, cz - d / 2, cx + w / 2 - t / 2, cz + d / 2, t, top, concrete);
    shell.wallRun(cx - w / 2, cz + d / 2 - t / 2, cx + w / 2, cz + d / 2 - t / 2, t, top, concrete);

    // 앞면 — 문 양옆의 기둥만 남았다
    const doorHalf = HANGAR.doorWidth / 2;
    shell.wallRun(cx - w / 2, cz - d / 2 + t / 2, cx - doorHalf, cz - d / 2 + t / 2, t, top, concrete);
    shell.wallRun(cx + doorHalf, cz - d / 2 + t / 2, cx + w / 2, cz - d / 2 + t / 2, t, top, concrete);

    // 상인방 — 문 위를 덮어야 뚫린 구멍이 아니라 문으로 읽힌다.
    // 머리 위이므로 콜라이더는 주지 않는다.
    shell.push(cx, cz - d / 2 + t / 2, top - 1.3, HANGAR.doorWidth, 1.3, t, rust);

    // ---- 지붕. 반쯤 내려앉았다.
    //
    // 전부 덮으면 안이 완전한 암흑이 되고(8.3), 그러면 문턱에서 안을 재는
    // 장면이 성립하지 않는다. 들보는 다 걸되 **판은 절반만** 남긴다.
    //
    // 지붕판에는 **콜라이더를 준다.** 머리에서 6m 위라 몸이 걸릴 일이 없고,
    // `updateShelter` 가 위로 쏘는 광선에 걸려야 안에서 비바람이 걷힌다.
    // 처음에 collide 를 빼두었더니 격납고 한복판에서 `shelter: 0` 이 나왔다 —
    // 지붕이 눈에는 보이는데 젖는, 화면으로는 안 잡히는 사고다.
    const beams = Math.round(d / 2.4);
    for (let i = 0; i <= beams; i++) {
      const bz = cz - d / 2 + (d * i) / beams;
      shell.push(cx, bz, top - 0.3, w - t, 0.3, 0.3, steel);
      if (rng.chance(0.42)) continue; // 날아간 자리 — 여기로 빛이 든다
      // 남은 지붕판 — 한쪽으로 흘러내린 것도 있다.
      //
      // 처음에는 절반 넘게 걷어냈는데, 재어 보니 바닥의 **25%만** 덮여서
      // 격납고 한복판에서도 비를 맞았다. 안을 밝히는 일은 비상등이 맡고
      // 지붕은 지붕 노릇을 하게 둔다 — 구멍은 빛이 아니라 폐허의 표시다.
      const sag = rng.chance(0.3) ? rng.range(0.4, 1.1) : 0;
      shell.push(
        cx + rng.range(-1.2, 1.2),
        bz,
        top - 0.3 - sag,
        w * rng.range(0.55, 0.92),
        0.16,
        d / beams,
        panel,
        true,
      );
    }
    // 마루 도리
    shell.push(cx, cz, top, 0.34, 0.34, d - t, steel);

    // ---- 갠트리 크레인 레일. 여기가 무엇을 하던 곳인지 말해주는 물건이다.
    for (const s of [-1, 1] as const) {
      shell.push(cx + s * (w / 2 - 1.6), cz, deck + h * 0.62, 0.34, 0.4, d - 2, rust);
    }
    // 크레인 다리 — 레일 위에 걸린 채 멈춰 있다
    const gz = cz + rng.range(-3, 3);
    shell.push(cx, gz, deck + h * 0.62 + 0.4, w - 3.2, 0.42, 0.6, steel);
    shell.push(cx + 2.2, gz, deck + h * 0.62 - 1.6, 0.5, 1.6, 0.5, steel);

    // ---- 뜯다 만 기계들.
    //
    // 잔해가 왜 여기 산더미인지를 설명하는 물건이다. 이게 없으면
    // "잔해가 많은 빈 창고"가 되고, 그러면 낮에 물릴 이유도 없어진다.
    for (let i = 0; i < 7; i++) {
      const hx = cx + rng.range(-w / 2 + 2.4, w / 2 - 2.4);
      const hz = cz + rng.range(-d / 2 + 2.2, d / 2 - 2.2);
      const g = terrain.sampleHeight(hx, hz);
      const bw = rng.range(1.6, 3.0);
      const bh = rng.range(0.9, 2.0);
      // 몸통
      shell.push(hx, hz, g - 0.15, bw, bh, rng.range(1.4, 2.4), hulk, true);
      // 뜯겨 나온 팔다리 — 눕혀 놓는다
      shell.push(hx + rng.range(-2, 2), hz + rng.range(-2, 2), g, rng.range(1.6, 3), 0.3, 0.34, steel);
      // 아직 죽지 않은 표시등. 이 붉은 점 하나가 "고장난 고철"과
      // "낮이 되면 일어나는 것"을 가른다
      if (rng.chance(0.5)) {
        shell.push(hx, hz + 0.1, g - 0.15 + bh, 0.16, 0.16, 0.16, lamp);
      }
    }

    // ---- 정비대 — 벽을 따라 늘어선 작업대와 부품 선반
    for (const s of [-1, 1] as const) {
      const bx = cx + s * (w / 2 - 1.4);
      for (let i = 0; i < 4; i++) {
        const bz2 = cz - d / 2 + 2.5 + i * ((d - 5) / 3);
        const g = terrain.sampleHeight(bx, bz2);
        shell.push(bx, bz2, g - 0.2, 1.5, 1.1, 2.2, steel, true);
        if (rng.chance(0.6)) {
          shell.push(bx, bz2, g + 0.9, 1.0, rng.range(0.3, 0.7), 1.2, rust);
        }
      }
    }

    this.group.add(
      shell.build(
        'hangar:frame',
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.78,
          metalness: 0.3,
          flatShading: true,
        }),
      ),
    );

    // ---- 아직 죽지 않은 비상등.
    //
    // 지붕을 반이나 걷어냈는데도 안이 거의 검게 나왔다. 8.3 그대로다 —
    // **만들어 놓고 안 보이는 것은 만들지 않은 것과 같다.** 문턱에서 안을
    // 들여다보며 "지금 들어갈 것인가"를 재는 것이 이 장소의 값인데,
    // 검은 구멍만 보이면 아무도 재지 못하고 그냥 안 들어간다.
    //
    // 종자고의 등과 같은 해법이되 색이 다르다. 여기 불은 붉다 —
    // 설비가 살아 있다는 뜻이자, 살아 있는 것이 반갑지만은 않다는 뜻이다.
    const deckY = deck + h * 0.55;
    for (const lz of [cz - d * 0.26, cz + d * 0.26]) {
      const light = new THREE.PointLight(0xc4674e, 9, 17, 2);
      light.position.set(cx, deckY, lz);
      this.group.add(light);
    }
  }

  /** 문 앞까지의 평면 거리 */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }

  /** 여기 안이면 정착지 등급과 무관하게 낮에 로봇이 깨어난다 */
  wakesRobots(x: number, z: number): boolean {
    return Math.hypot(HANGAR.x - x, HANGAR.z - z) <= HANGAR.wakeRadius;
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
