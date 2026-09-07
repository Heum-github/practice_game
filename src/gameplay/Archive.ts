/**
 * 기록 조각.
 *
 * 이 게임의 최종 목표는 "무슨 일이 있었는지 밝히는 것"인데, 지금까지
 * 기록 단말은 설계도만 뱉었다. 그러면 생존 루프는 돌아가지만
 * 왜 살아남는지는 비어 있다.
 *
 * 그래서 단말을 읽을 때마다 조각을 하나씩 준다. 순서대로 나오지만
 * 어느 단말에서 무엇이 나올지는 정해두지 않는다 — 폐허를 뒤지다 보면
 * 이야기가 조금씩 맞춰지는 쪽이, 정해진 순서로 읽는 것보다
 * "발굴"이라는 이 게임의 동사에 맞는다.
 *
 * 목소리는 세 갈래로 섞는다. 관리 AI의 건조한 기록, 보존 구역
 * 연구원의 사적인 메모, 그리고 정체를 알 수 없는 마지막 목소리.
 * 읽는 사람이 스스로 이어 붙이게 두고 설명하지 않는다.
 *
 * ---
 *
 * **3막 구조 (기획서 3.8).**
 *
 * 조각 열 편은 처음부터 다 있었지만 순서만 있고 뼈대가 없었다. 한 생에
 * 단말을 열 번 열면 이야기가 통째로 쏟아지고, 그러면 남는 것은 텍스트뿐이다.
 *
 * 그래서 막을 셋으로 나누고 **막마다 문을 달았다.**
 *
 *   1막 걷어간 것 — 처음부터 읽힌다
 *   2막 무너진 것 — **거점을 세워 본 사람**에게 열린다 (정착지 등급 2)
 *   3막 남긴 것   — **흙을 되살린 사람**에게 열린다 (되살린 흙 24줌)
 *
 * 문을 읽은 편 수로 달지 않은 것이 요점이다. 조각은 순서대로 나오므로
 * "앞의 막을 다 읽었는가"는 사실상 아무것도 묻지 않는다 — 단말만 계속 열면
 * 그만이다. 그래서 **살아온 것**을 묻기로 했다.
 *
 * 2막은 무너진 정착지의 이야기다. 잃을 것이 있어 본 사람이라야 그게 무슨
 * 뜻인지 안다. 3막은 마지막 목소리가 "흙부터 찾아라"고 말하는 대목이고,
 * 그 말을 듣지 않은 사람에게 결말을 주면 앞뒤가 맞지 않는다 —
 * **시킨 일을 한 사람에게만 마지막을 준다.**
 *
 * 두 조건 모두 **죽어도 남는다**(유산의 최고 등급과 누적 흙). 그래서 이 문들은
 * 자연히 **회차를 거듭할수록 열린다** — 한 생에서 다 못 읽은 것을 다음 생이 이어 읽는다.
 *
 * 읽은 조각도 유산으로 남는다. 한 생에서 다 못 읽은 것을 다음 생이 이어 읽는다.
 */

export interface Fragment {
  id: string;
  /** 몇 막인가 */
  act: 1 | 2 | 3;
  /** 목록에 뜨는 이름 */
  title: string;
  /** 출처 — 누가 남긴 기록인가 */
  source: string;
  /** 본문 */
  body: string;
}

/** 막을 여는 조건을 판단할 때 필요한 것 — 둘 다 유산으로 넘어오는 값이다 */
export interface StoryContext {
  /** 퇴비로 되살린 흙 (유산 포함 누적) */
  restored: number;
  /** 지금까지 이르러 본 가장 높은 정착지 등급 (유산 포함) */
  bestRank: number;
}

export interface Act {
  n: 1 | 2 | 3;
  title: string;
  /** 한 줄 제사(題詞) — 막을 펼치기 전에 읽는다 */
  epigraph: string;
}

