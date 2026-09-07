import { AILMENT, BUILD } from '../config';

/**
 * 아이템 정의.
 *
 * 넷으로 나뉜다 — 월드에서 캐는 것, 시작 가방에 든 것(통조림 · 씨앗 · 의문의 물체),
 * 만들어 쓰는 도구와 설비, 그리고 몸을 다스리는 것(끓인 물 · 억제제).
 *
 * 마지막 갈래가 v0.3에서 생겼다. 체온과 포자병이 들어오면서 "가방에 무엇을
 * 넣고 다닐 것인가"에 물과 약이 끼어들었기 때문이다.
 */

export type ItemId =
  | 'scrap'
  | 'soil'
  | 'stagnantWater'
  | 'cannedFood'
  | 'seed'
  | 'relic'
  | 'crop'
  | 'pickaxe'
  | 'wateringCan'
  | 'rainCollector'
  | 'wall'
  | 'campfire'
  | 'workbench'
  | 'storageBox'
  | 'blueprint'
  | 'hardenedPickaxe'
  | 'gate'
  | 'boiledWater'
  | 'medicine'
  | 'driedGrass'
  | 'roastedCrop'
  | 'grainStew'
  | 'codex'
  | 'compostBin'
  | 'trap'
  | 'vaultKey';

/** 땅에 설치할 수 있는 것 */
export type BuildKind =
  | 'plot'
  | 'collector'
  | 'wall'
  | 'gate'
  | 'campfire'
  | 'workbench'
  | 'storage'
  | 'compost'
  | 'trap';

