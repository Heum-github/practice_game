import { COOK, PLANT } from '../config';
import type { Inventory } from './Inventory';
import { itemDef, type ItemId } from './Items';

export interface Recipe {
  id: string;
  output: ItemId;
  outputCount: number;
  inputs: Array<{ id: ItemId; count: number }>;
  /** 왜 만드는지 한 줄 — 제작창에서 판단 근거가 된다 */
  note: string;
  /** 이 설비 곁에 있어야 만들 수 있다 */
  station?: 'workbench' | 'campfire';
  /**
   * 불 앞에 앉아 있어야 하는 시간 (s).
   *
   * 있으면 단추를 눌러도 바로 나오지 않는다 — 재료를 냄비에 넣고,
   * 그 자리를 지켜야 한다. 자리를 뜨거나 불이 꺼지면 재료는 돌려받는다.
   */
  cookTime?: number;
  /** 처음에는 만들 줄 모르는 것 — 조감도 데이터를 읽어야 열린다 */
  locked?: boolean;
  /**
   * 종자고를 연 사람에게만 열린다.
   *
   * 조감도와 다른 문이다. 조감도는 폐허에서 주워 오는 것이라 "운이 좋았는가"를
   * 물을 뿐이지만, 종자고는 기록 열 편을 다 읽어야 열린다 — 정착지 등급 2와
   * 되살린 흙 24줌을 이미 지나온 사람만 통과하는 유일한 문이다.
   */
  needsVault?: boolean;
}

/**
 * 제작 레시피.
 *
 * 네 단계로 나뉜다.
 *  1. 맨손 — 잔해만으로 만드는 최소한의 것
 *  2. 화톳불 — 불이 있어야 되는 것 (물을 끓인다)
 *  3. 작업대 — 거점을 세워야 열리는 것
 *  4. 조감도 — 폐허에서 설계를 건져와야 아는 것 (GAME_PLANNING 2.4)
 *
 * 이 세 층이 "성장이 체감되는가"라는 v0.2의 검증 질문에 답하는 구조다.
 */
