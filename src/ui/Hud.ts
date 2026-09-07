import * as THREE from 'three';

export interface HudState {
  day: number;
  /** "포자철 7일" — 계절 이름과 그 안에서의 날짜 */
  season: string;
  seasonColor: string;
  /** 정착지 등급 이름과 다음 조건 */
  settlement: string;
  settlementHint: string;
  clock: string;
  phase: string;
  /** 0..1 하루 진행도 */
  dayProgress: number;
  isNight: boolean;

  fps: number;
  position: THREE.Vector3;
  speed: number;
  grounded: boolean;
  sliding: boolean;
  /** 발밑의 흙 함유량 0..1 */
  soil: number;

  drawCalls: number;
  triangles: number;
  colliders: number;
  /** 살아 있는 변이 생물 수 */
  creatures: number;
  /** 마우스 시점 조작 방식 — '잠금' 이면 커서가 잡혀 자유롭게 돌아간다 */
  lookMode: string;
  /** 거점 상태 한 줄 — 수확할 밭, 마른 밭, 고인 물 */
  base: {
    ripe: number;
    dry: number;
    empty: number;
    filled: number;
    firesOut: number;
    firesLow: number;
    compostReady: number;
  };
  /** 잔류 포자 농도 — "1.24배 (되살림 0.10)" */
  hazard: string;
  hazardWarn: boolean;
  /** 지금 세이브가 어디로 가는지 — '서버' / '로컬' */
  saveTarget: string;
}

/** 값 하나를 표시하는 행 */
class Row {
  readonly el: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private last = '';

  constructor(parent: HTMLElement, label: string) {
    this.el = document.createElement('div');
    this.el.className = 'row';

    const k = document.createElement('span');
    k.className = 'row__k';
    k.textContent = label;

    this.value = document.createElement('span');
    this.value.className = 'row__v';

    this.el.append(k, this.value);
    parent.appendChild(this.el);
  }

  set(text: string, tone: '' | 'accent' | 'warn' = ''): void {
    if (text !== this.last) {
      this.value.textContent = text;
      this.last = text;
    }
    const cls = tone ? `row__v row__v--${tone}` : 'row__v';
    if (this.value.className !== cls) this.value.className = cls;
  }

  /** 색을 직접 주는 줄 — 계절처럼 값 자체가 색을 갖는 경우 */
  setColored(text: string, color: string): void {
    if (text !== this.last) {
      this.value.textContent = text;
      this.value.style.color = color;
      this.last = text;
    }
  }
}

