import { FARM, PLANT } from '../config';
import { itemDef, type ItemId } from '../gameplay/Items';
import { itemIcon } from './ItemIcons';

/**
 * 도감.
 *
 * "기초 작물"은 이름이 아니라 분류다. 무엇을 심고 있는지 모른 채 농사를 짓게
 * 두면, 밭은 그냥 숫자가 오르는 상자가 된다. 이름과 내력이 붙어야 기른다는
 * 감각이 생긴다.
 *
 * 겸사겸사 튜토리얼이기도 하다. 재배 조건과 조리법을 여기 적어 두면
 * 화면 구석에 안내문을 띄우지 않고도 필요한 것을 다 알려줄 수 있다 —
 * 게다가 이 세계의 물건 안에 적혀 있으니 설정과도 어긋나지 않는다.
 */

/**
 * 갈래.
 *
 * 처음에는 여섯 항목을 한 줄에 늘어놓았는데, 기르는 이야기와 익히는 이야기와
 * 세계가 나빠지는 이야기가 한 목록에서 뒤섞였다. 무엇을 찾으러 폈는지 알면서도
 * 목록을 처음부터 훑어야 했다 — 읽는 사람의 머릿속에 있는 칸막이를
 * 화면에도 세워 준다.
 */
const TABS = ['식물', '조리', '땅과 계절'] as const;
type Tab = (typeof TABS)[number];

interface CodexEntry {
  /** 어느 갈래에 놓이는가 */
  tab: Tab;
  /** 표제 항목의 아이템 */
  id: ItemId;
  /** 한 줄 요약 */
  tagline: string;
  /** 본문 — 보존 구역 연구원의 기록체 */
  body: string;
  /** 표 형태로 보여줄 것들 */
  facts: Array<[string, string]>;
}