export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- 맨손
  {
    id: 'pickaxe',
    output: 'pickaxe',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 8 }],
    note: '채집 속도 1.8배 · 내구 60',
  },
  {
    id: 'wall',
    output: 'wall',
    outputCount: 2,
    inputs: [{ id: 'scrap', count: 5 }],
    note: '밤에 오는 것들을 막는다',
  },
  {
    id: 'campfire',
    output: 'campfire',
    outputCount: 1,
    inputs: [
      { id: 'scrap', count: 6 },
      { id: 'driedGrass', count: 2 },
    ],
    // 예전에는 작물 하나가 들었다. 그러면 첫 수확 전에는 불을 못 피우는데,
    // 체온이 들어온 지금 그건 "첫날 밤에 얼어 죽어라"는 뜻이 된다.
    // 불쏘시개를 마른 풀로 바꾸면 순서가 제자리를 찾는다 —
    // 풀을 베어 불을 피우고, 그 불로 물을 끓이고, 그 다음에 농사를 짓는다.
    note: '변이 생물이 빛을 피한다 · 몸을 덥힌다 · 물을 끓인다',
  },
  {
    id: 'gate',
    output: 'gate',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 7 }],
    note: '벽으로 두른 안으로 드나든다 · E로 여닫는다',
  },
  {
    id: 'trap',
    output: 'trap',
    outputCount: 2,
    inputs: [{ id: 'scrap', count: 9 }],
    note: '밟으면 34 피해 · 네 번이면 부서진다 — 로봇에게 불빛은 통하지 않는다',
  },
  {
    id: 'workbench',
    output: 'workbench',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 14 }],
    note: '더 많은 것을 만들 수 있게 된다',
  },

  // ---------------------------------------------------------------- 화톳불
  {
    id: 'boiledWater',
    output: 'boiledWater',
    outputCount: 1,
    inputs: [{ id: 'stagnantWater', count: 1 }],
    note: '포자가 죽는다 · 갈증 42 · 체온 12',
    station: 'campfire',
    cookTime: COOK.boiledWater,
  },
  // 요리.
  //
  // 수확물을 그대로 씹는 것 말고 할 일이 없으면, 농사의 보상이 한 겹뿐이다.
  // 익히면 같은 알곡이 훨씬 든든해진다 — 밭을 늘릴 이유가 하나 더 생기고,
  // 화톳불에 네 번째 쓸모가 붙는다.
  {
    id: 'roastedCrop',
    output: 'roastedCrop',
    outputCount: 1,
    inputs: [{ id: 'crop', count: 1 }],
    note: '포만 38 → 62 · 체온 8',
    station: 'campfire',
    cookTime: COOK.roastedCrop,
  },
  {
    id: 'grainStew',
    output: 'grainStew',
    outputCount: 1,
    inputs: [
      { id: 'crop', count: 2 },
      { id: 'boiledWater', count: 1 },
    ],
    note: '포만 74 · 갈증 30 · 체온 26 · 체력 6 — 밤을 나기 전에',
    station: 'campfire',
    cookTime: COOK.grainStew,
  },

  // ---------------------------------------------------------------- 작업대
  {
    id: 'wateringCan',
    output: 'wateringCan',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 6 }],
    note: '물 하나로 밭 셋 · 내구 45',
    station: 'workbench',
  },
  {
    id: 'rainCollector',
    output: 'rainCollector',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 12 }],
    note: '매일 아침 물 두 개',
    station: 'workbench',
  },
  {
    id: 'storageBox',
    output: 'storageBox',
    outputCount: 1,
    inputs: [{ id: 'scrap', count: 10 }],
    note: '18칸을 더 쓴다',
    station: 'workbench',
  },

  // ---------------------------------------------------------------- 조감도
  {
    id: 'compostBin',
    output: 'compostBin',
    outputCount: 1,
    inputs: [
      { id: 'scrap', count: 12 },
      { id: 'driedGrass', count: 4 },
    ],
    // 기획서 3.2 — "유기물로 퇴비를 만들어 흙을 증식시키는 것이 중반 기술 목표".
    // 흙의 상한을 푸는 설비이므로 조감도 뒤에 둔다. 첫날부터 있으면
    // "흙이 사라진 세계"라는 전제가 하루 만에 무의미해진다.
    note: '유기물을 삭혀 흙으로 되돌린다 — 흙을 늘리는 유일한 방법',
    station: 'workbench',
    locked: true,
  },
  {
    id: 'medicine',
    output: 'medicine',
    outputCount: 2,
    inputs: [
      { id: 'crop', count: 3 },
      { id: 'scrap', count: 2 },
    ],
    note: '포자병을 끊는다 — 농사가 약이 되는 지점',
    station: 'workbench',
    locked: true,
  },
  {
    id: 'hardenedPickaxe',
    output: 'hardenedPickaxe',
    outputCount: 1,
    inputs: [
      { id: 'scrap', count: 16 },
      { id: 'crop', count: 2 },
    ],
    note: '내구 160 · 부식이 거의 없다',
    station: 'workbench',
    locked: true,
  },

  // ---------------------------------------------------------------- 종자고
  {
    id: 'soilPlant',
    output: 'soilPlant',
    outputCount: 1,
    inputs: [
      { id: 'scrap', count: PLANT.scrapCost },
      { id: 'soil', count: PLANT.soilCost },
    ],
    // 흙을 만드는 물건을 흙 없이 세울 수 있으면 첫 대가 공짜가 되고,
    // 둘째 대부터는 자기 산출을 도로 먹는다 — 대를 늘릴수록 늘리는 값이
    // 비싸져 저절로 몇 대에서 멎는다 (docs/game/soil-plant.md).
    note: '잔해를 흙으로 되돌린다 — 도는 동안 낮에 로봇을 부른다',
    station: 'workbench',
    needsVault: true,
  },
];

