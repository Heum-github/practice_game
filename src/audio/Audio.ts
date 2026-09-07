/**
 * 소리.
 *
 * 이 게임에는 소리가 하나도 없었다. 발이 땅에 닿아도, 곡괭이가 박혀도,
 * 물려도 아무 일이 없다. 화면만 보면 다 있는 것 같은데 손에 잡히는 느낌이
 * 없는 이유가 그것이다.
 *
 * 음원 파일을 두지 않고 Web Audio 로 합성한다. 이 프로젝트는 지형도 캐릭터도
 * 작물도 전부 코드로 만들고 있으므로 소리만 파일을 들고 올 이유가 없다.
 * 그리고 합성이면 세기·재질·속도에 따라 매번 다른 소리를 낼 수 있다 —
 * 같은 wav 를 반복 재생하는 것보다 오히려 덜 지겹다.
 *
 * ── 브라우저 규칙 ─────────────────────────────────────────
 * AudioContext 는 사용자가 무언가 누르기 전에는 소리를 내지 못한다.
 * 그래서 만들기만 해두고 첫 조작에서 resume() 한다.
 */

/** 소리 하나의 재료 */
interface NoiseOpts {
  /** 길이 (s) */
  duration: number;
  /** 필터 종류와 중심 주파수 */
  type?: BiquadFilterType;
  freq: number;
  /** 끝날 때의 주파수 — 주면 그쪽으로 미끄러진다 */
  freqTo?: number;
  q?: number;
  gain: number;
  /** 솟는 시간 (s). 짧을수록 딱딱한 소리 */
  attack?: number;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /** 바람 — 켜두고 세기만 바꾼다 */
  private windGain: GainNode | null = null;
  /** 비 — 바람보다 높은 대역의 쉬익 소리 */
  private rainGain: GainNode | null = null;
  /** 날씨 세기 0..1 */
  private wxRain = 0;
  private wxDust = 0;
  /** 화톳불 — 가까이 가면 커진다 */
  private fireGain: GainNode | null = null;

  private muted = false;
  private volume = 0.75;

  /** 한 프레임에 소리가 몰려 터지는 것을 막는다 */
  private voices = 0;
  private lastVoiceReset = 0;

  /** 창을 떠났을 때 잠시 멈춘 것인지 */
  private suspendedByVisibility = false;

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  constructor() {
    // 바람은 계속 울리는 소리라서, 창을 떠나도 그대로 남는다.
    // 브라우저가 배경 탭의 오디오를 알아서 멈춰주지는 않는다 —
    // 직접 멈추지 않으면 게임을 보고 있지도 않은데 소리만 계속 난다.
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', () => this.dispose());

    this.muted = localStorage.getItem('eden.muted') === '1';
    // 저장된 값이 없으면 기본값을 지킨다.
    //
    // getItem 은 키가 없을 때 null 을 주는데 Number(null) 은 0 이다.
    // 그대로 검사에 넣으면 "0 은 유한하고 0~1 범위"라서 통과해버려
    // 처음 켠 사람의 볼륨이 0 이 된다. 실제로 그렇게 소리가 안 났다.
    const raw = localStorage.getItem('eden.volume');
    if (raw !== null && raw !== '') {
      const v = Number(raw);
      if (Number.isFinite(v) && v > 0 && v <= 1) this.volume = v;
    }
  }

  /**
   * 첫 사용자 조작에서 부른다.
   * 여기서 처음으로 AudioContext 를 만든다 — 미리 만들면 브라우저가 막는다.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // 잡음 한 통을 만들어 두고 계속 돌려 쓴다
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this.startAmbience();
  }

  /** 창을 떠났다 — 소리를 멈춘다 */
  private pause(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.suspendedByVisibility = true;
    void this.ctx.suspend();
  }

  /** 창으로 돌아왔다 */
  private resume(): void {
    if (!this.ctx || !this.suspendedByVisibility) return;
    this.suspendedByVisibility = false;
    void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('eden.muted', this.muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // ---------------------------------------------------------------- 재료

  /** 잡음을 필터에 통과시켜 한 번 울린다 */
  private burst(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer || this.muted) return;
    if (!this.take()) return;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // 통의 아무 데서나 시작해 매번 다른 결이 나오게 한다
    const offset = Math.random() * (this.noiseBuffer.duration - o.duration - 0.01);

    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'lowpass';
    filter.frequency.setValueAtTime(o.freq, now);
    if (o.freqTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqTo), now + o.duration);
    }
    filter.Q.value = o.q ?? 1;