export interface ConsumeEffect {
  hunger?: number;
  thirst?: number;
  hp?: number;
  /** 체온 회복 — 끓인 것은 몸을 덥힌다 */
  warmth?: number;
  /** 포자 노출 증감 */
  spore?: number;
  /** 이 확률로 포자병에 걸린다 */
  sporeRisk?: number;
  /** 앓고 있던 병을 끊는다 */
  cure?: boolean;
  /** 섭취 후 화면에 띄울 한 줄 */
  note: string;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  /** 핫바 칸에 그릴 짧은 글자 */
  glyph: string;
  stack: number;
  /** UI 색 (CSS) */
  color: string;
  description: string;
  consume?: ConsumeEffect;
  /** 좌클릭으로 땅에 설치할 수 있는 아이템 */
  places?: BuildKind;
  /** 핫바에 들고 있을 때 효과를 내는 도구 */
  tool?: 'pickaxe' | 'wateringCan';
  /**
   * 내구도 — 한 번 쓸 때마다 1/durability 만큼 닳는다.
   * 값이 있으면 마모·부식 대상이 된다.
   */
  durability?: number;
  /**
   * 잔류 포자에 의한 부식 속도 (하루당 마모량).
   * 금속 도구는 쓰지 않아도 서서히 삭는다 — 이 세계의 도구가 영구적이지 않은 이유다.
   */
  corrosionPerDay?: number;
  /** 화톳불에 넣었을 때 타는 시간 (일). 있으면 연료로 쓸 수 있다 */
  fuel?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  scrap: {
    id: 'scrap',
    name: '금속 잔해',
    glyph: '金',
    stack: 40,
    color: '#8b949e',
    description: '기계 문명이 남긴 것. 이 세상에서 가장 흔한 자재다.',
  },
  soil: {
    id: 'soil',
    name: '흙',
    glyph: '土',
    stack: 20,
    color: '#a3763f',
    description: 'AI가 걷어내고 남은 극소량. 이 세계에서 가장 귀하다. 좌클릭으로 밭을 만든다.',
    places: 'plot',
  },
  stagnantWater: {
    id: 'stagnantWater',
    name: '고인 물',
    glyph: '水',
    stack: 10,
    color: '#5b8fa8',
    description:
      '콘크리트 웅덩이에 고인 빗물. 포자가 그대로 떠 있다. 불 곁에서 끓이면 안전하다.',
    consume: {
      thirst: 34,
      // 체력을 조금씩 깎는 대신 확률로 앓게 한다. 매번 같은 대가를 치르면
      // 그냥 세금이 되지만, 확률이면 "끓여 마실 것인가"를 매번 저울질하게 된다.
      sporeRisk: AILMENT.rawWaterInfectChance,
      spore: AILMENT.rawWaterSpore,
      note: '탁한 물이 목을 긁고 내려간다',
    },
  },
  boiledWater: {
    id: 'boiledWater',
    name: '끓인 물',
    glyph: '湯',
    stack: 10,
    color: '#8fd0c4',
    description: '불에 올려 포자를 죽인 물. 갈증을 채우고 몸을 덥힌다.',
    consume: {
      thirst: 42,
      warmth: 12,
      note: '뜨거운 물이 속을 데운다',
    },
  },
  medicine: {
    id: 'medicine',
    name: '포자 억제제',
    glyph: '藥',
    stack: 5,
    color: '#c79fd6',
    description: '작물에서 뽑아낸 억제제. 앓던 것이 끊기고 쌓인 노출도 절반 빠진다.',
    consume: {
      cure: true,
      note: '숨이 트인다',
    },
  },
  driedGrass: {
    id: 'driedGrass',
    name: '마른 풀',
    glyph: '草',
    stack: 20,
    color: '#a89a52',
    description:
      '흙이 남은 자리에만 서 있는 마지막 풀. 이 세계에서 타는 것은 이것과 작물 대뿐이다. E로 화톳불에 넣는다.',
    fuel: BUILD.fuelPerGrass,
  },
  cannedFood: {
    id: 'cannedFood',
    name: '비상 통조림',
    glyph: '缶',
    stack: 8,
    color: '#b9a05a',
    description: '보존 구역에서 가지고 나온 것. 몇 개 없다.',
    consume: {
      hunger: 46,
      thirst: 6,
      note: '차가운 통조림이 속을 채운다',
    },
  },
  seed: {
    id: 'seed',
    name: '재생종 보리씨',
    glyph: '種',
    stack: 30,
    color: '#8fae5a',
    description: '충격 속에서도 살아남은 강인한 품종. 심을 흙이 필요하다.',
  },
  relic: {
    id: 'relic',
    name: '의문의 물체',
    glyph: '?',
    stack: 1,
    color: '#c0a3d6',
    description: '용도를 알 수 없다. 읽어낼 방법을 찾아야 한다.',
  },
  /**
   * 의문의 물체의 정체.
   *
   * 기록 열 편을 다 읽으면 손 안의 것이 이것으로 바뀐다. 새 물건을 주는 게
   * 아니라 **원래 있던 것의 이름이 밝혀지는** 것이라, 첫날부터 가방에 있던
   * 물건이 그제야 뜻을 갖는다 — "세 번째 것이 무엇인지는 네가 알아내야 한다."
   */
  vaultKey: {
    id: 'vaultKey',
    name: '종자고 열쇠',
    glyph: '⚿',
    stack: 1,
    color: '#b9c46a',
    description:
      '보존 구역 종자고의 인증 키. 1,204종이 그 안에 잠들어 있다. ' +
      '흙을 되찾지 못하면 우리는 씨앗을 지킨 게 아니라 보관만 한 것이다.',
  },
  crop: {
    id: 'crop',
    name: '재생종 보리',
    glyph: '穀',
    stack: 20,
    color: '#9dbd63',
    description:
      '보존 구역에서 개량한 내성 품종. 척박한 땅에서도 이삭을 맺는다. 날로도 먹지만 익히면 훨씬 낫다.',
    consume: {
      hunger: 38,
      thirst: 4,
      note: '설익은 알곡이 서걱거린다',
    },
  },
  roastedCrop: {
    id: 'roastedCrop',
    name: '구운 보리',
    glyph: '燒',
    stack: 20,
    color: '#c9a05a',
    description: '불에 올려 겉을 그을린 알곡. 그냥 씹는 것보다 훨씬 든든하다.',
    consume: {
      hunger: 62,
      warmth: 8,
      note: '고소한 냄새가 입안에 퍼진다',
    },
  },
  grainStew: {
    id: 'grainStew',
    name: '보리죽',
    glyph: '粥',
    stack: 10,
    color: '#d9b878',
    description:
      '끓인 물에 알곡을 풀어 오래 끓인 것. 배와 갈증을 함께 채우고 몸을 깊이 덥힌다.',
    consume: {
      hunger: 74,
      thirst: 30,
      warmth: 26,
      hp: 6,
      note: '뜨거운 죽이 속을 훑고 내려간다',
    },
  },
  codex: {
    id: 'codex',
    name: '식물 도감',
    glyph: '冊',
    stack: 1,
    color: '#9dbd63',
    description:
      '보존 구역에서 쓰던 재배 기록. 무엇을 심고 어떻게 먹는지가 적혀 있다. F로 펼친다.',
  },
  pickaxe: {
    id: 'pickaxe',
    name: '잔해 곡괭이',
    glyph: '⛏',
    stack: 1,
    color: '#c6b48a',
    description: '들고 있으면 채집이 빨라진다. 잔류 포자에 서서히 삭는다.',
    tool: 'pickaxe',
    durability: 60,
    corrosionPerDay: 0.16,
  },
  hardenedPickaxe: {
    id: 'hardenedPickaxe',
    name: '코팅 곡괭이',
    glyph: '⛏',
    stack: 1,
    color: '#8fd0c4',
    description: '부식 저항 처리를 한 곡괭이. 오래 간다.',
    tool: 'pickaxe',
    durability: 160,
    corrosionPerDay: 0.03,
  },
  wateringCan: {
    id: 'wateringCan',
    name: '물뿌리개',
    glyph: '壺',
    stack: 1,
    color: '#7fb0c4',
    description: '물 하나로 밭 세 곳에 물을 줄 수 있다. 잔류 포자에 서서히 삭는다.',
    tool: 'wateringCan',
    durability: 45,
    corrosionPerDay: 0.12,
  },
  rainCollector: {
    id: 'rainCollector',
    name: '빗물 집수기',
    glyph: '⌂',
    stack: 5,
    color: '#a0a8ae',
    description: '설치해 두면 밤새 빗물이 고인다. 좌클릭으로 설치한다.',
    places: 'collector',
  },
  wall: {
    id: 'wall',
    name: '잔해 방벽',
    glyph: '壁',
    stack: 20,
    color: '#9298a0',
    description:
      '무너진 것을 다시 쌓아 올린 벽. 밤에 오는 것들을 막는다. R로 방향을 돌려 구역을 두른다.',
    places: 'wall',
  },
  gate: {
    id: 'gate',
    name: '여닫이 문',
    glyph: '門',
    stack: 10,
    color: '#a9926a',
    description:
      '방벽에 낸 출입구. E로 여닫는다. 닫아두면 벽과 같고, 변이 생물은 열지 못한다.',
    places: 'gate',
  },
  campfire: {
    id: 'campfire',
    name: '화톳불',
    glyph: '火',
    stack: 5,
    color: '#d98a4a',
    description: '변이 생물은 빛을 피한다. 밤을 견디는 가장 확실한 방법.',
    places: 'campfire',
  },
  workbench: {
    id: 'workbench',
    name: '작업대',
    glyph: '工',
    stack: 3,
    color: '#c2a878',
    description: '곁에 있어야 만들 수 있는 것들이 있다. 거점의 시작.',
    places: 'workbench',
  },
  storageBox: {
    id: 'storageBox',
    name: '보관함',
    glyph: '箱',
    stack: 3,
    color: '#b08a58',
    description: '가방에 다 들어가지 않는 것을 넣어둔다. E로 연다.',
    places: 'storage',
  },
  compostBin: {
    id: 'compostBin',
    name: '퇴비 더미',
    glyph: '肥',
    stack: 3,
    color: '#7d6a3e',
    description:
      '유기물을 삭혀 흙으로 되돌린다. 마른 풀과 작물을 넣고 며칠 두면 흙이 나온다 — 흙을 늘리는 유일한 방법.',
    places: 'compost',
  },
  trap: {
    id: 'trap',
    name: '잔해 함정',
    glyph: '罠',
    stack: 10,
    color: '#98a2ad',
    description:
      '날 선 철판을 세워 묻은 자리. 밟으면 크게 다친다. 로봇에게는 불빛이 통하지 않으니 길목에 이것을 둔다.',
    places: 'trap',
  },
  blueprint: {
    id: 'blueprint',
    name: '조감도 데이터',
    glyph: '図',
    stack: 10,
    color: '#9fc0e0',
    description:
      '폐허에서 건져낸 설계 기록. F로 읽으면 만들 줄 몰랐던 것 하나를 알게 된다.',
  },
};

export function itemDef(id: ItemId): ItemDef {
  return ITEMS[id];
}
