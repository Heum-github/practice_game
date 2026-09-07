import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { blob, boot as bootGeo, tube } from './BodyParts';
import { clamp, damp, lerp } from '../util/math';
import {
  ankleDorsi,
  elbowFlexion,
  hipFlexion,
  kneeFlexion,
  pelvisList,
  pelvisRise,
  pelvisSway,
  pelvisTwist,
  shoulderSwing,
} from './Gait';

/**
 * 발이 딛을 지면을 알려주는 창구.
 *
 * PlayerCharacter 가 Terrain 을 직접 알 필요는 없다. 높이만 물어보면 된다.
 */
export interface GroundProbe {
  /** 월드 좌표의 지면 높이 */
  heightAt(x: number, z: number): number;
  /** 진행 방향 기준 경사 (rad). 오르막이 양수 */
  slope: number;
}

/**
 * 인체 비율 (신장 1.78m 기준).
 *
 * 실제 사람의 관절 높이를 그대로 쓴다. 발목 0.07, 무릎 0.50, 고관절 0.92,
 * 어깨 1.45, 턱 1.52, 정수리 1.78. 머리가 신장의 1/7.5 이 되어야
 * 어른으로 보인다 — 이 비율이 어긋나면 아무리 다듬어도 인형처럼 보인다.
 *
 * buildLeg 의 배치와 반드시 같아야 한다 (역기구학이 이 값을 쓴다).
 */
const HIP_Y = 0.92;
const THIGH = 0.42;
const SHIN = 0.43;
/** 발목에서 신발 바닥까지 */
const SOLE = 0.07;

interface Limb {
  /** 관절 피벗 — 회전은 여기에 준다 */
  pivot: THREE.Group;
  /** 무릎/팔꿈치 아래 */
  lower: THREE.Group;
  /** 발목 (다리에만 있다) */
  foot?: THREE.Group;
}

const MAT = {
  suit: new THREE.MeshStandardMaterial({ color: 0x59604d, roughness: 0.92 }),
  suitLight: new THREE.MeshStandardMaterial({
    color: 0x6a7159,
    roughness: 0.9,
  }),
  canvasTan: new THREE.MeshStandardMaterial({
    color: 0x8a7a55,
    roughness: 0.95,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: 0x24231f,
    roughness: 0.98,
  }),
  steel: new THREE.MeshStandardMaterial({
    color: 0x878d95,
    roughness: 0.38,
    metalness: 0.72,
  }),
  filter: new THREE.MeshStandardMaterial({
    color: 0x5e6459,
    roughness: 0.6,
    metalness: 0.25,
  }),
  suitDark: new THREE.MeshStandardMaterial({ color: 0x3a3f33, roughness: 0.9 }),
  strap: new THREE.MeshStandardMaterial({ color: 0x2c2e26, roughness: 0.95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xa8805e, roughness: 0.86 }),
  hood: new THREE.MeshStandardMaterial({ color: 0x4a4f40, roughness: 0.94 }),
  pack: new THREE.MeshStandardMaterial({ color: 0x6d5a41, roughness: 0.95 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.9 }),
  mask: new THREE.MeshStandardMaterial({
    color: 0x9aa093,
    roughness: 0.45,
    metalness: 0.35,
  }),
  lens: new THREE.MeshStandardMaterial({
    color: 0x1d2a2e,
    roughness: 0.15,
    metalness: 0.6,
  }),
};

/**
 * 캐릭터 부품의 기본 형태.
 * 날카로운 상자 대신 모서리를 둥글린다 — 실루엣이 훨씬 부드럽게 읽히고
 * 앰비언트 오클루전이 모서리를 잡아주면서 입체감이 크게 산다.
 */
const BOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.07);

/** 작업 동작 종류 */
export type ActionKind = 'none' | 'swing' | 'tend';