    const gain = ctx.createGain();
    const attack = o.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + o.duration);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.max(0, offset), o.duration);
    src.stop(now + o.duration + 0.02);
  }

  /** 짧은 음정 — 금속이 부딪히는 느낌을 만든다 */
  private ping(freq: number, duration: number, gain: number, freqTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    if (!this.take()) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    if (freqTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), now + duration);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * 동시에 울리는 소리 수를 제한한다.
   * 생물 여럿이 한꺼번에 때리면 소리가 뭉쳐 찢어진다.
   */
  private take(): boolean {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastVoiceReset > 0.05) {
      this.lastVoiceReset = now;
      this.voices = 0;
    }
    if (this.voices >= 6) return false;
    this.voices++;
    return true;
  }

  // ---------------------------------------------------------------- 환경음

  /** 바람과 불 — 껐다 켜지 않고 세기만 조절한다 */
  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;

    // 바람: 낮게 걸러낸 잡음을 계속 돌린다
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // 불: 더 높은 대역을 얹어 타닥거리게 한다
    const fire = ctx.createBufferSource();
    fire.buffer = this.noiseBuffer;
    fire.loop = true;
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'bandpass';
    fireFilter.frequency.value = 1150;
    fireFilter.Q.value = 0.9;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    fire.connect(fireFilter).connect(this.fireGain).connect(this.master);
    fire.start();

    // 비: 넓은 대역의 쉬익 소리. 바람보다 높고 고르다.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuffer;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 900;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rain.start();
  }

  /**
   * 프레임마다 환경음을 맞춘다.
   * @param exposure 0..1 — 트인 곳일수록 바람이 세다
   * @param fireDistance 가장 가까운 불까지의 거리 (m). 없으면 Infinity
   */
  ambience(exposure: number, fireDistance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.windGain) {
      // 궂은 날에는 트인 곳이 아니어도 바람이 거세다
      const gust = this.wxDust * 0.055 + this.wxRain * 0.02;
      this.windGain.gain.setTargetAtTime(0.012 + exposure * 0.03 + gust, t, 0.6);
    }
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(this.wxRain * 0.05, t, 0.8);
    }
    if (this.fireGain) {
      const near = Math.max(0, 1 - fireDistance / 9);
      this.fireGain.gain.setTargetAtTime(near * near * 0.05, t, 0.3);
    }
  }

  /** 지금 날씨를 알려준다 — 바람과 빗소리의 세기가 여기서 정해진다 */
  setWeather(rain: number, dust: number): void {
    this.wxRain = rain;
    this.wxDust = dust;
  }

  // ---------------------------------------------------------------- 효과음

  /** 발소리 — 세게 디딜수록 낮고 크다 */
  footstep(strength: number): void {
    const s = Math.min(1.4, Math.max(0.3, strength));
    this.burst({
      duration: 0.1 + s * 0.04,
      freq: 1100 - s * 260,
      freqTo: 300,
      q: 0.8,
      gain: 0.05 + s * 0.05,
    });
  }

  /** 곡괭이/주먹이 닿았다 */
  hit(armed: boolean): void {
    if (armed) {
      this.burst({ duration: 0.13, freq: 2600, freqTo: 700, q: 1.2, gain: 0.13 });
      this.ping(430, 0.16, 0.06, 250);
    } else {
      this.burst({ duration: 0.11, freq: 700, freqTo: 220, q: 0.9, gain: 0.1 });
    }
  }

  /** 채집 중 계속 나는 소리 */
  gather(kind: 'soil' | 'water' | 'metal'): void {
    if (kind === 'water') {
      this.burst({ duration: 0.22, freq: 900, freqTo: 1800, q: 1.6, gain: 0.05, attack: 0.05 });
    } else if (kind === 'metal') {
      this.burst({ duration: 0.16, freq: 3200, freqTo: 1200, q: 1.4, gain: 0.06 });
    } else {
      this.burst({ duration: 0.24, freq: 800, freqTo: 380, q: 0.7, gain: 0.06, attack: 0.04 });
    }
  }

  /** 무언가를 세웠다 / 밭을 일궜다 */
  place(): void {
    this.burst({ duration: 0.2, freq: 520, freqTo: 180, q: 0.8, gain: 0.09 });
    this.ping(180, 0.14, 0.04, 120);
  }

  /** 물렸다 */
  hurt(): void {
    this.burst({ duration: 0.3, freq: 420, freqTo: 120, q: 1.1, gain: 0.16 });
    this.ping(140, 0.24, 0.07, 80);
  }

  /** 수확 · 획득 — 살짝 밝게 */
  pickup(): void {
    this.ping(660, 0.09, 0.045, 880);
  }

  /** 만들었다 */
  craft(): void {
    this.ping(520, 0.1, 0.05, 700);
    this.ping(780, 0.12, 0.035, 940);
  }

  /** 창을 열고 닫을 때 */
  ui(open: boolean): void {
    this.ping(open ? 520 : 380, 0.05, 0.03, open ? 620 : 300);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.fireGain = null;
  }
}
