import { AILMENT, INVENTORY, SURVIVAL } from '../config';
import { itemIcon } from './ItemIcons';
import type { Inventory } from '../gameplay/Inventory';
import type { SurvivalStats } from '../gameplay/SurvivalStats';
import { itemDef } from '../gameplay/Items';
import type { ItemId } from '../gameplay/Items';

/** 게이지 한 줄 */
class Gauge {
  readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly name: HTMLSpanElement;
  private lastPct = -1;
  private lastWarn = false;
  private lastLabel: string;
  private visible = true;

  /**
   * @param warnAt 이 값을 지나면 경고색
   * @param rising true 면 "올라갈수록 나쁜" 게이지 (포자 노출)
   */
  constructor(
    parent: HTMLElement,
    label: string,
    tone: string,
    private readonly warnAt: number = SURVIVAL.warnLevel,
    private readonly rising = false,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'gauge';
    this.lastLabel = label;

    const head = document.createElement('div');
    head.className = 'gauge__head';

    const name = document.createElement('span');
    name.textContent = label;
    this.name = name;

    this.value = document.createElement('span');
    this.value.className = 'gauge__value';

    head.append(name, this.value);

    const track = document.createElement('div');
    track.className = 'gauge__track';
    this.fill = document.createElement('div');
    this.fill.className = 'gauge__fill';
    this.fill.style.background = tone;
    track.appendChild(this.fill);

    this.el.append(head, track);
    parent.appendChild(this.el);
  }

  set(current: number, max: number): void {
    const pct = Math.max(0, Math.min(1, current / max));
    const rounded = Math.round(pct * 200);
    if (rounded !== this.lastPct) {
      this.fill.style.width = `${pct * 100}%`;
      this.value.textContent = String(Math.ceil(current));
      this.lastPct = rounded;
    }
    const warn = this.rising ? current > this.warnAt : current < this.warnAt;
    if (warn !== this.lastWarn) {
      this.el.classList.toggle('gauge--warn', warn);
      this.lastWarn = warn;
    }
  }

  /** 라벨을 바꾼다 — 노출이 발병으로 바뀌면 이름도 바뀌어야 한다 */
  setLabel(label: string, tone?: string): void {
    if (label === this.lastLabel) return;
    this.name.textContent = label;
    if (tone) this.fill.style.background = tone;
    this.lastLabel = label;
  }

  /** 평소에는 없다가 필요할 때만 나타나는 게이지 */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.el.style.display = on ? '' : 'none';
    this.visible = on;
  }
}

/**
 * 플레이어 상태 HUD — 생존 게이지, 핫바, 채집 안내, 인벤토리, 획득 알림.
 *
 * 디버그 수치를 보여주는 Hud와 분리되어 있다. 이쪽은 실제 플레이에 필요한 정보만 담는다.
 */
export class PlayerHud {
  private readonly root: HTMLDivElement;

  private readonly gHp: Gauge;
  private readonly gHunger: Gauge;
  private readonly gThirst: Gauge;
  private readonly gWarmth: Gauge;
  /** 포자 노출 — 쌓이기 전에는 화면에 없다 */
  private readonly gSpore: Gauge;

  private readonly hotbarCells: HTMLDivElement[] = [];
  private readonly bagCells: HTMLDivElement[] = [];
  private readonly bag: HTMLDivElement;
  private readonly bagDetail: HTMLDivElement;

  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLSpanElement;
  private readonly promptFill: HTMLDivElement;

  private readonly toasts: HTMLDivElement;
  private readonly baseBar: HTMLDivElement;
  private readonly baseChips: HTMLDivElement[] = [];
  private lastBaseKey = '';
  private readonly place: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly placeLabel: HTMLSpanElement;
  private readonly placeFill: HTMLDivElement;

  private bagOpen = false;

