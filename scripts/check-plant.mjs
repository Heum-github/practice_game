/**
 * 토양 재생 플랜트 — 도는 셈이 맞는지 한 번에 확인한다.
 *
 * 화면 없이 `Buildings` 를 그대로 세워 돌린다. 브라우저를 못 붙이는 자리에서도
 * "잔해 여섯이 흙 하나인가 · 몇 일에 한 줌인가 · 언제 조용해지는가"를
 * 숫자로 잡아내려는 것이다. 세 가지 다 눈으로는 절대 안 보인다.
 *
 *   node scripts/check-plant.mjs
 */
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const { Buildings, Terrain, PLANT } = await load(['world/Buildings', 'world/Terrain', 'config']);

const buildings = new Buildings(new Terrain());
/**
 * 프레임만 한 걸음으로 나눠 돌린다.
 *
 * 한 번에 며칠을 밀어 넣으면 한 틱에 한 줌만 나오고 나머지는 버려진다
 * (퇴비도 같다). 실제 게임은 프레임마다 아주 작은 days 를 넘기므로,
 * 검증도 그렇게 해야 셈이 게임과 같아진다.
 */
const run = (days, step = 0.005) => {
  for (let t = 0; t < days; t += step) buildings.update(Math.min(step, days - t));
};
assert.equal(buildings.tryPlace('plant', 0, 0), null, '플랜트를 놓을 수 있어야 한다');
const [plant] = buildings.placed;

// --- 한 몫을 넣으면 daysPerSoil 만에 흙 한 줌이 나온다
plant.moisture = 1;
buildings.update(PLANT.daysPerSoil * 0.9);
assert.equal(plant.stored, 0, '아직 다 돌지 않았는데 흙이 나왔다');
buildings.update(PLANT.daysPerSoil * 0.2);
assert.equal(plant.stored, 1, `한 몫은 ${PLANT.daysPerSoil}일에 흙 한 줌이어야 한다`);
assert.equal(plant.moisture, 0, '넣어둔 몫이 줄지 않았다');

// --- 넣어둔 몫이 바닥나면 스스로 조용해진다 (끄지 못하는 대가는 대가가 아니다)
assert.equal(Buildings.plantRunning(plant), false, '빈 플랜트가 계속 돌고 있다');
assert.equal(buildings.plantNoiseAt(0, 0), false, '멎은 플랜트가 로봇을 부르고 있다');

// --- 한 통은 문서가 적은 만큼만 시끄럽다
plant.moisture = PLANT.inputMax;
plant.stored = 0;
assert.equal(buildings.plantNoiseAt(0, 0), true, '도는 플랜트가 소리를 내지 않는다');
assert.equal(
  buildings.plantNoiseAt(PLANT.wakeRadius + 1, 0),
  false,
  '소리가 wakeRadius 밖까지 나간다',
);
run(PLANT.inputMax * PLANT.daysPerSoil);
assert.equal(plant.stored, PLANT.inputMax, '한 통이 다 흙이 되지 않았다');
assert.equal(buildings.plantNoiseAt(0, 0), false, '다 돌고도 계속 시끄럽다');

// --- 가득 찬 채로는 돌지 않는다. 대가만 치르고 아무것도 안 나오는 구간은 없다
plant.moisture = 2;
plant.stored = PLANT.capacity;
assert.equal(Buildings.plantRunning(plant), false, '가득 찬 플랜트가 계속 돈다');

// --- 문서(docs/game/soil-plant.md)의 셈과 config 가 어긋나지 않는가
const perDay = 1 / PLANT.daysPerSoil;
const scrapForFloor = 88 * PLANT.scrapPerSoil;
assert.ok(Math.abs(perDay - 3.3) < 0.1, `대당 하루 ${perDay.toFixed(1)}줌 — 문서는 3.3`);
assert.ok(
  Math.abs(PLANT.inputMax * PLANT.daysPerSoil - 1.8) < 0.05,
  '한 통이 1.8일이 아니다 — 문서의 "며칠을 시끄럽게 둘 것인가"가 어긋난다',
);
assert.ok(scrapForFloor < 2220, '영구 하한에 드는 잔해가 세계에 있는 것보다 많다');

console.log(
  `플랜트 정상 — 한 몫 ${PLANT.scrapPerSoil}잔해/${PLANT.daysPerSoil}일 · ` +
    `대당 하루 ${perDay.toFixed(1)}줌 · 한 통 ${(PLANT.inputMax * PLANT.daysPerSoil).toFixed(1)}일 ` +
    `· 하한 88줌 = 잔해 ${scrapForFloor}`,
);
