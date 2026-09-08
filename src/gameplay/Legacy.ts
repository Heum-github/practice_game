/**
 * 유산 — 죽음을 넘어 남는 것 (기획서 7장 리스크의 완충안).
 *
 * 사망은 완전 초기화다. 그 결정은 그대로 두었다 — 되돌릴 수 있으면
 * 밤이 무섭지 않고, 밤이 무섭지 않으면 이 게임에 남는 것이 없다.
 *
 * 다만 한 해가 15시간이고 마을까지 키운 뒤에 **전부** 잃으면,
 * 그건 긴장이 아니라 그냥 그만둘 이유다. 그래서 무엇을 남길지 골라야 했고,
 * 기준을 하나 세웠다 —
 *
 *   **손에 있던 것은 잃고, 머리에 남은 것과 세계에 준 것은 남는다.**
 *
 * 물자·건물·정착지·생존자는 당신의 것이었으므로 함께 사라진다.
 * 그러나 해독한 조감도와 읽은 기록은 **데이터**다. 이 세계에서 데이터는
 * 사람보다 오래 남는다 — 애초에 주인공이 폐허에서 주워 온 것이 그것이었다.
 *
 * 그리고 **퇴비로 되살린 흙은 남는다.** 그것만은 당신의 소유물이 아니라
 * 땅에 돌려준 것이기 때문이다. 3.7의 상승 곡선이 한 생에서 끝나지 않고
 * 대를 잇는다 — 세계를 되살리는 일은 원래 한 사람이 끝낼 수 있는 일이 아니다.
 */

const KEY = 'eden:legacy:v1';

export interface LegacyData {
  /** 몇 번째 생인가 (1부터) */
  runs: number;
  /** 해독해둔 조감도 레시피 id */
  unlocked: string[];
  /** 읽어낸 기록 조각 id */
  archive: string[];
  /** 퇴비로 되살린 흙의 누적 — 땅에 돌려준 몫이라 남는다 */
  restored: number;
  /**
   * 지난 생들이 지나보낸 계절의 누적.
   *
   * 되살린 흙이 대를 잇는다면 세계가 늙은 만큼도 함께 넘어가야 한다 —
   * 같은 시드의 같은 폐허이므로 지난 생이 겪은 세월이 사라질 이유가 없다
   * (docs/game/environment.md 의 상승 곡선을 회차 너머까지 참으로 만드는 값이다).
   */
  seasons: number;
  /** 가장 오래 버틴 날 */
  bestDays: number;
  /** 가장 크게 키운 정착지 등급 */
  bestRank: number;
  /**
   * 종자고를 열었는가.
   *
   * 이것도 **머리에 남는 것**이다 — 문을 여는 방법을 알았고, 그 안의 것을
   * 이미 손에 넣었다. 다음 생이 같은 문 앞에서 처음부터 다시 시작하면
   * 계승이 아니라 그냥 반복이다.
   */
  vault: boolean;
  /**
   * 올라가 본 관측 첨탑과 거기서 눈에 담은 자원 노드.
   *
   * 이것도 **머리에 남는 것**이다. 같은 시드의 같은 폐허이므로 앞사람이 그린
   * 지도는 다음 사람에게도 그대로 맞는다 — 두 번째 생은 힘이 세지는 게 아니라
   * 길을 아는 채로 시작한다.
   */
  masts: number[];
  surveyed: number[];
}

function empty(): LegacyData {
  return {
    runs: 1,
    unlocked: [],
    archive: [],
    restored: 0,
    seasons: 0,
    bestDays: 0,
    bestRank: 0,
    vault: false,
    masts: [],
    surveyed: [],
  };
}

/**
 * 불러온다. 없거나 깨졌으면 첫 생으로 본다.
 *
 * localStorage 를 쓴다 — 세이브는 사망 시 서버에서 지워지지만 유산은 남아야 하므로
 * 저장 위치 자체를 분리했다. 한쪽을 지우는 코드가 다른 쪽을 건드릴 수 없다.
 */
export function loadLegacy(): LegacyData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as Partial<LegacyData>;
    return {
      runs: numberOr(data.runs, 1),
      unlocked: Array.isArray(data.unlocked) ? data.unlocked.filter(isText) : [],
      archive: Array.isArray(data.archive) ? data.archive.filter(isText) : [],
      restored: numberOr(data.restored, 0),
      seasons: numberOr(data.seasons, 0),
      bestDays: numberOr(data.bestDays, 0),
      bestRank: numberOr(data.bestRank, 0),
      vault: data.vault === true,
      masts: Array.isArray(data.masts) ? data.masts.filter(isNumber) : [],
      surveyed: Array.isArray(data.surveyed) ? data.surveyed.filter(isNumber) : [],
    };
  } catch {
    return empty();
  }
}

/**
 * 이번 생이 끝났다. 남길 것을 추려 다음 생에 넘긴다.
 *
 * 지식은 **합집합**이다 — 지난 생에 배운 것을 이번 생에 못 찾았다고 잊지 않는다.
 * 되살린 흙은 **누적**이다 — 대를 이어 쌓이는 유일한 값이다.
 */
export function recordDeath(
  prev: LegacyData,
  run: {
    unlocked: string[];
    archive: string[];
    restored: number;
    /** 이번 생에서 지나보낸 계절 수 — 세계 나이도 흙처럼 누적된다 */
    seasons: number;
    days: number;
    rank: number;
    vault: boolean;
    masts: number[];
    surveyed: number[];
  },
): LegacyData {
  const next: LegacyData = {
    runs: prev.runs + 1,
    vault: prev.vault || run.vault,
    masts: [...new Set([...prev.masts, ...run.masts])],
    surveyed: [...new Set([...prev.surveyed, ...run.surveyed])],
    unlocked: [...new Set([...prev.unlocked, ...run.unlocked])],
    archive: [...new Set([...prev.archive, ...run.archive])],
    restored: prev.restored + Math.max(0, run.restored),
    seasons: prev.seasons + Math.max(0, run.seasons),
    bestDays: Math.max(prev.bestDays, run.days),
    bestRank: Math.max(prev.bestRank, run.rank),
  };
  save(next);
  return next;
}

export function save(data: LegacyData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장할 수 없어도 게임은 계속된다. 유산은 있으면 좋은 것이지 전제가 아니다.
  }
}

/** 개발용 — 처음부터 다시 */
export function clearLegacy(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/**
 * 사망 화면에 띄울 "무엇이 남는가" 목록.
 * 잃은 것을 먼저 말하고 남는 것을 뒤에 둔다 — 마지막에 읽는 것이 다음 생을 시작하게 한다.
 */
export function legacyLines(run: {
  unlocked: number;
  archive: number;
  restored: number;
  /** 이 세계가 대를 이어 지나보낸 계절 수 — 되살린 흙과 나란히 선다 */
  seasons?: number;
  vault?: boolean;
  masts?: number;
}): string[] {
  const kept: string[] = [];
  if (run.unlocked > 0) kept.push(`해독한 설계 ${run.unlocked}가지`);
  if (run.archive > 0) kept.push(`되찾은 기록 ${run.archive}편`);
  if (run.restored > 0) kept.push(`되살린 흙 ${Math.round(run.restored)}줌`);
  if (run.seasons && Math.floor(run.seasons) > 0) {
    kept.push(`이 세계가 난 계절 ${Math.floor(run.seasons)}번`);
  }
  if (run.masts) kept.push(`눈에 담은 일대 ${run.masts}곳`);
  if (run.vault) kept.push('열어둔 종자고');
  return kept;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isText(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
