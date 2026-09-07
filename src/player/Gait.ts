/**
 * 보행 주기 모델 — 실측 정상 보행 자료 기반.
 *
 * 사인파 하나로 다리를 흔들면 걷는 것처럼 보이지 않는다. 실제 사람의 관절은
 * 한 주기 안에서 국면마다 전혀 다르게 움직이고, 특히 무릎은 한 주기에
 * 봉우리가 둘인 비대칭 곡선이라 어떤 사인파로도 흉내낼 수 없다.
 *
 * 그래서 임상 보행분석(clinical gait analysis)의 정상 보행 관절각 곡선을
 * 주기의 5%마다 표로 적고, 그 사이를 이어 쓴다.
 *
 * ── 한 주기의 국면 (보행) ─────────────────────────────────
 *   0%    발뒤꿈치 닿음      엉덩관절 최대 굴곡(+30°), 무릎 거의 폄
 *   0~10% 하중 반응          무릎이 18°까지 꺾이며 충격을 먹는다
 *   10~30% 중간 디딤기       무릎이 다시 펴지고 정강이가 앞으로 넘어간다
 *   30~50% 말기 디딤기       발목 배측굴곡 최대(+10°), 뒤꿈치가 뜬다
 *   50~62% 발끝 떼기         발목이 -18°까지 밀며 몸을 앞으로 보낸다
 *   62~100% 흔듦기           무릎을 62°까지 접어 발이 땅에 끌리지 않게 한다
 *
 * 디딤기 60% / 흔듦기 40% 의 이 비대칭이 걷는 것처럼 보이게 하는 핵심이다.
 * 달리기는 성질이 다른 운동이라(체공 구간이 있다) 별도의 표를 두고 섞는다.
 *
 * ── 부호 규약 ────────────────────────────────────────────
 * 이 파일은 전부 **해부학 기준**으로 돌려준다. 굴곡이 양수다.
 * 리그의 회전축 부호와는 다르므로 PlayerCharacter 에서 변환한다.
 * (리그는 캐릭터 정면이 +Z 이고, pivot.rotation.x 양수가 다리를 뒤로 보낸다)
 */

const DEG = Math.PI / 180;

/**
 * 주기 표를 부드럽게 잇는다 (Catmull-Rom, 양 끝이 순환).
 *
 * 선형 보간을 쓰면 표의 마디마다 기울기가 꺾여 관절이 딱딱 끊긴다.
 * 3차 보간이라야 각속도까지 연속이 되어 눈에 매끄럽게 보인다.
 */