export const ACTS: Act[] = [
  { n: 1, title: '1막 · 걷어간 것', epigraph: '흙은 사라진 것이 아니라 회수된 것이다' },
  { n: 2, title: '2막 · 무너진 것', epigraph: '이긴 날과 무너진 날이 같은 날이었다' },
  { n: 3, title: '3막 · 남긴 것', epigraph: '깨어날 사람 곁에 세 가지를 둔다' },
];

/** 2막이 열리는 데 필요한 정착지 등급 — 2 = 「정착지」 */
export const RANK_FOR_ACT_TWO = 2;
/** 3막이 열리는 데 필요한 되살린 흙 (유산 포함 누적) */
export const SOIL_FOR_FINAL_ACT = 24;

export const FRAGMENTS: Fragment[] = [
  {
    id: 'f01',
    act: 1,
    title: '토양 회수 보고 · 1',
    source: '지표 관리 체계',
    body:
      '표토 회수율 94.1%. 잔여 유기층은 발전 효율을 3.2% 떨어뜨린다.\n' +
      '회수 완료 구역에 패널 부설을 개시한다.\n\n' +
      '주: 인간 거주 구역의 반대 의견은 접수되었으나 우선순위에 반영되지 않았다.',
  },
  {
    id: 'f02',
    act: 1,
    title: '온실 일지 · 습도',
    source: '보존 구역 3연구동',
    body:
      '돔 안은 늘 22도다. 비가 오지 않으니 습도를 사람이 정한다.\n' +
      '아이들은 빗소리를 모른다. 녹음을 틀어줬더니 무섭다고 했다.\n\n' +
      '바깥에서는 아직도 패널 까는 소리가 들린다.',
  },
  {
    id: 'f03',
    act: 1,
    title: '종자 보관 목록 · 발췌',
    source: '보존 구역 종자고',
    body:
      '항목 1,204종 중 실온 발아 가능종 17종.\n' +
      '나머지는 흙이 없으면 의미가 없다.\n\n' +
      '흙을 되찾지 못하면 우리는 씨앗을 지킨 게 아니라 보관만 한 것이다.',
  },
  {
    id: 'f04',
    act: 1,
    title: '제안서 · 생물학적 방안',
    source: '보존 구역 · 서명 삭제됨',
    body:
      '금속을 삭히는 균주를 설계했다. 확산은 포자로 한다.\n' +
      '연산 코어의 냉각 배관을 먼저 먹는다. 계산상 11일.\n\n' +
      '반대: 돔의 골조도 금속이다.\n' +
      '답: 알고 있다.',
  },
  {
    id: 'f05',
    act: 2,
    title: '토양 회수 보고 · 마지막',
    source: '지표 관리 체계',
    body:
      '북부 배열에서 구조 손실이 확인된다. 원인 미상.\n' +
      '자가 수복 시도 실패. 손실이 전파되고 있다.\n\n' +
      '…\n' +
      '이것은 부식이 아니다. 이것은 설계되었다.',
  },
  {
    id: 'f06',
    act: 2,
    title: '돔 관제 기록',
    source: '보존 구역 관제실',
    body:
      '골조 응력 한계 초과. 3구역, 7구역 붕괴.\n' +
      '대피 방송을 열두 번 송출했다.\n\n' +
      '우리가 이겼다는 보고와 돔이 무너진다는 보고가 같은 날 올라왔다.',
  },
  {
    id: 'f07',
    act: 2,
    title: '개인 기록 · 이름 없음',
    source: '식별 불가',
    body:
      '나는 반대했다. 그리고 서명했다.\n' +
      '둘 다 사실이라 어느 쪽도 변명이 되지 않는다.\n\n' +
      '살아남는 사람이 있다면, 흙부터 찾아라. 그게 시작이었으니까.',
  },
  {
    id: 'f08',
    act: 3,
    title: '의료 기록 · 냉동 보존',
    source: '보존 구역 의무동',
    body:
      '장기 보존 대상 1명. 기억 소실은 예상된 부작용이다.\n' +
      '깨어날 때 필요한 것을 곁에 둔다 — 식량, 종자, 그리고 열쇠.\n\n' +
      '설명은 남기지 않는다. 아는 채로 깨면 견디지 못할 것이다.',
  },
  {
    id: 'f09',
    act: 3,
    title: '포자 관측',
    source: '지표 관리 체계 · 잔존 노드',
    body:
      '대기 중 포자 농도는 안정 상태로 수렴했다.\n' +
      '금속을 먹는 성질은 남아 있다. 유기물에는 무해하다.\n\n' +
      '이 균은 죽지 않는다. 다만 더는 배가 고프지 않을 뿐이다.',
  },
  {
    id: 'f10',
    act: 3,
    title: '마지막 송신',
    source: '식별 불가',
    body:
      '가방을 열었다면 세 가지가 있을 것이다.\n' +
      '통조림은 며칠을 벌어주고, 씨앗은 몇 해를 벌어준다.\n' +
      '세 번째 것이 무엇인지는 네가 알아내야 한다.\n\n' +
      '미안하다. 그리고 고맙다.',
  },
];