const ENTRIES: CodexEntry[] = [
  {
    tab: '식물',
    id: 'crop',
    tagline: '보존 구역 3세대 개량종 · 학명 없음',
    body:
      '흙이 걷힌 세상을 전제로 만든 품종이다. 뿌리를 얕게 뻗고 잎이 두꺼워\n' +
      '적은 물로도 이삭을 맺는다. 맛을 버리고 버티는 힘만 남긴 셈이라\n' +
      '날로 씹으면 서걱거린다 — 반드시 익혀 먹으라고 적혀 있다.\n\n' +
      '한 번 거두면 씨앗이 함께 나온다. 처음 한 번만 성공하면\n' +
      '그 뒤로 농사는 스스로 굴러간다.',
    facts: [
      ['심는 곳', `비옥도 ${Math.round(FARM.minFertility * 100)}% 이상의 밭`],
      ['물', `한 번 주면 ${FARM.moisturePerWatering.toFixed(2)}일 · 마르면 자라지 않는다`],
      ['자라는 데', `젖어 있는 채로 ${FARM.daysToRipen}일 (비옥할수록 빠르다)`],
      ['거두면', `알곡 ${FARM.cropYield}~4 · 씨앗 ${FARM.seedYield} · 마른 대 ${FARM.stalkYield}`],
    ],
  },
  {
    tab: '조리',
    id: 'roastedCrop',
    tagline: '조리 1 — 화톳불 곁에서',
    body:
      '알곡을 달군 철판에 올려 겉만 그을린다. 속의 전분이 부서져\n' +
      '같은 양으로 훨씬 오래 버틴다. 갓 구운 것은 몸도 덥힌다.\n\n' +
      '불만 있으면 되므로 가장 먼저 배우게 되는 조리법이다.',
    facts: [
      ['재료', '재생종 보리 1'],
      ['필요', '화톳불 곁 (타고 있어야 한다)'],
      ['포만', '38 → 62'],
      ['체온', '+8'],
    ],
  },
  {
    tab: '조리',
    id: 'grainStew',
    tagline: '조리 2 — 밤을 나기 전에',
    body:
      '끓인 물에 알곡을 풀어 오래 끓인다. 물과 곡식을 한 번에 삼키는 셈이라\n' +
      '거점을 비우고 멀리 나가는 날 아침에 알맞다.\n\n' +
      '무엇보다 몸을 깊이 덥힌다. 추운 밤을 앞두고 있다면\n' +
      '이것부터 끓여 두라고 적혀 있다.',
    facts: [
      ['재료', '재생종 보리 2 · 끓인 물 1'],
      ['필요', '화톳불 곁'],
      ['포만 · 갈증', '74 · 30'],
      ['체온 · 체력', '+26 · +6'],
    ],
  },
  {
    tab: '땅과 계절',
    id: 'relic',
    tagline: '관측 기록 — 네 계절과 두 곡선',
    body:
      '보존 구역의 관측반이 마지막까지 적어둔 것이다.\n\n' +
      '한 해는 네 계절, 계절 하나는 열닷새다.\n' +
      '  해빙  — 풀이 다시 돋는다. 비가 잦고 잘 자란다\n' +
      '  건기  — 먼지폭풍과 가뭄. 밭이 빨리 마른다\n' +
      '  포자철 — 대기가 탁하다. 노출이 두 배로 쌓인다\n' +
      '  혹한  — 얼어붙는다. 밖에서 밤을 넘길 수 없고 작물도 멎는다\n\n' +
      '그리고 그 아래에 더 느린 것이 하나 흐른다. **잔류 포자는 해마다 짙어진다.**\n' +
      '같은 자리에 서 있어도 삼 년째의 숨은 첫해의 숨보다 무겁고, 가만히 둔\n' +
      '연장도 더 빨리 삭는다.\n\n' +
      '되돌릴 방법이 없지는 않다. 퇴비로 흙을 되살린 만큼 농도가 내려간다 —\n' +
      '세계는 계속 나빠지고, 우리는 그보다 빨리 좋아져야 한다.',
    facts: [
      ['한 계절', '15일 (약 3시간 45분)'],
      ['한 해', '네 계절 · 60일'],
      ['농도', '계절마다 +0.16배 · 최대 2.6배'],
      ['되살림', '퇴비 흙 한 줌마다 −0.012배'],
    ],
  },
  {
    tab: '땅과 계절',
    id: 'compostBin',
    tagline: '토양 재생 1단계 — 흙을 늘리는 유일한 방법',
    body:
      'AI가 걷어간 흙은 돌아오지 않는다. 세상에 남은 것을 다 긁어모으면\n' +
      '농장은 거기서 멈춘다.\n\n' +
      '삭히면 늘어난다. 마른 풀과 알곡을 쌓아 며칠 두면 다시 흙이 된다 —\n' +
      '그러니 이 통은 밭을 늘리는 기계인 동시에, 먹을 것을 흙과 맞바꾸는\n' +
      '저울이기도 하다. 무엇을 넣을지는 그날의 사정이 정한다.',
    facts: [
      ['넣는 것', `마른 풀(1몫) · 재생종 보리(${FARM.compostCropValue}몫)`],
      ['한 번에', `${FARM.compostInputMax}몫까지`],
      ['삭는 데', `한 몫에 ${FARM.compostDays}일 (약 21분)`],
      ['나오는 것', `흙 1 — 최대 ${FARM.compostCapacity}까지 쌓아둔다`],
    ],
  },
  {
    tab: '땅과 계절',
    id: 'soilPlant',
    tagline: '토양 재생 2단계 — 부순 것을 되돌린다',
    body:
      '퇴비는 키운 것을 삭힌다. 이건 부순 것을 되돌린다 — 이 세계에서\n' +
      '가장 흔한 잔해를 가장 귀한 흙으로 바꾼다.\n\n' +
      '공짜는 아니다. 도는 동안 소리와 열을 내고, 그 반경 안이면 정착지\n' +
      '등급과 무관하게 낮에 로봇이 깨어난다. 넣어둔 몫이 바닥나면\n' +
      '스스로 조용해지니, 한 통을 채우는 일은 곧 며칠을 시끄럽게 둘\n' +
      '것인가를 고르는 일이다.',
    facts: [
      ['제작', `잔해 ${PLANT.scrapCost} · 흙 ${PLANT.soilCost} (작업대 · 종자고를 연 뒤)`],
      ['넣는 것', `잔해 ${PLANT.scrapPerSoil} = 한 몫`],
      ['한 번에', `${PLANT.inputMax}몫까지`],
      ['도는 데', `한 몫에 ${PLANT.daysPerSoil}일`],
      ['나오는 것', `흙 1 — 최대 ${PLANT.capacity}까지 쌓아둔다`],
      ['대가', `도는 동안 ${PLANT.wakeRadius}m 안이면 등급과 무관하게 낮에 로봇`],
    ],
  },
  {
    tab: '식물',
    id: 'driedGrass',
    tagline: '야생 — 흙이 남은 자리의 표지',
    body:
      '개량종이 아니라 살아남은 야생 풀이다. 흙이 남지 않은 땅에는\n' +
      '한 포기도 서지 못하므로, 풀이 보이기 시작하면 그 근처에\n' +
      '흙도 남아 있다는 뜻이다.\n\n' +
      '먹을 수는 없다. 대신 이 세계에서 타는 몇 안 되는 것 중 하나다.',
    facts: [
      ['자라는 곳', '비옥도 36% 이상의 땅'],
      ['쓰임', '화톳불 연료 (한 단에 7분 30초)'],
      ['또 다른 출처', '작물을 수확할 때 대가 함께 나온다'],
    ],
  },
];

