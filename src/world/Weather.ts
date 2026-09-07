import * as THREE from 'three';
import { Rng } from '../util/math';

/**
 * 날씨.
 *
 * 하늘이 하루 종일 똑같으면 15분짜리 하루가 스무 번 반복돼도 늘 같은 날이다.
 * 날씨는 그 반복에 결을 만든다.
 *
 * 다만 보기만 좋고 아무 일도 하지 않으면 금방 배경이 된다. 그래서 둘 다
 * 농사에 직접 걸리게 한다 —
 *
 *   비        밭이 저절로 젖는다. 물통을 들고 뛰지 않아도 되는 날.
 *   먼지폭풍  밭이 빨리 마르고 앞이 안 보인다. 나가지 말아야 하는 날.
 *
 * 그러면 플레이어는 하늘을 본다. 그게 날씨를 넣는 이유다.
 */

export type WeatherKind = 'clear' | 'rain' | 'dust';

/** 입자 한 알 */
interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const MAX_MOTES = 900;
/** 입자가 플레이어를 따라다니는 상자의 크기 (m) */
const BOX = 26;
const BOX_H = 18;

export class Weather {
  readonly points: THREE.Points;

  /** 지금 날씨 */
  kind: WeatherKind = 'clear';
  /** 0..1 — 서서히 짙어지고 옅어진다 */
  intensity = 0;

  private target = 0;
  /** 머리 위가 막힌 정도 0..1 — 실내에서는 비도 먼지도 덜 들이친다 */
  private shelter = 0;
  /** 비가 올 확률의 가중치 — 계절이 정한다 */
  private rainBias = 0.5;
  private timer = 0;
  private readonly rng: Rng;

  private readonly motes: Mote[] = [];
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x7a17);
    this.positions = new Float32Array(MAX_MOTES * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // 매 프레임 플레이어를 따라 옮기므로 잘라내기 계산은 의미가 없다
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    this.material = new THREE.PointsMaterial({
      color: 0x9fb4c4,
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'weather';
    this.points.frustumCulled = false;
    this.points.visible = false;

    for (let i = 0; i < MAX_MOTES; i++) {
      this.motes.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    }

    // 첫 날은 맑게 시작한다 — 눈을 뜨자마자 폭풍이면 아무것도 배우지 못한다
    this.timer = 150;
  }

  /** 비가 오는 세기 (0이면 안 온다) */
  get rain(): number {
    return this.kind === 'rain' ? this.intensity : 0;
  }

  /** 먼지폭풍의 세기 */
  get dust(): number {
    return this.kind === 'dust' ? this.intensity : 0;
  }

  /** 화면에 띄울 이름. 맑으면 null */
  get label(): string | null {
    if (this.intensity < 0.25) return null;
    return this.kind === 'rain' ? '비' : this.kind === 'dust' ? '먼지폭풍' : null;
  }

  /**
   * @param dt 실제 프레임 시간 (s)
   * @param focus 플레이어 위치 — 입자 상자가 여기를 따라다닌다
   * @returns 이번 프레임에 날씨가 바뀌었으면 새 종류
   */
  update(dt: number, focus: THREE.Vector3, shelter = 0, rainBias = 0.5): WeatherKind | null {
    this.shelter = shelter;
    this.rainBias = rainBias;
    let changed: WeatherKind | null = null;

    this.timer -= dt;
    if (this.timer <= 0) {
      changed = this.roll();
    }

    // 세기는 천천히 따라간다 — 날씨가 딱 끊기면 스위치처럼 보인다
    const speed = this.target > this.intensity ? 0.09 : 0.14;
    this.intensity += Math.sign(this.target - this.intensity) * Math.min(
      Math.abs(this.target - this.intensity),
      speed * dt,
    );

    this.updateMotes(dt, focus);
    return changed;
  }

  /**
   * 다음 날씨를 뽑는다.
   *
   * 궂은 날이 될 확률은 그대로 두고, **비냐 먼지폭풍이냐**만 계절이 정한다.
   * 건기에는 폭풍이, 해빙기에는 비가 잦다 — 어느 계절인지 알면 무엇을
   * 대비해야 하는지도 알게 된다.
   */
  private roll(): WeatherKind {
    const r = this.rng.range(0, 1);
    if (this.kind !== 'clear') {
      // 궂은 날씨 뒤에는 반드시 갠다 — 연달아 오면 버틸 수가 없다
      this.kind = 'clear';
      this.target = 0;
      this.timer = this.rng.range(180, 420);
    } else if (r < 0.72) {
      // 궂은 날 안에서 비와 먼지폭풍의 비율만 계절이 가른다
      const rainy = this.rng.range(0, 1) < this.rainBias;
      this.kind = rainy ? 'rain' : 'dust';
      this.target = this.rng.range(rainy ? 0.55 : 0.5, 1);
      this.timer = this.rng.range(rainy ? 70 : 60, rainy ? 150 : 120);
    } else {
      this.timer = this.rng.range(120, 260);
      return 'clear';
    }
    return this.kind;
  }

  private updateMotes(dt: number, focus: THREE.Vector3): void {
    const vis = this.intensity > 0.02 && this.kind !== 'clear';
    this.points.visible = vis;
    if (!vis) return;

    const raining = this.kind === 'rain';
    // 지붕 아래에서는 들이치는 양만 남는다
    const indoor = 1 - this.shelter * 0.85;
    const count = Math.floor(MAX_MOTES * this.intensity * indoor);

    this.material.opacity = (raining ? 0.42 : 0.3) * this.intensity * indoor;
    this.material.size = raining ? 0.07 : 0.13;
    this.material.color.setHex(raining ? 0x9fb4c4 : 0xa89a80);

    const half = BOX / 2;
    for (let i = 0; i < count; i++) {
      const m = this.motes[i]!;

      // 아직 자리를 못 잡은 알갱이는 상자 안에 새로 뿌린다
      if (m.vy === 0 && m.vx === 0) this.respawn(m, focus, raining);

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;

      // 상자를 벗어나면 반대쪽으로 감는다 — 새로 만들지 않고 계속 돌려 쓴다
      const dx = m.x - focus.x;
      const dz = m.z - focus.z;
      if (m.y < focus.y - 2 || Math.abs(dx) > half || Math.abs(dz) > half) {
        this.respawn(m, focus, raining);
      }

      this.positions[i * 3] = m.x;
      this.positions[i * 3 + 1] = m.y;
      this.positions[i * 3 + 2] = m.z;
    }

    this.geometry.setDrawRange(0, count);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private respawn(m: Mote, focus: THREE.Vector3, raining: boolean): void {
    const half = BOX / 2;
    m.x = focus.x + this.rng.range(-half, half);
    m.z = focus.z + this.rng.range(-half, half);

    if (raining) {
      // 비는 위에서 떨어진다
      m.y = focus.y + this.rng.range(4, BOX_H);
      m.vy = -this.rng.range(14, 20);
      m.vx = this.rng.range(-1.2, 1.2);
      m.vz = this.rng.range(-1.2, 1.2);
    } else {
      // 먼지는 옆으로 흐른다
      m.y = focus.y + this.rng.range(0.2, 7);
      m.vy = this.rng.range(-0.6, 0.6);
      m.vx = this.rng.range(6, 13);
      m.vz = this.rng.range(-3, 3);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
