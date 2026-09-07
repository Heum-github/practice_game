import * as THREE from 'three';
import { CREATURE_KINDS, type CreatureKind, CREATURE, SETTLEMENT, WORLD } from '../config';
import { Rng, clamp, dampAngle } from '../util/math';
import { Terrain } from './Terrain';
import type { ColliderSet, Aabb } from './Collision';
import type { Buildings } from './Buildings';

type State = 'wander' | 'chase' | 'attack' | 'flee' | 'dying';

interface Creature {
  alive: boolean;
  /** 어떤 종류인가 — 속도·체력·피해가 여기서 갈린다 */
  kind: CreatureKind;
  state: State;
  hp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  /** 다리 위상 */
  gait: number;
  /** 다음 공격까지 남은 시간 */
  cooldown: number;
  /** 배회 목표 */
  goalX: number;
  goalZ: number;
  goalTimer: number;
  /** 죽는 연출에 쓰는 0..1 */
  fade: number;
  /**
   * 맞은 직후의 움찔거림 0..1.
   *
   * 색만 반짝이면 "때렸다"가 아니라 "깜빡였다"로 읽힌다.
   * 몸이 눌리고 뒤로 젖혀져야 맞은 것으로 보인다.
   */
  recoil: number;
  /** 피격 시 잠깐 밝아진다 */
  flash: number;
}

/**
 * 밤에 나타나는 변이 생물.
 *
 * 세계관: 포자에 변이된 것들, 혹은 보존 구역에서 빠져나온 개체 (GAME_PLANNING 3.6).
 * 빛을 피하므로 화톳불이 곧 방어 수단이다 — 전투 실력이 아니라 사전 준비로
 * 해결하도록 설계했다. 전투 비중 20%를 유지하는 방법이기도 하다.
 *
 * 낮에는 나타나지 않고, 동이 트면 물러난다.
 */
export class Creatures {
  readonly group = new THREE.Group();

  private readonly list: Creature[] = [];
  private readonly terrain: Terrain;
  private readonly colliders: ColliderSet;
  private readonly buildings: Buildings;
  private readonly rng = new Rng(WORLD.seed + 31337);

  private bodyMesh!: THREE.InstancedMesh;
  private legMesh!: THREE.InstancedMesh;
  private eyeMesh!: THREE.InstancedMesh;

  private spawnTimer = 0;
  /** 지금 며칠째인가 — 어떤 종류가 나올지 정한다 */
  private day = 1;
  /** 정착지 등급 — 로봇이 거점을 탐지하는 문턱 */
  private rank = 0;
  /**
   * 등급을 건너뛰고 낮에 로봇을 부르는 자리 (정비 격납고).
   *
   * 로봇은 원래 거점이 커져야 온다 — **거점이 눈에 띄는 것**이 이유다(3.6).
   * 격납고는 이유가 다르다. 거기 잠들어 있던 것들이 발소리에 깨는 것이라,
   * 야영지뿐인 사람도 발을 들이면 물린다. 그래서 등급 검사를 우회한다.
   */
  private wakeZone: ((x: number, z: number) => boolean) | null = null;
  /** 태양광 세기 0..1 — 흐린 날 로봇이 느려진다 */
  private solar = 1;

  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly candidates: Aabb[] = [];
  private readonly hitColor = new THREE.Color(0xd8a0a0);
  private readonly tmpColor = new THREE.Color();

  /** 플레이어가 이번 프레임에 받은 피해 (읽고 나면 0으로) */
  private pendingDamage = 0;

