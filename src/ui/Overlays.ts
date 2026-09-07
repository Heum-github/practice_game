/**
 * 로딩 화면과 일시정지 베일.
 *
 * 로딩 화면은 생성 진행률을 보여주다가, 끝나면 그대로 시작 화면이 된다.
 * 오프닝 문구가 여기서 한 번 나오고 사라진다.
 */
/** 기록을 다 읽었을 때의 글 — 판을 둘이 쓰므로 상수로 빼둔다 */
const STORY_END = [
  '<span style="opacity:.72">열 편을 다 읽었다.</span>',
  '',
  '통조림은 며칠을 벌어주었고,',
  '씨앗은 몇 해를 벌어주었다.',
  '<span style="color:#b9c46a">세 번째 것은 종자고 열쇠였다.</span>',
  '',
  '<span style="opacity:.72">1,204종이 아직 그 안에 잠들어 있다.</span>',
  '<span style="opacity:.72">분화구 언저리, 반쯤 파묻힌 문 뒤에.</span>',
].join('<br>');

export class Overlays {
  private readonly loading: HTMLDivElement;
  private readonly bar: HTMLElement;
  private readonly body: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly veil: HTMLDivElement;

  private readonly death: HTMLDivElement;
  private readonly deathCause: HTMLDivElement;
  private readonly deathSummary: HTMLDivElement;
  private deathHint!: HTMLDivElement;

  private readonly ending: HTMLDivElement;
  private endTitle!: HTMLDivElement;
  private endBody!: HTMLDivElement;
  private onEnding?: () => void;

  private started = false;
  private onStart?: () => void;
  private onRestart?: () => void;

  constructor(container: HTMLElement) {
    // ---------------------------------------------------------- 로딩/시작
    this.loading = document.createElement('div');
    this.loading.className = 'overlay';

    const inner = document.createElement('div');
    inner.className = 'overlay__inner';

    const title = document.createElement('div');
    title.className = 'overlay__title';
    title.textContent = '에덴의 포자';

    const sub = document.createElement('div');
    sub.className = 'overlay__sub';
    sub.textContent = "Eden's Spore · v0.5";

    this.body = document.createElement('div');
    this.body.className = 'overlay__body';
    this.body.textContent = '세계를 생성하는 중…';

    const progress = document.createElement('div');
    progress.className = 'overlay__progress';
    this.bar = document.createElement('i');
    progress.appendChild(this.bar);

    this.hint = document.createElement('div');
    this.hint.className = 'overlay__hint';
    this.hint.style.visibility = 'hidden';
    this.hint.textContent = '클릭하여 눈을 뜬다';

    inner.append(title, sub, this.body, progress, this.hint);
    this.loading.appendChild(inner);
    container.appendChild(this.loading);

    // ---------------------------------------------------------- 일시정지
    this.veil = document.createElement('div');
    this.veil.className = 'veil veil--hidden';

    const box = document.createElement('div');
    box.className = 'veil__box';

    const key = document.createElement('div');
    key.className = 'veil__key';
    key.textContent = '클릭하여 계속';

    const note = document.createElement('div');
    note.className = 'veil__note';
    note.textContent = '커서가 해제되어 있는 동안 시간은 흐르지 않는다';

    box.append(key, note);
    this.veil.appendChild(box);
    container.appendChild(this.veil);

    // ---------------------------------------------------------- 사망
    this.death = document.createElement('div');
    this.death.className = 'overlay overlay--hidden';
    this.death.style.background = 'rgba(6, 5, 5, 0.92)';
    this.death.style.zIndex = '25';

    const dInner = document.createElement('div');
    dInner.className = 'overlay__inner';

    const dTitle = document.createElement('div');
    dTitle.className = 'death__title';
    dTitle.textContent = '숨이 멎었다';

    this.deathCause = document.createElement('div');
    this.deathCause.className = 'death__cause';

    this.deathSummary = document.createElement('div');
    this.deathSummary.className = 'overlay__body';

    const dHint = document.createElement('div');
    dHint.className = 'overlay__hint';
    // "처음부터"가 아니다 — 물자는 잃었지만 기록과 되살린 땅은 넘어간다
    dHint.textContent = '클릭하여 다음 사람으로';
    this.deathHint = dHint;

    dInner.append(dTitle, this.deathCause, this.deathSummary, dHint);
    this.death.appendChild(dInner);
    container.appendChild(this.death);

    // ---------------------------------------------------------- 결말
    //
    // 이기는 화면이 아니다. 열 편을 다 읽었다는 것은 무슨 일이 있었는지
    // 알게 됐다는 뜻일 뿐, 흙은 아직 그대로다. 그래서 축하 대신
    // **첫날부터 가방에 있던 물건의 이름**을 알려주고 끝낸다.
    this.ending = document.createElement('div');
    this.ending.className = 'overlay overlay--hidden';
    this.ending.style.background = 'rgba(8, 10, 7, 0.94)';
    this.ending.style.zIndex = '26';

    const eInner = document.createElement('div');
    eInner.className = 'overlay__inner';

    const eTitle = document.createElement('div');
    eTitle.className = 'death__title';
    eTitle.style.color = '#b9c46a';
    eTitle.textContent = '세 번째 것';
    this.endTitle = eTitle;

    const eBody = document.createElement('div');
    eBody.className = 'overlay__body';
    this.endBody = eBody;
    eBody.innerHTML = STORY_END;

    const eHint = document.createElement('div');
    eHint.className = 'overlay__hint';
    eHint.textContent = '클릭하여 계속한다';

    eInner.append(eTitle, eBody, eHint);
    this.ending.appendChild(eInner);
    container.appendChild(this.ending);
    this.ending.addEventListener('click', () => {
      this.ending.classList.add('overlay--hidden');
      this.onEnding?.();
    });

    this.loading.addEventListener('click', this.handleClick);
    this.veil.addEventListener('click', this.handleClick);
    this.death.addEventListener('click', () => this.onRestart?.());
  }

