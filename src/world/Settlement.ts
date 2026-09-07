import { SETTLEMENT } from '../config';
import type { Buildings } from './Buildings';

/**
 * 정착지 등급 (기획서 3.5).
 *
 * v0.3까지 짓는 것들은 저마다 쓸모가 있었지만 **서로를 몰랐다.** 작업대는
 * 작업대고 방벽은 방벽이라, 스무 개를 지어도 그건 스무 개의 물건이지 마을이 아니다.
 *
 * 등급은 그것들을 하나로 읽는 눈이다. 무엇을 얼마나 지었는지, 둘러쌌는지,
 * 먹을 것을 스스로 대는지를 함께 보고 "여기가 어디까지 왔는가"를 한 줄로 말한다.
 * 그리고 그 한 줄이 생존자를 부르고, 로봇의 눈에 띄게 한다 —
 * **커지는 것에 보상과 대가가 동시에 붙어야** 도시를 키우는 일이 선택이 된다.
 *
 * ── 둘러쌈을 어떻게 재는가 ─────────────────────────────
 * 방벽 개수를 세는 것으로는 안 된다. 스무 개를 일렬로 늘어놓아도 개수는 같다.
 * 그래서 거점 한가운데에서 **격자를 타고 물을 흘려본다.** 방벽과 문에 막혀
 * 바깥으로 새어나가지 못하면 둘러싸인 것이다. 실제로 두르지 않으면 인정되지 않는다.
 */

export interface SettlementState {
  /** 0 = 아직 야영지 */
  rank: number;
  name: string;
  /** 거점의 중심 (표지와 생존자 배치에 쓴다) */
  cx: number;
  cz: number;
  /** 거점 설비 수 (밭·방벽 제외) */
  facilities: number;
  plots: number;
  /** 방벽으로 실제로 둘러싸인 칸 수 (0이면 트여 있다) */
  enclosed: number;
  /** 다음 등급까지 무엇이 모자란지 — 없으면 최고 등급 */
  next: string | null;
}

/** 물이 새어나가는지 볼 때 훑는 최대 반경 (칸) */
const FLOOD_RADIUS = 26;
/** 한 번에 훑는 칸 수 상한 — 넓게 트인 곳에서 헛돌지 않게 */
const FLOOD_LIMIT = 2600;

export class Settlement {
  // 첫 프레임부터 "다음에 무엇을 지어야 하는가"가 떠 있어야 한다.
  // 시뮬레이션이 한 번 돌기 전까지 빈칸이면 HUD가 잠깐 거짓말을 한다.
  private state: SettlementState = emptyState();

  /** 설치물이 바뀌었을 때만 다시 잰다 */
  private lastRevision = -1;
  private lastRank = 0;

  get current(): Readonly<SettlementState> {
    return this.state;
  }

  get rank(): number {
    return this.state.rank;
  }

  /**
   * 다시 잰다. 설치물이 그대로면 아무 일도 하지 않는다.
   * @returns 등급이 올랐으면 새 등급 (아니면 -1)
   */
  update(buildings: Buildings, force = false): number {
    if (!force && buildings.revision === this.lastRevision) return -1;
    this.lastRevision = buildings.revision;

    const s = this.state;
    const b = buildings.stats;

    // 거점의 중심 — 설비들의 무게중심. 없으면 잴 것도 없다.
    const marks = buildings.landmarks();
    if (marks.length === 0) {
      this.state = emptyState();
      this.lastRank = 0;
      return -1;
    }

    let cx = 0;
    let cz = 0;
    for (const m of marks) {
      cx += m.x;
      cz += m.z;
    }
    s.cx = cx / marks.length;
    s.cz = cz / marks.length;

    s.facilities = b.fires + b.collectors + b.compost + buildings.countOf('workbench') + buildings.countOf('storage');
    s.plots = b.plots;
    s.enclosed = this.measureEnclosure(buildings, s.cx, s.cz);

    // 조건을 다 만족하는 가장 높은 등급을 찾는다
    let rank = 0;
    for (let i = SETTLEMENT.ranks.length - 1; i >= 1; i--) {
      const need = SETTLEMENT.ranks[i]!;
      if (
        s.facilities >= need.facilities &&
        s.plots >= need.plots &&
        s.enclosed >= need.enclosed
      ) {
        rank = i;
        break;
      }
    }

    s.rank = rank;
    s.name = SETTLEMENT.ranks[rank]!.name;
    s.next = SETTLEMENT.ranks[rank + 1]?.hint ?? null;

    const rose = rank > this.lastRank ? rank : -1;
    this.lastRank = rank;
    return rose;
  }

  /**
   * 거점 중심에서 물을 흘려 방벽 바깥으로 새는지 본다.
   *
   * 새지 않으면 **훑은 칸 수가 곧 두른 넓이**다. 새면 0 —
   * 벽을 아무리 많이 세워도 한 곳이 뚫려 있으면 두른 것이 아니다.
   *
   * 문은 벽으로 친다. 여닫는 것은 사람의 사정이고, 울타리로서는 이어져 있다.
   */
  private measureEnclosure(buildings: Buildings, cx: number, cz: number): number {
    const startX = Math.round(cx);
    const startZ = Math.round(cz);
    if (buildings.blocksAt(startX, startZ)) return 0;

    const seen = new Set<number>();
    const queue: Array<[number, number]> = [[startX, startZ]];
    seen.add(startX * 4096 + startZ);

    let head = 0;
    while (head < queue.length) {
      if (queue.length > FLOOD_LIMIT) return 0; // 너무 넓다 = 트여 있다
      const [x, z] = queue[head++]!;

      // 반경을 벗어났으면 바깥으로 샌 것이다
      if (Math.abs(x - startX) > FLOOD_RADIUS || Math.abs(z - startZ) > FLOOD_RADIUS) return 0;

      for (let i = 0; i < 4; i++) {
        const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const nz = z + (i === 2 ? 1 : i === 3 ? -1 : 0);
        const key = nx * 4096 + nz;
        if (seen.has(key)) continue;
        if (buildings.blocksAt(nx, nz)) continue; // 벽에 막혔다
        seen.add(key);
        queue.push([nx, nz]);
      }
    }

    // 한 번도 새지 않고 끝났다 — 훑은 넓이가 두른 넓이다
    return seen.size;
  }

  reset(): void {
    this.state = emptyState();
    this.lastRevision = -1;
    this.lastRank = 0;
  }
}

/** 아무것도 짓지 않은 상태 — 다음 조건은 채워 둔다 */
function emptyState(): SettlementState {
  return {
    rank: 0,
    name: SETTLEMENT.ranks[0]!.name,
    cx: 0,
    cz: 0,
    facilities: 0,
    plots: 0,
    enclosed: 0,
    next: SETTLEMENT.ranks[1]?.hint ?? null,
  };
}