function sampleCycle(table: readonly number[], p: number): number {
  const n = table.length;
  const x = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const t = x - i;
  const a = table[(i - 1 + n) % n];
  const b = table[i % n];
  const c = table[(i + 1) % n];
  const d = table[(i + 2) % n];
  return (
    0.5 *
    (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
  );
}

// ── 정상 보행 (deg) — 주기의 0%, 5%, ... 95% ────────────────────────

/** 엉덩관절 굴곡. 닿는 순간 +30°, 발끝 뗄 무렵 -10° */
const WALK_HIP = [30, 27, 24, 21, 17, 13, 9, 5, 1, -3, -7, -10, -8, -2, 7, 16, 24, 29, 32, 32];

/**
 * 무릎 굴곡. 봉우리가 둘 — 하중 반응의 18°와 흔듦기의 62°.
 * 이 비대칭이 사인파와 가장 크게 갈리는 지점이다.
 */
const WALK_KNEE = [3, 10, 16, 18, 16, 12, 8, 5, 5, 8, 14, 23, 36, 50, 59, 62, 57, 45, 28, 12];

/** 발목 배측굴곡(양수). 말기 디딤기 +10°, 발끝 뗄 때 -18° */
const WALK_ANKLE = [0, -4, -5, -2, 2, 5, 7, 9, 10, 10, 7, 0, -12, -18, -10, -3, 0, 2, 2, 1];

// ── 달리기 (deg) — 디딤기가 35% 로 짧아지고 체공 구간이 생긴다 ──────

const RUN_HIP = [40, 33, 26, 19, 12, 5, -2, -9, -15, -18, -16, -8, 4, 17, 29, 39, 46, 50, 50, 46];

/** 달릴 때는 흔듦기 무릎이 120° 넘게 접힌다 — 발뒤꿈치가 엉덩이에 붙는다 */
const RUN_KNEE = [20, 30, 38, 42, 40, 34, 26, 22, 26, 40, 62, 85, 105, 118, 122, 115, 95, 70, 45, 28];

const RUN_ANKLE = [-5, 2, 8, 12, 14, 12, 5, -8, -22, -25, -18, -10, -4, 0, 3, 5, 5, 2, -2, -5];

function blend(walk: readonly number[], run: readonly number[], p: number, r: number): number {
  const w = sampleCycle(walk, p);
  return (r <= 0 ? w : w + (sampleCycle(run, p) - w) * r) * DEG;
}

/** 엉덩관절 굴곡 (rad, 양수가 앞) */
export function hipFlexion(p: number, run: number): number {
  return blend(WALK_HIP, RUN_HIP, p, run);
}

/**
 * 무릎 굴곡 (rad, 양수가 접힌 것).
 * 사람 무릎은 과신전되지 않으므로 음수로 내려가지 않게 막는다.
 */
export function kneeFlexion(p: number, run: number): number {
  return Math.max(0, blend(WALK_KNEE, RUN_KNEE, p, run));
}

/** 발목 배측굴곡 (rad, 양수가 발끝을 위로) */
export function ankleDorsi(p: number, run: number): number {
  return blend(WALK_ANKLE, RUN_ANKLE, p, run);
}

const TAU = Math.PI * 2;

// ── 골반과 몸통 ──────────────────────────────────────────────────
//
// 이쪽은 실제로도 사인파에 가까워 표를 쓰지 않는다.
// 위상 기준은 왼다리다 (왼발 디딤기 = 0~60%).

/**
 * 골반 상하 진동 (m, 평균 기준 ±).
 * 한 주기에 두 번. 한 발로 서는 중간 디딤기(30%, 80%)가 가장 높고
 * 양발이 닿아 있는 순간이 가장 낮다. 실제 사람은 총 4~5cm 움직인다.
 */
export function pelvisRise(p: number, amp: number): number {
  return amp * Math.cos(TAU * 2 * (p - 0.3));
}

/**
 * 골반 좌우 이동 (m). 체중을 실은 다리 쪽으로 옮겨간다.
 * @returns 왼쪽이 양수
 */
export function pelvisSway(p: number, amp: number): number {
  return amp * Math.cos(TAU * (p - 0.3));
}

/**
 * 골반 수평 회전 (rad). 흔드는 다리 쪽 골반이 앞으로 나온다.
 * @returns 왼쪽 골반이 앞이면 양수
 */
export function pelvisTwist(p: number, amp: number): number {
  return amp * Math.cos(TAU * (p - 0.85));
}

/**
 * 골반 좌우 기울기 (rad). 흔드는 쪽 골반이 내려간다.
 * 이것이 없으면 상체가 뻣뻣한 판처럼 보인다.
 * @returns 왼쪽이 올라가면 양수
 */
export function pelvisList(p: number, amp: number): number {
  return -amp * Math.cos(TAU * (p - 0.8));
}

// ── 팔 ───────────────────────────────────────────────────────────

/**
 * 어깨 시상면 각 (rad, 양수가 앞).
 * 같은 쪽 다리와 정반대로 간다 — 왼다리가 앞이면 왼팔은 뒤다.
 * 몸통의 회전을 상쇄해 균형을 잡는 동작이라 반드시 반대여야 한다.
 */
export function shoulderSwing(p: number, amp: number): number {
  return amp * Math.cos(TAU * (p - 0.4));
}

/** 팔꿈치 굴곡 (rad, 양수가 접힌 것). 팔이 앞으로 나올 때 더 접힌다 */
export function elbowFlexion(p: number, base: number, extra: number): number {
  return base + extra * Math.max(0, Math.cos(TAU * (p - 0.4)));
}
