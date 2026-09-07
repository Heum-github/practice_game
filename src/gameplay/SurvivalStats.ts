import { AILMENT, SURVIVAL, TIME } from '../config';
import { clamp } from '../util/math';
import type { ConsumeEffect } from './Items';

export type DeathCause = '아사' | '탈수' | '부상' | '저체온' | '포자병';

/**
 * 몸이 놓인 자리.
 *
 * 체온과 포자 노출은 무엇을 먹었느냐가 아니라 **어디에 있느냐**로 결정된다.
 * 그래서 이 값들을 매 프레임 밖에서 받아온다.
 */
export interface Environment {
  /** 0=밤, 1=한낮 */
  daylight: number;
  /** 머리 위가 막힌 정도 0..1 */
  shelter: number;
  /** 화톳불 온기 0..1 — 가까울수록 1 */
  fire: number;
  rain: number;
  dust: number;
  /**
   * 잔류 포자 농도 (1 = 1일차 기준).
   * 계절과 환경 악화 곡선이 여기 실려 온다 — 같은 자리에 서 있어도
   * 포자철의 3년차는 해빙기의 1년차보다 훨씬 빨리 쌓인다.
   */
  sporeDensity: number;
  /** 체온 손실 배수 — 혹한기에는 같은 밤도 두 배로 춥다 */
  chill: number;
}

/** 화면에 한 줄 띄울 몸의 신호 */
export interface Notice {
  text: string;
  color: string;
}

const CALM: Environment = {
  daylight: 1,
  shelter: 0,
  fire: 0,
  rain: 0,
  dust: 0,
  sporeDensity: 1,
  chill: 1,
};

/**
 * 생존 스탯 — 체력 · 포만감 · 수분 · 체온 · 포자병.
 *
 * 앞의 셋은 가방이 답하는 시계다. 먹고 마시면 된다.
 * 뒤의 둘은 거점이 답하는 시계다 — 불을 피웠는가, 지붕 아래 있는가,
 * 폭풍이 부는 날 밖에 나갔는가.
 *
 * 포자병은 단순 감소가 아니라 **나선형 악화**로 설계했다 (기획서 3.1).
 * 앓으면 느려지고 더 허기지고 체력이 돌아오지 않는다. 그래서 자원 수급이 막히고,
 * 막히면 더 앓는다. 다만 따뜻하고 배부르면 스스로 이겨내므로,
 * 이 나선을 끊는 방법이 "약 한 알"이 아니라 "불 곁에서 버티는 하루"가 된다.
 */
export class SurvivalStats {
  hp: number = SURVIVAL.maxHp;
  hunger: number = SURVIVAL.maxHunger;
  thirst: number = SURVIVAL.maxThirst;
  /** 체온 — 밤과 궂은 날씨에 떨어지고, 해와 불이 되돌린다 */
  warmth: number = AILMENT.maxWarmth;
  /** 대기 잔류 포자 노출 누적. 가득 차면 발병한다 */
  spore = 0;
  /** 병세 0..1. 0보다 크면 앓는 중이다 */
  sickness = 0;

  dead = false;
  cause: DeathCause | null = null;

  private onDeathCb?: (cause: DeathCause) => void;
  private readonly notices: Notice[] = [];
  /** 같은 신호를 매 프레임 다시 띄우지 않기 위한 문턱 기억 */
  private shivering = false;
  private freezing = false;

  onDeath(cb: (cause: DeathCause) => void): void {
    this.onDeathCb = cb;
  }

  reset(): void {
    this.hp = SURVIVAL.maxHp;
    this.hunger = SURVIVAL.maxHunger;
    this.thirst = SURVIVAL.maxThirst;
    this.warmth = AILMENT.maxWarmth;
    this.spore = 0;
    this.sickness = 0;
    this.dead = false;
    this.cause = null;
    this.notices.length = 0;
    this.shivering = false;
    this.freezing = false;
  }

  /** 앓는 중인지 */
  get sick(): boolean {
    return this.sickness > 0;
  }

  /**
   * 병세가 만드는 이동 속도 배수.
   * 나선형 악화의 첫 고리 — 아프면 자원을 구하러 가는 것부터 느려진다.
   */
  get speedMult(): number {
    return 1 - this.sickness * (1 - AILMENT.sicknessSlow);
  }

  /** 몸이 보낸 신호를 하나 꺼낸다 (없으면 null) */
  takeNotice(): Notice | null {
    return this.notices.shift() ?? null;
  }

  /**
   * @param sprinting 달리는 중인지
   * @param laboring 채집 등 힘 쓰는 중인지
   * @param env 지금 몸이 놓인 자리 (없으면 아무 영향 없는 자리로 본다)
   * @param timeScale 시간 배속 — 병세와 노출은 게임 내 시간으로 흐른다
   */
  update(
    dt: number,
    sprinting: boolean,
    laboring: boolean,
    env: Environment = CALM,
    timeScale = 1,
  ): void {
    if (this.dead) return;

    this.updateWarmth(dt, sprinting, env);
    this.updateSpore(dt, env);
    this.updateSickness((dt * timeScale) / TIME.secondsPerDay);
    this.updateHunger(dt, sprinting, laboring);
  }