/** 조감도로 열 수 있는 레시피들 (등장 순서대로 열린다) */
export function nextLockedRecipe(unlocked: ReadonlySet<string>): Recipe | null {
  return RECIPES.find((r) => r.locked && !unlocked.has(r.id)) ?? null;
}

export function hasMaterials(recipe: Recipe, inventory: Inventory): boolean {
  return recipe.inputs.every((i) => inventory.countOf(i.id) >= i.count);
}

export interface CraftContext {
  /** 작업대 곁에 있는지 */
  nearWorkbench: boolean;
  /** 화톳불 곁에 있는지 — 물을 끓이려면 불이 있어야 한다 */
  nearCampfire: boolean;
  unlocked: ReadonlySet<string>;
  /** 종자고를 열었는지 — 유산으로 물려받은 것도 포함이다 */
  vaultOpen: boolean;
}

/** 지금 만들 수 있는지, 못 만든다면 왜 */
export function craftBlocker(
  recipe: Recipe,
  inventory: Inventory,
  ctx: CraftContext,
): string | null {
  if (recipe.locked && !ctx.unlocked.has(recipe.id)) return '조감도가 필요하다';
  if (recipe.needsVault && !ctx.vaultOpen) return '종자고 안에서 알게 되는 것이다';
  if (recipe.station === 'workbench' && !ctx.nearWorkbench) return '작업대 곁이어야 한다';
  // 꺼진 불은 불이 아니다 — fireDistance 가 연료 없는 화톳불을 이미 걸러낸다
  if (recipe.station === 'campfire' && !ctx.nearCampfire) return '타고 있는 화톳불 곁이어야 한다';
  if (!hasMaterials(recipe, inventory)) return '재료가 부족하다';
  return null;
}

/**
 * 재료를 소모한다 — 결과물은 아직 주지 않는다.
 *
 * 조리는 여기서 한 번 끊긴다. 재료를 미리 가져가야 조리 중에 그 재료로
 * 다른 것을 또 만드는 일이 없고, 중간에 그만두면 그대로 돌려주면 된다.
 *
 * @returns 실패 사유. 성공이면 null
 */
export function takeInputs(
  recipe: Recipe,
  inventory: Inventory,
  ctx: CraftContext,
): string | null {
  const blocker = craftBlocker(recipe, inventory, ctx);
  if (blocker) return blocker;

  // 도구는 한 개만 들고 다니게 한다 — 두 개를 번갈아 쓰면 부식이 무의미해진다
  const def = itemDef(recipe.output);
  if (def.tool && inventory.countOf(recipe.output) > 0) return '이미 가지고 있다';

  // 넣을 자리가 있는지 먼저 확인한다 (재료만 사라지는 사고를 막는다)
  const free = inventory.slots.some(
    (s) => s === null || (s.id === recipe.output && s.count < def.stack),
  );
  if (!free) return '가방이 가득 찼다';

  for (const need of recipe.inputs) {
    let left = need.count;
    for (let i = 0; i < inventory.slots.length && left > 0; i++) {
      const slot = inventory.slots[i];
      if (!slot || slot.id !== need.id) continue;
      const take = Math.min(slot.count, left);
      slot.count -= take;
      left -= take;
      if (slot.count <= 0) inventory.slots[i] = null;
    }
  }
  return null;
}

/** 조리를 그만뒀다 — 넣었던 것을 그대로 돌려준다 */
export function returnInputs(recipe: Recipe, inventory: Inventory): void {
  for (const need of recipe.inputs) inventory.add(need.id, need.count);
}

/** 결과물을 손에 쥔다 */
export function giveOutput(recipe: Recipe, inventory: Inventory): void {
  inventory.add(recipe.output, recipe.outputCount);
}

/**
 * 재료를 소모하고 결과물을 넣는다 (시간이 들지 않는 제작).
 * @returns 실패 사유. 성공이면 null
 */
export function craft(
  recipe: Recipe,
  inventory: Inventory,
  ctx: CraftContext,
): string | null {
  const err = takeInputs(recipe, inventory, ctx);
  if (err) return err;
  giveOutput(recipe, inventory);
  return null;
}
