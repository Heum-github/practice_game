import type { Inventory, Slot } from './Inventory';
import { itemDef, type ItemId } from './Items';

export const STORAGE_SLOTS = 18;

/**
 * 보관함 한 개의 내용물.
 *
 * 가방이 12칸뿐이라 거점을 키우면 금세 넘친다. 보관함은 그 압박을 푸는
 * 첫 번째 설비이자, 작업대 이후 "거점을 짓는다"는 감각이 생기는 지점이다.
 */
export class StorageBox {
  readonly slots: Array<Slot | null> = new Array(STORAGE_SLOTS).fill(null);

  add(id: ItemId, count: number, wear?: number): number {
    const max = itemDef(id).stack;
    let left = count;

    if (max > 1) {
      for (const slot of this.slots) {
        if (left <= 0) break;
        if (!slot || slot.id !== id || slot.count >= max) continue;
        const put = Math.min(max - slot.count, left);
        slot.count += put;
        left -= put;
      }
    }

    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(max, left);
      this.slots[i] = wear === undefined ? { id, count: put } : { id, count: put, wear };
      left -= put;
    }
    return left;
  }

  get used(): number {
    return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
  }

  /**
   * 쪼개진 더미를 합친다 (가방의 `compact` 와 같은 이유·같은 규칙).
   * 마모도가 있는 도구는 개체가 구분되어야 하므로 건드리지 않는다.
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
    return changed;
  }

  /** 칸 하나를 통째로 버린다 */
  dropAt(index: number): Slot | null {
    const slot = this.slots[index];
    if (!slot) return null;
    this.slots[index] = null;
    return slot;
  }

  serialize(): Array<Slot | null> {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  restore(list: Array<Slot | null>): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = list[i] ? { ...list[i]! } : null;
    }
  }
}

/**
 * 가방 ↔ 보관함 사이의 칸 하나를 옮긴다.
 * @returns 옮겼으면 true
 */
export function transfer(
  from: Array<Slot | null>,
  index: number,
  to: { add: (id: ItemId, count: number, wear?: number) => number },
): boolean {
  const slot = from[index];
  if (!slot) return false;
  const left = to.add(slot.id, slot.count, slot.wear);
  if (left === slot.count) return false; // 받는 쪽이 가득 찼다
  if (left <= 0) {
    from[index] = null;
  } else {
    slot.count = left;
  }
  return true;
}

/** 인벤토리를 위 transfer의 대상으로 쓰기 위한 어댑터 */
export function inventorySink(inv: Inventory): {
  add: (id: ItemId, count: number, wear?: number) => number;
} {
  return {
    add: (id, count, wear) => {
      const left = inv.add(id, count);
      // 마모도가 있는 도구는 넣은 칸에 마모도를 되살린다
      if (wear !== undefined && left < count) {
        const slot = inv.slots.find((s) => s?.id === id && s.wear === 0);
        if (slot) slot.wear = wear;
      }
      return left;
    },
  };
}