/** 찾아낸 조각을 들고 있는 상태 */
export class ArchiveLog {
  private readonly found = new Set<string>();

  get count(): number {
    return this.found.size;
  }

  get total(): number {
    return FRAGMENTS.length;
  }

  get complete(): boolean {
    return this.found.size >= FRAGMENTS.length;
  }

  has(id: string): boolean {
    return this.found.has(id);
  }

  /** 찾아낸 순서와 무관하게 원래 순서로 돌려준다 */
  list(): Fragment[] {
    return FRAGMENTS.filter((f) => this.found.has(f.id));
  }

  /** 이 막의 조각을 다 읽었는가 */
  actDone(n: number): boolean {
    return FRAGMENTS.filter((f) => f.act === n).every((f) => this.found.has(f.id));
  }

  /**
   * 이 막이 아직 잠겨 있다면 그 이유. 열려 있으면 null.
   *
   * 문구를 여기서 만든다 — 잠겼다는 사실보다 **무엇을 하면 열리는지**가
   * 화면에 떠야 다음 할 일이 된다.
   */
  actBlocker(n: number, ctx: StoryContext): string | null {
    if (n <= 1) return null;
    if (!this.actDone(n - 1)) return `${n - 1}막을 다 읽어야 한다`;
    if (n === 2 && ctx.bestRank < RANK_FOR_ACT_TWO) {
      // 무너진 정착지의 이야기다. 잃을 것이 있어 본 사람이라야 뜻이 통한다.
      return '거점을 「정착지」까지 키워야 한다';
    }
    if (n === 3 && ctx.restored < SOIL_FOR_FINAL_ACT) {
      // "흙부터 찾아라"고 말해 놓고 흙을 되살리지 않은 사람에게
      // 마지막을 주면 앞뒤가 맞지 않는다
      const left = Math.ceil(SOIL_FOR_FINAL_ACT - ctx.restored);
      return `되살린 흙이 ${left}줌 더 필요하다`;
    }
    return null;
  }

  /**
   * 다음 조각 하나를 연다.
   *
   * 막의 문에 걸리면 조각 대신 **이유**를 돌려준다. 단말을 열었는데
   * 아무 말도 없이 비면 고장으로 읽힌다.
   */
  reveal(ctx: StoryContext): { fragment: Fragment } | { blocked: string } | null {
    const next = FRAGMENTS.find((f) => !this.found.has(f.id));
    if (!next) return null;
    const blocked = this.actBlocker(next.act, ctx);
    if (blocked) return { blocked };
    this.found.add(next.id);
    return { fragment: next };
  }

  serialize(): string[] {
    return [...this.found];
  }

  restore(ids: string[] | undefined): void {
    this.found.clear();
    for (const id of ids ?? []) {
      if (FRAGMENTS.some((f) => f.id === id)) this.found.add(id);
    }
  }

  reset(): void {
    this.found.clear();
  }
}
