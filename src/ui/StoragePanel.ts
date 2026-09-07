import type { Inventory, Slot } from '../gameplay/Inventory';
import { itemDef } from '../gameplay/Items';
import type { StorageBox } from '../gameplay/Storage';
import { itemIcon } from './ItemIcons';
import { itemTip } from './ItemTip';

/**
 * 보관함 창.
 *
 * 왼쪽이 보관함, 오른쪽이 가방. 칸을 누르면 반대쪽으로 통째로 넘어간다.
 * 드래그 앤 드롭 대신 클릭 한 번으로 끝내는 이유는, 이 게임에서 정리에
 * 들여야 할 손품이 재미의 일부가 아니기 때문이다.
 *
 * 칸은 가방과 **똑같이** 그린다. 예전에는 이 창만 한자 한 글자로 남아 있어서,
 * 같은 물건이 창을 옮길 때마다 다른 모습으로 보였다. 어느 쪽이 보기 좋은가와
 * 무관하게, 한 물건이 두 얼굴을 갖는 것 자체가 문제다.
 */
export class StoragePanel {
  private readonly root: HTMLDivElement;
  private readonly boxGrid: HTMLDivElement;
  private readonly bagGrid: HTMLDivElement;
  private readonly title: HTMLDivElement;

  private box: StorageBox | null = null;
  private open = false;

  constructor(
    container: HTMLElement,
    private readonly inventory: Inventory,
    private readonly onMove: (fromBox: boolean, index: number) => void,
    /** 칸 하나를 통째로 버린다 */
    private readonly onDrop: (fromBox: boolean, index: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'store store--hidden';

    const wrap = document.createElement('div');
    wrap.className = 'store__box';

    this.title = document.createElement('div');
    this.title.className = 'store__title';
    this.title.textContent = '보관함';

    const cols = document.createElement('div');
    cols.className = 'store__cols';

    this.boxGrid = document.createElement('div');
    this.boxGrid.className = 'store__grid';
    this.bagGrid = document.createElement('div');
    this.bagGrid.className = 'store__grid';

    const left = document.createElement('div');
    const leftLabel = document.createElement('div');
    leftLabel.className = 'store__label';
    leftLabel.textContent = '보관함';
    left.append(leftLabel, this.boxGrid);

    const right = document.createElement('div');
    const rightLabel = document.createElement('div');
    rightLabel.className = 'store__label';
    rightLabel.textContent = '가방';
    right.append(rightLabel, this.bagGrid);

    cols.append(left, right);

    const hint = document.createElement('div');
    hint.className = 'store__hint';
    hint.textContent = '칸을 눌러 옮긴다 · 오른쪽 버튼(또는 ×)으로 버린다 · E · ESC로 닫기';

    wrap.append(this.title, cols, hint);
    this.root.appendChild(wrap);
    container.appendChild(this.root);

    inventory.onChange(() => {
      if (this.open) this.refresh();
    });
  }

  private cell(slot: Slot | null, fromBox: boolean, index: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = slot ? 'cell' : 'cell cell--empty';
    if (!slot) return el;

    const def = itemDef(slot.id);

    const icon = document.createElement('span');
    icon.className = 'cell__icon';
    icon.style.color = def.color;
    icon.innerHTML = itemIcon(slot.id);

    const count = document.createElement('em');
    count.className = 'cell__count';
    count.textContent = slot.count > 1 ? String(slot.count) : '';

    el.append(icon, count);

    if (slot.wear !== undefined && def.durability) {
      const bar = document.createElement('i');
      bar.className = 'cell__wear';
      bar.style.width = `${(1 - slot.wear) * 100}%`;
      el.appendChild(bar);
    }

    // 버리기 — 보이는 버튼을 두고 오른쪽 버튼은 지름길로만 남긴다.
    // 눌러보기 전에는 있는 줄 모르는 기능을 유일한 통로로 두지 않는다.
    const kill = document.createElement('button');
    kill.type = 'button';
    kill.className = 'cell__clear';
    kill.textContent = '×';
    kill.title = '버린다';
    kill.onclick = (ev): void => {
      ev.stopPropagation();
      this.onDrop(fromBox, index);
    };
    el.appendChild(kill);

    el.onclick = (): void => this.onMove(fromBox, index);
    el.oncontextmenu = (ev): void => {
      ev.preventDefault();
      this.onDrop(fromBox, index);
    };

    itemTip.attach(el, slot.id, fromBox ? '눌러서 가방으로' : '눌러서 보관함으로');
    return el;
  }

  private refresh(): void {
    itemTip.hide();
    this.boxGrid.replaceChildren();
    this.bagGrid.replaceChildren();

    const boxSlots = this.box?.slots ?? [];
    boxSlots.forEach((slot, i) => {
      this.boxGrid.appendChild(this.cell(slot, true, i));
    });
    this.inventory.slots.forEach((slot, i) => {
      this.bagGrid.appendChild(this.cell(slot, false, i));
    });

    const used = this.box?.used ?? 0;
    this.title.textContent = `보관함 · ${used}/${boxSlots.length}`;
  }

  show(box: StorageBox): void {
    this.box = box;
    this.open = true;
    this.root.classList.remove('store--hidden');
    this.refresh();
  }

  /** 내용이 바뀌었을 때 다시 그린다 (보관함 쪽은 인벤토리 이벤트를 타지 않는다) */
  refreshIfOpen(): void {
    if (this.open) this.refresh();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.box = null;
    itemTip.hide();
    this.root.classList.add('store--hidden');
  }

  get isOpen(): boolean {
    return this.open;
  }

  get current(): StorageBox | null {
    return this.box;
  }

  dispose(): void {
    this.root.remove();
  }
}
