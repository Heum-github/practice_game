import { INVENTORY } from '../config';
import { itemDef, type ItemId } from './Items';

export interface Slot {
  id: ItemId;
  count: number;
  /**
   * 도구의 마모도 0..1 (1이면 부서진다).
   * 도구는 스택이 1이라 칸 하나가 곧 개체 하나다 — 별도 개체 모델 없이 여기에 붙인다.
   */
  wear?: number;
}

/**
 * 12칸 격자 인벤토리와, 그 위에 얹은 핫바 배정.
 *
 * 가방 칸과 핫바 칸을 분리한다.
 *
 * 예전에는 핫바가 그냥 가방의 앞 여섯 칸이었다. 그러면 물건을 주울 때마다
 * 순서가 밀려서, 1번에 두었던 물뿌리개가 어느새 4번에 가 있다.
 * 급할 때 숫자키를 잘못 누르게 되는 이유가 그것이다.
 *
 * 그래서 핫바는 **아이템 종류를 가리키는 배정표**로 만든다.
 * 1번에 흙을 배정해두면 흙이 가방 어느 칸에 있든 1번은 항상 흙이다.
 */
export class Inventory {
  readonly slots: Array<Slot | null>;

  /**
   * 핫바 칸마다 배정된 아이템 종류. null 이면 빈 칸.
   * 물건이 다 떨어져도 배정은 남는다 — 그 자리를 계속 맡아둔다는 뜻이다.
   */
  readonly bindings: Array<ItemId | null>;

  /** 현재 선택된 핫바 칸 (0..hotbarSlots-1) */
  selected = 0;

  private listeners: Array<() => void> = [];

  constructor() {
    this.slots = new Array<Slot | null>(INVENTORY.slots).fill(null);
    this.bindings = new Array<ItemId | null>(INVENTORY.hotbarSlots).fill(null);
  }

  /**
   * 핫바 칸에 아이템을 배정한다.
   * 이미 다른 칸에 배정돼 있으면 그 칸과 자리를 바꾼다 — 중복은 혼란만 준다.
   */
  bind(hotbarIndex: number, id: ItemId | null): void {
    if (hotbarIndex < 0 || hotbarIndex >= this.bindings.length) return;
    if (id) {
      const prev = this.bindings.indexOf(id);
      if (prev >= 0 && prev !== hotbarIndex) this.bindings[prev] = this.bindings[hotbarIndex];
    }
    this.bindings[hotbarIndex] = id;
    this.emit();
  }