export class CodexPanel {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;

  private open = false;
  private tab: Tab = '식물';
  /** 갈래마다 마지막으로 보던 항목을 기억한다 — 돌아왔을 때 처음으로 튕기지 않게 */
  private readonly seen = new Map<Tab, ItemId>();
  private onCloseCb?: () => void;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'arch arch--hidden';

    const box = document.createElement('div');
    box.className = 'arch__box';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'arch__close';
    close.textContent = '닫기 ×';
    close.onclick = (): void => this.dismiss();

    const title = document.createElement('div');
    title.className = 'arch__title';
    title.textContent = '도감';

    const count = document.createElement('div');
    count.className = 'arch__count';
    count.textContent = '보존 구역 재배·조리 기록 · 반출본';

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'codex__tabs';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'codex__tab';
      b.textContent = t;
      b.dataset.tab = t;
      b.onclick = (): void => {
        this.tab = t;
        this.refresh();
      };
      this.tabsEl.appendChild(b);
    }

    const cols = document.createElement('div');
    cols.className = 'arch__cols';

    this.listEl = document.createElement('div');
    this.listEl.className = 'arch__list';
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'arch__body';
    cols.append(this.listEl, this.bodyEl);

    const hint = document.createElement('div');
    hint.className = 'arch__hint';
    hint.textContent = 'F 또는 ESC로 덮는다';

    box.append(close, title, count, this.tabsEl, cols, hint);
    this.root.appendChild(box);

    box.onclick = (ev): void => ev.stopPropagation();
    this.root.onclick = (): void => this.dismiss();
    container.appendChild(this.root);
  }

  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  private dismiss(): void {
    this.close();
    this.onCloseCb?.();
  }

  private refresh(): void {
    for (const b of this.tabsEl.children) {
      b.classList.toggle('codex__tab--on', (b as HTMLElement).dataset.tab === this.tab);
    }

    const shown = ENTRIES.filter((e) => e.tab === this.tab);
    const want = this.seen.get(this.tab);
    const cur = shown.find((e) => e.id === want) ?? shown[0]!;
    this.seen.set(this.tab, cur.id);

    this.listEl.replaceChildren();
    for (const entry of shown) {
      const d = itemDef(entry.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'arch__item' + (entry.id === cur.id ? ' arch__item--on' : '');
      row.innerHTML =
        `<span class="codex__icon" style="color:${d.color}">${itemIcon(entry.id)}</span>` +
        `<span>${d.name}</span>`;
      row.onclick = (): void => {
        this.seen.set(this.tab, entry.id);
        this.refresh();
      };
      this.listEl.appendChild(row);
    }

    const def = itemDef(cur.id);

    this.bodyEl.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = def.name;
    h.style.color = def.color;

    const src = document.createElement('div');
    src.className = 'arch__source';
    src.textContent = cur.tagline;

    const table = document.createElement('div');
    table.className = 'codex__facts';
    for (const [k, v] of cur.facts) {
      const row = document.createElement('div');
      row.innerHTML = `<b>${k}</b><span>${v}</span>`;
      table.appendChild(row);
    }

    const p = document.createElement('pre');
    p.className = 'arch__text';
    p.textContent = cur.body;

    this.bodyEl.append(h, src, table, p);
  }

  show(): void {
    this.open = true;
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

  get isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.root.remove();
  }
}