  // --------------------------------------------------------------- 체온
  private updateWarmth(dt: number, sprinting: boolean, env: Environment): void {
    // 비바람은 체온을 훨씬 빨리 앗아간다. 지붕이 그중 일부를 막는다.
    // 계절이 밑바탕을 정하고, 그 위에 그날의 날씨가 얹힌다
    let loss =
      AILMENT.warmthLossPerSecond *
      env.chill *
      (1 + env.rain * AILMENT.rainChill + env.dust * AILMENT.dustChill);
    loss *= 1 - env.shelter * (1 - AILMENT.shelterWarmthKeep);

    // 해는 밖에 있을 때만 든다
    let gain = AILMENT.warmthSunGain * env.daylight * (1 - env.shelter * 0.5);
    gain += AILMENT.warmthFireGain * env.fire;
    if (sprinting) gain += AILMENT.sprintWarmthGain;

    this.warmth = clamp(this.warmth + (gain - loss) * dt, 0, AILMENT.maxWarmth);

    // 문턱을 넘는 순간에만 알린다 — 매 프레임 띄우면 경고가 배경이 된다
    if (!this.shivering && this.warmth < AILMENT.shiverLevel) {
      this.shivering = true;
      this.notices.push({ text: '몸이 떨린다 — 불이 필요하다', color: '#7fa8d0' });
    } else if (this.shivering && this.warmth > AILMENT.shiverLevel + 12) {
      this.shivering = false;
    }
    if (!this.freezing && this.warmth <= 0) {
      this.freezing = true;
      this.notices.push({ text: '손끝의 감각이 사라진다', color: '#6f8fb8' });
    } else if (this.freezing && this.warmth > 6) {
      this.freezing = false;
    }
  }

  // --------------------------------------------------------------- 포자
  private updateSpore(dt: number, env: Environment): void {
    // 세계가 나빠진 만큼 같은 숨도 더 많이 마신다 (기획서 3.7)
    let rate = AILMENT.sporePerSecond * env.sporeDensity;
    // 먼지폭풍은 포자를 흩날리고, 비는 씻어 내린다
    rate *= 1 + env.dust * (AILMENT.dustSporeMult - 1);
    rate *= 1 - env.rain * (1 - AILMENT.rainSporeMult);
    rate *= 1 - env.shelter * (1 - AILMENT.shelterSporeKeep);
    // 추우면 면역이 떨어진다 — 체온과 포자병이 한 덩어리로 묶이는 지점
    if (this.warmth < AILMENT.shiverLevel) {
      const cold = 1 - this.warmth / AILMENT.shiverLevel;
      rate *= 1 + cold * (AILMENT.coldSporeMult - 1);
    }
    // 불 연기가 포자를 태운다. 거점에 머무는 동안은 노출이 도로 빠진다.
    rate -= AILMENT.fireSporeRelief * env.fire;

    this.spore = clamp(this.spore + rate * dt, 0, AILMENT.maxSpore);

    if (this.spore >= AILMENT.maxSpore && this.sickness <= 0) {
      this.infect();
    }
  }

  /**
   * 병세는 하루 단위로 흐른다.
   *
   * 체온과 노출은 분 단위 몸의 사정이라 포만·수분처럼 실시간으로 움직이지만,
   * 병세는 작물 성장이나 도구 부식과 같은 "며칠짜리" 곡선이다. 그래서 배속에
   * 걸리게 둔다 — `setTimeScale` 로 발병부터 회복까지를 앉은 자리에서 볼 수 있다.
   */
  // --------------------------------------------------------------- 병세
  private updateSickness(days: number): void {
    if (this.sickness <= 0) return;

    // 따뜻하고 배부르면 몸이 스스로 이겨낸다
    const mending =
      this.warmth > AILMENT.shiverLevel &&
      this.hunger > SURVIVAL.regenThreshold &&
      this.thirst > SURVIVAL.regenThreshold;
    const rate = mending ? -AILMENT.sicknessRecoverPerDay : AILMENT.sicknessPerDay;

    this.sickness = clamp(this.sickness + rate * days, 0, 1);
    if (this.sickness <= 0) {
      this.notices.push({ text: '기침이 잦아들었다 — 이겨냈다', color: '#8fd0c4' });
    }
  }