  /** 가방에서 고른 아이템 종류 — 다음에 누르는 핫바 칸에 배정된다 */
  private pendingBind: ItemId | null = null;
  /** 자리를 옮기려고 집어 든 핫바 칸 — 다음에 누르는 칸과 맞바꾼다 */
  private pendingSwap: number | null = null;
  /** 가방 안의 핫바 배정 칸 */
  private readonly assignCells: HTMLDivElement[] = [];
  /** 마우스를 따라다니는 설명 상자 */
  private readonly tip: HTMLDivElement;
  /** 길잡이 — 지금 할 일 하나 */
  private readonly guide: HTMLDivElement;
  private lastPromptLabel = '';
  private lastPlaceText = '';
  /** 피격 잔상 0..1 — 프레임에서 직접 줄인다 */
  private hurtLevel = 0;
  /** 가방 칸을 버릴 때 알린다 */
  private onDropSlot?: (index: number) => void;

  constructor(container: HTMLElement, private readonly inventory: Inventory) {
    this.root = document.createElement('div');
    this.root.className = 'phud';

    // ---------------------------------------------------------- 생존 게이지
    const stats = document.createElement('div');
    stats.className = 'phud__stats';
    this.gHp = new Gauge(stats, '체력', 'linear-gradient(90deg,#8c3b3b,#c4564e)');
    this.gHunger = new Gauge(stats, '포만', 'linear-gradient(90deg,#7a6a30,#c0a24e)');
    this.gThirst = new Gauge(stats, '수분', 'linear-gradient(90deg,#2f5d70,#5b9cb8)');
    this.gWarmth = new Gauge(
      stats,
      '체온',
      'linear-gradient(90deg,#6b4a2e,#d08a4a)',
      AILMENT.shiverLevel,
    );
    // 포자는 "차오르면 나쁜" 게이지다. 다른 넷과 방향이 반대라
    // 색과 경고 조건을 뒤집어 둔다.
    this.gSpore = new Gauge(
      stats,
      '포자',
      'linear-gradient(90deg,#5a4670,#a97fd0)',
      AILMENT.sporeShowLevel + 40,
      true,
    );
    this.gSpore.setVisible(false);
    this.root.appendChild(stats);

    // ---------------------------------------------------------- 채집 안내
    this.prompt = document.createElement('div');
    this.prompt.className = 'phud__prompt phud__prompt--hidden';

    const key = document.createElement('b');
    key.textContent = 'E';
    this.promptText = document.createElement('span');

    const bar = document.createElement('div');
    bar.className = 'phud__promptbar';
    this.promptFill = document.createElement('div');
    bar.appendChild(this.promptFill);

    this.prompt.append(key, this.promptText, bar);
    this.root.appendChild(this.prompt);

    // ---------------------------------------------------------- 피격 연출
    this.hurt = document.createElement('div');
    this.hurt.className = 'phud__hurt';
    this.root.appendChild(this.hurt);

    // ---------------------------------------------------------- 설치 안내
    this.place = document.createElement('div');
    this.place.className = 'phud__place phud__place--hidden';
    this.placeLabel = document.createElement('span');
    const placeBar = document.createElement('div');
    placeBar.className = 'phud__placebar';
    this.placeFill = document.createElement('div');
    placeBar.appendChild(this.placeFill);
    this.place.append(this.placeLabel, placeBar);
    this.root.appendChild(this.place);

    // ---------------------------------------------------------- 거점 상태
    // 밭이 흩어져 있으면 무엇이 밀렸는지 직접 걸어다니며 확인해야 한다.
    // 수확할 것과 목마른 밭의 개수만 띄워도 그 왕복이 사라진다.
    this.baseBar = document.createElement('div');
    this.baseBar.className = 'basebar';
    for (let i = 0; i < 8; i++) {
      const chip = document.createElement('div');
      chip.className = 'basebar__chip basebar__chip--hidden';
      this.baseBar.appendChild(chip);
      this.baseChips.push(chip);
    }
    container.appendChild(this.baseBar);

    // ---------------------------------------------------------- 획득 알림
    this.toasts = document.createElement('div');
    this.toasts.className = 'phud__toasts';
    this.root.appendChild(this.toasts);

    // ---------------------------------------------------------- 핫바
    const hotbar = document.createElement('div');
    hotbar.className = 'phud__hotbar';
    for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
      const cell = this.makeCell(i + 1);
      // 포인터 잠금이 풀린 상태에서는 눌러서 고르고, 옮기고, 지울 수도 있다
      cell.onclick = (): void => this.hotbarClick(i);
      this.addClearButton(cell, i);
      hotbar.appendChild(cell);
      this.hotbarCells.push(cell);
    }
    this.root.appendChild(hotbar);