  /**
   * 핫바 두 칸의 배정을 맞바꾼다.
   *
   * 예전에는 자리를 옮기려면 가방에서 물건을 다시 골라 배정하는 수밖에 없었다.
   * 1번과 3번을 바꾸려면 두 번을 다시 배정해야 했고, 그 사이에 한쪽이 비어
   * 어느 것이 어디 있었는지 헷갈린다. 자리 바꾸기는 자리 바꾸기여야 한다.
   */
  swapBindings(a: number, b: number): void {
    const n = this.bindings.length;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) return;
    const tmp = this.bindings[a]!;
    this.bindings[a] = this.bindings[b]!;
    this.bindings[b] = tmp;
    this.emit();
  }

  /**
   * 처음 보는 아이템을 빈 핫바 칸에 자동으로 올린다.
   * 이게 없으면 주운 물건을 매번 손으로 배정해야 해서 성가시다.
   */
  private autoBind(id: ItemId): void {
    if (this.bindings.includes(id)) return;
    const free = this.bindings.indexOf(null);
    if (free >= 0) this.bindings[free] = id;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  /** 밖에서 칸을 직접 손댄 뒤 UI를 갱신시킨다 */
  touch(): void {
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /**
   * 아이템을 넣는다.
   * @returns 자리가 없어 넣지 못한 개수 (0이면 전부 들어갔다)
   */
  add(id: ItemId, count: number): number {
    const max = itemDef(id).stack;
    let left = count;

    // 1) 기존 더미에 먼저 채운다.
    //    스택 한도가 1인 것(도구)은 개체마다 마모도가 달라 겹칠 수 없다.
    for (const slot of this.slots) {
      if (left <= 0) break;
      if (max <= 1) break;
      if (!slot || slot.id !== id || slot.count >= max) continue;
      const room = max - slot.count;
      const put = Math.min(room, left);
      slot.count += put;
      left -= put;
    }

    // 2) 남으면 빈 칸을 연다
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(max, left);
      this.slots[i] = itemDef(id).durability ? { id, count: put, wear: 0 } : { id, count: put };
      left -= put;
    }

    if (left !== count) {
      this.autoBind(id);
      this.emit();
    }
    return left;
  }

  /**
   * 같은 종류로 쪼개져 있는 더미를 앞칸부터 합친다.
   *
   * `add` 는 넣을 때만 기존 더미를 채운다. 그래서 보관함으로 절반을 옮겼다가
   * 되가져오거나, 꽉 찬 칸에서 몇 개를 먹고 나면 20+3 처럼 갈라진 채로 남는다.
   * 한 번 쪼개진 것을 다시 붙일 방법이 없으면 12칸이 금세 잠긴다.
   *
   * 마모도가 있는 도구는 건드리지 않는다 — 개체마다 닳은 정도가 달라
   * 합치면 어느 하나의 마모도를 잃는다.
   *
   * @returns 실제로 합쳐진 칸이 있었는지
   */
  compact(): boolean {
    let changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      const target = this.slots[i];
      if (!target) continue;
      const max = itemDef(target.id).stack;
      if (max <= 1 || target.count >= max) continue;

      for (let j = i + 1; j < this.slots.length && target.count < max; j++) {
        const src = this.slots[j];
        if (!src || src.id !== target.id) continue;
        const move = Math.min(max - target.count, src.count);
        target.count += move;
        src.count -= move;
        if (src.count <= 0) this.slots[j] = null;
        changed = true;
      }
    }
    if (changed) this.emit();
    return changed;
  }

  /**
   * 칸 하나를 통째로 버린다 (핫바 배정과 무관하게).
   * @returns 버린 내용. 빈 칸이면 null
   */
  dropAt(index: number): Slot | null {
    const slot = this.slots[index];
    if (!slot) return null;
    this.slots[index] = null;
    this.emit();
    return slot;
  }

  /** 전체 보유 수량 */
  countOf(id: ItemId): number {
    let n = 0;
    for (const slot of this.slots) {
      if (slot?.id === id) n += slot.count;
    }
    return n;
  }

  /** 지정 칸에서 하나 뺀다. 비면 칸을 비운다 */
  takeOne(index: number): ItemId | null {
    const slot = this.slots[index];
    if (!slot) return null;
    const id = slot.id;
    slot.count -= 1;
    if (slot.count <= 0) this.slots[index] = null;
    this.emit();
    return id;
  }

  /**
   * 가방에 있는데 어느 핫바 칸에도 없는 종류를 빈 칸에 올린다.
   *
   * 세이브를 불러온 직후에 부른다. 배정 정보가 없던 예전 세이브에서도
   * 핫바가 비어 있지 않게 하고, 손으로 지운 칸은 그대로 둔다.
   */
  rebindMissing(): void {
    let changed = false;
    for (const slot of this.slots) {
      if (!slot || this.bindings.includes(slot.id)) continue;
      const free = this.bindings.indexOf(null);
      if (free < 0) break;
      this.bindings[free] = slot.id;
      changed = true;
    }
    if (changed) this.emit();
  }

  /** 지금 고른 핫바 칸이 실제로 가리키는 가방 칸 번호. 없으면 -1 */
  get selectedIndex(): number {
    const id = this.bindings[this.selected];
    if (!id) return -1;
    return this.slots.findIndex((s) => s?.id === id);
  }

  get selectedSlot(): Slot | null {
    const i = this.selectedIndex;
    return i < 0 ? null : this.slots[i]!;
  }

  /** 핫바 칸에 배정된 종류의 총 보유량 (여러 칸에 흩어져 있어도 합친다) */
  boundCount(hotbarIndex: number): number {
    const id = this.bindings[hotbarIndex];
    return id ? this.countOf(id) : 0;
  }

  /** 고른 핫바 칸에서 하나 뺀다 */
  takeOneSelected(): ItemId | null {
    const i = this.selectedIndex;
    return i < 0 ? null : this.takeOne(i);
  }

  selectHotbar(index: number): void {
    if (index < 0 || index >= INVENTORY.hotbarSlots) return;
    if (this.selected === index) return;
    this.selected = index;
    this.emit();
  }

  /** 핫바 안에서 한 칸씩 이동 */
  cycleHotbar(delta: number): void {
    const n = INVENTORY.hotbarSlots;
    this.selectHotbar(((this.selected + delta) % n + n) % n);
  }

  clear(): void {
    this.slots.fill(null);
    this.bindings.fill(null);
    this.selected = 0;
    this.emit();
  }

  /** 저장/디버그용 스냅샷 */
  snapshot(): Array<Slot | null> {
    return this.slots.map((s) => (s ? { ...s } : null));
  }
}