/** 0..1 순환 위상이 이번 프레임에 mark 를 지났는가 */
function crossed(prev: number, now: number, mark: number): boolean {
  if (now >= prev) return prev < mark && now >= mark;
  // 한 바퀴 넘어간 경우
  return prev < mark || now >= mark;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;

/**
 * 보존 구역에서 나고 자란 생존자.
 *
 * 로우폴리 상자 조립 + 절차적 애니메이션.
 * 스켈레톤 애니메이션 파일 없이 걷기·달리기·점프·대기 동작을 전부 코드로 만든다.
 * 마스크와 가방은 장식이 아니라 세계관 소품이다 (잔류 포자 / 시작 아이템 3종).
 */
export class PlayerCharacter {
  readonly object = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;

  private stride = 0;
  private walkAmt = 0;
  private idleT = 0;
  private lean = 0;
  private airT = 0;
  private headPitch = 0;

  /** 작업 동작 — 'swing'은 내려찍기(일구기·채집·수확), 'tend'는 손질(파종·급수) */
  private action: ActionKind = 'none';
  /** 작업 자세가 섞여 들어간 정도 0..1 */
  private actionAmt = 0;
  /** 작업 동작의 위상 */
  private actionT = 0;

  /** 착지 충격 잔상 0..1 */
  private landImpact = 0;
  private wasGrounded = true;
  /** 직전 프레임의 발 위상 — 발이 땅에 닿는 순간을 잡는다 */
  private lastStridePhase = 0;
  private onFootstepCb?: (foot: 'left' | 'right', strength: number) => void;

  constructor() {
    this.object.name = 'player';

    // body가 상하 반동을 담당한다 (루트는 물리 위치만 담당)
    this.object.add(this.body);

    this.buildTorso();
    this.buildHead();
    this.buildPack();

    this.legL = this.buildLeg(-0.1);
    this.legR = this.buildLeg(0.1);
    this.armL = this.buildArm(-0.2);
    this.armR = this.buildArm(0.2);

    // 큰 덩어리만 그림자를 던진다.
    // 버클·필터통 같은 잔부품까지 그림자 패스에 넣으면 드로우콜만 두 배가 되고
    // 화면에서는 차이가 보이지 않는다.
    this.object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.receiveShadow = true;
      // 몸통·팔다리는 실제 크기의 형상이라 scale 이 1이다.
      // 장비 상자만 scale 로 크기를 주므로, 작은 잔부품은 그림자에서 뺀다.
      const s = o.scale;
      o.castShadow = Math.max(s.x, s.y, s.z) >= 0.16;
    });
  }

  // ---------------------------------------------------------------- 조립

  private static mesh(
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    return m;
  }

  private buildTorso(): void {
    this.torso.position.set(0, HIP_Y, 0);
    this.body.add(this.torso);

    const add = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x = 0,
      y = 0,
      z = 0,
    ): void => {
      this.torso.add(PlayerCharacter.mesh(w, h, d, mat, x, y, z));
    };

    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, x = 0, z = 0): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.torso.add(m);
    };

    // 몸통 — 허리가 잘록하고 가슴이 넓은 하나의 매끄러운 덩어리.
    // 상자를 쌓으면 아무리 많이 쌓아도 계단이 보인다.
    part(
      tube([
        [0.0, 0.15, 0.105],
        [0.09, 0.145, 0.1],
        [0.18, 0.132, 0.093],
        [0.28, 0.15, 0.103],
        [0.38, 0.175, 0.115],
        [0.46, 0.185, 0.118],
        [0.53, 0.17, 0.107],
        [0.6, 0.128, 0.088],
      ]),
      MAT.suit,
    );

    // 어깨 봉우리 — 팔이 붙는 자리가 각지면 로봇처럼 보인다
    part(blob(0.085, 0.075, 0.085), MAT.suit, 0.52, -0.165);
    part(blob(0.085, 0.075, 0.085), MAT.suit, 0.52, 0.165);

    // 여민 옷섶과 가슴 멜빵
    add(0.09, 0.4, 0.02, MAT.suitDark, 0, 0.4, 0.115);
    add(0.05, 0.34, 0.025, MAT.strap, -0.1, 0.44, 0.11);
    add(0.05, 0.34, 0.025, MAT.strap, 0.1, 0.44, 0.11);
    add(0.11, 0.09, 0.03, MAT.suitLight, -0.1, 0.5, 0.115);

    // 허리 벨트와 버클
    add(0.31, 0.075, 0.215, MAT.strap, 0, 0.17, 0);
    add(0.07, 0.055, 0.05, MAT.steel, 0, 0.17, 0.11);
    // 허리에 매단 주머니 둘
    add(0.11, 0.13, 0.075, MAT.canvasTan, -0.17, 0.1, 0.05);
    add(0.095, 0.11, 0.07, MAT.canvasTan, 0.18, 0.09, -0.03);

    // 옷깃
    part(tube([[0.0, 0.115, 0.082], [0.055, 0.105, 0.078]], 12, false, false), MAT.hood, 0.58);
  }

  private buildHead(): void {
    this.head.position.set(0, 1.5, 0);
    this.body.add(this.head);

    const add = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x = 0,
      y = 0,
      z = 0,
    ): void => {
      this.head.add(PlayerCharacter.mesh(w, h, d, mat, x, y, z));
    };

    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, x = 0, z = 0): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.head.add(m);
    };

    // 목 — 앞으로 살짝 기울어 있다
    part(tube([[-0.1, 0.05, 0.052], [0.02, 0.046, 0.048]], 10, false, false), MAT.skin, 0, 0, 0.005);

    // 머리 — 두개골과 턱을 따로 두어야 옆에서 볼 때 사람 윤곽이 나온다
    part(blob(0.088, 0.112, 0.1), MAT.skin, 0.115, 0, -0.004);
    part(blob(0.073, 0.058, 0.084), MAT.skin, 0.038, 0, 0.012);

    // 후드 — 뒤통수를 감싸고 옆으로 흘러내린다
    part(blob(0.113, 0.125, 0.118, 0.9), MAT.hood, 0.118, 0, -0.022);
    add(0.075, 0.17, 0.115, MAT.hood, -0.105, 0.075, -0.03);
    add(0.075, 0.17, 0.115, MAT.hood, 0.105, 0.075, -0.03);
    add(0.2, 0.06, 0.085, MAT.hood, 0, 0.02, -0.115);

    // 방진 마스크 — 대기 중 잔류 포자를 막는다
    part(blob(0.075, 0.055, 0.055), MAT.mask, 0.028, 0, 0.072);
    add(0.09, 0.055, 0.035, MAT.filter, 0, -0.005, 0.115); // 배기구
    add(0.055, 0.055, 0.05, MAT.filter, -0.082, 0.038, 0.055); // 좌측 필터통
    add(0.055, 0.055, 0.05, MAT.filter, 0.082, 0.038, 0.055); // 우측 필터통
    add(0.19, 0.04, 0.025, MAT.strap, 0, 0.035, -0.02); // 마스크 끈

    // 고글 — 렌즈 둘, 이음새, 머리 뒤로 도는 끈
    add(0.075, 0.055, 0.035, MAT.lens, -0.052, 0.125, 0.08);
    add(0.075, 0.055, 0.035, MAT.lens, 0.052, 0.125, 0.08);
    add(0.045, 0.025, 0.03, MAT.steel, 0, 0.125, 0.082);
    add(0.215, 0.04, 0.2, MAT.strap, 0, 0.128, -0.01);
  }

  /** 시작 아이템 3종이 들어 있는 가방 */
  private buildPack(): void {
    const pack = new THREE.Group();
    pack.position.set(0, 0.4, -0.17);
    this.torso.add(pack);

    pack.add(PlayerCharacter.mesh(0.33, 0.4, 0.19, MAT.pack, 0, 0, -0.01));
    // 앞주머니
    pack.add(PlayerCharacter.mesh(0.24, 0.17, 0.08, MAT.canvasTan, 0, -0.07, -0.12));
    // 묶음 끈 두 줄
    pack.add(PlayerCharacter.mesh(0.35, 0.045, 0.21, MAT.strap, 0, 0.11, -0.01));
    pack.add(PlayerCharacter.mesh(0.35, 0.045, 0.21, MAT.strap, 0, -0.05, -0.01));
    // 어깨로 넘어가는 멜빵
    pack.add(PlayerCharacter.mesh(0.055, 0.34, 0.06, MAT.strap, -0.15, 0.16, 0.16));
    pack.add(PlayerCharacter.mesh(0.055, 0.34, 0.06, MAT.strap, 0.15, 0.16, 0.16));
    // 옆에 매단 물통
    pack.add(PlayerCharacter.mesh(0.1, 0.17, 0.1, MAT.mask, 0.2, -0.05, 0));
    pack.add(PlayerCharacter.mesh(0.05, 0.04, 0.05, MAT.steel, 0.2, 0.05, 0));
    // 위에 말아 얹은 방수포
    pack.add(PlayerCharacter.mesh(0.32, 0.12, 0.12, MAT.canvasTan, 0, 0.24, -0.02));
    // 아래에 묶은 여분 자재
    pack.add(PlayerCharacter.mesh(0.3, 0.09, 0.09, MAT.suitDark, 0, -0.23, -0.02));
  }

  private buildLeg(x: number): Limb {
    const pivot = new THREE.Group();
    pivot.position.set(x, HIP_Y, 0);
    this.body.add(pivot);

    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Group,
      y = 0,
      z = 0,
    ): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      parent.add(m);
    };

    // 넓적다리 — 위가 굵고 무릎으로 갈수록 가늘어진다
    part(
      tube([
        [0.03, 0.098, 0.105],
        [-0.12, 0.09, 0.098],
        [-0.28, 0.078, 0.085],
        [-0.42, 0.068, 0.074],
      ]),
      MAT.suit,
      pivot,
    );
    pivot.add(PlayerCharacter.mesh(0.155, 0.04, 0.165, MAT.strap, 0, -0.3, 0));

    const lower = new THREE.Group();
    lower.position.set(0, -THIGH, 0);
    pivot.add(lower);

    // 정강이 — 종아리가 무릎 바로 아래에서 가장 굵다
    part(
      tube([
        [0.01, 0.07, 0.076],
        [-0.08, 0.074, 0.082],
        [-0.22, 0.058, 0.064],
        [-0.35, 0.044, 0.05],
        [-0.43, 0.04, 0.046],
      ]),
      MAT.suitDark,
      lower,
    );
    // 무릎보호대와 각반
    lower.add(PlayerCharacter.mesh(0.135, 0.095, 0.075, MAT.rubber, 0, -0.03, 0.055));
    lower.add(PlayerCharacter.mesh(0.115, 0.085, 0.12, MAT.canvasTan, 0, -0.36, 0));

    // 발목 — 뒤꿈치를 딛고 발끝으로 미는 동작이 여기서 나온다
    const foot = new THREE.Group();
    foot.position.set(0, -SHIN, 0);
    lower.add(foot);
    foot.add(new THREE.Mesh(bootGeo(), MAT.boot));

    return { pivot, lower, foot };
  }

  private buildArm(x: number): Limb {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    this.body.add(pivot);

    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Group): void => {
      parent.add(new THREE.Mesh(geo, mat));
    };

    // 위팔
    part(
      tube([
        [0.03, 0.058, 0.06],
        [-0.1, 0.052, 0.055],
        [-0.22, 0.045, 0.048],
        [-0.3, 0.042, 0.045],
      ]),
      MAT.suit,
      pivot,
    );

    const lower = new THREE.Group();
    lower.position.set(0, -0.3, 0);
    pivot.add(lower);

    // 아래팔 — 팔꿈치 쪽이 굵고 손목이 가늘다
    part(
      tube([
        [0.01, 0.047, 0.05],
        [-0.1, 0.041, 0.044],
        [-0.2, 0.033, 0.037],
        [-0.26, 0.03, 0.034],
      ]),
      MAT.suitDark,
      lower,
    );
    // 소매 끝
    lower.add(PlayerCharacter.mesh(0.075, 0.05, 0.08, MAT.canvasTan, 0, -0.245, 0));

    // 장갑 낀 손 — 손바닥과 엄지를 따로 둔다
    const hand = new THREE.Mesh(blob(0.036, 0.055, 0.026), MAT.rubber);
    hand.position.set(0, -0.31, 0.004);
    lower.add(hand);
    const thumb = new THREE.Mesh(blob(0.016, 0.03, 0.016), MAT.rubber);
    thumb.position.set(x < 0 ? 0.03 : -0.03, -0.295, 0.018);
    thumb.rotation.z = x < 0 ? -0.5 : 0.5;
    lower.add(thumb);

    return { pivot, lower };
  }

  // ---------------------------------------------------------------- 애니메이션

  /** 카메라 피치를 머리에 살짝 반영한다 (0..1 정도로 감쇠된 값) */
  setHeadPitch(pitch: number): void {
    this.headPitch = clamp(pitch, -0.7, 0.6);
  }

  /** 발이 땅에 닿을 때마다 부른다 — 먼지와 발소리를 붙이는 자리 */
  onFootstep(cb: (foot: 'left' | 'right', strength: number) => void): void {
    this.onFootstepCb = cb;
  }

  /**
   * 지금 하고 있는 작업.
   *
   * 이동 애니메이션 위에 덧씌워진다 — 걸으면서도 팔은 작업 자세를 유지한다.
   * 'none'을 주면 자세가 서서히 풀린다.
   */
  setAction(kind: ActionKind): void {
    if (kind !== this.action) {
      // 동작이 바뀌면 위상을 처음부터 — 내려찍기가 중간에서 시작하면 어색하다
      if (kind !== 'none') this.actionT = 0;
      this.action = kind;
    }
  }

  /**
   * @param speed 수평 이동 속력 (m/s)
   * @param walkSpeed 기준 걷기 속력 — 달리기 판정에 쓴다
   * @param grounded 접지 여부
   * @param vertical 수직 속도 (점프 +, 낙하 -)
   */
  update(
    dt: number,
    speed: number,
    walkSpeed: number,
    grounded: boolean,
    vertical: number,
    probe?: GroundProbe,
  ): void {
    this.idleT += dt;

    // 착지 순간을 잡아 충격을 남긴다.
    //
    // 울퉁불퉁한 지면에서는 접지 판정이 매 프레임 껐다 켜졌다 한다.
    // 낙하 속도로 거르지 않으면 걷기만 해도 착지 연출이 계속 터진다.
    if (grounded && !this.wasGrounded && vertical < -2.5) {
      this.landImpact = clamp(-vertical / 14, 0.15, 1);
      // 어느 발로 딛는지는 지금 보행 위상이 정한다
      const foot = this.stride < 0.5 ? 'left' : 'right';
      this.onFootstepCb?.(foot, clamp(-vertical / 10, 0.5, 1.4));
    }
    this.wasGrounded = grounded;

    // 공중 상태 전이를 부드럽게
    this.airT = damp(this.airT, grounded ? 0 : 1, 11, dt);

    const moving = speed > 0.16;
    const run = clamp((speed - walkSpeed) / walkSpeed, 0, 1);

    // 보폭 위상: 이동 거리에 비례해야 발이 미끄러지지 않는다.
    // this.stride 는 0..1 의 보행 주기 위상이다.
    //
    // 보폭은 걸음 빈도를 정한다. 1.5m 로 두면 초당 4.5걸음이 되어
    // 종종거리는 것처럼 보였다. 실제 사람은 걸을 때 초당 2걸음 남짓,
    // 달릴 때 초당 3걸음(분당 180) 정도다. 거기에 맞춘다.
    let strideLength = lerp(2.7, 4.3, run);
    // 언덕에서는 보폭이 짧아진다. 평지 보폭 그대로 오르막을 오르면
    // 다리가 껑충껑충 벌어져 우스워진다.
    const grade = probe ? clamp(probe.slope, -0.9, 0.9) : 0;
    strideLength *= 1 - Math.min(0.34, Math.abs(grade) * 0.42);
    if (moving) {
      this.stride = (this.stride + (dt * speed) / strideLength) % 1;
    } else if (this.walkAmt > 0.03) {
      // 멈출 때는 걸음을 마저 딛는다.
      //
      // 흔듦기 한가운데서 얼어붙으면 한 발을 든 채로 자세만 중립으로
      // 녹아드는 그림이 된다. 양발이 땅에 닿는 위상(0 또는 0.5)까지
      // 마저 돌려놓아야 "멈춰 섰다"로 읽힌다.
      const marks = [0, 0.5, 1];
      let best = 1;
      let bestD = Infinity;
      for (const m of marks) {
        const d = m - this.stride;
        if (d >= -0.02 && d < bestD) {
          bestD = d;
          best = m;
        }
      }
      this.stride = Math.min(best, this.stride + dt * 1.5) % 1;
    }

    // 정지하면 자세가 중립으로 부드럽게 되돌아간다
    const walkAmt = damp(this.walkAmt, moving ? clamp(speed / walkSpeed, 0, 1.35) : 0, 9, dt);
    this.walkAmt = walkAmt;

    const air = this.airT;
    const ground = 1 - air;
    // 관절 표가 이미 실제 각도를 담고 있으므로 1을 넘겨 부풀리지 않는다.
    // 빠른 속도는 run 계수가 달리기 표로 섞어 표현한다.
    const k = Math.min(1, walkAmt) * ground;

    // 왼발이 먼저, 오른발은 반 주기 뒤
    const pL = this.stride;
    const pR = (this.stride + 0.5) % 1;

    // ---- 다리
    //
    // Gait 는 해부학 기준(굴곡이 양수)으로 돌려주고, 리그는 축 방향이 달라
    // 여기서 부호를 뒤집는다. 실측한 규약은 이렇다 (캐릭터 정면 = +Z):
    //   pivot.rotation.x 양수 → 넓적다리가 뒤로   ⇒ 굴곡은 음수
    //   lower.rotation.x 양수 → 정강이가 뒤로     ⇒ 굴곡은 양수
    //   foot.rotation.x  양수 → 발끝이 아래로     ⇒ 배측굴곡은 음수
    // 이걸 틀리면 무릎이 앞으로 꺾이는, 사람에게 없는 동작이 나온다.
    // 오르막에서는 무릎을 더 들고 발목을 더 세운다.
    // 내리막에서는 무릎을 더 굽혀 체중을 받아낸다 (제동은 무릎이 한다).
    const up = Math.max(0, grade) * ground;
    const down = Math.max(0, -grade) * ground;
    const hipLift = up * 0.5;
    const kneeBrake = down * 0.55;
    const ankleUp = up * 0.45;

    this.legL.pivot.rotation.x = lerp(-(hipFlexion(pL, run) + hipLift) * k, -0.75, air);
    this.legR.pivot.rotation.x = lerp(-(hipFlexion(pR, run) + hipLift) * k, 0.3, air);
    this.legL.lower.rotation.x = lerp((kneeFlexion(pL, run) + kneeBrake) * k, 0.95, air);
    this.legR.lower.rotation.x = lerp((kneeFlexion(pR, run) + kneeBrake) * k, 0.5, air);
    if (this.legL.foot) {
      this.legL.foot.rotation.x = lerp(-(ankleDorsi(pL, run) + ankleUp) * k, 0.3, air);
    }
    if (this.legR.foot) {
      this.legR.foot.rotation.x = lerp(-(ankleDorsi(pR, run) + ankleUp) * k, 0.25, air);
    }

    // 발끝은 바깥으로 약 7도 벌어져 있다. 나란히 두면 인형처럼 보인다.
    this.legL.pivot.rotation.y = -0.11;
    this.legR.pivot.rotation.y = 0.11;

    // ---- 골반: 오르내림 · 좌우 이동 · 비틀림 · 기울기
    //
    // 이 넷이 없으면 다리만 움직이고 몸통은 판자처럼 떠 다닌다.
    // 크기도 실측치에 맞춘다 — 상하 ±2.3cm, 좌우 ±2.2cm, 회전 ±4.5도.
    // 예전 값은 두 배 넘게 커서 몸이 좌우로 출렁였다.
    const rise = pelvisRise(pL, lerp(0.023, 0.042, run) * k);
    const sway = pelvisSway(pL, lerp(0.022, 0.012, run) * k);
    const twist = pelvisTwist(pL, lerp(0.08, 0.14, run) * k);
    const list = pelvisList(pL, lerp(0.07, 0.09, run) * k);

    const breathe = Math.sin(this.idleT * 1.6) * 0.008 * (1 - walkAmt);
    // 착지 충격으로 무릎을 굽히는 잔상
    this.landImpact = Math.max(0, this.landImpact - dt * 3.4);
    const squat = this.landImpact * this.landImpact * 0.22;

    this.body.position.y = lerp(rise + breathe - squat, -0.06, air);
    this.body.position.x = sway;
    this.body.rotation.y = twist;
    this.body.rotation.z = list;

    // ---- 상체: 골반과 반대로 비틀려 균형을 잡는다
    this.torso.rotation.y = -twist * 0.85;
    this.torso.rotation.z = -list * 0.7;

    this.lean = damp(this.lean, moving ? 0.05 + run * 0.22 : 0, 7, dt);
    const fallLean = clamp(-vertical * 0.012, -0.18, 0.1);
    // 오르막에서는 몸을 앞으로 기울여 무게중심을 발 위에 둔다.
    // 내리막에서는 반대로 살짝 세워 뒤로 넘어지지 않게 버틴다.
    const slopeLean = (up * 0.4 - down * 0.22) * Math.max(0.35, walkAmt);
    this.torso.rotation.x = this.lean + slopeLean + fallLean * air + squat * 1.1;

    // ---- 팔: 같은 쪽 다리와 정반대로, 달릴수록 더 접어 든다
    // 어깨는 걸을 때 ±16도, 달릴 때 ±34도. 팔꿈치는 걸을 때 20도쯤
    // 접혀 있다가 달리면 85도로 고정되다시피 한다 — 달리기의 특징이다.
    const armAmp = lerp(0.28, 0.6, run) * k;
    const idleSway = Math.sin(this.idleT * 1.15) * 0.035 * (1 - walkAmt);
    const elbowBase = lerp(0.35, 1.45, run);
    const elbowExtra = lerp(0.44, 0.3, run) * k;

    // 어깨 굴곡(앞)은 리그에서 음수, 팔꿈치 굴곡도 음수다
    this.armL.pivot.rotation.x = lerp(-shoulderSwing(pL, armAmp) + idleSway, -1.0, air);
    this.armR.pivot.rotation.x = lerp(-shoulderSwing(pR, armAmp) - idleSway, -0.9, air);
    this.armL.pivot.rotation.z = lerp(0.07 + run * 0.05, 0.42, air);
    this.armR.pivot.rotation.z = lerp(-0.07 - run * 0.05, -0.42, air);
    this.armL.lower.rotation.x = lerp(-elbowFlexion(pL, elbowBase, elbowExtra), -0.9, air);
    this.armR.lower.rotation.x = lerp(-elbowFlexion(pR, elbowBase, elbowExtra), -0.9, air);

    // ---- 발을 실제 지면에 붙인다
    if (probe && air < 0.9) {
      const planted = 1 - air;
      this.plantFoot(this.legL, pL, walkAmt, planted, probe);
      this.plantFoot(this.legR, pR, walkAmt, planted, probe);
    }

    // ---- 작업 자세를 위에 덧씌운다
    this.applyAction(dt, air);

    // ---- 머리: 몸통이 흔들려도 시선은 수평을 지킨다
    //
    // 사람은 걸을 때 머리를 자동으로 안정시킨다. 이것을 빼면
    // 카메라가 붙어 있지 않은 3인칭에서도 인형처럼 통째로 흔들려 보인다.
    this.head.rotation.z = -list * 0.85;
    this.head.rotation.y = -twist * 0.4;
    const headTarget = this.headPitch * 0.42 - this.lean + this.actionAmt * 0.34;
    this.head.rotation.x = damp(this.head.rotation.x, headTarget, 10, dt);
    this.head.position.y = 1.5 - this.lean * 0.05;

    // 위상이 0 또는 0.5 를 지나는 순간이 각각 왼발·오른발이 닿는 때다
    if (grounded && walkAmt > 0.25) {
      const prev = this.lastStridePhase;
      const now = this.stride;
      if (crossed(prev, now, 0)) this.onFootstepCb?.('left', walkAmt);
      if (crossed(prev, now, 0.5)) this.onFootstepCb?.('right', walkAmt);
    }
    this.lastStridePhase = this.stride;
  }

  /**
   * 발 하나를 실제 지면에 붙인다 (2관절 역기구학).
   *
   * 언덕에서 걷는 것이 이상해 보이는 진짜 이유는 관절 각도가 아니다.
   * 두 발이 같은 길이로 뻗어 있어서, 비탈에서는 산 쪽 발이 땅에 묻히고
   * 골짜기 쪽 발이 공중에 뜨기 때문이다. 각도를 아무리 손봐도 안 고쳐진다.
   *
   * 그래서 발이 닿아야 할 지면 높이를 직접 재고, 그 높이에 발목이 오도록
   * 넓적다리와 정강이 각도를 다시 푼다.
   *
   * 씬 그래프를 순회하지 않고 정방향 계산으로 발목 위치를 구한다 —
   * 프레임마다 69개 메시의 행렬을 두 번 갱신하는 것보다 훨씬 싸다.
   */
  private plantFoot(
    leg: Limb,
    phase: number,
    walkAmt: number,
    planted: number,
    probe: GroundProbe,
  ): void {
    if (!leg.foot) return;

    // 디딤기에만 붙인다. 흔드는 중인 발까지 붙이면 땅을 쓸며 걷는다.
    // 멈춰 서 있을 때는 양발 모두 디딤기다.
    const gaitStance = phase >= 0.6 ? 0 : clamp(Math.min(phase / 0.06, (0.6 - phase) / 0.08), 0, 1);
    const w = lerp(1, gaitStance, clamp(walkAmt, 0, 1)) * planted;

    const hipRot = leg.pivot.rotation.x;
    const kneeRot = leg.lower.rotation.x;

    // 정방향: 골반 기준 발목 위치. (0,-L,0) 을 X축으로 θ 돌리면 (-L·sinθ) 가 z다.
    const ky = -THIGH * Math.cos(hipRot);
    const kz = -THIGH * Math.sin(hipRot);
    const a = hipRot + kneeRot;
    const ankleY = HIP_Y + this.body.position.y + ky - SHIN * Math.cos(a);
    const ankleZ = kz - SHIN * Math.sin(a);
    const ankleX = leg.pivot.position.x + this.body.position.x;

    // 캐릭터 로컬 → 월드 (루트는 Y축 회전만 한다)
    const f = this.object.rotation.y;
    const cf = Math.cos(f);
    const sf = Math.sin(f);
    const wx = this.object.position.x + ankleX * cf + ankleZ * sf;
    const wz = this.object.position.z - ankleX * sf + ankleZ * cf;

    // 이 발이 닿아야 할 높이 (캐릭터 발밑 기준)
    const targetY = probe.heightAt(wx, wz) - this.object.position.y + SOLE;
    const hipY = HIP_Y + this.body.position.y;

    // 디딤기에는 발을 지면까지 끌어내리고,
    // 흔듦기에도 지면 아래로는 절대 내려가지 않게 막는다.
    // 후자가 없으면 내리막에서 발이 흙을 뚫고 들어간다 — 실제로 14cm 들어갔다.
    const wantY = Math.max(lerp(ankleY, targetY, w), targetY);
    if (Math.abs(wantY - ankleY) < 0.002) return;
    const vy = wantY - hipY;
    const d = clamp(Math.hypot(vy, ankleZ), 0.14, THIGH + SHIN - 0.015);

    // 2관절 역기구학
    const theta = Math.atan2(ankleZ, -vy); // 수직 아래가 0, 앞이 양수
    const cosA = clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1);
    const cosK = clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1);
    const newHip = -(theta + Math.acos(cosA));
    const newKnee = Math.PI - Math.acos(cosK);

    leg.pivot.rotation.x = newHip;
    leg.lower.rotation.x = newKnee;

    // 발바닥이 비탈을 따라 눕는다. 평지에서 발만 삐딱한 것보다 이쪽이 훨씬 크게 읽힌다.
    const solePitch = -Math.atan(probe.slope) - (newHip + newKnee);
    leg.foot.rotation.x = lerp(leg.foot.rotation.x, clamp(solePitch, -0.7, 0.7), w * 0.8);
  }

  /**
   * 작업 동작.
   *
   * 공중에서는 섞지 않는다 — 떨어지면서 곡괭이질하는 그림은 이상하다.
   */
  private applyAction(dt: number, air: number): void {
    const want = this.action === 'none' ? 0 : 1 - air;
    this.actionAmt = damp(this.actionAmt, want, 12, dt);
    if (this.actionAmt < 0.002) return;

    this.actionT += dt;
    const k = this.actionAmt;

    if (this.action === 'tend' || (this.action === 'none' && this.actionAmt < 0.5)) {
      // 손질 — 쪼그려 앉아 한 손을 땅으로. 아주 느린 원 운동.
      const w = Math.sin(this.actionT * 2.6);
      this.blend(this.armR.pivot, 'x', -1.15 + w * 0.16, k);
      this.blend(this.armR.lower.rotation, 'x', -0.72, k);
      this.blend(this.armL.pivot, 'x', -0.5, k);
      this.blend(this.armL.lower.rotation, 'x', -0.5, k);
      this.blend(this.torso.rotation, 'x', 0.55, k);
      this.body.position.y -= 0.16 * k;
      this.legL.pivot.rotation.x = lerp(this.legL.pivot.rotation.x, 0.42, k);
      this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.62, k);
      return;
    }

    // 내려찍기 — 들어올렸다가 내리치고 잠깐 멈춘다
    const period = 0.62;
    const t = (this.actionT % period) / period;
    // 0~0.42 들어올림, 0.42~0.62 내리침, 나머지 회복
    let swing: number;
    if (t < 0.42) {
      swing = -1.9 * easeOut(t / 0.42); // 뒤로 크게
    } else if (t < 0.62) {
      swing = lerp(-1.9, 0.75, easeIn((t - 0.42) / 0.2)); // 앞으로 내리침
    } else {
      swing = lerp(0.75, 0, (t - 0.62) / 0.38);
    }

    this.blend(this.armR.pivot, 'x', swing, k);
    this.blend(this.armL.pivot, 'x', swing * 0.86, k);
    this.blend(this.armR.lower.rotation, 'x', -0.34, k);
    this.blend(this.armL.lower.rotation, 'x', -0.4, k);
    this.blend(this.armR.pivot, 'z', -0.16, k);
    this.blend(this.armL.pivot, 'z', 0.16, k);

    // 상체가 내리침에 맞춰 숙였다가 펴진다
    const bend = t < 0.42 ? 0.12 : t < 0.62 ? lerp(0.12, 0.62, easeIn((t - 0.42) / 0.2)) : 0.4;
    this.blend(this.torso.rotation, 'x', bend, k);
    this.body.position.y -= bend * 0.1 * k;

    // 발을 벌리고 선다
    this.legL.pivot.rotation.x = lerp(this.legL.pivot.rotation.x, 0.2, k * 0.7);
    this.legR.pivot.rotation.x = lerp(this.legR.pivot.rotation.x, -0.16, k * 0.7);
  }

  /** 이동 애니메이션 결과 위에 작업 자세를 가중 혼합한다 */
  private blend(
    target: THREE.Object3D | THREE.Euler,
    axis: 'x' | 'z',
    value: number,
    k: number,
  ): void {
    const euler = target instanceof THREE.Object3D ? target.rotation : target;
    euler[axis] = lerp(euler[axis], value, k);
  }

  dispose(): void {
    BOX.dispose();
    for (const m of Object.values(MAT)) m.dispose();
  }
}
