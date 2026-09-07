import { SEASONS, TIME } from '../config';
import { clamp, smoothstep } from '../util/math';

export type DayPhase = '심야' | '여명' | '아침' | '한낮' | '오후' | '황혼' | '밤';

/** 계절 하나의 정의 */
export type Season = (typeof SEASONS)[number];

/**
 * 게임 내 시간. 하루 = 실시간 15분.
 * 태양 고도와 낮/밤 판정의 단일 출처(single source of truth)다.
 */
export class GameTime {
  /** 0 = 자정, 0.5 = 정오. [0,1) */
  phase: number = TIME.startPhase;
  /** 1일차부터 시작 */
  day = 1;
  /** 시간 배속 — 디버그용 */
  scale = 1;

  update(dt: number): void {
    this.phase += (dt * this.scale) / TIME.secondsPerDay;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.day += 1;
    }
  }

  /**
   * 태양의 궤도각.
   * 0 = 동쪽 지평선, PI/2 = 천정, PI = 서쪽 지평선, PI~2PI = 지평선 아래.
   */
  get sunAngle(): number {
    const { dawn, dusk } = TIME;
    const p = this.phase;
    if (p >= dawn && p < dusk) {
      return ((p - dawn) / (dusk - dawn)) * Math.PI;
    }
    const night = p < dawn ? p + 1 : p;
    return Math.PI + ((night - dusk) / (1 - dusk + dawn)) * Math.PI;
  }

  /** -1 .. 1 (지평선 위가 양수) */
  get sunElevation(): number {
    return Math.sin(this.sunAngle);
  }

  /**
   * 0 = 완전한 밤, 1 = 완전한 낮.
   * 지평선 부근을 부드럽게 넘겨 일출·일몰이 뚝 끊기지 않게 한다.
   */
  get daylight(): number {
    return smoothstep(-0.14, 0.18, this.sunElevation);
  }

  get isNight(): boolean {
    return this.daylight < 0.5;
  }

  /** 달의 위상 (0..1) — 8일 주기 */
  get moonPhase(): number {
    return ((this.day - 1) % 8) / 8;
  }

  // ---------------------------------------------------------------- 계절

  /** 지금 몇 번째 계절인가 (0..3) */
  get seasonIndex(): number {
    return Math.floor((this.day - 1) / TIME.daysPerSeason) % SEASONS.length;
  }

  get season(): Season {
    return SEASONS[this.seasonIndex]!;
  }

  /** 이 계절의 며칠째인가 (1부터) */
  get dayOfSeason(): number {
    return ((this.day - 1) % TIME.daysPerSeason) + 1;
  }

  /** 몇 년째인가 (1부터). 1년 = 네 계절 = 60일 */
  get year(): number {
    return Math.floor((this.day - 1) / (TIME.daysPerSeason * SEASONS.length)) + 1;
  }

  /** 1일차부터 지난 계절 수 — 환경 악화 곡선의 가로축 */
  get seasonsElapsed(): number {
    return (this.day - 1) / TIME.daysPerSeason;
  }

  /** "2년 · 포자철 7일" */
  get seasonText(): string {
    return `${this.year}년 · ${this.season.name} ${this.dayOfSeason}일`;
  }

  get phaseName(): DayPhase {
    const p = this.phase;
    if (p < 0.17) return '심야';
    if (p < 0.24) return '여명';
    if (p < 0.36) return '아침';
    if (p < 0.58) return '한낮';
    if (p < 0.74) return '오후';
    if (p < 0.84) return '황혼';
    return '밤';
  }

  /** "06:42" 형식 */
  get clockText(): string {
    const totalMinutes = clamp(this.phase, 0, 0.99999) * 24 * 60;
    const h = Math.floor(totalMinutes / 60);
    const m = Math.floor(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
