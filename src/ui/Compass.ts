export interface CompassMark {
  /** 월드 방위각 (rad) — atan2(dx, dz) */
  angle: number;
  distance: number;
  glyph: string;
  color: string;
}

/** 화면에 그릴 방위 범위 (rad) — 이보다 옆에 있는 것은 띠 밖이다 */
const HALF_SPAN = Math.PI * 0.42;

/**
 * 화면 위쪽의 방위 띠.
 *
 * 200m 월드에 표지가 하나도 없으면 거점으로 돌아가는 일이 순전히 기억력 싸움이 된다.
 * 지도를 통째로 주는 대신 방위와 거리만 알려준다 — 어디로 가야 하는지는 알지만
 * 무엇이 있는지는 직접 가 봐야 하는 정도의 정보량이다.
 */
export class Compass {
  private readonly root: HTMLDivElement;
  private readonly strip: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly cardinals: HTMLDivElement[] = [];
  /** 마지막으로 DOM에 쓴 값 — 같은 값을 다시 쓰면 레이아웃만 다시 계산된다 */
  private readonly lastLeft = new WeakMap<HTMLElement, number>();
  private readonly lastText = new WeakMap<HTMLElement, string>();

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'compass';

    this.strip = document.createElement('div');
    this.strip.className = 'compass__strip';
    this.root.appendChild(this.strip);

    const needle = document.createElement('div');
    needle.className = 'compass__needle';
    this.root.appendChild(needle);

    container.appendChild(this.root);

    // 동서남북 눈금은 개수가 고정이라 미리 만들어 둔다
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'compass__card';
      el.textContent = ['북', '동', '남', '서'][i]!;
      this.strip.appendChild(el);
      this.cardinals.push(el);
    }
  }

  /**
   * @param yaw 카메라가 바라보는 방위 (rad)
   * @param marks 표시할 지점들
   */
  update(yaw: number, marks: CompassMark[]): void {
    // 카메라 전방 = -(sin yaw, cos yaw) 이므로 화면 중앙이 가리키는 방위는 이렇게 된다
    const facing = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));

    for (let i = 0; i < 4; i++) {
      // 북(-Z) 기준으로 90도씩
      this.place(this.cardinals[i]!, (i * Math.PI) / 2, facing);
    }

    // 부족하면 늘리고, 남으면 숨긴다
    while (this.pool.length < marks.length) {
      const el = document.createElement('div');
      el.className = 'compass__mark';
      el.innerHTML = '<b></b><i></i>';
      this.strip.appendChild(el);
      this.pool.push(el);
    }

    for (let i = 0; i < this.pool.length; i++) {
      const el = this.pool[i]!;
      const mark = marks[i];
      if (!mark) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      const label = `${mark.glyph}|${Math.round(mark.distance)}`;
      if (this.lastText.get(el) !== label) {
        this.lastText.set(el, label);
        el.style.color = mark.color;
        el.querySelector('b')!.textContent = mark.glyph;
        el.querySelector('i')!.textContent = `${Math.round(mark.distance)}m`;
      }
      this.place(el, mark.angle, facing);
    }
  }

  /** 방위각을 띠 위의 가로 위치로 옮긴다 */
  private place(el: HTMLElement, angle: number, facing: number): void {
    let rel = angle - facing;
    // -PI..PI 로 접는다
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));

    if (Math.abs(rel) > HALF_SPAN) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    // 0.1% 단위로 양자화 — 사람 눈에는 같고, 브라우저에는 "안 바뀐 값"이 된다
    const t = Math.round((0.5 + rel / (HALF_SPAN * 2)) * 1000);
    if (this.lastLeft.get(el) !== t) {
      this.lastLeft.set(el, t);
      el.style.left = `${t / 10}%`;
      el.style.opacity = (1 - Math.abs(rel / HALF_SPAN) * 0.65).toFixed(2);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
