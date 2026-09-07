import {
  ACTS,
  FRAGMENTS,
  type ArchiveLog,
  type Fragment,
  type StoryContext,
} from '../gameplay/Archive';

/**
 * 기록 보관함.
 *
 * 찾아낸 조각을 다시 읽을 수 있어야 한다. 처음 나올 때 한 번 띄우고 마는
 * 방식은 스쳐 지나가기 쉽고, 그러면 이야기가 남지 않는다.
 *
 * 아직 못 찾은 항목도 자리는 보여준다 — 몇 개가 남았는지 알아야
 * 더 찾아볼 마음이 생긴다. 대신 제목까지 가려서 내용을 미리 흘리지 않는다.
 */
export class ArchivePanel {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly countEl: HTMLDivElement;
  private readonly log: ArchiveLog;

  private open = false;
  private selected: string | null = null;
  private onCloseCb?: () => void;

  /** 막의 문이 열렸는지 판단하려면 되살린 흙을 알아야 한다 */
  private readonly context: () => StoryContext;

  constructor(container: HTMLElement, log: ArchiveLog, context: () => StoryContext) {
    this.log = log;
    this.context = context;

    this.root = document.createElement('div');
    this.root.className = 'arch arch--hidden';

    const box = document.createElement('div');
    box.className = 'arch__box';

    const title = document.createElement('div');
    title.className = 'arch__title';
    title.textContent = '기록';

    // 닫기 버튼.
    //
    // 조감도를 읽으면 이 창이 저절로 뜬다. 그때까지 닫는 방법은 `J` 나 `ESC`
    // 뿐이었는데, 저절로 뜬 창은 사용자가 연 적이 없으니 닫는 키도 알 리가 없다.
    // 스스로 여는 창에는 스스로 닫는 방법이 붙어 있어야 한다.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'arch__close';
    close.textContent = '닫기 ×';
    close.onclick = (): void => {
      this.close();
      this.onCloseCb?.();
    };

    const hint = document.createElement('div');
    hint.className = 'arch__hint';
    hint.textContent = 'J 또는 ESC로도 닫는다';

    this.countEl = document.createElement('div');
    this.countEl.className = 'arch__count';

    const cols = document.createElement('div');
    cols.className = 'arch__cols';

    this.listEl = document.createElement('div');
    this.listEl.className = 'arch__list';

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'arch__body';

    cols.append(this.listEl, this.bodyEl);
    box.append(close, title, this.countEl, cols, hint);
    this.root.appendChild(box);

    // 바깥을 눌러도 닫힌다 — 창 안쪽 클릭은 여기까지 올라오지 않게 막는다
    box.onclick = (ev): void => ev.stopPropagation();
    this.root.onclick = (): void => {
      this.close();
      this.onCloseCb?.();
    };

    container.appendChild(this.root);
  }

  /** 창이 닫힐 때 알린다 — 커서 잠금을 되돌려야 한다 */
  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** @param focus 열면서 바로 펼칠 조각 */
  show(focus?: Fragment): void {
    this.open = true;
    this.selected = focus?.id ?? this.selected ?? this.log.list()[0]?.id ?? null;
    this.root.classList.remove('arch--hidden');
    this.refresh();
  }

  close(): void {
    this.open = false;
    this.root.classList.add('arch--hidden');
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  refresh(): void {
    this.countEl.textContent = `${this.log.count} / ${this.log.total} 조각`;

    const ctx = this.context();
    this.listEl.replaceChildren();

    // 막을 머리글로 끊어 읽는다.
    //
    // 열 줄을 한 덩어리로 늘어놓으면 몇 편을 읽었는지만 보이고 **어디까지
    // 왔는지**는 안 보인다. 막이 보이면 이야기에 마디가 생기고,
    // 잠긴 막은 그 자리에서 무엇을 하면 열리는지 말해준다 — 그게 다음 할 일이 된다.
    for (const act of ACTS) {
      const blocked = this.log.actBlocker(act.n, ctx);

      const head = document.createElement('div');
      head.className = 'arch__act' + (blocked ? ' arch__act--locked' : '');
      head.innerHTML =
        `<b>${act.title}</b>` +
        (blocked
          ? `<i>잠겨 있다 — ${blocked}</i>`
          : `<i>${act.epigraph}</i>`);
      this.listEl.appendChild(head);

      for (const f of FRAGMENTS.filter((x) => x.act === act.n)) {
        const row = document.createElement('button');
        row.type = 'button';
        const known = this.log.has(f.id);
        row.className = 'arch__item' + (known ? '' : ' arch__item--locked');
        if (known && f.id === this.selected) row.classList.add('arch__item--on');
        // 못 찾은 것은 제목도 가린다 — 목록만으로 내용을 짐작하게 두지 않는다
        row.textContent = known ? f.title : blocked ? '봉인됨' : '판독 불가';
        if (known) {
          row.onclick = (): void => {
            this.selected = f.id;
            this.refresh();
          };
        }
        this.listEl.appendChild(row);
      }
    }

    const cur = FRAGMENTS.find((f) => f.id === this.selected && this.log.has(f.id));
    if (!cur) {
      this.bodyEl.innerHTML =
        '<p class="arch__empty">아직 아무것도 읽지 못했다.<br>폐허에 남은 단말을 찾아라.</p>';
      return;
    }

    this.bodyEl.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = cur.title;
    const src = document.createElement('div');
    src.className = 'arch__source';
    src.textContent = cur.source;
    const p = document.createElement('pre');
    p.className = 'arch__text';
    p.textContent = cur.body;
    this.bodyEl.append(h, src, p);
  }
}
