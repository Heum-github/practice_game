/**
 * 환경 악화 곡선 — 두 곡선의 경주가 회차를 넘어서도 사는지 확인한다.
 *
 * 되살린 흙(끌어내리는 몫)은 유산으로 대를 잇는데 세계의 나이(밀어올리는 몫)가
 * 매 생 0으로 돌아가면, 한 생에 38줌만 넘긴 다음 생은 1일차부터 곡선 바닥이고
 * 그 뒤로 세계가 더는 변하지 않는다. **화면으로는 절대 안 보이는** 종류라
 * 숫자로 잡는다 (기획서 3.7 · docs/game/environment.md).
 *
 *   node scripts/check-curve.mjs
 */
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const { Environment, GameTime, HAZARD } = await load([
  'world/Environment',
  'core/GameTime',
  'config',
]);

/** 지난 생들이 N계절을 났고 되살린 흙이 M줌인 채로 맞는 1일차의 추세 */
const trendOnDayOne = (carriedSeasons, restored) => {
  const env = new Environment();
  const time = new GameTime();
  time.day = 1;
  env.reset(restored, carriedSeasons);
  env.update(time);
  return env.trendOnly;
};

// --- 첫 생의 1일차는 기준값 1.0 이다
assert.equal(trendOnDayOne(0, 0), HAZARD.base, '첫 생 1일차가 기준값이 아니다');

// --- 세계는 계절마다 나빠진다
const oneYear = trendOnDayOne(4, 0);
assert.ok(
  Math.abs(oneYear - (HAZARD.base + 4 * HAZARD.perSeason)) < 1e-9,
  '지난 생이 난 계절이 곡선을 밀어올리지 않는다',
);

// --- 되살린 흙은 그 나빠짐을 끌어내린다
assert.ok(trendOnDayOne(4, 20) < oneYear, '되살린 흙이 곡선을 끌어내리지 않는다');

// --- **회귀**: 한 해를 난 다음 생이 1일차부터 바닥이면 안 된다.
//     예전에는 38줌만 넘기면 회차 2의 1일차가 이미 하한이었다.
const floorSoil = Math.ceil((HAZARD.base - HAZARD.minDensity) / HAZARD.reliefPerSoil);
assert.equal(
  trendOnDayOne(0, floorSoil),
  HAZARD.minDensity,
  `한 생 안에서는 ${floorSoil}줌이면 하한에 닿아야 한다`,
);
assert.ok(
  trendOnDayOne(4, floorSoil) > HAZARD.minDensity,
  `한 해를 난 다음 생이 ${floorSoil}줌만으로 1일차부터 바닥이다 — 곡선이 죽었다`,
);

// --- 세계가 나빠지는 속도와 되살림이 문서가 적은 저울대로인가
//     (docs/game/environment.md "하루 0.5줌어치")
const perDay = HAZARD.perSeason / 15 / HAZARD.reliefPerSoil;
assert.ok(Math.abs(perDay - 0.5) < 0.05, `세계가 나빠지는 속도가 하루 ${perDay.toFixed(2)}줌`);

// --- 천장은 여전히 최종값에 걸린다 (8.3)
const worn = new Environment();
const late = new GameTime();
late.day = 31; // 포자철
worn.reset(0, 40);
worn.update(late);
assert.equal(worn.trendOnly, HAZARD.trendMax, '오래 난 세계의 추세가 천장에서 멎지 않는다');
assert.ok(worn.density <= HAZARD.max, '실효 농도가 천장을 뚫었다');

const foreverFloor = Math.ceil((HAZARD.trendMax - HAZARD.minDensity) / HAZARD.reliefPerSoil);
console.log(
  `곡선 정상 — 한 생 하한 ${floorSoil}줌 · 영원한 하한 ${foreverFloor}줌 · ` +
    `세계는 하루 ${perDay.toFixed(2)}줌씩 나빠진다`,
);