  /**
   * 사망 화면.
   *
   * 사망은 여전히 완전 초기화다 — 물자도 건물도 정착지도 돌아오지 않는다.
   * 다만 **무엇이 남는지**를 같은 화면에서 말한다. 잃은 것만 적어두면
   * 그건 그만둘 이유가 되고, 남는 것만 적으면 죽음이 가벼워진다.
   * 잃은 것을 먼저, 남는 것을 뒤에 — 마지막에 읽는 것이 다음 생을 시작하게 한다.
   */
  showDeath(
    cause: string,
    day: number,
    onRestart: () => void,
    legacy?: { runs: number; kept: string[] },
  ): void {
    this.onRestart = onRestart;
    this.deathCause.textContent = `사인 · ${cause}`;

    const lines = [
      `${day}일째에 쓰러졌다.`,
      '모아둔 것도, 세운 것도 모두 잔해 속으로 흩어졌다.',
    ];

    if (legacy && legacy.kept.length > 0) {
      lines.push(
        '',
        '<span style="color:#b9c46a">그러나 남는 것이 있다</span>',
        `<span style="color:#8fae5a">${legacy.kept.join(' · ')}</span>`,
        '<span style="opacity:.72">읽어낸 것은 데이터로 남고,</span>',
        '<span style="opacity:.72">땅에 돌려준 흙은 땅의 것이 되었다.</span>',
      );
    } else if (legacy) {
      lines.push('', '<span style="opacity:.72">아무것도 남기지 못했다.</span>');
    }

    // 첫 생에는 넘길 것이 없으니 문구도 달라야 한다
    this.deathHint.textContent =
      legacy && legacy.kept.length > 0 ? '클릭하여 다음 사람으로' : '클릭하여 처음부터';
    this.deathSummary.innerHTML = lines.join('<br>');
    this.death.classList.remove('overlay--hidden');
  }

  hideDeath(): void {
    this.death.classList.add('overlay--hidden');
  }

