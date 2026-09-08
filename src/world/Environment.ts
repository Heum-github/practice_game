import { HAZARD } from '../config';
import { clamp } from '../util/math';
import type { GameTime } from '../core/GameTime';

/**
 * 환경 악화 곡선 (기획서 3.7) — 교차하는 두 곡선.
 *
 * 이 게임의 긴장은 "오늘 밤을 넘길 수 있는가"에서 끝나면 안 된다.
 * 하루하루를 아무리 잘 넘겨도 세계가 그대로면, 스무 번째 밤은 첫 번째 밤과 같다.
 *
 *   **하강 곡선** — 잔류 포자 농도는 해가 갈수록 오른다.
 *   숨만 쉬어도 노출이 빨리 쌓이고, 가만히 둔 도구도 더 빨리 삭는다.
 *
 *   **상승 곡선** — 플레이어가 되살린 땅이 그 농도를 도로 끌어내린다.
 *
 * 되살림을 **퇴비로 만든 흙**으로 센다. 밭 개수를 세면 캐온 흙을 옮겨 심기만 해도
 * 지수가 오르지만, 퇴비는 없던 흙을 만들어낸 것이라 세계가 실제로 나아진 몫이다.
 * 3.2의 "퇴비는 중반 기술 목표"와 3.7의 "상승 곡선"이 여기서 같은 것이 된다.
 *
 * 이 값 하나가 포자 노출·도구 부식에 함께 걸리므로, 곡선을 손보고 싶으면
 * 여기만 만지면 된다.
 */
export class Environment {
  /** 퇴비로 되살린 흙의 누적 — 세이브에 실린다 */
  restored = 0;

  /** 계절과 무관한 장기 추세 (1일차 1.0에서 서서히 오른다) */
  private trend: number = HAZARD.base;
  /** 계절 배수까지 얹은 실효 농도 */
  private effective: number = HAZARD.base;

  /** 계절이 바뀌는 순간을 잡기 위한 직전 계절 */
  private lastSeason = -1;

  /**
   * 지난 생들이 이미 지나보낸 계절 수.
   *
   * `restored`(하강을 끌어내리는 몫)는 유산으로 대를 잇는데 `time.seasonsElapsed`
   * (밀어올리는 몫)는 매 생 0에서 시작하면, 한 생 만에 되살림이 하한을 넘긴
   * 다음 생은 1일차부터 이미 바닥이고 그 뒤로 세계가 더는 변하지 않는다.
   * 같은 시드의 같은 폐허이니 세계의 나이도 사람처럼 대를 이어야 저울이 산다.
   */
  private carried = 0;

  update(time: GameTime): void {
    // 장기 추세는 제 천장에서 멈춘다
    const seasons = this.carried + time.seasonsElapsed;
    const rise = Math.min(HAZARD.base + seasons * HAZARD.perSeason, HAZARD.trendMax);
    const relief = this.restored * HAZARD.reliefPerSoil;
    this.trend = clamp(rise - relief, HAZARD.minDensity, HAZARD.trendMax);

    // 계절은 그 위에 곱해지고, 실효 농도가 다시 한 번 천장에 걸린다.
    // 곱한 뒤에 막지 않으면 포자철이 천장을 뚫고 나간다.
    this.effective = clamp(this.trend * time.season.spore, HAZARD.minDensity * 0.5, HAZARD.max);
  }

  /**
   * 지금의 잔류 포자 농도. 1이 1일차 기준이다.
   * 포자 노출과 금속 부식이 함께 이 값에 걸린다.
   */
  get density(): number {
    return this.effective;
  }

  /** 계절을 뺀 장기 추세만 — "세계가 얼마나 나빠졌는가" */
  get trendOnly(): number {
    return this.trend;
  }

  /** 되살림이 지금 끌어내리고 있는 양 */
  get relief(): number {
    return this.restored * HAZARD.reliefPerSoil;
  }

  /** 퇴비에서 흙을 꺼낼 때마다 부른다 */
  addRestored(amount = 1): void {
    this.restored += amount;
  }

  /**
   * 계절이 막 바뀌었으면 새 계절 번호를 돌려준다 (아니면 -1).
   * 풀 재생과 알림이 이 신호를 쓴다.
   */
  takeSeasonChange(time: GameTime): number {
    const now = time.seasonIndex;
    if (now === this.lastSeason) return -1;
    const first = this.lastSeason < 0;
    this.lastSeason = now;
    // 첫 프레임은 "바뀐 것"이 아니다 — 시작하자마자 알림이 뜨면 어리둥절하다
    return first ? -1 : now;
  }

  /** 지난 생들이 지나보낸 계절 수 — 세이브·유산·개발 훅이 읽는다 */
  get carriedSeasons(): number {
    return this.carried;
  }

  /** 이어하기·초기화용. 세이브 이어받기와 유산 승계가 같은 시그니처를 쓴다 */
  reset(restored = 0, carriedSeasons = 0): void {
    this.restored = restored;
    this.carried = carriedSeasons;
    this.trend = HAZARD.base;
    this.effective = HAZARD.base;
    this.lastSeason = -1;
  }
}