    // ---------------------------------------------------------- 인벤토리
    this.bag = document.createElement('div');
    this.bag.className = 'phud__bag phud__bag--hidden';

    const bagInner = document.createElement('div');
    bagInner.className = 'phud__bagbox';

    const title = document.createElement('div');
    title.className = 'phud__bagtitle';
    title.textContent = '가방';

    const grid = document.createElement('div');
    grid.className = 'phud__grid';
    for (let i = 0; i < INVENTORY.slots; i++) {
      const cell = this.makeCell(null);
      cell.onclick = (): void => {
        const slot = this.inventory.slots[i];
        // 같은 것을 다시 누르면 선택 해제
        this.pendingBind = slot && slot.id !== this.pendingBind ? slot.id : null;
        this.refreshSlots();
        this.updateHint();
      };

      // 버리기 — 핫바 배정과 무관하게 이 칸을 통째로 비운다.
      // `Q` 는 배정된 것만 버릴 수 있어서, 배정되지 않은 물건은
      // 가방에 갇힌 채 12칸 중 하나를 계속 물고 있었다.
      const kill = document.createElement('button');
      kill.className = 'cell__clear';
      kill.type = 'button';
      kill.textContent = '×';
      kill.title = '버린다';
      kill.onclick = (ev): void => {
        ev.stopPropagation();
        this.onDropSlot?.(i);
      };
      cell.appendChild(kill);
      cell.oncontextmenu = (ev): void => {
        ev.preventDefault();
        this.onDropSlot?.(i);
      };

      grid.appendChild(cell);
      this.bagCells.push(cell);
    }

    // ---------------------------------------------------------- 핫바 배정
    //
    // 가방 칸을 눌러 고르고, 아래 번호 칸을 눌러 자리를 정한다.
    // 한 번 정해두면 물건이 어느 칸으로 옮겨가든 그 번호는 그대로다.
    const assignTitle = document.createElement('div');
    assignTitle.className = 'phud__bagtitle phud__bagtitle--sub';
    assignTitle.textContent = '핫바 배정';

