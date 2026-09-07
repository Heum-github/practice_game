import { itemDef, type ItemId } from '../gameplay/Items';

/**
 * 아이템 설명 상자.
 *
 * 가방과 보관함이 같은 설명을 보여줘야 한다. 처음에는 가방 안에만 있었는데,
 * 그래서 보관함 창은 한자 한 글자만 덩그러니 남아 무엇이 들었는지 알 수 없었다.
 * 칸을 그리는 곳이 둘이면 설명도 둘이 되므로, 아예 하나로 빼내 공유한다.
 *
 * `document.body` 에 직접 붙는다. 어느 창 위에 뜨든 잘리지 않아야 하기 때문이다.
 */
class ItemTip {
  private el: HTMLDivElement | null = null;

  private ensure(): HTMLDivElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'phud__tip';
    el.style.display = 'none';
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  /** 커서 옆에 띄운다 */
  show(ev: MouseEvent, id: ItemId, extra?: string): void {
    const def = itemDef(id);
    const lines: string[] = [];
    if (def.consume) lines.push('먹거나 마실 수 있다');
    if (def.places) lines.push('좌클릭으로 설치');
    if (def.tool) lines.push('들고 있으면 효과가 있다');
    if (def.durability) lines.push('쓸수록 닳는다');
    if (def.fuel) lines.push('화톳불에 넣는다');
    if (extra) lines.push(extra);

    const el = this.ensure();
    el.innerHTML =
      `<b style="color:${def.color}">${def.name}</b>` +
      `<span>${def.description}</span>` +
      (lines.length ? `<i>${lines.join(' · ')}</i>` : '');
    el.style.display = 'block';

    // 화면 밖으로 나가지 않게 되접는다
    const pad = 14;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }

  /** 칸 하나에 설명을 붙인다 */
  attach(cell: HTMLElement, id: ItemId, extra?: string): void {
    const show = (ev: MouseEvent): void => this.show(ev, id, extra);
    cell.onmouseenter = show;
    cell.onmousemove = show;
    cell.onmouseleave = (): void => this.hide();
  }
}

export const itemTip = new ItemTip();