  constructor(terrain: Terrain, colliders: ColliderSet, buildings: Buildings) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.buildings = buildings;
    this.group.name = 'creatures';
    this.buildMeshes();
  }

  get aliveCount(): number {
    return this.list.reduce((n, c) => n + (c.alive && c.state !== 'dying' ? 1 : 0), 0);
  }

  /** 이번 프레임에 플레이어가 입은 피해를 꺼낸다 */
  takeDamage(): number {
    const d = this.pendingDamage;
    this.pendingDamage = 0;
    return d;
  }

  // ---------------------------------------------------------------- 메시

  private buildMeshes(): void {
    const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        flatShading: true,
        ...opts,
      });

    // 몸통 — 웅크린 덩어리
    this.bodyMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.42, 0),
      mat(CREATURE.color),
      CREATURE.maxAlive,
    );
    // 다리 — 인스턴스 하나로 네 개를 표현하기 어려우니 개체당 넉 줄을 따로 둔다
    this.legMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.44, 0.09),
      mat(0x1d1a16),
      CREATURE.maxAlive * 4,
    );
    // 눈 — 어둠 속에서 이것만 먼저 보인다
    this.eyeMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.055, 6, 4),
      new THREE.MeshBasicMaterial({ color: CREATURE.eyeColor }),
      CREATURE.maxAlive * 2,
    );

    for (const mesh of [this.bodyMesh, this.legMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.bodyMesh.name = 'creature:body';
    this.legMesh.name = 'creature:leg';
    this.eyeMesh.name = 'creature:eye';

    this.bodyMesh.count = 0;
    this.legMesh.count = 0;
    this.eyeMesh.count = 0;

    // 매 프레임 위치가 바뀌는데 경계구는 생성 시점에 한 번만 계산된다.
    // 최대 여섯 마리뿐이라 매 프레임 다시 재는 것보다 컬링을 끄는 쪽이 싸다.
    this.bodyMesh.frustumCulled = false;
    this.legMesh.frustumCulled = false;
    this.eyeMesh.frustumCulled = false;

    this.group.add(this.bodyMesh, this.legMesh, this.eyeMesh);
  }

  // ---------------------------------------------------------------- 생성

  /**
   * @param daylight 0(밤) .. 1(낮)
   */
  private trySpawn(dt: number, px: number, pz: number, daylight: number): void {
    // 밤이면 생물, 낮이면 로봇. 둘 사이의 어스름에는 아무것도 오지 않는다 —
    // 그 틈이 하루 중 마음 놓고 움직일 수 있는 시간이다.
    const night = daylight <= CREATURE.spawnDaylight;
    // 격납고 안이면 등급을 묻지 않는다 — 거점이 아니라 장소가 부르는 것이다
    const woken = this.wakeZone?.(px, pz) === true;
    const dayTime =
      daylight >= CREATURE.robotDaylight && (woken || this.rank >= SETTLEMENT.robotFromRank);
    if (!night && !dayTime) return;
    if (this.aliveCount >= CREATURE.maxAlive) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // 로봇은 드물게, 그러나 한 번 오면 무겁다
    this.spawnTimer = night ? CREATURE.spawnInterval : CREATURE.robotSpawnInterval;

    // 플레이어에게서 적당히 떨어진 곳, 그리고 불빛 밖에서 나타난다
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(CREATURE.spawnMinDist, CREATURE.spawnMaxDist);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;

      const half = WORLD.size / 2 - 6;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      // 생물만 불빛을 피한다. 로봇은 빛을 먹고 살아서 화톳불이 소용없다 —
      // 밤을 막던 방법이 낮에는 통하지 않는다는 것이 이 위협의 핵심이다.
      if (night && this.buildings.lightAt(x, z) > 0) continue;
      if (this.blocked(x, z)) continue;

      // 무리형은 한 번에 여럿이 나온다 — 수가 곧 위협인 종류다
      const kind = this.rollKind(this.day, night, woken);
      const [lo, hi] = CREATURE_KINDS[kind].pack;
      const n = this.rng.int(lo, hi + 1);
      for (let i = 0; i < n && this.aliveCount < CREATURE.maxAlive; i++) {
        this.spawnAt(
          x + this.rng.range(-2.2, 2.2),
          z + this.rng.range(-2.2, 2.2),
          kind,
        );
      }
      return;
    }
  }

  /**
   * 오늘 나올 수 있는 종류 중 하나를 가중치로 뽑는다.
   *
   * fromDay 로 등장 시점을 늦춰 두면, 며칠을 버틴 사람만 새 위협을 만난다.
   * 그게 환경 악화 곡선(기획서 3.7)이다.
   */
  private rollKind(day: number, night: boolean, woken = false): CreatureKind {
    const pool: CreatureKind[] = [];
    const weights: number[] = [];
    let total = 0;

    // 격납고가 깨우는 것은 **거기 잠들어 있던 것들**이다. 등급의 문턱만
    // 넘겨줄 뿐, 더 무거운 것까지 끌어오지는 않는다 — 야영지뿐인 1일차에
    // 중장 보행기가 나오면 그건 위협이 아니라 사형이다.
    const rank = woken ? Math.max(this.rank, SETTLEMENT.robotFromRank) : this.rank;

    for (const k of Object.keys(CREATURE_KINDS) as CreatureKind[]) {
      const spec = CREATURE_KINDS[k];
      // 밤 무리와 낮 무리는 서로 섞이지 않는다
      if (isRobot(k) === night) continue;
      if (day < spec.fromDay) continue;
      // 로봇은 거점이 그만큼 커져야 눈에 띈다 (기획서 3.6)
      if ('fromRank' in spec && rank < spec.fromRank) continue;

      // 날이 갈수록 험한 것이 자주 나온다
      const w = spec.weight + (spec.fromDay > 1 ? Math.min(3, (day - spec.fromDay) * 0.5) : 0);
      total += w;
      pool.push(k);
      weights.push(w);
    }
    if (pool.length === 0) return night ? 'stalker' : 'drone';

    let pick = this.rng.range(0, total);
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i]!;
      if (pick <= 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }

  private blocked(x: number, z: number): boolean {
    const y = this.terrain.sampleHeight(x, z);
    this.colliders.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5, this.candidates);
    for (const b of this.candidates) {
      if (b.minY < y + 1.2 && b.maxY > y + 0.05) return true;
    }
    return false;
  }

  private spawnAt(x: number, z: number, kind: CreatureKind): void {
    const slot = this.list.find((c) => !c.alive);
    const c: Creature = slot ?? ({} as Creature);

    c.alive = true;
    c.kind = kind;
    c.state = 'wander';
    c.hp = CREATURE_KINDS[kind].hp;
    c.x = x;
    c.z = z;
    c.y = this.terrain.sampleHeight(x, z);
    c.vx = 0;
    c.vz = 0;
    c.facing = this.rng.range(0, Math.PI * 2);
    c.gait = this.rng.range(0, Math.PI * 2);
    c.cooldown = 0;
    c.goalX = x;
    c.goalZ = z;
    c.goalTimer = 0;
    c.fade = 1;
    c.flash = 0;
    c.recoil = 0;

    if (!slot) this.list.push(c);
  }

  /** 동이 트면 물러난다 */
  /** @param robots true면 로봇만, false면 생물만 물린다 */
  private retreat(robots: boolean): void {
    for (const c of this.list) {
      if (!c.alive || c.state === 'dying') continue;
      if (isRobot(c.kind) !== robots) continue;
      c.state = 'dying';
    }
  }

  /**
   * 등급을 건너뛰고 낮에 로봇을 부르는 자리를 건다 (정비 격납고).
   * 한 번만 걸어 두면 되므로 매 프레임 넘기지 않는다.
   */
  setWakeZone(test: (x: number, z: number) => boolean): void {
    this.wakeZone = test;
  }

  // ---------------------------------------------------------------- 갱신

  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    daylight: number,
    playerDead: boolean,
    day = 1,
    rank = 0,
    overcast = 0,
  ): void {
    this.day = day;
    this.rank = rank;
    // 흐린 날에는 태양광이 가려 로봇이 느려지고 약해진다 (기획서 3.6)
    this.solar = 1 - overcast * (1 - CREATURE.robotOvercastMult);

    this.trySpawn(dt, px, pz, daylight);

    // 물러나는 조건이 둘로 갈린다. 생물은 밝아지면 숨고,
    // 로봇은 어두워지면 동력을 잃는다 — 이 대칭이 하루의 리듬을 만든다.
    if (daylight > CREATURE.retreatDaylight) this.retreat(false);
    if (daylight < CREATURE.robotRetreatDaylight) this.retreat(true);

    for (const c of this.list) {
      if (!c.alive) continue;
      this.step(c, dt, px, py, pz, playerDead);
    }

    this.writeInstances();
  }

  private step(
    c: Creature,
    dt: number,
    px: number,
    py: number,
    pz: number,
    playerDead: boolean,
  ): void {
    if (c.state === 'dying') {
      c.fade = Math.max(0, c.fade - dt * 1.6);
      if (c.fade <= 0) c.alive = false;
      return;
    }

    const spec = CREATURE_KINDS[c.kind];

    c.cooldown = Math.max(0, c.cooldown - dt);
    c.flash = Math.max(0, c.flash - dt * 4);
    c.recoil = Math.max(0, c.recoil - dt * 5.5);

    const dx = px - c.x;
    const dz = pz - c.z;
    const dist = Math.hypot(dx, dz);

    // 불빛 안으로는 들어오지 않는다 — 화톳불이 곧 방벽이다.
    //
    // 다만 **로봇에게는 통하지 않는다.** 태양광으로 사는 것들이라 빛을 꺼릴 이유가 없다.
    // 밤을 막던 방법이 낮에는 아무 소용이 없다는 것이 이 위협의 핵심이고,
    // 그래서 방벽과 함정이라는 다른 답을 준비해야 한다.
    const light = isRobot(c.kind) ? 0 : this.buildings.lightAt(c.x, c.z);
    if (light > 0) {
      c.state = 'flee';
    } else if (playerDead) {
      c.state = 'wander';
    } else if (dist < spec.attackRange) {
      c.state = 'attack';
    } else if (dist < CREATURE.detectRange) {
      c.state = 'chase';
    } else if (c.state === 'chase' || c.state === 'attack') {
      // 놓쳤다 — 배회로 돌아간다
      if (dist > CREATURE.loseRange) c.state = 'wander';
    }

    let wishX = 0;
    let wishZ = 0;
    let speed: number = spec.walkSpeed;

    /**
     * 로봇은 태양광으로 움직인다. 흐린 날에는 절반 남짓으로 느려지고
     * 그만큼 약해진다 — 기획서 3.6이 말한 "흐린 날 이용"이 여기서 실제 수단이 된다.
     * 폭풍이 부는 낮은 밖에 나가기 나쁜 날이자, 유일하게 로봇을 이길 만한 날이다.
     */
    const power = isRobot(c.kind) ? this.solar : 1;

    switch (c.state) {
      case 'attack': {
        // 제자리에서 물어뜯는다
        if (c.cooldown <= 0) {
          c.cooldown = spec.attackCooldown / power;
          this.pendingDamage += spec.damage * power;
        }
        break;
      }
      case 'chase': {
        wishX = dx / (dist || 1);
        wishZ = dz / (dist || 1);
        speed = spec.chaseSpeed;
        break;
      }
      case 'flee': {
        // 가장 가까운 불에서 멀어지는 방향
        const away = this.buildings.awayFromLight(c.x, c.z);
        wishX = away.x;
        wishZ = away.z;
        speed = spec.chaseSpeed;
        break;
      }
      case 'wander': {
        c.goalTimer -= dt;
        if (c.goalTimer <= 0 || Math.hypot(c.goalX - c.x, c.goalZ - c.z) < 1.2) {
          c.goalTimer = this.rng.range(2.5, 6);
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(4, 14);
          c.goalX = clamp(c.x + Math.cos(a) * r, -90, 90);
          c.goalZ = clamp(c.z + Math.sin(a) * r, -90, 90);
        }
        const gx = c.goalX - c.x;
        const gz = c.goalZ - c.z;
        const gl = Math.hypot(gx, gz) || 1;
        wishX = gx / gl;
        wishZ = gz / gl;
        break;
      }
    }

    // 가감속. 로봇은 동력이 약한 만큼 느리다.
    const accel = CREATURE.accel * dt;
    c.vx = approach(c.vx, wishX * speed * power, accel);
    c.vz = approach(c.vz, wishZ * speed * power, accel);

    this.move(c, c.vx * dt, c.vz * dt);

    // 함정을 밟았는가. (죽어가는 것은 여기까지 오지 않는다)
    const bite = this.buildings.triggerTrap(c.x, c.z);
    if (bite > 0) this.hurt(c, bite);

    c.y = this.terrain.sampleHeight(c.x, c.z);

    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.2) {
      c.facing = dampAngle(c.facing, Math.atan2(c.vx, c.vz), 8, dt);
      c.gait += dt * sp * 3.4;
    } else if (c.state === 'attack') {
      // 공격 중에는 플레이어를 노려본다
      c.facing = dampAngle(c.facing, Math.atan2(dx, dz), 10, dt);
    }

    void py;
  }

  /** 축 분리 이동 — 벽과 잔해를 통과하지 못한다 */
  private move(c: Creature, dx: number, dz: number): void {
    const r = CREATURE_KINDS[c.kind].radius;

    c.x += dx;
    let y = this.terrain.sampleHeight(c.x, c.z);
    this.colliders.query(c.x - r, c.z - r, c.x + r, c.z + r, this.candidates);
    for (const b of this.candidates) {
      if (b.minY > y + CREATURE.stepHeight || b.maxY < y) continue;
      if (c.x + r <= b.minX || c.x - r >= b.maxX) continue;
      if (c.z + r <= b.minZ || c.z - r >= b.maxZ) continue;
      c.x = dx > 0 ? b.minX - r : b.maxX + r;
      c.vx = 0;
    }

    c.z += dz;
    y = this.terrain.sampleHeight(c.x, c.z);
    this.colliders.query(c.x - r, c.z - r, c.x + r, c.z + r, this.candidates);
    for (const b of this.candidates) {
      if (b.minY > y + CREATURE.stepHeight || b.maxY < y) continue;
      if (c.x + r <= b.minX || c.x - r >= b.maxX) continue;
      if (c.z + r <= b.minZ || c.z - r >= b.maxZ) continue;
      c.z = dz > 0 ? b.minZ - r : b.maxZ + r;
      c.vz = 0;
    }
  }

  // ---------------------------------------------------------------- 전투

  /**
   * 함정 등 플레이어의 손을 거치지 않은 피해.
   * 넉백이 없다 — 밟은 자리에서 그대로 주저앉아야 함정이 있던 자리가 읽힌다.
   */
  private hurt(c: Creature, damage: number): void {
    c.hp -= damage;
    c.flash = 1;
    c.recoil = 1;
    if (c.hp <= 0) c.state = 'dying';
  }

  /**
   * 플레이어의 근접 공격.
   * @returns 맞춘 개체 수
   */
  strike(px: number, pz: number, fx: number, fz: number, damage: number): number {
    let hits = 0;
    for (const c of this.list) {
      if (!c.alive || c.state === 'dying') continue;
      const dx = c.x - px;
      const dz = c.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > CREATURE.playerReach) continue;
      // 등 뒤의 것은 맞지 않는다
      if (dist > 0.3 && (dx * fx + dz * fz) / dist < 0.35) continue;

      c.hp -= damage;
      c.flash = 1;
      c.recoil = 1;
      hits++;

      if (c.hp <= 0) {
        c.state = 'dying';
      } else {
        // 맞으면 뒤로 밀린다
        // 무거운 것은 덜 밀린다
        const kb = CREATURE_KINDS[c.kind].knockback;
        c.vx += (dx / (dist || 1)) * kb;
        c.vz += (dz / (dist || 1)) * kb;
      }
    }
    return hits;
  }

  // ---------------------------------------------------------------- 렌더

  private writeInstances(): void {
    let bodyN = 0;
    let legN = 0;
    let eyeN = 0;

    for (const c of this.list) {
      if (!c.alive) continue;

      // 종류마다 크기와 색이 다르다 — 실루엣만 보고 무엇이 오는지 알아야 한다
      const kindSpec = CREATURE_KINDS[c.kind];
      const scale = c.fade * kindSpec.scale;
      // 맞은 순간 몸이 납작해졌다가 돌아온다 (제곱을 써서 초반만 강하게)
      const rc = c.recoil * c.recoil;
      const bob = Math.sin(c.gait) * 0.045;
      const bodyY = c.y + 0.46 * scale + bob;

      // 몸통
      this.v.set(c.x, bodyY, c.z);
      // 뒤로 젖혀지며 눌린다
      this.euler.set(Math.sin(c.gait * 0.5) * 0.06 + rc * 0.55, c.facing, 0);
      this.q.setFromEuler(this.euler);
      this.s.set(
        scale * (1 + rc * 0.18),
        scale * 0.86 * (1 - rc * 0.24),
        scale * 1.16 * (1 + rc * 0.12),
      );
      this.m.compose(this.v, this.q, this.s);
      this.bodyMesh.setMatrixAt(bodyN, this.m);

      this.tmpColor.setHex(kindSpec.color).lerp(this.hitColor, c.flash);
      this.bodyMesh.setColorAt(bodyN, this.tmpColor);
      bodyN++;

      // 다리 넷 — 대각선 쌍이 번갈아 움직인다
      const cos = Math.cos(c.facing);
      const sin = Math.sin(c.facing);
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const front = i < 2 ? 1 : -1;
        const phase = c.gait + (i < 2 ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI : 0);
        const swing = Math.sin(phase) * 0.22;

        const lx = side * 0.24;
        const lz = front * 0.3 + swing;
        this.v.set(
          c.x + lx * cos + lz * sin,
          c.y + 0.22 * scale,
          c.z - lx * sin + lz * cos,
        );
        this.euler.set(swing * 0.9, c.facing, 0);
        this.q.setFromEuler(this.euler);
        this.s.setScalar(scale);
        this.m.compose(this.v, this.q, this.s);
        this.legMesh.setMatrixAt(legN++, this.m);
      }

      // 눈 둘
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -0.13 : 0.13;
        const fz = 0.42;
        this.v.set(
          c.x + side * cos + fz * sin,
          bodyY + 0.12 * scale,
          c.z - side * sin + fz * cos,
        );
        this.q.identity();
        this.s.setScalar(scale);
        this.m.compose(this.v, this.q, this.s);
        this.eyeMesh.setMatrixAt(eyeN++, this.m);
      }
    }

    this.bodyMesh.count = bodyN;
    this.legMesh.count = legN;
    this.eyeMesh.count = eyeN;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.legMesh.instanceMatrix.needsUpdate = true;
    this.eyeMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
  }

  /** 가장 가까운 개체까지의 거리 — HUD 경고에 쓴다 */
  nearestDistance(px: number, pz: number): number {
    let best = Infinity;
    for (const c of this.list) {
      if (!c.alive || c.state === 'dying') continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  reset(): void {
    for (const c of this.list) c.alive = false;
    this.spawnTimer = 0;
    this.pendingDamage = 0;
    this.writeInstances();
  }

  dispose(): void {
    for (const mesh of [this.bodyMesh, this.legMesh, this.eyeMesh]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}


/**
 * 이 종류가 기계인가.
 *
 * `daytime` 플래그 하나로 가른다. 종류를 새로 넣을 때 목록 두 곳을
 * 맞춰 고치는 대신 정의 한 줄만 보면 되도록.
 */
function isRobot(kind: CreatureKind): boolean {
  const spec = CREATURE_KINDS[kind] as { daytime?: boolean };
  return spec.daytime === true;
}