    const assignRow = document.createElement('div');
    assignRow.className = 'phud__assign';
    for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
      const cell = this.makeCell(i + 1);
      cell.onclick = (): void => this.hotbarClick(i);
      this.addClearButton(cell, i);
      assignRow.appendChild(cell);
      this.assignCells.push(cell);
    }

    this.bagDetail = document.createElement('div');
    this.bagDetail.className = 'phud__detail';

    bagInner.append(title, grid, assignTitle, assignRow, this.bagDetail);
    this.bag.appendChild(bagInner);
    this.root.appendChild(this.bag);

    // 길잡이는 화면 왼쪽 위, 시계 아래에 둔다.
    // 한 번에 하나만 띄운다 — 목록을 통째로 펼치면 세계를 둘러보는 대신
    // 체크리스트를 지우는 게임이 된다.
    this.guide = document.createElement('div');
    this.guide.className = 'phud__guide';
    this.guide.style.display = 'none';
    this.root.appendChild(this.guide);

    this.tip = document.createElement('div');
    this.tip.className = 'phud__tip';
    this.tip.style.display = 'none';
    this.root.appendChild(this.tip);

    container.appendChild(this.root);

    inventory.onChange(() => this.refreshSlots());
    this.refreshSlots();
    this.updateHint();
  }

  /**
   * 핫바 칸을 눌렀을 때. 아래 세 가지를 한 자리에서 처리한다.
   *
   *  1. 가방에서 물건을 골라둔 상태 → 이 칸에 배정한다
   *  2. 배정된 칸을 눌렀는데 아무것도 안 들고 있음 → **집어 든다** (자리 옮기기 시작)
   *  3. 이미 하나 집어 든 상태 → 두 칸을 맞바꾼다
   *
   * 2·3이 이번에 생겼다. 그전에는 핫바 안에서 자리를 바꿀 방법이 아예 없어서,
   * 순서를 정리하려면 가방에서 하나씩 다시 배정해야 했다.
   */
  private hotbarClick(i: number): void {
    if (this.pendingBind) {
      this.inventory.bind(i, this.pendingBind);
      this.pendingBind = null;
    } else if (this.pendingSwap !== null) {
      // 같은 칸을 다시 누르면 그냥 내려놓는다
      if (this.pendingSwap !== i) this.inventory.swapBindings(this.pendingSwap, i);
      this.pendingSwap = null;
    } else if (this.inventory.bindings[i]) {
      this.pendingSwap = i;
    } else {
      this.inventory.selectHotbar(i);
    }
    this.refreshSlots();
    this.updateHint();
  }

  /**
   * 칸에 "배정 해제" 버튼을 단다.
   *
   * 처음에는 오른쪽 버튼만으로 지우게 했는데, 그건 눌러보기 전에는 있는 줄
   * 모르는 기능이다. 보이는 버튼을 두고 오른쪽 버튼은 지름길로만 남긴다.
   */
  private addClearButton(cell: HTMLDivElement, hotbarIndex: number): void {
    const btn = document.createElement('button');
    btn.className = 'cell__clear';
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = '이 칸의 배정을 해제한다';
    btn.onclick = (ev): void => {
      // 칸 자체의 클릭(선택·배정)까지 같이 터지면 안 된다
      ev.stopPropagation();
      this.inventory.bind(hotbarIndex, null);
      this.refreshSlots();
      this.updateHint();
    };
    cell.appendChild(btn);

    // 오른쪽 버튼은 같은 동작의 지름길
    cell.oncontextmenu = (ev): void => {
      ev.preventDefault();
      this.inventory.bind(hotbarIndex, null);
      this.refreshSlots();
      this.updateHint();
    };
  }

  private makeCell(number: number | null): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = 'cell';

    if (number !== null) {
      const n = document.createElement('i');
      n.className = 'cell__num';
      n.textContent = String(number);
      cell.appendChild(n);
    }

    const icon = document.createElement('span');
    icon.className = 'cell__icon';
    cell.appendChild(icon);

    const count = document.createElement('em');
    count.className = 'cell__count';
    cell.appendChild(count);

    const wear = document.createElement('i');
    wear.className = 'cell__wear';
    wear.style.display = 'none';
    cell.appendChild(wear);

    return cell;
  }

  /**
   * 칸 하나를 그린다.
   *
   * @param dim 배정은 돼 있으나 물건이 없는 상태 (핫바에서만 생긴다)
   */
  private applyCell(
    cell: HTMLDivElement,
    id: ItemId | null,
    count: number,
    wearValue: number | undefined,
    dim = false,
  ): void {
    const icon = cell.querySelector<HTMLSpanElement>('.cell__icon')!;
    const countEl = cell.querySelector<HTMLElement>('.cell__count')!;
    const wear = cell.querySelector<HTMLElement>('.cell__wear')!;

    const clear = cell.querySelector<HTMLElement>('.cell__clear');
    if (clear) clear.style.display = id ? '' : 'none';

    if (!id) {
      icon.innerHTML = '';
      countEl.textContent = '';
      wear.style.display = 'none';
      cell.classList.add('cell--empty');
      cell.classList.remove('cell--dim');
      cell.onmouseenter = null;
      cell.onmousemove = null;
      cell.onmouseleave = null;
      return;
    }

    const def = itemDef(id);
    icon.innerHTML = itemIcon(id);
    icon.style.color = def.color;
    countEl.textContent = count > 1 ? String(count) : count === 0 ? '0' : '';
    cell.classList.remove('cell--empty');
    cell.classList.toggle('cell--dim', dim);

    // 도구는 남은 내구도를 막대로 — 부서지기 전에 알아채야 한다
    if (def.durability && wearValue !== undefined) {
      const left = 1 - wearValue;
      wear.style.display = '';
      wear.style.width = `calc((100% - 6px) * ${left.toFixed(3)})`;
      wear.style.background = left < 0.25 ? 'var(--hud-warn)' : 'var(--hud-accent)';
    } else {
      wear.style.display = 'none';
    }

    const show = (ev: MouseEvent): void => this.showTip(ev, id);
    cell.onmouseenter = show;
    cell.onmousemove = show;
    cell.onmouseleave = (): void => this.hideTip();
  }

  /** 설명 상자를 커서 옆에 띄운다 */
  private showTip(ev: MouseEvent, id: ItemId): void {
    const def = itemDef(id);
    const lines: string[] = [];
    if (def.consume) lines.push('먹거나 마실 수 있다');
    if (def.places) lines.push('좌클릭으로 설치');
    if (def.tool) lines.push('들고 있으면 효과가 있다');
    if (def.durability) lines.push('쓸수록 닳는다');

    this.tip.innerHTML =
      `<b style="color:${def.color}">${def.name}</b>` +
      `<span>${def.description}</span>` +
      (lines.length ? `<i>${lines.join(' · ')}</i>` : '');
    this.tip.style.display = 'block';

    // 화면 밖으로 나가지 않게 되접는다
    const pad = 14;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    this.tip.style.left = `${Math.max(8, x)}px`;
    this.tip.style.top = `${Math.max(8, y)}px`;
  }

  private hideTip(): void {
    this.tip.style.display = 'none';
  }

  /**
   * 길잡이를 갱신한다.
   * @param done 지금까지 이룬 목표 수
   */
  setObjective(title: string | null, hint: string, done: number, total: number): void {
    if (!title) {
      this.guide.style.display = 'none';
      return;
    }
    this.guide.style.display = '';
    this.guide.innerHTML =
      `<i>기억나지 않는다 · ${done}/${total}</i>` +
      `<b>${title}</b>` +
      `<span>${hint}</span>`;
  }

  /** 목표를 하나 이뤘다 — 테두리가 잠깐 밝아진다 */
  flashObjective(): void {
    this.guide.classList.remove('phud__guide--clear');
    // 리플로우를 강제해 애니메이션을 다시 태운다
    void this.guide.offsetWidth;
    this.guide.classList.add('phud__guide--clear');
  }

  /** 가방 아래에 지금 무엇을 해야 하는지 적어둔다 */
  private updateHint(): void {
    if (this.pendingBind) {
      const def = itemDef(this.pendingBind);
      this.bagDetail.innerHTML =
        `<b style="color:${def.color}">${def.name}</b> 를 고름 — ` +
        '아래 번호 칸을 눌러 배정한다. 취소하려면 가방에서 같은 것을 다시 누른다.';
    } else if (this.pendingSwap !== null) {
      const id = this.inventory.bindings[this.pendingSwap];
      const def = id ? itemDef(id) : null;
      this.bagDetail.innerHTML =
        `<b style="color:${def?.color ?? '#fff'}">${this.pendingSwap + 1}번 ${def?.name ?? ''}</b>` +
        ' 을 집었다 — 옮길 번호 칸을 누르면 자리를 맞바꾼다. 같은 칸을 다시 누르면 취소된다.';
    } else {
      this.bagDetail.textContent =
        '가방에서 물건을 누르고 아래 번호 칸을 눌러 배정한다. ' +
        '번호 칸끼리 눌러 자리를 맞바꿀 수도 있다. ' +
        '배정을 지우려면 그 칸의 × 를 누른다 (오른쪽 버튼도 같다).';
    }
  }

  private refreshSlots(): void {
    const inv = this.inventory;

    // 핫바는 배정표를 따른다. 물건이 어느 칸에 있든 자리는 고정이다.
    for (let i = 0; i < this.hotbarCells.length; i++) {
      const cell = this.hotbarCells[i]!;
      const id = inv.bindings[i] ?? null;
      const n = inv.boundCount(i);
      const slot = id ? inv.slots.find((sl) => sl?.id === id) : undefined;
      this.applyCell(cell, id, n, slot?.wear, n === 0);
      cell.classList.toggle('cell--selected', i === inv.selected);
      cell.classList.toggle('cell--picked', i === this.pendingSwap);
    }

    // 가방은 실제 칸을 그대로 보여준다
    for (let i = 0; i < this.bagCells.length; i++) {
      const cell = this.bagCells[i]!;
      const slot = inv.slots[i] ?? null;
      this.applyCell(cell, slot?.id ?? null, slot?.count ?? 0, slot?.wear);
      cell.classList.toggle('cell--picked', !!slot && slot.id === this.pendingBind);
    }

    // 가방 안의 배정 줄
    for (let i = 0; i < this.assignCells.length; i++) {
      const cell = this.assignCells[i]!;
      const id = inv.bindings[i] ?? null;
      this.applyCell(cell, id, inv.boundCount(i), undefined, inv.boundCount(i) === 0);
      cell.classList.toggle('cell--selected', i === inv.selected);
      cell.classList.toggle('cell--picked', i === this.pendingSwap);
    }
  }

  // ---------------------------------------------------------------- 갱신

  update(dt: number, stats: SurvivalStats): void {
    this.gHp.set(stats.hp, SURVIVAL.maxHp);
    this.gHunger.set(stats.hunger, SURVIVAL.maxHunger);
    this.gThirst.set(stats.thirst, SURVIVAL.maxThirst);
    this.gWarmth.set(stats.warmth, AILMENT.maxWarmth);

    // 앓기 시작하면 노출 게이지가 병세 게이지로 바뀐다 —
    // 줄 하나를 더 늘리는 대신 같은 자리에서 뜻만 바꾼다
    if (stats.sick) {
      this.gSpore.setVisible(true);
      this.gSpore.setLabel('포자병', 'linear-gradient(90deg,#6d2f3a,#c4566e)');
      this.gSpore.set(stats.sickness * 100, 100);
    } else {
      this.gSpore.setVisible(stats.spore > AILMENT.sporeShowLevel);
      this.gSpore.setLabel('포자', 'linear-gradient(90deg,#5a4670,#a97fd0)');
      this.gSpore.set(stats.spore, AILMENT.maxSpore);
    }

    if (this.hurtLevel > 0) {
      this.hurtLevel = Math.max(0, this.hurtLevel - dt * 2.6);
      this.hurt.style.opacity = (this.hurtLevel * this.hurtLevel).toFixed(3);
    } else if (this.hurt.style.opacity !== '0') {
      this.hurt.style.opacity = '0';
    }
  }

  setPrompt(label: string | null, progress: number): void {
    if (label !== this.lastPromptLabel) {
      this.prompt.classList.toggle('phud__prompt--hidden', label === null);
      if (label) this.promptText.textContent = label;
      this.lastPromptLabel = label ?? '';
    }
    this.promptFill.style.width = `${Math.min(progress, 1) * 100}%`;
  }

  /** 거점 상태 칩 — 0인 항목은 숨긴다 */
  setBase(base: {
    ripe: number;
    dry: number;
    empty: number;
    filled: number;
    firesOut: number;
    firesLow: number;
    /** 꺼낼 흙이 준비된 설비 수 — 퇴비 더미와 플랜트를 합친다 */
    soilReady: number;
    /** 지금 돌아가는 플랜트 수 — 낮에 로봇을 부르고 있는 대수 */
    plantsRunning: number;
  }): void {
    const key =
      `${base.ripe}|${base.dry}|${base.empty}|${base.filled}` +
      `|${base.firesOut}|${base.firesLow}|${base.soilReady}|${base.plantsRunning}`;
    if (key === this.lastBaseKey) return;
    this.lastBaseKey = key;

    // 불이 가장 앞이다. 밭은 하루 늦어도 되지만 꺼진 불은 그 밤에 바로 걸린다.
    // 돌아가는 플랜트는 불 바로 다음이다 — 낮에 로봇을 부르는 대가가
    // 화면에서 눈에 띄지 않으면 대가가 아니다 (8.3).
    const rows: Array<[number, string, string]> = [
      [base.firesOut, `꺼진 불 ${base.firesOut}`, '#c4564e'],
      [base.firesLow, `사위는 불 ${base.firesLow}`, '#d98a4a'],
      [base.plantsRunning, `플랜트 ${base.plantsRunning}대 가동 — 낮에 로봇`, '#c4564e'],
      [base.ripe, `수확 ${base.ripe}`, '#9dbd63'],
      [base.soilReady, `꺼낼 흙 ${base.soilReady}`, '#a3763f'],
      [base.dry, `목마름 ${base.dry}`, '#d98a4a'],
      [base.empty, `빈 밭 ${base.empty}`, '#8e948a'],
      [base.filled, `고인 물 ${base.filled}`, '#5b8fa8'],
    ];

    rows.forEach(([n, text, color], i) => {
      const chip = this.baseChips[i]!;
      chip.classList.toggle('basebar__chip--hidden', n <= 0);
      if (n > 0) {
        chip.textContent = text;
        chip.style.color = color;
      }
    });
  }

  /** 설치 안내 — progress > 0 이면 일구는 중임을 막대로 보여준다 */
  setPlaceHint(text: string | null, ok: boolean, progress: number): void {
    const key = `${text ?? ''}|${ok}`;
    if (key !== this.lastPlaceText) {
      this.lastPlaceText = key;
      this.place.classList.toggle('phud__place--hidden', text === null);
      this.place.classList.toggle('phud__place--ok', ok);
      this.place.classList.toggle('phud__place--bad', !ok);
      if (text) this.placeLabel.textContent = text;
    }
    this.placeFill.style.width = `${Math.min(progress, 1) * 100}%`;
  }

  toggleBag(): void {
    this.bagOpen = !this.bagOpen;
    this.bag.classList.toggle('phud__bag--hidden', !this.bagOpen);
    if (this.bagOpen) this.refreshSlots();
  }

  /** 가방 칸을 버리는 처리를 붙인다 */
  onDrop(cb: (index: number) => void): void {
    this.onDropSlot = cb;
  }

  closeBag(): void {
    if (!this.bagOpen) return;
    this.bagOpen = false;
    this.pendingBind = null;
    this.pendingSwap = null;
    this.hideTip();
    this.bag.classList.add('phud__bag--hidden');
  }

  get isBagOpen(): boolean {
    return this.bagOpen;
  }

  /**
   * 피격 — 화면 가장자리가 붉게 번쩍인다.
   *
   * CSS 애니메이션을 쓰지 않는다. 배경 탭에서는 애니메이션이 멈춰
   * 붉은 화면이 그대로 굳어버리기 때문이다. 프레임에서 직접 감쇠시킨다.
   */
  flashHurt(): void {
    this.hurtLevel = 1;
  }

  /** 화면 가운데 아래로 잠깐 떠오르는 알림 */
  toast(text: string, color = '#d8dbd2'): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.color = color;
    this.toasts.appendChild(el);

    // 애니메이션이 끝나면 스스로 사라진다
    window.setTimeout(() => el.remove(), 1800);

    // 화면이 알림으로 뒤덮이지 않게 한도를 둔다
    while (this.toasts.childElementCount > 5) {
      this.toasts.firstElementChild?.remove();
    }
  }

  dispose(): void {
    this.root.remove();
    this.baseBar.remove();
  }
}
