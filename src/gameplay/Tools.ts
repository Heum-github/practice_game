import type { Inventory, Slot } from './Inventory';
import { itemDef } from './Items';
import { withJosa } from '../util/korean';

export interface ToolEvent {
  message: string;
  color: string;
}

/**
 * 도구의 마모와 부식.
 *
 * 두 가지가 함께 도구를 갉는다.
 *  - **마모**: 쓸 때마다 닳는다. 많이 일할수록 빨리 없어진다.
 *  - **부식**: 가만히 둬도 삭는다. 대기 중 잔류 포자가 금속을 부식시키기 때문이다
 *    (GAME_PLANNING 2.4). 이것이 "왜 도구가 영구적이지 않은가"에 대한 세계관의 답이고,
 *    금속 잔해 수요가 끊기지 않는 이유다.
 *
 * 부식 저항 코팅(조감도 해금)이 중반의 목표가 되는 것도 이 구조에서 나온다.
 */
export class ToolWear {
  private onEventCb?: (e: ToolEvent) => void;

  constructor(private readonly inventory: Inventory) {}

  onEvent(cb: (e: ToolEvent) => void): void {
    this.onEventCb = cb;
  }

  /** 지금 선택한 칸의 도구를 한 번 쓴 것으로 친다 */
  useSelected(times = 1): void {
    this.wearSlot(this.inventory.selectedIndex, times);
  }

  /** 특정 칸의 도구를 닳게 한다 */
  wearSlot(index: number, times = 1): void {
    const slot = this.inventory.slots[index];
    if (!slot) return;
    const def = itemDef(slot.id);
    if (!def.durability) return;
    this.applyWear(index, slot, times / def.durability);
  }

  /**
   * 시간이 흐른 만큼 가방 안의 모든 금속 도구를 부식시킨다.
   * @param days 흐른 게임 시간 (일)
   */
  corrode(days: number): void {
    if (days <= 0) return;
    for (let i = this.inventory.slots.length - 1; i >= 0; i--) {
      const slot = this.inventory.slots[i];
      if (!slot) continue;
      const def = itemDef(slot.id);
      if (!def.corrosionPerDay) continue;
      this.applyWear(i, slot, def.corrosionPerDay * days);
    }
  }

  private applyWear(index: number, slot: Slot, amount: number): void {
    const def = itemDef(slot.id);
    const before = slot.wear ?? 0;
    const after = before + amount;

    if (after >= 1) {
      this.inventory.slots[index] = null;
      this.inventory.touch();
      this.onEventCb?.({
        message: `${withJosa(def.name, '이가')} 삭아 부서졌다`,
        color: '#d98a4a',
      });
      return;
    }

    slot.wear = after;

    // 처음 경고선을 넘는 순간에만 알린다 — 매 프레임 떠들면 시끄럽다
    if (before < WARN_AT && after >= WARN_AT) {
      this.onEventCb?.({
        message: `${withJosa(def.name, '이가')} 많이 삭았다`,
        color: '#d98a4a',
      });
    }
    this.inventory.touch();
  }
}

/** 이 마모도를 넘으면 경고한다 */
const WARN_AT = 0.75;