  /**
   * 기록 열 편을 모두 읽은 순간 한 번.
   *
   * 종자고 화면과 같은 판을 쓴다. 글을 매번 다시 써 넣는 이유는,
   * 저쪽이 먼저 뜬 뒤에 이쪽이 다시 뜰 일은 없지만 **한 판을 둘이 쓰면
   * 언젠가 남의 글이 남는다**는 것이 규칙이기 때문이다.
   */
  showEnding(onClose: () => void): void {
    this.onEnding = onClose;
    this.endTitle.textContent = '세 번째 것';
    this.endBody.innerHTML = STORY_END;
    this.ending.classList.remove('overlay--hidden');
  }

  /**
   * 종자고 문이 열린 순간.
   *
   * 결말 화면과 따로 두는 이유는, 저쪽이 **알아낸 것**이고 이쪽은
   * **해낸 것**이기 때문이다. 두 장면 사이에 몇 시간이 놓일 수도 있다.
   */
  showVault(onClose: () => void): void {
    this.onEnding = onClose;
    this.endTitle.textContent = '종자고';
    this.endBody.innerHTML = [
      '<span style="opacity:.72">문이 내려앉는다.</span>',
      '',
      '선반이 끝까지 늘어서 있다.',
      '<span style="color:#b9c46a">1,204종. 하나도 상하지 않았다.</span>',
      '',
      '<span style="opacity:.72">그들은 씨앗을 지킨 것이 아니라 보관만 한 것이었다.</span>',
      '<span style="opacity:.72">심을 흙이 없었으니까.</span>',
      '',
      '이제는 흙이 있다.',
    ].join('<br>');
    this.ending.classList.remove('overlay--hidden');
  }

  private handleClick = (): void => {
    if (!this.started) return;
    this.onStart?.();
  };

  setProgress(p: number, label: string): void {
    this.bar.style.width = `${Math.round(p * 100)}%`;
    this.body.textContent = label;
  }

  /**
   * 생성이 끝나 시작을 기다리는 상태로 전환.
   * @param resumeNote 이어할 세이브가 있으면 오프닝 대신 이 문구를 보여준다
   */
  ready(onStart: () => void, resumeNote?: string, legacy?: { runs: number; kept: string[] }): void {
    this.started = true;
    this.onStart = onStart;
    this.bar.style.width = '100%';

    if (resumeNote) {
      this.body.innerHTML = [
        '기억은 아직 돌아오지 않았다.',
        '하지만 손에 익은 것들이 남아 있다.',
        `<span style="color:#b9c46a">${resumeNote}</span>`,
      ].join('<br>');
    } else if (legacy && legacy.runs > 1) {
      // 두 번째 생부터는 오프닝이 달라진다. 같은 문장을 다시 읽히면
      // 죽음이 "다시 시작 버튼"으로만 남는다.
      this.body.innerHTML = [
        `<span style="color:#8e948a">${legacy.runs}번째로 눈을 뜬다.</span>`,
        '앞선 사람이 남긴 기록이 가방에 들어 있다.',
        ...(legacy.kept.length
          ? [`<span style="color:#8fae5a">${legacy.kept.join(' · ')}</span>`]
          : []),
        '<span style="opacity:.72">이 폐허는 그가 걷던 곳과 같은 곳이다.</span>',
      ].join('<br>');
    } else {
      this.body.innerHTML = [
        '폭발의 충격으로 모든 기억이 사라졌다.',
        '부서진 보존 구역의 잔해 속에서 눈을 뜬다.',
        '가방에는 통조림 하나, 씨앗 한 줌,',
        '그리고 용도를 알 수 없는 물체가 들어 있다.',
      ].join('<br>');
    }

    this.hint.textContent = resumeNote ? '클릭하여 이어한다' : '클릭하여 눈을 뜬다';
    this.hint.style.visibility = 'visible';
  }

  hideLoading(): void {
    this.loading.classList.add('overlay--hidden');
  }

  setPaused(paused: boolean): void {
    this.veil.classList.toggle('veil--hidden', !paused);
  }

  dispose(): void {
    this.loading.remove();
    this.veil.remove();
    this.death.remove();
    this.ending.remove();
  }
}
