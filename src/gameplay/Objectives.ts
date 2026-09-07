import type { ItemId } from './Items';

/**
 * 길잡이.
 *
 * 이 게임은 눈을 뜬 순간 아무것도 알려주지 않는다. 세계관상으로는 맞다 —
 * 주인공은 기억을 잃었다. 하지만 플레이어까지 아무것도 모르면
 * "무엇을 해야 하는지 몰라서" 그만두게 된다. 척박함은 난이도여야지
 * 불친절이면 안 된다.
 *
 * 그래서 한 번에 하나씩만 알려준다. 목록을 통째로 펼치면 할 일 목록이 되고,
 * 그러면 세계를 둘러보는 대신 체크리스트를 지우는 게임이 된다.
 *
 * 형식은 주인공이 스스로에게 남기는 메모다. 명령조가 아니라
 * "물부터 찾아야 한다" 같은 혼잣말이라야 기억을 잃은 사람의 시점에 맞는다.
 */

/** 목표를 판정할 때 보는 게임 상태 */
export interface ObjectiveContext {
  /** 아이템 보유량 */
  count: (id: ItemId) => number;
  /** 설치물·농사 현황 */
  base: {
    plots: number;
    planted: number;
    watered: number;
    ripe: number;
    fires: number;
    benches: number;
    collectors: number;
    compost: number;
    traps: number;
  };
  /** 정착지 등급 */
  rank: number;
  /** 모여든 생존자 수 */
  settlers: number;
  /** 이번 판의 누적 */
  harvests: number;
  gathered: number;
  /** 화톳불에 연료를 넣은 횟수 */
  refuels: number;
  /** 며칠째인가 */
  day: number;
  /** 해금한 설계 수 */
  unlocked: number;
  /** 되찾은 기록 조각 수 (유산 포함) */
  fragments: number;
  /** 기록의 마지막 막이 요구하는 되살린 흙 — 아직 모자란 만큼 */
  soilLeftForStory: number;
  /** 종자고를 열었는가 */
  vaultOpen: boolean;
  /** 올라가 본 관측 첨탑 수 */
  masts: number;
}

export interface Objective {
  id: string;
  /** 지금 할 일 — 짧게 */
  title: string;
  /** 왜, 어떻게 — 한 줄 */
  hint: string;
  /** 달성 여부 */
  done: (c: ObjectiveContext) => boolean;
}

/**
 * 순서대로 하나씩 진행한다.
 *
 * 앞의 것을 건너뛰고 뒤를 먼저 해내도 괜찮다 —
 * 매 프레임 "지금 목표"만 검사하므로, 이미 이룬 것은 즉시 넘어간다.
 */
