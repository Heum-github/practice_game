import * as THREE from 'three';
import { VAULT } from '../config';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import type { Aabb, ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 보존 구역 종자고 (기획서 2.3 · 3.8).
 *
 * 이야기가 가리키는 **장소**다. 기록 열 편을 다 읽으면 첫날부터 가방에 있던
 * "의문의 물체"가 종자고 열쇠였다는 것이 밝혀지는데, 열 문이 없으면
 * 그 결말은 자막으로만 남는다.
 *
 * 그래서 분화구 언저리 — 보존 구역이 서 있던 자리 — 에 반쯤 파묻힌 채로
 * 처음부터 서 있다. **아무것도 모르는 첫날에도 발견된다.** 다만 열리지 않는다.
 * 열리지 않는 문을 먼저 보여주는 것이 이 배치의 요점이다. 질문이 먼저 생기고
 * 대답이 나중에 오는 편이, 대답을 받고 나서 질문거리를 찾아 나서는 것보다 낫다.
 *
 * 폐허(Ruins)에 섞어 굽지 않고 따로 세운 이유는 **문이 열려야** 하기 때문이다.
 * 폐허는 생성 시점에 인스턴스로 통째로 구워지므로 나중에 한 조각만 치울 수 없다.
 */
export class SeedVault {
  readonly group = new THREE.Group();
  /** 문 앞 — 상호작용과 나침반이 가리키는 지점 */
  readonly x: number;
  readonly z: number;
  readonly y: number;

  private readonly door: THREE.Mesh;
  private readonly seal: THREE.Mesh;
  /** 문의 콜라이더 — 열면 이것만 걷어낸다 */
  private doorBox: Aabb | null = null;
  private colliders: ColliderWorld | null = null;

  private opened = false;
  /** 문이 내려앉는 연출 진행도 0..1 */
  private slide = 0;
  private readonly doorY: number;

  constructor(terrain: Terrain, colliders: ColliderWorld) {
    this.group.name = 'seedVault';
    this.colliders = colliders;

    const cx = VAULT.x;
    const cz = VAULT.z;
    const g = terrain.sampleHeight(cx, cz);

    // 문은 -Z 면에 낸다. 분화구 중심(원점)을 등지고 서 있는 셈이다.
    const half = VAULT.depth / 2;
    this.x = cx;
    this.z = cz - half - 1.2;
    this.y = terrain.sampleHeight(this.x, this.z);

    const concrete = new THREE.Color(0x6a6a61);
    const dark = new THREE.Color(0x53534c);
    const metal = new THREE.Color(0x4a5057);
    const band = new THREE.Color(0x9aa86a);

    const w = VAULT.width;
    const d = VAULT.depth;
    const h = VAULT.height;
    // 반쯤 파묻혀 있다 — 온전한 건물이 하나만 서 있으면 폐허에서 튄다
    const base = g - h * VAULT.buried;

    const boxes: BoxSpec[] = [];
    const rel = (y: number): number => base + y - (base + h / 2);

    // 몸통 — 옆벽 둘, 뒷벽, 지붕
    boxes.push({ x: -w / 2 + 0.5, y: rel(h / 2), z: 0, w: 1, h, d, color: concrete });
    boxes.push({ x: w / 2 - 0.5, y: rel(h / 2), z: 0, w: 1, h, d, color: concrete });
    boxes.push({ x: 0, y: rel(h / 2), z: d / 2 - 0.5, w, h, d: 1, color: concrete });
    boxes.push({ x: 0, y: rel(h - 0.4), z: 0, w: w + 0.6, h: 0.8, d: d + 0.6, color: dark });

    // 앞면 — 문틀만 남기고 좌우를 막는다.
    //
    // **문턱은 지면에 맞춘다.** 상자 바닥(base)에 맞춰 열었더니 건물이 묻힌
    // 만큼 문도 같이 묻혀서, 문의 아랫동강이 흙 속에 있었다.
    // 사람이 드나드는 구멍은 사람이 서 있는 높이에서 시작해야 한다.
    const doorW = VAULT.doorWidth;
    const doorH = VAULT.doorHeight;
    const sill = g - base; // 상자 바닥에서 지면까지
    const sideW = (w - doorW) / 2;
    boxes.push({
      x: -(doorW + sideW) / 2, y: rel(h / 2), z: -d / 2 + 0.5,
      w: sideW, h, d: 1, color: concrete,
    });
    boxes.push({
      x: (doorW + sideW) / 2, y: rel(h / 2), z: -d / 2 + 0.5,
      w: sideW, h, d: 1, color: concrete,
    });
    // 문턱 아래 — 묻힌 부분은 그대로 막아둔다
    if (sill > 0.05) {
      boxes.push({
        x: 0, y: rel(sill / 2), z: -d / 2 + 0.5,
        w: doorW, h: sill, d: 1, color: concrete,
      });
    }
    // 상인방 — 문 위를 덮어야 구멍이 아니라 문으로 읽힌다
    const lintel = h - sill - doorH;
    if (lintel > 0.05) {
      boxes.push({
        x: 0, y: rel(sill + doorH + lintel / 2), z: -d / 2 + 0.5,
        w: doorW, h: lintel, d: 1, color: dark,
      });
    }
    // 문틀 테두리
    boxes.push({
      x: 0, y: rel(sill + doorH + 0.12), z: -d / 2 - 0.05,
      w: doorW + 0.5, h: 0.24, d: 0.4, color: metal,
    });

    // 앞면에 칠해둔 띠.
    //
    // 이게 없으면 폐허의 콘크리트 덩어리와 구분이 안 된다. 멀리서도
    // "저건 무너진 게 아니라 잠긴 것"으로 읽혀야 걸음이 그쪽으로 돈다.
    boxes.push({
      x: 0, y: rel(h - 1.15), z: -d / 2 - 0.02,
      w: w - 1.4, h: 0.34, d: 0.16, color: band,
    });

    // 안쪽 선반.
    //
    // 문을 열고 들어갔는데 빈 상자면 "1,204종"이 글자로만 남는다.
    // 벽을 따라 시렁을 걸고 종자함을 얹어 두면 들어간 값이 눈에 보인다.
    // 같은 메시에 구워 넣으므로 드로우콜은 늘지 않는다.
    // 종자함은 따로 굽는다.
    //
    // 지붕이 덮인 안쪽은 **완전한 암흑**이다. 문을 열고 들어갔더니 검은 화면만
    // 나오면 "1,204종"은 자막으로만 남는다. 종자함에 자체 발광을 주고
    // 안에 등을 하나 달아 — 아직 전력이 남아 있는 설비라는 뜻이기도 하다.
    const rack = new THREE.Color(0x565b5e);
    const canister = new THREE.Color(0x8fae5a);
    const cans: BoxSpec[] = [];
    // 시렁 자리 — 콜라이더도 이 값으로 만든다. 형체와 충돌이 같은 숫자를
    // 보고 있어야 한쪽만 고쳤을 때 어긋나지 않는다.
    const rackX = w / 2 - 1.5;
    const rackZ = 0.4;
    const rackHalfW = 0.75;
    const rackHalfD = (d - 2.6) / 2;
    for (const side of [-1, 1]) {
      const rx = side * rackX;
      for (let level = 0; level < 3; level++) {
        const ry = sill + 0.6 + level * 0.78;
        if (ry > h - 0.9) break;
        boxes.push({
          x: rx, y: rel(ry), z: rackZ,
          w: rackHalfW * 2, h: 0.09, d: rackHalfD * 2, color: rack,
        });
        // 종자함 — 시렁 위에 늘어놓는다
        const slots = 5;
        for (let k = 0; k < slots; k++) {
          const rz = 0.4 - (d - 3.2) / 2 + (k * (d - 3.2)) / (slots - 1);
          cans.push({
            x: rx, y: rel(ry + 0.24), z: rz,
            w: 1.1, h: 0.38, d: 0.5,
            color: canister,
          });
        }
      }
      // 시렁을 받치는 기둥
      boxes.push({
        x: rx, y: rel(sill + (h - sill) / 2), z: 0.4 - (d - 3.2) / 2,
        w: 0.12, h: h - sill, d: 0.12, color: rack,
      });
      boxes.push({
        x: rx, y: rel(sill + (h - sill) / 2), z: 0.4 + (d - 3.2) / 2,
        w: 0.12, h: h - sill, d: 0.12, color: rack,
      });
    }

    const shell = new THREE.Mesh(
      mergeBoxes(boxes),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true }),
    );
    shell.position.set(cx, base + h / 2, cz);
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.group.add(shell);

    const canMesh = new THREE.Mesh(
      mergeBoxes(cans),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        flatShading: true,
        emissive: new THREE.Color(0x38491f),
        emissiveIntensity: 1,
      }),
    );
    canMesh.position.copy(shell.position);
    this.group.add(canMesh);

    // 안쪽 등 하나. 냉동 보존고가 아직 죽지 않았다는 표시다.
    const lamp = new THREE.PointLight(0xb9c46a, 6, 12, 2);
    lamp.position.set(cx, g + h * 0.55, cz + 0.6);
    this.group.add(lamp);

    // ---- 문. 따로 만들어 두면 열 때 내려앉힐 수 있다.
    this.doorY = g + doorH / 2;
    const doorBoxes: BoxSpec[] = [
      { x: 0, y: 0, z: 0, w: doorW - 0.1, h: doorH, d: 0.42, color: metal },
      // 가로 보강대 — 두께 없는 판은 문이 아니라 벽에 칠한 그림처럼 보인다
      { x: 0, y: -doorH * 0.28, z: -0.24, w: doorW - 0.3, h: 0.22, d: 0.14, color: dark },
      { x: 0, y: doorH * 0.28, z: -0.24, w: doorW - 0.3, h: 0.22, d: 0.14, color: dark },
    ];
    this.door = new THREE.Mesh(
      mergeBoxes(doorBoxes),
      new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.5, metalness: 0.45, flatShading: true,
      }),
    );
    this.door.position.set(cx, this.doorY, cz - d / 2 - 0.1);
    this.door.castShadow = true;
    this.group.add(this.door);

    // 인증 등 — 잠겼을 땐 붉고, 열리면 꺼진다.
    // 이 작은 불빛 하나가 "고장난 폐허"와 "아직 살아 있는 설비"를 가른다.
    this.seal = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xc4564e }),
    );
    this.seal.position.set(cx + doorW / 2 - 0.35, this.doorY + 0.6, cz - d / 2 - 0.34);
    this.group.add(this.seal);

    // 콜라이더 — 몸통은 늘 막고, 문은 열면 걷어낸다
    const add = (minX: number, maxX: number, minZ: number, maxZ: number): Aabb => {
      const box: Aabb = { minX, maxX, minY: base, maxY: base + h, minZ, maxZ };
      colliders.add(box);
      return box;
    };
    add(cx - w / 2, cx - w / 2 + 1, cz - d / 2, cz + d / 2);
    add(cx + w / 2 - 1, cx + w / 2, cz - d / 2, cz + d / 2);
    add(cx - w / 2, cx + w / 2, cz + d / 2 - 1, cz + d / 2);
    add(cx - (doorW + sideW) / 2 - sideW / 2, cx - doorW / 2, cz - d / 2, cz - d / 2 + 1);
    add(cx + doorW / 2, cx + (doorW + sideW) / 2 + sideW / 2, cz - d / 2, cz - d / 2 + 1);
    // 시렁 — 벽 다섯 장만 막아 두었더니 1,204종이 든 방을 걸어서 통과했다.
    //
    // 시렁을 받치는 기둥은 바닥부터 천장까지 서 있으므로 시렁 자리는 통째로
    // 막는다. 양옆이 각각 1.25m 를 물지만 실내가 9m 라 가운데 6.5m 가 남는다 —
    // 플레이어 지름(0.68m)의 아홉 배가 넘고 문(2.6m)보다도 넓다.
    for (const side of [-1, 1]) {
      const rx = cx + side * rackX;
      add(rx - rackHalfW, rx + rackHalfW, cz + rackZ - rackHalfD, cz + rackZ + rackHalfD);
    }
    // 문의 콜라이더는 지면 위 문짝만 — 아래는 이미 앞면 벽이 막고 있다
    this.doorBox = {
      minX: cx - doorW / 2, maxX: cx + doorW / 2,
      minY: g, maxY: g + doorH,
      minZ: cz - d / 2 - 0.4, maxZ: cz - d / 2 + 0.3,
    };
    colliders.add(this.doorBox);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** 문 앞까지의 평면 거리 */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }

  /** 열쇠를 꽂았다 */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    (this.seal.material as THREE.MeshBasicMaterial).color.setHex(0x8fae5a);
    if (this.doorBox && this.colliders) {
      this.colliders.remove(this.doorBox);
      this.doorBox = null;
    }
  }

  /** 세이브·계승에서 이미 열린 채로 시작할 때 */
  restore(open: boolean): void {
    if (!open) return;
    this.open();
    this.slide = 1;
    this.applySlide();
  }

  /** 문이 땅속으로 내려앉는다 — 열자마자 사라지면 열었다는 실감이 없다 */
  update(dt: number): void {
    if (!this.opened || this.slide >= 1) return;
    this.slide = Math.min(1, this.slide + dt / VAULT.doorSlideTime);
    this.applySlide();
  }

  private applySlide(): void {
    this.door.position.y = this.doorY - VAULT.doorHeight * 1.04 * this.slide;
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
