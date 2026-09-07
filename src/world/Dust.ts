import * as THREE from 'three';

interface Puff {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

const MAX_PUFFS = 120;

/**
 * 발밑에서 피어오르는 먼지.
 *
 * 발이 땅에 닿는 순간 아무 일도 일어나지 않으면, 아무리 관절을 잘 돌려도
 * 캐릭터가 지면 위를 미끄러지는 것처럼 보인다. 접지 순간에 무언가가
 * 튀어야 발이 "닿았다"고 읽힌다.
 *
 * 흙을 걷어낸 세계라 지표는 콘크리트 가루다 — 흙빛이 아니라 잿빛으로 둔다.
 */
export class Dust {
  readonly points: THREE.Points;

  private readonly puffs: Puff[] = [];
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor() {
    this.positions = new Float32Array(MAX_PUFFS * 3);
    this.sizes = new Float32Array(MAX_PUFFS);
    this.alphas = new Float32Array(MAX_PUFFS);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // 화면 밖으로 잘려나가지 않도록 넉넉하게 잡는다 (매 프레임 갱신하므로 계산하지 않는다)
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    this.material = new THREE.PointsMaterial({
      color: 0xa8a49a,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'dust';
    this.points.frustumCulled = false;

    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffs.push({
        life: 0,
        maxLife: 1,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
      });
    }
  }

  /**
   * 한 지점에서 먼지를 피운다.
   * @param strength 0..1.5 — 세게 디딜수록 많이, 높이 튄다
   */
  burst(x: number, y: number, z: number, strength: number): void {
    const count = Math.round(2 + strength * 5);
    for (let i = 0; i < count; i++) {
      const p = this.puffs.find((q) => q.life <= 0);
      if (!p) return;

      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.12;
      p.x = x + Math.cos(a) * r;
      p.y = y + 0.03;
      p.z = z + Math.sin(a) * r;

      const spread = 0.35 + strength * 0.5;
      p.vx = Math.cos(a) * spread * (0.4 + Math.random() * 0.8);
      p.vz = Math.sin(a) * spread * (0.4 + Math.random() * 0.8);
      p.vy = 0.25 + Math.random() * 0.35 * strength;

      p.maxLife = 0.5 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.size = 0.5 + Math.random() * 0.7;
    }
  }

  update(dt: number): void {
    let n = 0;

    for (const p of this.puffs) {
      if (p.life <= 0) continue;

      p.life -= dt;
      if (p.life <= 0) continue;

      // 공기 저항으로 빠르게 잦아들고 아주 천천히 가라앉는다
      const drag = Math.exp(-2.6 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - 0.35 * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      this.sizes[n] = p.size;
      this.alphas[n] = p.life / p.maxLife;
      n++;
    }

    this.geometry.setDrawRange(0, n);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // 개별 알파를 셰이더 없이 표현할 수는 없으므로 전체 투명도로 근사한다 —
    // 먼지는 짧게 살고 여러 개가 겹치므로 이 정도로 충분하다.
    this.points.visible = n > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