export const OBJECTIVES: Objective[] = [
  {
    id: 'water',
    title: '마실 것을 찾는다',
    hint: '움푹 꺼진 자리에 빗물이 고인다. 웅덩이는 여럿이 모여 있다.',
    done: (c) => c.count('stagnantWater') >= 1,
  },
  {
    id: 'soil',
    title: '흙을 세 줌 모은다',
    hint: '마른 풀이 남아 있는 곳에 흙도 남아 있다. 곡괭이 없이도 긁어낼 수 있다.',
    done: (c) => c.count('soil') >= 3,
  },
  {
    id: 'plot',
    title: '밭을 한 칸 일군다',
    hint: '흙을 들고 땅을 보면 비옥도가 뜬다. 34% 이상이어야 일굴 수 있다.',
    done: (c) => c.base.plots >= 1,
  },
  {
    id: 'plant',
    title: '씨앗을 심는다',
    hint: '가방에 든 씨앗을 일군 밭에 심는다.',
    done: (c) => c.base.planted >= 1 || c.harvests >= 1,
  },
  {
    id: 'watering',
    title: '밭에 물을 준다',
    hint: '마른 밭은 자라지 않는다. 뜬 물을 밭에 부어라.',
    done: (c) => c.base.watered >= 1 || c.harvests >= 1,
  },
  {
    id: 'harvest',
    title: '첫 수확을 거둔다',
    hint: '이삭이 서고 누렇게 익으면 거둘 때다. 씨앗도 함께 나온다.',
    done: (c) => c.harvests >= 1,
  },
  {
    id: 'scrap',
    title: '잔해를 여덟 조각 모은다',
    hint: '무너진 철판은 어디에나 있다. 도구와 설비의 재료가 된다.',
    done: (c) => c.count('scrap') >= 8 || c.base.benches >= 1,
  },
  {
    id: 'bench',
    title: '작업대를 세운다',
    hint: '작업대 옆에서만 만들 수 있는 것들이 있다.',
    done: (c) => c.base.benches >= 1,
  },
  {
    id: 'pickaxe',
    title: '곡괭이를 만든다',
    hint: '맨손보다 훨씬 빨리 캐고, 훨씬 아프게 때린다.',
    done: (c) => c.count('pickaxe') >= 1 || c.count('hardenedPickaxe') >= 1,
  },
  {
    id: 'fire',
    title: '불을 피운다',
    hint: '밤에는 변이 생물이 돌아다닌다. 불빛 안으로는 들어오지 못한다.',
    done: (c) => c.base.fires >= 1,
  },
  {
    id: 'refuel',
    title: '불에 마른 풀을 넣는다',
    hint: '불 앞에서 E. 꺼진 불은 빛도 온기도 없고 물도 끓이지 못한다.',
    done: (c) => c.refuels >= 1,
  },
  {
    id: 'fuel',
    title: '마른 풀을 모은다',
    hint: '불은 저절로 타지 않는다. 풀덤불은 흙이 남은 땅에만 서 있다.',
    done: (c) => c.count('driedGrass') >= 3,
  },
  {
    id: 'boil',
    title: '물을 끓여 마신다',
    hint: '고인 물에는 포자가 떠 있다. 불 곁에서 C를 눌러 끓이면 안전하다.',
    done: (c) => c.count('boiledWater') >= 1,
  },
  {
    id: 'night',
    title: '하룻밤을 넘긴다',
    hint: '밤에는 체온이 떨어진다. 불 곁에서 버티거나, 벽을 세워 막아라.',
    done: (c) => c.day >= 2,
  },
  {
    id: 'collector',
    title: '빗물 집수기를 세운다',
    hint: '웅덩이까지 걸어가지 않아도 물이 모인다.',
    done: (c) => c.base.collectors >= 1,
  },
  // 첨탑을 단말보다 앞에 둔다. 오르면 단말이 나침반에 뜨므로
  // 다음 목표가 저절로 쉬워진다 — 길잡이가 순서를 알려주는 셈이다.
  {
    id: 'mast',
    title: '관측 첨탑에 오른다',
    hint: '나침반의 塔 표지를 따라간다. 꼭대기에 서면 그 일대의 흙과 단말이 눈에 들어온다.',
    done: (c) => c.masts >= 1,
  },
  {
    id: 'archive',
    title: '기록 단말을 찾는다',
    hint: '아직 희미하게 살아 있는 화면이 있다. 여기서 잃어버린 설계를 되찾는다.',
    done: (c) => c.unlocked >= 1,
  },
  {
    id: 'compost',
    title: '흙을 되살린다',
    hint: '세상의 흙은 유한하다. 퇴비 더미에 유기물을 넣으면 흙이 다시 생긴다.',
    done: (c) => c.base.compost >= 1,
  },
  {
    id: 'settle',
    title: '자리를 잡는다',
    hint: '밭 넷과 수확 세 번. 여기서부터는 살아남는 것이 아니라 사는 것이다.',
    done: (c) => c.base.plots >= 4 && c.harvests >= 3,
  },
  {
    id: 'enclose',
    title: '거점을 두른다',
    hint: '방벽을 R로 돌려 사방을 잇고 문을 하나 낸다. 실제로 막혀야 인정된다.',
    done: (c) => c.rank >= 2,
  },
  {
    id: 'settlers',
    title: '사람을 모은다',
    hint: '정착지가 되면 생존자가 찾아온다. 대신 먹을 것을 보관함에 채워둬야 한다.',
    done: (c) => c.settlers >= 1,
  },
  {
    id: 'defend',
    title: '낮을 대비한다',
    hint: '거점이 커지면 기계들이 탐지한다. 불빛은 통하지 않으니 길목에 함정을 묻어라.',
    done: (c) => c.base.traps >= 2,
  },
  // 마지막 목표는 살아남는 것이 아니라 **알아내는 것**이다.
  // 이 게임의 최종 목표가 "무슨 일이 있었는지 밝히는 것"이므로,
  // 길잡이도 거기서 끝나야 앞뒤가 맞는다.
  {
    id: 'story',
    title: '이야기를 잇는다',
    hint: '기록 단말을 계속 찾아라. 마지막 막은 흙을 되살린 사람에게만 열린다.',
    done: (c) => c.fragments >= 10,
  },
  {
    id: 'vault',
    title: '종자고를 연다',
    hint: '분화구 언저리에 반쯤 파묻힌 문이 있다. 열쇠는 처음부터 가방에 있었다.',
    done: (c) => c.vaultOpen,
  },
];

/** 진행 상태를 들고 있는 작은 상태 기계 */
export class ObjectiveTracker {
  private index = 0;

  get current(): Objective | null {
    return OBJECTIVES[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= OBJECTIVES.length;
  }

  get progress(): { done: number; total: number } {
    return { done: Math.min(this.index, OBJECTIVES.length), total: OBJECTIVES.length };
  }

  /**
   * 지금 목표가 달성됐는지 본다.
   *
   * 이미 이룬 것은 연달아 건너뛴다 — 순서를 무시하고 앞서 나간 플레이어에게
   * 지난 목표를 다시 시키면 길잡이가 아니라 방해가 된다.
   *
   * @returns 이번에 새로 달성한 목표들
   */
  update(c: ObjectiveContext): Objective[] {
    const cleared: Objective[] = [];
    while (this.index < OBJECTIVES.length && OBJECTIVES[this.index]!.done(c)) {
      cleared.push(OBJECTIVES[this.index]!);
      this.index++;
    }
    return cleared;
  }

  /** 세이브용 */
  serialize(): number {
    return this.index;
  }

  restore(index: number): void {
    this.index = Math.max(0, Math.min(OBJECTIVES.length, Math.floor(index)));
  }

  reset(): void {
    this.index = 0;
  }
}