/**
 * 상태 표시 오버레이.
 * v0.1은 디버그 성격이 강하다. 체력·포만감·수분 게이지는 v0.2에서 이 자리를 대체한다.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly needle: HTMLDivElement;
  private readonly phaseLabel: HTMLDivElement;

  private readonly rDay: Row;
  private readonly rSeason: Row;
  private readonly rTown: Row;
  private readonly rClock: Row;
  private readonly rFps: Row;
  private readonly rPos: Row;
  private readonly rSpeed: Row;
  private readonly rState: Row;
  private readonly rSoil: Row;
  private readonly rDraw: Row;
  private readonly rTri: Row;
  private readonly rCol: Row;
  private readonly rHazard: Row;
  private readonly rSave: Row;
  private readonly rCreature: Row;
  private readonly rLook: Row;

  /** 텍스트 갱신 주기 (s) — 매 프레임 DOM을 건드릴 이유가 없다 */
  private static readonly INTERVAL = 0.1;
  private acc = Hud.INTERVAL;

  /** 시계 패널이 자랄 때마다 길잡이를 밀어내리는 관찰자 */
  private readonly stack: ResizeObserver;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const vignette = document.createElement('div');
    vignette.className = 'hud__vignette';
    this.root.appendChild(vignette);

    // ---------------------------------------------------------- 시간 패널
    const clock = document.createElement('div');
    clock.className = 'panel panel--clock';

    this.rDay = new Row(clock, '일차');
    this.rSeason = new Row(clock, '계절');
    this.rTown = new Row(clock, '정착지');
    this.rClock = new Row(clock, '시각');

    this.phaseLabel = document.createElement('div');
    this.phaseLabel.className = 'phase';
    clock.appendChild(this.phaseLabel);

    const bar = document.createElement('div');
    bar.className = 'daybar';
    this.needle = document.createElement('div');
    this.needle.className = 'daybar__needle';
    bar.appendChild(this.needle);
    clock.appendChild(bar);

    this.root.appendChild(clock);

    // 길잡이가 이 패널 **바로 아래**에 서도록 아랫변의 높이를 넘긴다.
    //
    // 예전에는 길잡이 쪽 CSS 에 top: 96px 이 박혀 있었다. 그때는 맞았는데,
    // v0.4에서 '정착지' 줄이 하나 늘자 시계 패널이 그 아래로 자라
    // **날짜와 계절을 길잡이가 덮어버렸다.** 숫자를 다시 고쳐도 줄이 또 늘면
    // 같은 일이 생긴다 — 그래서 재서 알려주는 쪽으로 바꿨다.
    this.stack = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--hud-clock-bottom',
        `${clock.offsetTop + clock.offsetHeight}px`,
      );
    });
    this.stack.observe(clock);

    // ---------------------------------------------------------- 상태 패널
    const stats = document.createElement('div');
    stats.className = 'panel panel--stats';

    this.rPos = new Row(stats, '좌표');
    this.rSpeed = new Row(stats, '속력');
    this.rState = new Row(stats, '상태');
    this.rSoil = new Row(stats, '발밑 비옥도');

    const div = document.createElement('div');
    div.className = 'divider';
    stats.appendChild(div);

    this.rFps = new Row(stats, 'FPS');
    this.rDraw = new Row(stats, '드로우콜');
    this.rTri = new Row(stats, '삼각형');
    this.rCol = new Row(stats, '콜라이더');
    this.rCreature = new Row(stats, '변이 생물');
    this.rLook = new Row(stats, '시점');
    this.rHazard = new Row(stats, '포자 농도');
    this.rSave = new Row(stats, '저장');

    this.root.appendChild(stats);

    // ---------------------------------------------------------- 조작 안내
    const help = document.createElement('div');
    help.className = 'panel panel--help';
    help.innerHTML = [
      'WSAD — 이동',
      'SHIFT — 달리기',
      'SPACE — 점프',
      'E — 채집 · 농사 (길게)',
      '좌클릭 — 설치 · 공격',
      'R — 방벽 방향 · 밭 회전',
      'X — 철거 (길게)',
      '1‥6 — 슬롯',
      'TAB — 가방 · C — 제작',
      'Q — 선택한 칸 버리기',
      'F — 먹기 · 마시기 · 설계 읽기',
      '마우스 — 시점 · 휠 — 거리',
      'ESC — 커서 해제',
    ].join('<br>');
    this.root.appendChild(help);

    container.appendChild(this.root);
  }

  update(dt: number, s: HudState): void {
    this.needle.style.left = `${(s.dayProgress * 100).toFixed(1)}%`;

    this.acc += dt;
    if (this.acc < Hud.INTERVAL) return;
    this.acc = 0;

    this.rDay.set(`${s.day}`, 'accent');
    this.rSeason.setColored(s.season, s.seasonColor);
    // 등급 옆에 다음 조건을 붙인다 — 무엇을 더 지어야 하는지가 곧 다음 목표다
    this.rTown.set(
      s.settlementHint ? `${s.settlement} → ${s.settlementHint}` : s.settlement,
      s.settlement === '야영지' ? '' : 'accent',
    );
    this.rClock.set(s.clock, s.isNight ? 'warn' : '');
    this.rHazard.set(s.hazard, s.hazardWarn ? 'warn' : '');
    this.phaseLabel.textContent = s.phase;

    this.rPos.set(
      `${s.position.x.toFixed(0)}, ${s.position.y.toFixed(0)}, ${s.position.z.toFixed(0)}`,
    );
    this.rSpeed.set(`${s.speed.toFixed(1)} m/s`);
    this.rState.set(
      s.sliding ? '미끄러짐' : s.grounded ? '접지' : '공중',
      s.sliding ? 'warn' : '',
    );

    const soilPct = Math.round(s.soil * 100);
    this.rSoil.set(`${soilPct}%`, soilPct > 45 ? 'accent' : '');

    this.rFps.set(`${Math.round(s.fps)}`, s.fps < 40 ? 'warn' : '');
    this.rDraw.set(`${s.drawCalls}`);
    this.rTri.set(`${(s.triangles / 1000).toFixed(0)}k`);
    this.rCol.set(`${s.colliders}`);
    this.rSave.set(s.saveTarget, s.saveTarget === '서버' ? 'accent' : '');
    this.rCreature.set(`${s.creatures}`, s.creatures > 0 ? 'warn' : '');
    this.rLook.set(s.lookMode, s.lookMode === '잠금' ? 'accent' : 'warn');
  }

  dispose(): void {
    this.stack.disconnect();
    this.root.remove();
  }
}