  // ------------------------------------------------- 포만·수분과 체력 정산
  private updateHunger(dt: number, sprinting: boolean, laboring: boolean): void {
    let hungerRate = SURVIVAL.hungerPerSecond;
    let thirstRate = SURVIVAL.thirstPerSecond;

    if (sprinting) {
      hungerRate *= SURVIVAL.sprintHungerMult;
      thirstRate *= SURVIVAL.sprintThirstMult;
    } else if (laboring) {
      hungerRate *= SURVIVAL.laborHungerMult;
    }

    // 앓으면 더 허기지고 더 목마르다 — 나선의 두 번째 고리
    if (this.sickness > 0) {
      const drain = 1 + this.sickness * (AILMENT.sicknessDrain - 1);
      hungerRate *= drain;
      thirstRate *= drain;
    }

    this.hunger = clamp(this.hunger - hungerRate * dt, 0, SURVIVAL.maxHunger);
    this.thirst = clamp(this.thirst - thirstRate * dt, 0, SURVIVAL.maxThirst);

    let damage = 0;
    if (this.hunger <= 0) damage += SURVIVAL.starvationDamage;
    if (this.thirst <= 0) damage += SURVIVAL.dehydrationDamage;
    if (this.warmth <= 0) damage += AILMENT.hypothermiaDamage;

    // 병세가 짙어진 뒤에야 몸이 상한다 — 발병 직후에는 유예가 있다
    const harm = (this.sickness - AILMENT.sicknessHarmFrom) / (1 - AILMENT.sicknessHarmFrom);
    if (harm > 0) damage += AILMENT.sicknessDamage * harm;

    if (damage > 0) {
      this.hp -= damage * dt;
      if (this.hp <= 0) {
        this.die(this.worstCause());
        return;
      }
    } else if (
      this.hunger > SURVIVAL.regenThreshold &&
      this.thirst > SURVIVAL.regenThreshold &&
      // 앓는 동안에는 체력이 돌아오지 않는다 (기획서 3.1 — 회복 차단)
      this.sickness <= 0
    ) {
      this.hp = Math.min(this.hp + SURVIVAL.regenPerSecond * dt, SURVIVAL.maxHp);
    }
  }

  /** 지금 가장 급한 것을 사인으로 삼는다 */
  private worstCause(): DeathCause {
    if (this.thirst <= 0) return '탈수';
    if (this.hunger <= 0) return '아사';
    if (this.warmth <= 0) return '저체온';
    return '포자병';
  }

  /** 외부 피해 (낙하, 전투) */
  damage(amount: number, cause: DeathCause = '부상'): void {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) this.die(cause);
  }

  /** 포자병 발병 */
  infect(): void {
    if (this.dead || this.sickness > 0) return;
    this.sickness = 0.02;
    this.spore = AILMENT.sporeResetAfterOnset;
    this.notices.push({ text: '포자병 — 숨이 무거워진다', color: '#a97fd0' });
  }

  /** 치료 — 병세를 끊고 쌓인 노출도 절반 덜어낸다 */
  cure(): void {
    this.sickness = 0;
    this.spore = Math.min(this.spore, AILMENT.maxSpore * 0.5);
    this.shivering = this.warmth < AILMENT.shiverLevel;
  }

  /** 아이템 섭취 효과 적용 */
  apply(effect: ConsumeEffect, roll: number = Math.random()): void {
    if (this.dead) return;
    if (effect.hunger) {
      this.hunger = clamp(this.hunger + effect.hunger, 0, SURVIVAL.maxHunger);
    }
    if (effect.thirst) {
      this.thirst = clamp(this.thirst + effect.thirst, 0, SURVIVAL.maxThirst);
    }
    if (effect.warmth) {
      this.warmth = clamp(this.warmth + effect.warmth, 0, AILMENT.maxWarmth);
    }
    if (effect.spore) {
      this.spore = clamp(this.spore + effect.spore, 0, AILMENT.maxSpore);
    }
    if (effect.cure) this.cure();
    // 깨끗하지 않은 것을 삼켰다. 대가는 확률로 치른다 —
    // 매번 체력을 조금씩 깎는 것보다 이쪽이 "끓여 마실 이유"를 만든다.
    if (effect.sporeRisk && roll < effect.sporeRisk) this.infect();
    if (this.spore >= AILMENT.maxSpore) this.infect();
    if (effect.hp) {
      this.hp = clamp(this.hp + effect.hp, 0, SURVIVAL.maxHp);
      if (this.hp <= 0) this.die('부상');
    }
  }

  private die(cause: DeathCause): void {
    this.hp = 0;
    this.dead = true;
    this.cause = cause;
    this.onDeathCb?.(cause);
  }

  /** 가장 위험한 값이 경고 수준인지 */
  get warning(): boolean {
    return (
      this.hunger < SURVIVAL.warnLevel ||
      this.thirst < SURVIVAL.warnLevel ||
      this.hp < SURVIVAL.warnLevel ||
      this.warmth < AILMENT.shiverLevel ||
      this.sickness > 0
    );
  }
}
