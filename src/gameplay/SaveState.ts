import type { Slot } from './Inventory';
import type { PlotStage } from '../world/Buildings';
import type { BuildKind } from './Items';

/**
 * 세이브 데이터.
 *
 * 월드 전체가 아니라 **시드 + 변경분**만 담는다 (기획 3.9).
 * 지형과 폐허와 자원 노드의 배치는 시드에서 결정론적으로 다시 만들어지므로,
 * 저장할 것은 "플레이어가 세상에 남긴 차이"뿐이다 —
 * 캔 노드, 지은 것, 가진 것, 그리고 시계.
 */
export interface SaveState {
  time: { day: number; phase: number };
  player: { x: number; y: number; z: number; facing: number };
  stats: {
    hp: number;
    hunger: number;
    thirst: number;
    /** v0.3에서 추가 — 옛 세이브에는 없다 */
    warmth?: number;
    spore?: number;
    sickness?: number;
  };
  inventory: Array<Slot | null>;
  /** 핫바 배정 — 이게 빠지면 다시 켤 때마다 1번이 엉뚱한 물건이 된다 */
  bindings?: Array<string | null>;
  /** 캐서 줄어든 노드만 [인덱스, 남은 횟수] 로 */
  nodes: Array<[number, number]>;
  buildings: Array<{
    kind: BuildKind;
    gx: number;
    gz: number;
    stage: PlotStage;
    growth: number;
    moisture: number;
    stored: number;
    /** 옛 세이브에는 없을 수 있다 */
    fertility?: number;
  }>;
  /** 한 판 동안의 누적 — 사망 기록으로 서버에 올라간다 */
  tally: { harvests: number; gathered: number; refuels?: number };
  /**
   * 조감도로 열어둔 레시피 id.
   * 이게 빠지면 어렵게 찾은 설계가 새로고침 한 번에 사라진다.
   */
  unlocked?: string[];
  /** 길잡이 진행 단계 */
  guide?: number;
  /**
   * 퇴비로 되살린 흙의 누적 (v0.3).
   * 환경 악화 곡선의 "상승 곡선" — 이게 빠지면 되살린 만큼이 새로고침에 사라진다.
   */
  restored?: number;
  /** 지난 생들이 지나보낸 계절 수 (v0.6) — 옛 세이브에는 없으므로 없으면 0 */
  worldSeasons?: number;
  /** 찾아낸 기록 조각 id */
  archive?: string[];
  /** 종자고를 열었는지 (v0.5) — 한 번 열린 문은 다시 닫히지 않는다 */
  vault?: boolean;
  /** 올라가 본 관측 첨탑의 번호 (v0.5) */
  masts?: number[];
  /** 첨탑에서 눈에 담아둔 자원 노드의 번호 — 배치는 시드가 만드므로 번호면 충분하다 */
  surveyed?: number[];
  /** 보관함 내용 — 격자 좌표를 키로 (설치물 목록과 짝을 이룬다) */
  storage?: Array<{ gx: number; gz: number; slots: Array<Slot | null> }>;
}
