import * as THREE from 'three';
import { RenderContext } from '../render/RenderContext';
import { Terrain } from '../world/Terrain';
import { Ruins } from '../world/Ruins';
import { Sky } from '../world/Sky';
import { ResourceNodes } from '../world/ResourceNodes';
import { Buildings, type Placed } from '../world/Buildings';
import { Audio } from '../audio/Audio';
import { Creatures } from '../world/Creatures';
import { Dust } from '../world/Dust';
import { Flora } from '../world/Flora';
import { Skyline } from '../world/Skyline';
import { Weather } from '../world/Weather';
import { Environment } from '../world/Environment';
import { Settlement } from '../world/Settlement';
import { Settlers } from '../world/Settlers';
import { ObjectiveTracker, type ObjectiveContext } from '../gameplay/Objectives';
import { ColliderSet } from '../world/Collision';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { Hud, type HudState } from '../ui/Hud';
import { PlayerHud } from '../ui/PlayerHud';
import { Overlays } from '../ui/Overlays';
import { Inventory } from '../gameplay/Inventory';
import { SurvivalStats } from '../gameplay/SurvivalStats';
import { InteractionSystem } from '../gameplay/Interaction';
import { Placement } from '../gameplay/Placement';
import {
  craft,
  giveOutput,
  nextLockedRecipe,
  returnInputs,
  takeInputs,
  type CraftContext,
  type Recipe,
} from '../gameplay/Recipes';
import { ToolWear } from '../gameplay/Tools';
import { transfer, inventorySink } from '../gameplay/Storage';
import { CraftPanel } from '../ui/CraftPanel';
import { StoragePanel } from '../ui/StoragePanel';
import { ArchivePanel } from '../ui/ArchivePanel';
import { CodexPanel } from '../ui/CodexPanel';
import {
  ACTS,
  ArchiveLog,
  SOIL_FOR_FINAL_ACT,
  type StoryContext,
} from '../gameplay/Archive';
import { Compass, type CompassMark } from '../ui/Compass';
import { itemDef, type BuildKind, type ItemId } from '../gameplay/Items';
import { Input } from './Input';
import { GameTime } from './GameTime';
import {
  AILMENT,
  BUILD,
  COMBAT,
  COOK,
  GREENHOUSE,
  HANGAR,
  WATER_TOWER,
  MAST,
  VAULT,
  FARM,
  HAZARD,
  PLAYER,
  SETTLEMENT,
  TIME,
  WORLD,
} from '../config';
import { SeedVault } from '../world/SeedVault';
import { SurveyMast } from '../world/SurveyMast';
import { Greenhouse } from '../world/Greenhouse';
import { WaterTower } from '../world/WaterTower';
import { Hangar } from '../world/Hangar';
import { Api } from '../net/Api';
import type { SaveState } from '../gameplay/SaveState';
import {
  clearLegacy,
  loadLegacy,
  recordDeath,
  legacyLines,
  type LegacyData,
} from '../gameplay/Legacy';
import { clamp, damp } from '../util/math';
import { withJosa } from '../util/korean';

/** 물리 서브스텝 간격. 프레임레이트와 무관하게 일정한 이동 결과를 보장한다 */
const PHYSICS_STEP = 1 / 120;
const MAX_SUBSTEPS = 6;
/** 탭 전환 등으로 프레임이 길게 튀었을 때의 상한 */
const MAX_FRAME_DT = 0.1;

const SPAWN = { x: -3, z: 7 };

/** 궂은 날의 안개 색 */
const DUST_FOG = new THREE.Color(0x8a7a5e);
const RAIN_FOG = new THREE.Color(0x8d99a6);

/** 계절 색을 안개에 섞을 때 쓰는 임시 색 — 매 프레임 새로 만들지 않는다 */
const SEASON_TINT = new THREE.Color();

/** 머리 위를 재는 광선 — 매 프레임 새로 만들지 않는다 */
const SHELTER_ORIGIN = new THREE.Vector3();
const SHELTER_UP = new THREE.Vector3(0, 1, 0);
const SHELTER_REACH = 7;

/** 철거 조준의 시야각 — 설치보다 좁게 잡아 옆엣것이 잘못 걸리지 않게 한다 */
const DEMOLISH_CONE_COS = Math.cos(40 * Math.PI / 180);

/** 철거 안내에 쓰는 이름 */
const BUILD_LABEL: Partial<Record<BuildKind, string>> = {
  plot: '밭',
  collector: '집수기',
  wall: '방벽',
  gate: '문',
  campfire: '화톳불',
  workbench: '작업대',
  storage: '보관함',
  compost: '퇴비 더미',
  trap: '함정',
};

/** 이 속력을 넘으면 달리는 중으로 보고 소모를 가속한다 (걷기 3.4 / 달리기 6.2) */
const PLAYER_SPRINT_THRESHOLD = 4.6;

/** 자동 저장 간격 (s) */
const AUTOSAVE_SECONDS = 30;

/** 나침반에 띄우는 거점 표지 */
const LANDMARK_STYLE: Partial<Record<BuildKind, { glyph: string; color: string }>> = {
  workbench: { glyph: '工', color: '#c2a878' },
  storage: { glyph: '箱', color: '#b08a58' },
  campfire: { glyph: '火', color: '#d98a4a' },
  plot: { glyph: '田', color: '#9dbd63' },
};

/** 설치 종류별 작업 시간 (s) */
const TILL_TIME: Record<string, number> = {
  plot: FARM.tillTime,
  collector: FARM.buildTime,
  wall: BUILD.wallTime,
  campfire: BUILD.fireTime,
  workbench: BUILD.benchTime,
  storage: BUILD.storageTime,
  gate: BUILD.wallTime,
  compost: FARM.buildTime,
  trap: BUILD.trapTime,
};

export class Game {
  private readonly container: HTMLElement;
  private readonly ctx: RenderContext;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly overlays: Overlays;
  private readonly time = new GameTime();

  private terrain!: Terrain;
  private ruins!: Ruins;
  private vault!: SeedVault;
  private masts!: SurveyMast;
  private greenhouse!: Greenhouse;
  private waterTower!: WaterTower;
  private hangar!: Hangar;

  /**
   * 첨탑에서 눈에 담아둔 자원 노드의 번호.
   *
   * 노드 배열은 시드로 결정론적으로 만들어지므로 번호만 들고 있으면 된다 —
   * 세이브에도 유산에도 숫자 몇 개로 들어간다.
   */
  private surveyed = new Set<number>();

  /** 종자고 문 앞에서 열쇠를 꽂고 버틴 시간 (s) */
  private vaultHold = 0;
  /** 이번 프레임에 띄울 종자고 안내 */
  private vaultHint: string | null = null;
  private sky!: Sky;
  private resources!: ResourceNodes;
  private buildings!: Buildings;
  private creatures!: Creatures;
  private dust!: Dust;
  private flora!: Flora;
  private skyline!: Skyline;
  private weather!: Weather;
  /** 계절과 환경 악화 곡선 — 나빠지는 세계와 되살리는 손의 경주 (기획서 3.7) */
  private readonly env = new Environment();
  /** 정착지 등급 — 지은 것들을 하나로 읽는다 (기획서 3.5) */
  private readonly settlement = new Settlement();
  private settlers!: Settlers;
  private readonly audio = new Audio();
  /** 폐허 + 지은 것을 합친 충돌 조회 */
  private solids!: ColliderSet;
  private player!: PlayerController;
  private camera!: ThirdPersonCamera;

  private tools!: ToolWear;
  /** 조감도로 열어둔 레시피 */
  private readonly unlocked = new Set<string>();

  /** 창을 띄우느라 포인터 락을 풀어둔 상태인지 */
  private uiHoldingCursor = false;

  /** 근접 공격 쿨다운 */
  private swingCooldown = 0;

  private readonly inventory = new Inventory();
  private readonly stats = new SurvivalStats();
  /** 길잡이 — 지금 할 일 하나씩 */
  private readonly guide = new ObjectiveTracker();
  /** 찾아낸 기록 조각 */
  private readonly archive = new ArchiveLog();
  private archivePanel!: ArchivePanel;
  private codexPanel!: CodexPanel;
  private interaction!: InteractionSystem;
  private placement!: Placement;
  private playerHud!: PlayerHud;
  private craftPanel!: CraftPanel;
  private storagePanel!: StoragePanel;
  private compass!: Compass;
  private readonly compassMarks: CompassMark[] = [];
  /** 거점 표지의 월드 좌표 — 설치물이 바뀔 때만 다시 모은다 */
  private readonly landmarkCache: ReturnType<Buildings['landmarks']> = [];
  private landmarkRevision = -1;

  /** 하루가 넘어가는 순간을 잡기 위한 직전 일차 */
  private lastDay = 1;
  /** 진행 중인 설치 작업 — 일구기·세우기 모션이 끝나야 실제로 놓인다 */
  private tillTask: {
    kind: BuildKind;
    /**
     * 작업을 시작할 때 손에 들고 있던 아이템.
     *
     * 예전에는 칸 번호를 적어뒀는데, 핫바가 배정표로 바뀌면서
     * 핫바 번호와 가방 칸 번호가 서로 다른 주소가 됐다. 번호를 들고 다니면
     * 엉뚱한 칸을 보게 되므로 아이템 자체를 기억한다.
     */
    item: ItemId;
    x: number;
    z: number;
    t: number;
    total: number;
  } | null = null;

  /** 평상시 시간 배속. 개발용 훅이 여기를 바꾼다 (T 키는 이 값을 일시적으로 덮는다) */
  private baseTimeScale = 1;

  private readonly api = new Api();
  /** 죽음을 넘어 남는 것 — 해독한 설계·읽은 기록·되살린 흙 (기획서 7장) */
  private legacy: LegacyData = loadLegacy();
  /** 이번 판의 누적 — 사망 시 기록으로 올라간다 */
  private tally = { harvests: 0, gathered: 0, refuels: 0 };
  private saveTimer = 0;

  private running = false;
  private started = false;
  private paused = true;
  /** 포인터 락을 한 번이라도 얻었는지 — 락 해제를 일시정지로 해석할지 판단한다 */
  private everLocked = false;
  private lastFrame = 0;
  private accumulator = 0;
  /**
   * 타격이 꽂힌 직후 세상을 아주 잠깐 멈추는 시간 (s).
   *
   * 때린 순간 모든 것이 그대로 흐르면 곡괭이가 허공을 지나간 것처럼 보인다.
   * 60ms 만 멈춰도 "맞았다"가 손에 잡힌다 — 격투 게임이 오래 쓰는 방법이다.
   * 대신 화면 자체는 계속 그린다. 멈추는 것은 시뮬레이션뿐이다.
   */
  private hitStop = 0;
  /**
   * 머리 위가 막힌 정도 0..1.
   *
   * 폐허에 지붕은 있었지만 들어가도 아무 차이가 없었다. 그러면 실내는
   * 그냥 어두운 바깥이다. 비바람을 막아줘야 "들어가자"가 성립한다.
   */
  private shelter = 0;
  /** 가장 가까운 화톳불까지의 거리 (m) — 온기·소리·제작이 함께 쓴다 */
  private fireDist = Infinity;
  /** 그 거리를 온기로 환산한 값 0..1 */
  private fireWarmth = 0;
  /** 생존자들이 먹다 남긴 소수점 — 1이 넘을 때만 창고에서 덜어낸다 */
  private settlerHunger = 0;
  /** 연달아 굶은 횟수 — 잔소리를 세 번에 한 번만 하기 위해 */
  private starvedTicks = 0;
  /** 철거 중인 대상과 경과 시간 */
  private wreck: { node: Placed; t: number } | null = null;

  /**
   * 지금 불 위에 올려둔 것 (기획서 3.2).
   *
   * 단추 한 번에 밥이 나오면 화톳불은 "조건"일 뿐 장소가 되지 못한다.
   * 시간을 들이게 하면 불이 머무는 곳이 되고, 밤이 오기 전에 미리 끓여둘지
   * 지금 먹고 뛸지가 판단이 된다.
   */
  private cooking: { recipe: Recipe; t: number; total: number } | null = null;

  /**
   * 결말을 이미 보여줬는가.
   *
   * 없으면 기록이 완성된 상태로 다시 들어올 때마다 결말이 뜨고 열쇠가 하나씩
   * 더 생긴다. 완성되는 **그 순간**에만 한 번 — 이후의 생은 이미 아는 채로 깨어난다.
   */
  private storyShown = false;

  /**
   * 이번 프레임에 띄울 철거 안내.
   *
   * 철거가 있다는 것을 아무도 몰랐다 — 키 목록 어디에도 없었고, 뜯을 수 있는
   * 것 앞에 서도 화면이 조용했다. 되돌릴 수 없다고 믿으면 아예 짓지 않게 된다.
   * 그래서 뜯을 수 있는 것을 보고 있을 때만 그 자리에서 한 줄 알려준다.
   */
  private wreckHint: string | null = null;
  private fps = 60;

  private readonly hudState: HudState = {
    day: 1,
    season: '',
    seasonColor: '#8fae5a',
    settlement: '야영지',
    settlementHint: '',
    clock: '00:00',
    phase: '',
    hazard: '',
    hazardWarn: false,
    dayProgress: 0,
    isNight: false,
    fps: 60,
    position: new THREE.Vector3(),
    speed: 0,
    grounded: true,
    sliding: false,
    soil: 0,
    drawCalls: 0,
    triangles: 0,
    colliders: 0,
    saveTarget: '로컬',
    creatures: 0,
    lookMode: '드래그',
    base: { ripe: 0, dry: 0, empty: 0, filled: 0, firesOut: 0, firesLow: 0, compostReady: 0 },
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.ctx = new RenderContext(container);
    this.input = new Input(this.ctx.canvas);
    this.hud = new Hud(container);
    this.overlays = new Overlays(container);

    // 포인터 락은 있으면 좋은 것이지 전제가 아니다.
    // 락을 얻었다가 놓쳤을 때만(=ESC) 일시정지로 해석한다.
    this.input.onPointerLockChange((locked) => {
      if (!this.started) return;
      if (locked) {
        this.everLocked = true;
        this.setPaused(false);
      } else if (this.everLocked && !this.modalOpen) {
        // 창을 띄우려고 일부러 푼 것이라면 일시정지가 아니다
        this.setPaused(true);
      }
    });

    // 락이 없는 환경을 위한 명시적 일시정지 / 재개
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.started) return;
      if (this.modalOpen) {
        this.storagePanel.close();
        this.craftPanel.close();
        this.archivePanel.close();
        this.codexPanel.close();
        this.playerHud.closeBag();
        this.syncPointerForUi();
        return;
      }
      if (!this.input.locked) this.setPaused(true);
    });
    // 캔버스를 누르면 언제나 커서를 다시 잡는다.
    //
    // 포인터 락은 사용자 제스처 안에서만 요청할 수 있고, 브라우저가
    // 이런저런 이유로 거절하기도 한다. 한 번 놓치면 드래그 조작으로 떨어져
    // "마우스를 눌러야만 시점이 도는" 답답한 상태가 되므로,
    // 클릭할 때마다 다시 잡아 본다.
    this.ctx.canvas.addEventListener('mousedown', () => {
      this.audio.unlock();
      if (!this.started) return;
      if (this.paused) {
        this.resume();
        return;
      }
      if (!this.input.locked && !this.modalOpen) this.input.requestLock();
    });

    this.ctx.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    this.overlays.setPaused(v);
    // 정지 동안 쌓인 물리 시간을 버려 재개 순간에 순간이동하지 않게 한다
    if (v) this.accumulator = 0;
  }

  private resume(): void {
    if (this.stats.dead) return; // 사망 화면은 클릭으로 재개되지 않는다
    this.setPaused(false);
    this.input.requestLock();
  }

  /**
   * 오프닝 문구에 나오는 가방 속 세 가지, 그리고 식물 도감.
   *
   * 도감은 튜토리얼을 **소지품으로** 주는 장치다. 주인공은 보존 구역에서
   * 농사를 짓던 사람이니 도감을 챙겨 나온 것이 자연스럽고, 기억을 잃은
   * 플레이어에게 "이 작물은 무엇이고 어떻게 먹는가"를 설명할 자리가 생긴다.
   * 안내문을 화면에 띄우는 대신 세계 안의 물건으로 두는 편이 낫다.
   */
  private giveStartingItems(): void {
    this.inventory.add('cannedFood', 1);
    this.inventory.add('seed', 6);
    // 정체를 이미 알아낸 사람에게 다시 "의문의 물체"를 쥐여줄 수는 없다.
    // 아는 것은 죽어도 남는다 — 그게 유산의 규칙이다.
    this.inventory.add(this.archive.complete ? 'vaultKey' : 'relic', 1);
    this.inventory.add('codex', 1);
  }

  /**
   * 막의 문을 판단할 때 쓰는 값.
   *
   * 둘 다 **유산까지 합친** 값이다 — 되살린 흙은 애초에 누적이고,
   * 등급은 이번 생과 지난 생 중 더 높은 쪽을 쓴다. 지난 생에 마을까지
   * 키워 본 사람에게 "거점을 세워라"를 다시 요구하면 이야기가 뒷걸음질한다.
   */
  private storyContext(): StoryContext {
    return {
      restored: this.env.restored,
      bestRank: Math.max(this.settlement.rank, this.legacy.bestRank),
    };
  }

  /**
   * 마지막 조각을 읽은 순간.
   *
   * 첫날부터 가방에 있던 "의문의 물체"가 그제야 이름을 갖는다.
   * 새 물건을 주는 것이 아니라 **원래 있던 것의 정체가 밝혀지는** 쪽이,
   * "세 번째 것이 무엇인지는 네가 알아내야 한다"는 마지막 송신과 맞는다.
   */
  private checkStoryComplete(): void {
    if (!this.archive.complete || this.storyShown) return;
    this.storyShown = true;

    // 손에 든 것을 바꿔 끼운다. 잃어버렸거나 보관함에 넣어 두었어도 새로 준다 —
    // 열 편을 다 읽고도 빈손인 것은 벌이 아니라 사고다.
    for (let i = this.inventory.slots.length - 1; i >= 0; i--) {
      if (this.inventory.slots[i]?.id === 'relic') this.inventory.dropAt(i);
    }
    this.inventory.add('vaultKey', 1);

    // 읽는 동안 세상은 멈춘다. 마지막 문장을 읽다가 물려 죽으면
    // 그건 긴장이 아니라 그냥 억울한 일이다.
    this.overlays.showEnding(() => {
      this.archivePanel.refresh();
      this.setPaused(false);
      this.input.requestLock();
    });
    this.setPaused(true);
  }

  // ---------------------------------------------------------------- 저장

  /** 지금 상태를 세이브 구조로 만든다 (시드 + 변경분만) */
  private snapshot(): SaveState {
    return {
      time: { day: this.time.day, phase: this.time.phase },
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        facing: this.player.facing,
      },
      stats: {
        hp: this.stats.hp,
        hunger: this.stats.hunger,
        thirst: this.stats.thirst,
        warmth: this.stats.warmth,
        spore: this.stats.spore,
        sickness: this.stats.sickness,
      },
      inventory: this.inventory.snapshot(),
      bindings: [...this.inventory.bindings],
      nodes: this.resources.serialize(),
      buildings: this.buildings.serialize(),
      tally: { ...this.tally },
      unlocked: [...this.unlocked],
      guide: this.guide.serialize(),
      restored: this.env.restored,
      archive: this.archive.serialize(),
      vault: this.vault.isOpen,
      masts: this.masts.serialize(),
      surveyed: [...this.surveyed],
      storage: this.buildings.serializeStorage(),
    };
  }

  private async save(): Promise<void> {
    if (!this.started || this.stats.dead) return;
    await this.api.saveGame(WORLD.seed, this.time.day, this.snapshot());
  }

  /** 세이브를 세계에 다시 입힌다 */
  private applySave(state: SaveState): void {
    this.time.day = state.time.day;
    this.time.phase = state.time.phase;
    this.lastDay = state.time.day;

    this.player.spawn(state.player.x, state.player.z);
    this.player.position.y = state.player.y;
    this.player.facing = state.player.facing;

    this.stats.reset();
    this.stats.hp = state.stats.hp;
    this.stats.hunger = state.stats.hunger;
    this.stats.thirst = state.stats.thirst;
    // 옛 세이브에는 없다 — 없으면 성한 몸으로 깨어난다
    this.stats.warmth = state.stats.warmth ?? AILMENT.maxWarmth;
    this.stats.spore = state.stats.spore ?? 0;
    this.stats.sickness = state.stats.sickness ?? 0;

    this.inventory.clear();
    this.inventory.bindings.fill(null);
    const saved = state.bindings ?? [];
    for (let i = 0; i < saved.length && i < this.inventory.bindings.length; i++) {
      this.inventory.bindings[i] = (saved[i] as ItemId | null) ?? null;
    }

    for (let i = 0; i < state.inventory.length && i < this.inventory.slots.length; i++) {
      this.inventory.slots[i] = state.inventory[i] ?? null;
    }
    // 배정 정보가 없던 예전 세이브만 채워준다.
    // 새 세이브에는 일부러 비워둔 칸도 그대로 담겨 있으므로 건드리지 않는다.
    if (!state.bindings) this.inventory.rebindMissing();
    this.guide.restore(state.guide ?? 0);
    this.env.reset(state.restored ?? 0);
    // 세이브에서 되살아난 설치물로 등급을 처음부터 다시 잰다
    this.settlement.reset();
    this.settlers.reset();
    this.settlerHunger = 0;
    this.archive.restore(state.archive);
    // 이어하는 판이 이미 다 읽은 상태라면 결말은 지난번에 봤다
    this.storyShown = this.archive.complete;
    if (state.vault) {
      this.vault.restore(true);
      this.applyVaultBonus();
    }
    this.masts.restore(state.masts ?? []);
    this.surveyed = new Set(state.surveyed ?? []);
    this.archivePanel?.refresh();
    this.inventory.selectHotbar(0);

    this.resources.restore(state.nodes);
    this.buildings.restore(state.buildings);
    if (state.storage) this.buildings.restoreStorage(state.storage);

    this.unlocked.clear();
    for (const id of state.unlocked ?? []) this.unlocked.add(id);

    // refuels 는 v0.3에서 생겼다 — 옛 세이브에는 없으므로 0으로 채운다
    this.tally = { ...state.tally, refuels: state.tally.refuels ?? 0 };

    this.camera.reset(this.player.position, state.player.facing + Math.PI);
  }

  /** 사망 후 완전 초기화 (기획 3.9) */
  private restart(): void {
    this.overlays.hideDeath();
    this.stats.reset();
    this.inventory.clear();
    this.resources.reset();
    this.buildings.reset();
    this.creatures.reset();
    this.interaction.reset();
    this.tillTask = null;
    this.cooking = null;
    this.playerHud.closeBag();
    this.craftPanel.close();
    this.storagePanel.close();
    // 지은 것과 모여든 사람은 사라진다 — 당신의 것이었다
    this.settlement.reset();
    this.settlers.reset();
    this.settlerHunger = 0;
    this.starvedTicks = 0;
    this.time.phase = TIME.startPhase;
    this.time.day = 1;
    this.lastDay = 1;
    this.player.spawn(SPAWN.x, SPAWN.z);
    this.camera.reset(this.player.position, Math.PI * 0.15);
    this.tally = { harvests: 0, gathered: 0, refuels: 0 };

    this.applyLegacy();
    this.giveStartingItems();
    this.setPaused(false);
    this.input.requestLock();
  }

  /**
   * 지난 생이 남긴 것을 물려받는다 (기획서 7장 완충안).
   *
   * 손에 있던 것은 이미 위에서 다 지웠다. 여기서 되돌리는 것은 둘뿐이다 —
   * **머리에 남은 것**(해독한 설계·읽은 기록)과 **땅에 돌려준 것**(되살린 흙).
   *
   * 되살린 흙을 남기는 것이 이 설계의 핵심이다. 3.7의 상승 곡선이 한 생에서
   * 끝나면 세계는 영영 나빠지기만 한다 — 세계를 되살리는 일은 원래
   * 한 사람이 끝낼 수 있는 일이 아니다.
   */
  private applyLegacy(): void {
    this.unlocked.clear();
    for (const id of this.legacy.unlocked) this.unlocked.add(id);
    this.archive.restore(this.legacy.archive);
    this.archivePanel?.refresh();
    this.env.reset(this.legacy.restored);
    // 지난 생이 이미 다 읽었다면 결말도 이미 봤다 — 다시 띄우지 않는다
    this.storyShown = this.archive.complete;
    // 한 번 연 문은 다음 생에도 열려 있다. 여는 방법을 알았고 안의 것도
    // 이미 손에 넣었다 — 같은 문 앞에서 처음부터 다시 시작하면 반복일 뿐이다.
    if (this.legacy.vault) {
      this.vault.restore(true);
      this.applyVaultBonus();
    }
    // 본 것도 남는다. 두 번째 생은 힘이 세지는 게 아니라 **길을 아는 채로**
    // 시작한다 — 같은 시드의 같은 폐허이므로 앞사람이 그린 지도가 그대로 맞는다.
    this.masts.restore(this.legacy.masts);
    this.surveyed = new Set(this.legacy.surveyed);
  }

  // ---------------------------------------------------------------- 부팅

  async boot(): Promise<void> {
    await this.buildWorld();

    // 이어할 것이 있는지 서버(없으면 로컬)에 물어본다
    const save = await this.loadExistingSave();

    this.overlays.ready(() => {
      this.started = true;
      this.overlays.hideLoading();
      this.resume();
      if (save) {
        this.playerHud.toast(
          `${save.day}일째부터 이어서 — ${this.api.online ? '서버' : '이 브라우저'}`,
          '#b9c46a',
        );
      }
    }, save ? `${save.day}일째에서 이어한다` : undefined, {
      runs: this.legacy.runs,
      kept: legacyLines({
        unlocked: this.legacy.unlocked.length,
        archive: this.legacy.archive.length,
        restored: this.legacy.restored,
        masts: this.legacy.masts.length,
        vault: this.legacy.vault,
      }),
    });

    // 창을 닫기 전에 마지막으로 한 번 밀어 넣는다
    window.addEventListener('pagehide', () => {
      if (this.started && !this.stats.dead) void this.save();
    });

    this.start();
  }

  /** 기존 세이브를 찾아 적용한다. 없으면 새 판 */
  private async loadExistingSave(): Promise<{ day: number } | null> {
    try {
      const save = await this.api.loadSave();
      if (!save || save.seed !== WORLD.seed) {
        // 이어할 것이 없다 = 새 생이다. 지난 생이 남긴 것을 물려받고 시작한다.
        this.applyLegacy();
        this.giveStartingItems();
        return null;
      }
      this.applySave(save.state);
      return { day: save.day };
    } catch (err) {
      console.warn('[에덴의 포자] 세이브를 불러오지 못했습니다', err);
      this.giveStartingItems();
      return null;
    }
  }

  /** 각 단계 사이에 프레임을 양보해 로딩 바가 실제로 그려지게 한다 */
  private async stage(progress: number, label: string, work: () => void): Promise<void> {
    this.overlays.setProgress(progress, label);
    await nextPaint();
    work();
  }

  private async buildWorld(): Promise<void> {
    await this.stage(0.08, '대지의 잔해를 읽는 중', () => {
      this.terrain = new Terrain();
      this.ctx.scene.add(this.terrain.mesh);
    });

    await this.stage(0.34, '무너진 도시를 세우는 중', () => {
      this.ruins = new Ruins(this.terrain);
      this.ctx.scene.add(this.ruins.group);

      // 종자고는 폐허와 같은 콜라이더 세계에 들어가되 메시는 따로 세운다 —
      // 문 한 짝만 나중에 치울 수 있어야 하기 때문이다
      this.vault = new SeedVault(this.terrain, this.ruins.colliders);
      this.ctx.scene.add(this.vault.group);

      this.masts = new SurveyMast(this.terrain, this.ruins.colliders);
      this.ctx.scene.add(this.masts.group);

      // 폐허 구조물 셋. 모두 폐허와 같은 콜라이더 세계에 들어간다 —
      // 자원 노드가 벽과 이랑을 피해 앉으려면 노드를 깔기 **전에** 서 있어야 한다.
      //
      // 셋이 저마다 다른 것을 준다. 온실은 흙, 급수탑은 물,
      // 격납고는 잔해 — 대신 낮에 로봇이 깨어난다.
      this.greenhouse = new Greenhouse(this.terrain, this.ruins.colliders);
      this.ctx.scene.add(this.greenhouse.group);

      this.waterTower = new WaterTower(this.terrain, this.ruins.colliders);
      this.ctx.scene.add(this.waterTower.group);

      this.hangar = new Hangar(this.terrain, this.ruins.colliders);
      this.ctx.scene.add(this.hangar.group);

      this.hudState.colliders = this.ruins.stats.colliders;
    });

    await this.stage(0.68, '대기와 포자를 채우는 중', () => {
      this.sky = new Sky();
      this.ctx.scene.add(this.sky.group);
      this.ctx.scene.fog = this.sky.fog;
      this.sky.attachEnvironment(this.ctx.renderer, this.ctx.scene);
      // 환경 반사는 금속을 살리기 위한 것이지 장면 전체를 밝히기 위한 게 아니다
      this.ctx.scene.environmentIntensity = 0.5;
    });

    await this.stage(0.78, '남은 것들을 흩뿌리는 중', () => {
      // 비옥한 땅에만 마른 풀이 남아 있다 — 어디를 일굴지 알려주는 단서
      // 지평선 너머의 도시 — 갈 수는 없지만 세계가 여기서 끝나지 않게 한다
      this.weather = new Weather(WORLD.seed);
      this.ctx.scene.add(this.weather.points);

      this.skyline = new Skyline(WORLD.seed);
      this.ctx.scene.add(this.skyline.mesh);

      this.flora = new Flora(this.terrain, this.ruins.colliders, WORLD.seed);
      this.ctx.scene.add(this.flora.mesh);

      // 폐허 구조물은 지형이 정한 조건과 무관하게 자기 몫을 끌고 온다 —
      // 여기 자원이 있는 이유는 땅이 아니라 건물이다
      this.resources = new ResourceNodes(this.terrain, this.ruins.colliders, [
        {
          x: GREENHOUSE.x,
          z: GREENHOUSE.z,
          radius: GREENHOUSE.hotspotRadius,
          nodes: { soil: GREENHOUSE.soilNodes, grass: GREENHOUSE.grassNodes },
        },
        {
          x: WATER_TOWER.x,
          z: WATER_TOWER.z,
          radius: WATER_TOWER.hotspotRadius,
          nodes: { water: WATER_TOWER.waterNodes },
        },
        {
          x: HANGAR.x,
          z: HANGAR.z,
          radius: HANGAR.hotspotRadius,
          nodes: { scrap: HANGAR.scrapNodes },
        },
      ]);
      this.ctx.scene.add(this.resources.group);
      this.buildings = new Buildings(this.terrain);
      this.ctx.scene.add(this.buildings.group);

      // 폐허(불변)와 지은 것(가변)을 합쳐 하나처럼 조회한다
      this.solids = new ColliderSet(this.ruins.colliders, this.buildings.colliders);

      this.creatures = new Creatures(this.terrain, this.solids, this.buildings);
      // 격납고는 정착지 등급을 건너뛰고 낮에 로봇을 부른다 —
      // 거점이 커져서가 아니라 거기 잠들어 있던 것들이 깨는 것이다
      this.creatures.setWakeZone((x, z) => this.hangar.wakesRobots(x, z));
      this.ctx.scene.add(this.creatures.group);

      this.settlers = new Settlers(this.terrain, this.buildings);
      this.ctx.scene.add(this.settlers.group);

      this.dust = new Dust();
      this.ctx.scene.add(this.dust.points);
    });

    await this.stage(0.9, '생존자를 깨우는 중', () => {
      this.player = new PlayerController(this.terrain, this.solids);
      this.player.spawn(SPAWN.x, SPAWN.z);
      this.ctx.scene.add(this.player.character.object);

      this.camera = new ThirdPersonCamera(this.ctx.camera, this.terrain, this.solids);
      this.camera.reset(this.player.position, Math.PI * 0.15);

      // 발이 닿을 때마다 먼지가 인다 — 접지가 눈에 보여야 걷는 것처럼 읽힌다
      this.player.character.onFootstep((foot, strength) => {
        const p = this.player.position;
        // 세게 디딜수록 화면이 흔들린다 (착지에서만 — 걸음마다 흔들면 멀미가 난다)
      if (strength > 1) this.camera.addShake(Math.min(0.5, (strength - 1) * 0.7));
      const side = foot === 'left' ? -0.14 : 0.14;
        const cos = Math.cos(this.player.facing);
        const sin = Math.sin(this.player.facing);
        this.dust.burst(p.x + side * cos, p.y, p.z - side * sin, strength);
        this.audio.footstep(strength);
      });

      this.playerHud = new PlayerHud(this.container, this.inventory);
      this.playerHud.onDrop((i) => this.dropFromPanel(false, i));
      this.compass = new Compass(this.container);
      this.craftPanel = new CraftPanel(
        this.container,
        this.inventory,
        (r) => this.tryCraft(r),
        () => this.craftContext(),
      );

      this.archivePanel = new ArchivePanel(this.container, this.archive, () =>
        this.storyContext(),
      );
      // 창이 스스로 닫히면 커서도 게임으로 돌려줘야 한다
      this.archivePanel.onClose(() => this.syncPointerForUi());
      // 여기서 도감을 두 번 만든 적이 있다. 두 번째가 첫 번째를 덮어써서
      // 첫 번째는 아무도 닫을 수 없는 채로 화면에 남았다 — 창이 사라지지
      // 않는다는 보고의 정체가 이것이었다.
      this.codexPanel = new CodexPanel(this.container);
      this.codexPanel.onClose(() => this.syncPointerForUi());
      this.storagePanel = new StoragePanel(
        this.container,
        this.inventory,
        (fromBox, i) => this.moveStorage(fromBox, i),
        (fromBox, i) => this.dropFromPanel(fromBox, i),
      );

      this.tools = new ToolWear(this.inventory);
      this.tools.onEvent((ev) => this.playerHud.toast(ev.message, ev.color));

      this.interaction = new InteractionSystem(
        this.resources,
        this.buildings,
        this.inventory,
      );
      this.interaction.onEvent((e) => {
        this.playerHud.toast(e.message, e.color);
        if (e.kind === 'gather') {
          this.tally.gathered += 1;
          this.audio.pickup();
        }
        if (e.kind === 'harvest') {
          this.tally.harvests += 1;
          this.audio.pickup();
        }
        if (e.kind === 'refuel') {
          this.tally.refuels += 1;
          this.audio.place();
        }
        if (e.kind === 'restore') {
          // 없던 흙이 생겼다 — 세계가 실제로 한 칸 나아진 몫이다
          this.env.addRestored();
          this.audio.pickup();
        }
      });
      this.interaction.onOpenStorageBox((node) => {
        const box = this.buildings.boxes.get(node);
        if (box) this.storagePanel.show(box);
      });
      this.interaction.onToolUse(() => this.tools.useSelected());

      this.placement = new Placement(this.terrain, this.buildings, this.inventory);
      this.ctx.canvas.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        if (!this.started || this.paused) return;
        this.tryPlace();
      });

      this.stats.onDeath((cause) => {
        this.setPaused(true);

        // 이번 생이 남긴 것을 먼저 추린다 — 화면에 띄우기 전에 확정해야
        // 재시작이 그 값을 그대로 물려받는다
        const run = {
          unlocked: [...this.unlocked],
          archive: this.archive.serialize(),
          restored: this.env.restored,
          days: this.time.day,
          rank: this.settlement.rank,
          vault: this.vault?.isOpen ?? false,
          masts: this.masts?.serialize() ?? [],
          surveyed: [...this.surveyed],
        };
        this.legacy = recordDeath(this.legacy, run);

        this.overlays.showDeath(cause, this.time.day, () => this.restart(), {
          runs: this.legacy.runs,
          kept: legacyLines({
            unlocked: run.unlocked.length,
            archive: run.archive.length,
            restored: run.restored,
            vault: run.vault,
            masts: run.masts.length,
          }),
        });

        // 한 판이 끝났다 — 기록을 남기고 세이브를 지운다
        void this.api.reportDeath({
          seed: WORLD.seed,
          days: this.time.day,
          cause,
          plots: this.buildings.stats.plots,
          harvests: this.tally.harvests,
          gathered: this.tally.gathered,
        });
      });
      // 시작 아이템은 세이브를 확인한 뒤에 준다 (loadExistingSave)
    });

    await this.stage(0.97, '첫 빛을 맞추는 중', () => {
      // 첫 프레임부터 조명과 그림자가 제자리에 있도록 한 번 밀어 넣는다
      this.sky.update(this.time, this.player.position, 0);
      this.camera.updateTransform(0.016, this.player.position);
      this.ctx.renderer.compile(this.ctx.scene, this.ctx.camera);
    });

    await nextPaint();
    this.overlays.setProgress(1, '준비 완료');
    this.exposeDevApi();
  }

  /**
   * 개발 빌드 전용 콘솔 훅.
   *
   * 배경 탭에서는 requestAnimationFrame이 멈춰 화면 확인이 불가능하므로,
   * 프레임을 수동으로 돌리고 시간대를 바로 바꿀 수 있는 통로를 열어둔다.
   * 프로덕션 번들에서는 이 블록 자체가 제거된다.
   */
  private exposeDevApi(): void {
    if (!import.meta.env.DEV) return;
    Reflect.set(window, '__eden', {
      game: this,
      /** 시각을 0..1로 지정 (0.5 = 정오) */
      setPhase: (p: number): void => {
        this.time.phase = ((p % 1) + 1) % 1;
      },
      /** 프레임을 강제로 n번 진행시킨다 */
      tick: (n = 1, dt = 1 / 60): void => {
        for (let i = 0; i < n; i++) this.advance(dt);
      },
      /** 플레이어를 특정 좌표로 옮긴다 */
      teleport: (x: number, z: number): void => {
        this.player.spawn(x, z);
      },
      /** 후처리(앰비언트 오클루전) 껐다 켜기 — 효과 비교용 */
      setPost: (on: boolean): void => this.ctx.setPostProcessing(on),
      /** 시간 배속 고정 — 작물 성장처럼 오래 걸리는 것을 확인할 때 */
      setTimeScale: (n: number): void => {
        this.baseTimeScale = n;
      },
      /** 설치물 통계 */
      buildings: (): unknown => this.buildings.stats,
      /** 자원 노드 통계 */
      resources: (): unknown => ({
        ...this.resources.stats,
        remaining: this.resources.nodes.filter((n) => n.active).length,
      }),
      /** 아이템 지급 */
      give: (id: ItemId, n = 1): number => this.inventory.add(id, n),
      /** 스탯 강제 설정 — 굶주림·탈수·저체온·포자병 테스트용 */
      setStats: (v: {
        hp?: number;
        hunger?: number;
        thirst?: number;
        warmth?: number;
        spore?: number;
        sickness?: number;
      }): void => {
        if (v.hp !== undefined) this.stats.hp = v.hp;
        if (v.hunger !== undefined) this.stats.hunger = v.hunger;
        if (v.thirst !== undefined) this.stats.thirst = v.thirst;
        if (v.warmth !== undefined) this.stats.warmth = v.warmth;
        if (v.spore !== undefined) this.stats.spore = v.spore;
        if (v.sickness !== undefined) this.stats.sickness = v.sickness;
      },
      /** 지금 몸이 놓인 자리 — 체온·포자가 왜 그렇게 움직이는지 확인용 */
      body: (): unknown => ({
        warmth: Math.round(this.stats.warmth),
        spore: Math.round(this.stats.spore),
        sickness: +this.stats.sickness.toFixed(2),
        speedMult: +this.stats.speedMult.toFixed(2),
        shelter: +this.shelter.toFixed(2),
        fire: +this.fireWarmth.toFixed(2),
        fireDist: Number.isFinite(this.fireDist) ? +this.fireDist.toFixed(1) : null,
      }),
      /** 이야기 — 막의 문이 지금 열려 있는가 */
      story: (): unknown => ({
        read: this.archive.count,
        total: this.archive.total,
        acts: ACTS.map((a) => ({
          act: a.n,
          done: this.archive.actDone(a.n),
          blocked: this.archive.actBlocker(a.n, this.storyContext()),
        })),
        restored: this.env.restored,
        needed: SOIL_FOR_FINAL_ACT,
      }),
      /** 조각을 한 편씩 읽어 본다 — 막의 문에 걸리면 이유를 돌려준다 */
      read: (n = 1): unknown => {
        const out: unknown[] = [];
        for (let i = 0; i < n; i++) {
          const r = this.archive.reveal(this.storyContext());
          out.push(r === null ? '끝' : 'fragment' in r ? r.fragment.title : r.blocked);
          if (r === null || 'blocked' in r) break;
        }
        this.checkStoryComplete();
        this.archivePanel.refresh();
        return out;
      },
      /** 관측 첨탑 — 어디에 있고 올라가 봤는가 */
      masts: (): unknown =>
        this.masts.masts.map((m, i) => ({
          n: i,
          x: m.x,
          z: m.z,
          topY: +m.topY.toFixed(1),
          surveyed: m.surveyed,
          distance: +Math.hypot(
            m.x - this.player.position.x,
            m.z - this.player.position.z,
          ).toFixed(1),
        })),
      /** 첨탑 꼭대기로 올려보낸다 */
      gotoMast: (n = 0): void => {
        const m = this.masts.masts[Math.max(0, Math.min(n, this.masts.masts.length - 1))];
        if (!m) return;
        this.player.spawn(m.x, m.z);
        this.player.position.y = m.topY + 0.9;
        this.camera.reset(this.player.position, Math.PI * 0.15);
      },
      /** 눈에 담아둔 자원 수 */
      surveyed: (): unknown => ({
        count: this.surveyed.size,
        masts: this.masts.serialize(),
      }),
      /**
       * 폐허 구조물 셋 — 자원이 실제로 깔렸는가.
       *
       * 자리를 손으로 고르므로 지형이 험하면 `tooSteep`/`blocked` 가 노드를
       * 전부 걸러낼 수 있다. 그러면 **건물만 서 있고 올 이유가 없는** 상태가
       * 되는데, 화면으로는 절대 안 보인다. `got` 이 `want` 에 한참 못 미치면
       * config 의 좌표를 옮겨야 한다는 뜻이다.
       *
       * 셋을 한 번에 돌려준다 — 하나만 보게 해 두면 나머지가 조용히 어긋난다.
       */
      sites: (): unknown => {
        const spots = [
          { name: 'greenhouse', c: GREENHOUSE, want: {
            soil: GREENHOUSE.soilNodes, grass: GREENHOUSE.grassNodes,
          } as Record<string, number> },
          { name: 'waterTower', c: WATER_TOWER, want: { water: WATER_TOWER.waterNodes } },
          { name: 'hangar', c: HANGAR, want: { scrap: HANGAR.scrapNodes } },
        ];
        const p = this.player.position;
        return spots.map(({ name, c, want }) => {
          const got: Record<string, number> = {};
          for (const node of this.resources.nodes) {
            if (Math.hypot(node.x - c.x, node.z - c.z) > c.hotspotRadius) continue;
            got[node.kind] = (got[node.kind] ?? 0) + 1;
          }
          return {
            name,
            at: [c.x, c.z],
            ground: +this.terrain.sampleHeight(c.x, c.z).toFixed(1),
            // 0.86 미만이면 노드가 깔리지 않는 경사다
            flatness: +this.terrain.sampleNormal(c.x, c.z).y.toFixed(3),
            want,
            got,
            distance: +Math.hypot(c.x - p.x, c.z - p.z).toFixed(1),
          };
        });
      },
      /**
       * 구조물 앞으로 보낸다 — 건물을 마주보게 세운다.
       * @param which 'greenhouse' | 'waterTower' | 'hangar'
       */
      gotoSite: (which = 'greenhouse'): void => {
        const site =
          which === 'waterTower' ? this.waterTower : which === 'hangar' ? this.hangar : this.greenhouse;
        this.player.spawn(site.x, site.z - 6);
        // 카메라 전방은 -(sin yaw, cos yaw) 다. +Z(건물 쪽)를 보려면 yaw = PI
        this.camera.reset(this.player.position, Math.PI);
      },
      /** 종자고 — 어디에 있고 열렸는가 */
      vault: (): unknown => ({
        x: this.vault.x,
        z: this.vault.z,
        open: this.vault.isOpen,
        distance: +this.vault
          .distanceTo(this.player.position.x, this.player.position.z)
          .toFixed(1),
        hasKey: this.inventory.countOf('vaultKey') > 0,
      }),
      /** 종자고 앞으로 순간이동한다 */
      gotoVault: (): void => {
        this.player.spawn(this.vault.x, this.vault.z - 2.4);
        this.camera.reset(this.player.position, Math.PI);
      },
      /** 유산 — 죽음을 넘어 남은 것 */
      legacy: (): unknown => ({ ...this.legacy }),
      /** 유산을 지우고 첫 생으로 되돌린다 */
      clearLegacy: (): void => {
        clearLegacy();
        this.legacy = loadLegacy();
      },
      /** 지금 죽는다 — 계승 화면을 바로 본다 */
      kill: (): void => this.stats.damage(9999, '부상'),
      /** 정착지 — 등급·조건·모여든 사람 */
      town: (): unknown => ({
        ...this.settlement.current,
        settlers: this.settlers.count,
        robotsDetect: this.settlement.rank >= SETTLEMENT.robotFromRank,
      }),
      /** 계절과 환경 악화 곡선 — 두 곡선이 지금 어디에 있는가 */
      world: (): unknown => ({
        day: this.time.day,
        year: this.time.year,
        season: this.time.season.name,
        dayOfSeason: this.time.dayOfSeason,
        density: +this.env.density.toFixed(3),
        trend: +this.env.trendOnly.toFixed(3),
        restored: this.env.restored,
        relief: +this.env.relief.toFixed(3),
      }),
      /** 며칠 뒤로 건너뛴다 — 계절이 바뀌는 순간을 바로 본다 */
      skipDays: (n = 1): unknown => {
        this.time.day += Math.max(0, Math.floor(n));
        this.lastDay = this.time.day;
        this.env.update(this.time);
        this.checkSeasonChange();
        return { day: this.time.day, season: this.time.season.name };
      },
      /** 되살린 흙을 강제로 넣는다 — 상승 곡선 확인용 */
      setRestored: (n: number): void => {
        this.env.reset(Math.max(0, n));
        this.env.update(this.time);
      },
      /** 화톳불마다 남은 연료 (분) — 꺼지는 순간을 확인할 때 */
      fires: (): unknown =>
        this.buildings.campfires.map((f) => ({
          x: +f.x.toFixed(1),
          z: +f.z.toFixed(1),
          fuel: +f.fuel.toFixed(3),
          minutes: +((f.fuel * TIME.secondsPerDay) / 60).toFixed(1),
          lit: f.fuel > 0,
        })),
      /** 모든 화톳불의 연료를 강제로 설정 — 꺼진 밤을 바로 만들어 본다 */
      setFuel: (days: number): void => {
        for (const f of this.buildings.campfires) {
          f.fuel = Math.max(0, days);
          this.buildings.refresh(f);
        }
      },
      /** 가장 가까운 노드로 이동 */
      gotoNode: (kind: 'scrap' | 'soil' | 'water'): unknown => {
        const p = this.player.position;
        let best = null as null | { x: number; z: number; d: number };
        for (const n of this.resources.nodes) {
          if (!n.active || n.kind !== kind) continue;
          const d = Math.hypot(n.x - p.x, n.z - p.z);
          if (!best || d < best.d) best = { x: n.x, z: n.z, d };
        }
        if (best) this.player.spawn(best.x - 1.4, best.z);
        return best;
      },
      /** 정규화 화면 좌표(-1..1)로 무엇이 찍히는지 확인한다 */
      pick: (nx: number, ny: number): unknown => {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(nx, ny), this.ctx.camera);
        return rc
          .intersectObjects(this.ctx.scene.children, true)
          .slice(0, 3)
          .map((h) => ({
            name: h.object.name || h.object.type,
            distance: +h.distance.toFixed(1),
            instanceId: h.instanceId,
            point: h.point.toArray().map((v) => +v.toFixed(1)),
          }));
      },
    });
  }

  // ---------------------------------------------------------------- 루프

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(rawDt, MAX_FRAME_DT);
    if (dt <= 0) return;

    this.fps = damp(this.fps, 1 / Math.max(rawDt, 1e-4), 3.5, dt);
    this.advance(dt);
  };

  /** 한 프레임 진행 — rAF와 개발용 수동 구동이 공유한다 */
  private advance(dt: number): void {
    // 창을 여닫는 키는 시뮬레이션이 멈춰 있어도 받는다
    this.handleUiInput();

    // 창이 열려 있는 동안에는 세상도 멈춘다.
    // 메뉴를 읽는 동안 물려 죽는 것은 긴장이 아니라 그냥 억울한 일이다.
    const modal = this.modalOpen;
    const active = this.started && !this.paused && !modal;

    // 창이 떠 있으면 마우스는 커서지 시점이 아니다
    if (!modal) this.camera.updateAngles(this.input);

    // 히트스톱 — 시뮬레이션만 멈추고 렌더와 카메라는 계속 돈다
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
    }
    const frozen = this.hitStop > 0;

    if (active && !frozen) {
      this.simulate(dt);
      this.updateGameplay(dt);
      // 디버그: T를 누르고 있는 동안 시간이 빠르게 흐른다
      this.time.scale = this.input.isKeyDown('KeyT') ? 90 : this.baseTimeScale;
      this.time.update(dt);

      // 하루가 넘어가면 밤새 내린 비로 웅덩이가 다시 찬다
      if (this.time.day !== this.lastDay) {
        this.lastDay = this.time.day;
        this.resources.refillWater();
        this.buildings.onNewDay();
        this.playerHud.toast(`${this.time.day}일째 아침`, '#b9c46a');
        this.checkSeasonChange();
        void this.save(); // 하루의 경계는 저장하기 좋은 지점이다
      }

      // 주기적 자동 저장
      this.saveTimer += dt;
      if (this.saveTimer >= AUTOSAVE_SECONDS) {
        this.saveTimer = 0;
        void this.save();
      }
    }

    if (modal) {
      // 시뮬레이션은 멈췄지만 게이지와 피격 잔상은 계속 그린다
      this.playerHud.update(dt, this.stats);
      this.playerHud.setPrompt(null, 0);
      this.playerHud.setPlaceHint(null, true, 0);
      this.buildings.hideGhost();
    }

    this.player.updateVisual(dt, this.camera.normalizedPitch);
    this.camera.setRunAmount(
      (this.player.horizontalSpeed - PLAYER.walkSpeed) / (PLAYER.sprintSpeed - PLAYER.walkSpeed),
    );
    this.dust.update(dt);
    this.skyline.follow(this.player.position.x, this.player.position.z);
    this.updateAmbience();
    this.camera.updateTransform(dt, this.player.position);
    this.updateCompass();
    this.sky.update(this.time, this.player.position, dt, this.ctx.scene);
    // 반드시 sky.update 다음이다 — Sky 가 안개와 조명을 매 프레임 새로 계산하므로
    // 먼저 덧씌우면 그대로 지워진다
    this.updateShelter(dt);
    this.updateWeather(dt);

    this.ctx.renderer.setClearColor(this.sky.fog.color, 1);
    this.ctx.render();

    this.updateHud(dt);
    this.input.endFrame();
  }

  /** 가방·제작창·보관함 중 하나라도 열려 있는가 */
  private get modalOpen(): boolean {
    return (
      this.playerHud?.isBagOpen === true ||
      this.craftPanel?.isOpen === true ||
      this.storagePanel?.isOpen === true ||
      this.archivePanel?.isOpen === true ||
      this.codexPanel?.isOpen === true
    );
  }

  /**
   * 창을 여닫는 키.
   *
   * 시뮬레이션이 멈춰 있어도 받아야 한다 — 그렇지 않으면 창을 열자마자
   * 닫을 방법이 사라진다.
   */
  private handleUiInput(): void {
    if (!this.started) return;

    if (this.input.wasPressed('inventory')) {
      if (this.storagePanel.isOpen) {
        this.storagePanel.close();
      } else {
        this.craftPanel.close();
        this.audio.ui(!this.playerHud.isBagOpen);
        this.playerHud.toggleBag();
      }
    }

    if (this.input.wasPressed('journal')) {
      this.playerHud.closeBag();
      this.craftPanel.close();
      this.storagePanel.close();
      this.audio.ui(!this.archivePanel.isOpen);
      this.archivePanel.toggle();
    }

    if (this.input.wasPressed('craft')) {
      if (this.storagePanel.isOpen) {
        this.storagePanel.close();
      } else {
        this.playerHud.closeBag();
        this.craftPanel.toggle();
      }
    }

    // 보관함은 열 때와 같은 키로 닫는다
    if (this.storagePanel.isOpen && this.input.wasPressed('interact')) {
      this.storagePanel.close();
    }

    // 도감도 마찬가지 — 편 키로 덮는다.
    // 창이 열린 동안에는 시뮬레이션이 멈추므로 여기서 받아야 한다.
    if (this.codexPanel.isOpen && this.input.wasPressed('use')) {
      this.codexPanel.close();
    }

    this.syncPointerForUi();
  }

  /**
   * 창이 열려 있는 동안에는 커서를 돌려준다.
   *
   * 포인터 락이 걸린 채로는 버튼을 누를 수 없고, 마우스를 움직이면
   * 시점만 돌아간다 — 제작창을 띄워놓고 아무것도 고를 수 없게 된다.
   */
  private syncPointerForUi(): void {
    const open = this.modalOpen;
    if (open === this.uiHoldingCursor) return;
    this.uiHoldingCursor = open;

    if (open) {
      if (this.input.locked) document.exitPointerLock();
    } else if (!this.paused && !this.stats.dead) {
      this.input.requestLock();
    }
  }

  /** 상호작용 · 인벤토리 조작 · 농사 진행 · 생존 스탯 — 프레임당 한 번이면 충분하다 */
  private updateGameplay(dt: number): void {
    const hotbar = this.input.hotbarPressed();
    if (hotbar >= 0) this.inventory.selectHotbar(hotbar);

    if (this.input.wasPressed('use')) this.consumeSelected();
    if (this.input.wasPressed('rotate')) this.placement.cycleRotation();
    if (this.input.wasPressed('drop')) this.dropSelected();
    if (this.input.wasPressed('mute')) {
      const muted = this.audio.toggleMute();
      this.playerHud.toast(muted ? '소리 끔' : '소리 켬', '#8fa4b8');
    }

    // ---- 상호작용 (E)
    const yaw = this.camera.yaw;
    this.interaction.update(
      dt,
      this.input.isDown('interact'),
      this.player.position.x,
      this.player.position.z,
      -Math.sin(yaw),
      -Math.cos(yaw),
    );

    // ---- 설치 조준 (좌클릭) — 작업 중에는 조준을 고정한다
    if (!this.tillTask) this.placement.update(this.ctx.camera, this.player.position);
    this.updateTilling(dt);
    this.updateDemolish(dt, yaw);
    this.updateCooking(dt);
    this.updateVault(dt);
    this.updateSurvey();

    // ---- 환경 악화 곡선 — 오늘 세계가 얼마나 나빠져 있는가
    this.env.update(this.time);
    const season = this.time.season;

    // ---- 도구 부식 — 가만히 둬도 잔류 포자가 금속을 갉는다.
    // 농도가 오르면 부식도 함께 빨라진다 (기획서 3.7 "금속 부식 가속")
    const days = (dt * this.time.scale) / TIME.secondsPerDay;
    this.tools.corrode(days * this.env.density);

    // ---- 작물 성장 · 불꽃
    // 먼지폭풍이 부는 날은 두 배 넘게 빨리 마르고, 계절이 그 바탕을 정한다
    this.buildings.update(
      days,
      dt,
      season.dry * (1 + this.weather.dust * 1.4),
      // 종자고를 연 뒤로는 개량종이 자란다 — 되찾은 씨앗의 값이
      // 밭에서 매일 조금씩 돌아온다
      season.growth * (this.vault.isOpen ? VAULT.growthMult : 1),
    );
    // 비가 오면 밭이 저절로 젖는다 — 물통을 들고 뛰지 않아도 되는 날
    if (this.weather.rain > 0.2) this.buildings.soak(days * this.weather.rain * 2.2);

    // ---- 정착지 — 지은 것이 바뀌었을 때만 다시 잰다
    const rose = this.settlement.update(this.buildings);
    if (rose > 0) this.announceRank(rose);
    if (rose >= 0 || this.settlers.count !== SETTLEMENT.ranks[this.settlement.rank]!.settlers) {
      const t = this.settlement.current;
      this.settlers.setTarget(SETTLEMENT.ranks[t.rank]!.settlers, t.cx, t.cz);
    }

    // ---- 생존자 — 등급이 부른 사람들이 밀린 집안일을 한다.
    // 그리고 먹는다. 사람이 늘면 입도 늘어야 공짜 노동력이 되지 않는다.
    const town = this.settlement.current;
    const eaten = this.settlers.update(dt, days, town.cx, town.cz);
    if (eaten > 0) this.feedSettlers(eaten);
    for (let n = this.settlers.takeNotice(); n; n = this.settlers.takeNotice()) {
      this.playerHud.toast(n, '#c2a878');
    }

    // ---- 밤의 생물과 낮의 로봇
    const p = this.player.position;
    this.creatures.update(
      dt,
      p.x,
      p.y,
      p.z,
      this.time.daylight,
      this.stats.dead,
      this.time.day,
      town.rank,
      // 흐린 날에는 태양광이 가려 로봇이 느려진다 (기획서 3.6)
      Math.max(this.weather.rain * 0.7, this.weather.dust),
    );

    const bite = this.creatures.takeDamage();
    if (bite > 0) {
      this.stats.damage(bite, '부상');
      this.playerHud.flashHurt();
      this.camera.addShake(0.55);
      this.audio.hurt();
      this.hitStop = 0.06;
    }

    this.swingCooldown = Math.max(0, this.swingCooldown - dt);

    // ---- 몸이 놓인 자리 — 불이 얼마나 가까운가
    // 불빛(생물을 막는 반경)보다 온기가 닿는 반경이 좁다. 쬐려면 다가가야 한다.
    this.fireDist = this.buildings.fireDistance(p.x, p.z);
    this.fireWarmth = clamp(1 - this.fireDist / AILMENT.fireWarmthRadius, 0, 1);

    // ---- 생존
    const sprinting = this.player.horizontalSpeed > PLAYER_SPRINT_THRESHOLD;
    const laboring = this.interaction.laboring || this.tillTask !== null;
    this.stats.update(
      dt,
      sprinting,
      laboring,
      {
        daylight: this.time.daylight,
        shelter: this.shelter,
        fire: this.fireWarmth,
        rain: this.weather.rain,
        dust: this.weather.dust,
        // 계절과 환경 악화 곡선이 여기로 들어온다 (기획서 3.7)
        sporeDensity: this.env.density,
        chill: this.time.season.chill,
      },
      this.time.scale,
    );

    // 병세가 걸음을 늦춘다 — 나선형 악화의 첫 고리
    this.player.speedScale = this.stats.speedMult;

    // 몸이 보낸 신호를 화면에 옮긴다 (떨림 · 발병 · 회복)
    for (let n = this.stats.takeNotice(); n; n = this.stats.takeNotice()) {
      this.playerHud.toast(n.text, n.color);
      this.audio.hurt();
    }

    // ---- 캐릭터 작업 자세
    if (this.tillTask) {
      this.player.character.setAction(this.tillTask.kind === 'plot' ? 'swing' : 'tend');
    } else if (this.swingCooldown > COMBAT.swingCooldown * 0.45) {
      this.player.character.setAction('swing');
    } else {
      this.player.character.setAction(this.interaction.actionKind);
    }

    // ---- HUD
    this.updateGuide();
    this.playerHud.update(dt, this.stats);
    this.playerHud.setPrompt(this.interaction.promptLabel, this.interaction.progress);

    // 불 위의 것이 가장 먼저다 — 지켜보라고 만든 시간이라 화면에도 그렇게 보여야 한다
    if (this.cooking) {
      const left = Math.ceil(this.cooking.total - this.cooking.t);
      this.playerHud.setPlaceHint(
        `${itemDef(this.cooking.recipe.output).name} — ${left}초`,
        true,
        this.cooking.t / this.cooking.total,
      );
      return;
    }

    if (this.tillTask) {
      this.playerHud.setPlaceHint(
        this.tillTask.kind === 'plot' ? '땅을 일구는 중' : '세우는 중',
        true,
        this.tillTask.t / this.tillTask.total,
      );
      return;
    }

    const kind = this.placement.heldKind;
    if (kind === null) {
      // 종자고가 먼저다 — 이야기의 문 앞에서는 다른 안내가 끼어들 자리가 없다
      this.playerHud.setPlaceHint(this.vaultHint ?? this.wreckHint, true, 0);
    } else if (this.placement.valid) {
      // 놓을 수 있을 때도 비옥도를 계속 보여준다.
      // 걸어다니며 숫자가 오르내리는 것을 보면 좋은 땅을 찾는 것이 플레이가 된다.
      const fert = Math.round(this.placement.averageFertility * 100);
      const name = BUILD_LABEL[kind] ?? '설치물';
      // 예전에는 밭이 아니면 전부 "집수기를 세운다"고 떴다. 여덟 가지를
      // 한 문장으로 덮어놓고 플레이어가 알아서 알기를 바란 셈이다.
      const head =
        kind === 'plot'
          ? `좌클릭 — 밭을 일군다 · 비옥도 ${fert}%`
          : `좌클릭 — ${withJosa(name, '을를')} 세운다`;
      // 방향과 철거는 눌러보기 전에는 있는 줄도 모른다. 손에 든 것이
      // 방향을 가질 때만 그 자리에서 알려주면 안내문이 늘 떠 있지 않아도 된다.
      const tail = this.placement.orient !== null ? ` · R — ${this.placement.orientLabel}` : '';
      this.playerHud.setPlaceHint(`${head}${tail}`, true, 0);
    } else {
      this.playerHud.setPlaceHint(this.placement.reason ?? '여기엔 놓을 수 없다', false, 0);
    }
  }

  /**
   * 설치를 시작한다.
   *
   * 즉시 놓지 않고 작업 시간을 둔다 — 곡괭이질 없이 밭이 튀어나오면
   * 땅을 일궜다는 느낌이 전혀 나지 않기 때문이다.
   */
  /**
   * 좌클릭.
   *
   * 설치할 것을 들고 있으면 설치하고, 아니면 휘두른다.
   * 버튼 하나로 두 가지를 겸하는 이유는 손에 든 것이 곧 의도이기 때문이다 —
   * 벽을 들고 적을 때리려는 사람은 없다.
   */
  private tryPlace(): void {
    if (this.modalOpen) return;
    if (this.tillTask) return;

    const kind = this.placement.heldKind;
    if (!kind) {
      this.swing();
      return;
    }

    if (!this.placement.valid) {
      this.playerHud.toast(this.placement.reason ?? '여기엔 놓을 수 없다', '#d98a4a');
      return;
    }

    // 구획이 클수록 오래 걸린다 — 여섯 칸을 한 번에 여는 데 한 칸과 같은 시간이 들면 가볍다
    const held = this.inventory.selectedSlot;
    if (!held) return;

    const cells = this.placement.cost;
    this.tillTask = {
      kind,
      item: held.id,
      x: this.placement.aim.x,
      z: this.placement.aim.z,
      t: 0,
      total: (TILL_TIME[kind] ?? 1) * (kind === 'plot' ? 0.55 + cells * 0.28 : 1),
    };
  }

  /** 근접 공격 — 곡괭이를 들고 있으면 훨씬 아프다 */
  private swing(): void {
    if (this.swingCooldown > 0 || this.stats.dead) return;
    this.swingCooldown = COMBAT.swingCooldown;

    const slot = this.inventory.selectedSlot;
    const armed = slot ? itemDef(slot.id).tool === 'pickaxe' : false;
    const damage = armed ? COMBAT.pickaxeDamage : COMBAT.fistDamage;

    const yaw = this.camera.yaw;
    const hits = this.creatures.strike(
      this.player.position.x,
      this.player.position.z,
      -Math.sin(yaw),
      -Math.cos(yaw),
      damage,
    );
    if (hits > 0) {
      this.playerHud.toast(armed ? '곡괭이가 박혔다' : '주먹이 닿았다', '#c4564e');
      this.camera.addShake(armed ? 0.35 : 0.2);
      this.audio.hit(armed);
      // 무기가 무거울수록 오래 멈춘다
      this.hitStop = armed ? 0.07 : 0.045;
    }
  }

  /**
   * 바람과 불 소리를 지금 상황에 맞춘다.
   *
   * 트인 곳일수록 바람이 세다. 주변 네 방향의 지면보다 높이 서 있으면
   * 능선 위라는 뜻이고, 움푹한 곳에 있으면 바람이 잦아든다.
   */
  private updateAmbience(): void {
    const p = this.player.position;
    let around = 0;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      around += this.terrain.sampleHeight(p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9);
    }
    const exposure = clamp((p.y - around / 4) / 6 + 0.45, 0, 1);

    // 불까지의 거리는 생존 갱신에서 이미 쟀다 — 매 프레임 두 번 돌 이유가 없다
    this.audio.ambience(exposure, this.fireDist);
  }

  /**
   * 날씨를 굴리고 그 결과를 하늘·소리에 반영한다.
   *
   * 안개와 조명은 Sky 가 매 프레임 시간대에 맞춰 다시 계산한다.
   * 그래서 그 뒤에 덧씌워야 한다 — 순서가 뒤집히면 다음 프레임에 지워진다.
   */
  /**
   * 머리 위에 지붕이 있는지 위로 광선을 한 번 쏜다.
   *
   * 프레임당 광선 하나면 충분하다. 문틀 아래를 지날 때 값이 깜빡이지 않도록
   * 결과를 그대로 쓰지 않고 부드럽게 따라가게 한다.
   */
  private updateShelter(dt: number): void {
    const p = this.player.position;
    SHELTER_ORIGIN.set(p.x, p.y + 1.7, p.z);
    const hit = this.solids.raycast(SHELTER_ORIGIN, SHELTER_UP, SHELTER_REACH);
    const under = hit >= 0 && hit < SHELTER_REACH ? 1 : 0;
    this.shelter = damp(this.shelter, under, 5, dt);
  }

  private updateWeather(dt: number): void {
    const changed = this.weather.update(
      dt,
      this.player.position,
      this.shelter,
      this.time.season.rainBias,
    );
    if (changed && changed !== 'clear') {
      this.playerHud.toast(changed === 'rain' ? '비가 내린다' : '먼지폭풍이 몰려온다', '#8fa4b8');
    }

    // 계절이 하늘빛에 옅게 배어난다.
    //
    // Sky 가 매 프레임 안개를 다시 계산하므로 반드시 그 뒤에 얹는다 (8.3 규칙).
    // 세게 물들이면 시간대 표현을 덮어써 낮과 밤의 구분이 흐려지므로 아주 옅게만.
    // 포자철의 탁한 보랏빛과 혹한기의 시린 푸른빛이 눈에 걸릴 정도면 충분하다.
    SEASON_TINT.set(this.time.season.color);
    this.sky.fog.color.lerp(SEASON_TINT, 0.09);

    const rain = this.weather.rain;
    const dust = this.weather.dust;
    // 지붕 아래에서는 안개도 바람도 훨씬 덜하다
    const indoor = 1 - this.shelter * 0.75;
    this.audio.setWeather(rain * indoor, dust * indoor);

    const murk = Math.max(rain * 0.55, dust) * indoor;
    if (murk <= 0.01) return;

    // 앞이 흐려진다. 먼지폭풍이 비보다 훨씬 심하다.
    this.sky.fog.near *= 1 - murk * 0.6;
    this.sky.fog.far *= 1 - murk * 0.62;
    if (dust > 0) this.sky.fog.color.lerp(DUST_FOG, dust * 0.7);
    else this.sky.fog.color.lerp(RAIN_FOG, rain * 0.4);

    // 해가 가린다
    this.sky.keyLight.intensity *= 1 - murk * 0.55;
    this.sky.hemiLight.intensity *= 1 - murk * 0.3;
  }

  /**
   * 길잡이를 굴린다.
   *
   * 매 프레임 "지금 목표" 하나만 검사한다. 전부 검사하면 목록이 길어질수록
   * 비용이 늘고, 어차피 순서대로 하나씩만 보여주므로 볼 이유도 없다.
   */
  private updateGuide(): void {
    const base = this.buildings.guideStats;
    const ctx: ObjectiveContext = {
      count: (id) => this.inventory.countOf(id),
      base,
      fragments: this.archive.count,
      soilLeftForStory: Math.max(0, SOIL_FOR_FINAL_ACT - this.env.restored),
      vaultOpen: this.vault.isOpen,
      masts: this.masts.serialize().length,
      harvests: this.tally.harvests,
      gathered: this.tally.gathered,
      refuels: this.tally.refuels,
      rank: this.settlement.rank,
      settlers: this.settlers.count,
      day: this.time.day,
      unlocked: this.unlocked.size,
    };

    const cleared = this.guide.update(ctx);
    if (cleared.length > 0) {
      const last = cleared[cleared.length - 1]!;
      this.playerHud.toast(`기억났다 — ${last.title}`, '#b9c46a');
      this.playerHud.flashObjective();
      this.audio.craft();
    }

    const cur = this.guide.current;
    const p = this.guide.progress;
    this.playerHud.setObjective(cur?.title ?? null, cur?.hint ?? '', p.done, p.total);
  }

  /**
   * 첨탑 꼭대기에 올라섰다.
   *
   * 누르는 것이 없다. 올라온 것 자체가 이미 값을 치른 것이므로 여기서 또
   * 키를 누르게 하면 노동이 두 번이 된다. 발이 발판에 닿는 순간 훑는다.
   */
  private updateSurvey(): void {
    if (this.stats.dead) return;
    const p = this.player.position;
    const i = this.masts.standingOn(p.x, p.y, p.z);
    if (i < 0) return;

    const mast = this.masts.masts[i]!;
    if (mast.surveyed) return;
    mast.surveyed = true;

    // 흙과 기록 단말만 담는다. 잔해까지 넣으면 340개가 나침반을 덮어
    // 정작 돌아갈 거점이 묻힌다 — 표지는 많을수록 쓸모가 준다.
    let found = 0;
    const nodes = this.resources.nodes;
    for (let n = 0; n < nodes.length; n++) {
      const node = nodes[n]!;
      if (node.kind !== 'soil' && node.kind !== 'archive') continue;
      if (Math.hypot(node.x - mast.x, node.z - mast.z) > MAST.surveyRadius) continue;
      if (this.surveyed.has(n)) continue;
      this.surveyed.add(n);
      found++;
    }

    this.audio.craft();
    this.camera.addShake(0.18);
    this.playerHud.toast(
      found > 0
        ? `이 일대를 눈에 담았다 — 흙과 단말 ${found}곳`
        : '이 일대에는 남은 것이 없다',
      found > 0 ? '#b9c46a' : '#8e948a',
    );
  }

  /**
   * 종자고 문 앞.
   *
   * 열쇠를 손에 들고 `E` 를 누르고 있어야 열린다. 한 번 눌러 열리게 하지 않은
   * 이유는 철거와 같다 — 이야기의 마지막 문이 지나가다 눌린 키 하나로
   * 열려서는 안 된다. 3초쯤 문 앞에 서 있는 시간이 그 자체로 장면이 된다.
   *
   * 열쇠가 없을 때도 말은 걸어준다. **열리지 않는다는 사실**이 이 문의
   * 첫 번째 역할이다 — 첫날에 여기 서 본 사람은 질문을 하나 안고 돌아간다.
   */
  private updateVault(dt: number): void {
    this.vault.update(dt);

    if (this.modalOpen || this.stats.dead || this.vault.isOpen) {
      this.vaultHold = 0;
      return;
    }

    const near =
      this.vault.distanceTo(this.player.position.x, this.player.position.z) <= VAULT.reach;
    if (!near) {
      this.vaultHold = 0;
      this.vaultHint = null;
      return;
    }

    if (this.inventory.countOf('vaultKey') <= 0) {
      this.vaultHold = 0;
      this.vaultHint = '봉인되어 있다 — 인증 키가 필요하다';
      return;
    }

    if (!this.input.isDown('interact')) {
      this.vaultHold = 0;
      this.vaultHint = 'E (길게) — 종자고를 연다';
      return;
    }

    this.vaultHold += dt;
    this.vaultHint = null;
    this.playerHud.setPlaceHint('종자고를 여는 중', true, this.vaultHold / VAULT.openTime);
    if (this.vaultHold < VAULT.openTime) return;

    this.vaultHold = 0;
    this.openVault();
  }

  /**
   * 문이 열렸다.
   *
   * 안에 든 것은 **흙이 있어야 뜻이 있는 것**이다. 씨앗 한 무더기와,
   * 그 뒤로 계속되는 개량종의 이점 — 밭이 없는 사람에게는 아무것도 아니고
   * 밭을 넓혀 온 사람에게는 지금까지의 노동이 한 번 더 값을 하는 지점이다.
   */
  private openVault(): void {
    this.vault.open();
    this.audio.craft();
    this.applyVaultBonus();

    const dropped = this.inventory.add('seed', VAULT.seeds);
    this.playerHud.setPlaceHint(null, true, 0);
    this.overlays.showVault(() => {
      this.setPaused(false);
      this.input.requestLock();
      if (dropped > 0) {
        this.playerHud.toast(`가방이 좁아 씨앗 ${dropped}개를 두고 왔다`, '#d98a4a');
      }
    });
    this.setPaused(true);
  }

  /** 종자고를 연 뒤로 영구히 — 작물이 빨리 자라고 한 줌 더 나온다 */
  private applyVaultBonus(): void {
    this.interaction.harvestBonus = VAULT.harvestBonus;
  }

  /** 진행 중인 설치 작업을 굴린다 */
  private updateTilling(dt: number): void {
    const task = this.tillTask;
    if (!task) return;

    // 손에 든 것이 바뀌거나 너무 멀어지면 그만둔다
    const slot = this.inventory.selectedSlot;
    const away = Math.hypot(
      this.player.position.x - task.x,
      this.player.position.z - task.z,
    );
    if (
      !slot ||
      slot.id !== task.item ||
      itemDef(slot.id).places !== task.kind ||
      away > FARM.placeReach + 1.5
    ) {
      this.tillTask = null;
      return;
    }

    task.t += dt;
    if (task.t < task.total) return;

    this.tillTask = null;
    // 조준은 작업 중 고정되어 있었으므로 마지막으로 한 번 다시 평가한다
    this.placement.update(this.ctx.camera, this.player.position);
    const result = this.placement.place();
    if (result) {
      this.playerHud.toast(result.message, result.ok ? '#b9c46a' : '#d98a4a');
      if (result.ok) this.audio.place();
    }
  }

  /**
   * 철거 (`X` 를 누르고 있는다).
   *
   * 잘못 놓은 것을 영영 되돌릴 수 없으면, 플레이어는 아예 짓지 않게 된다.
   * 되돌릴 수 있다는 것을 알아야 마음 놓고 실험한다.
   *
   * 한 번 누르는 것이 아니라 **누르고 있어야** 뜯긴다. 애써 키운 밭 앞에서
   * 키 하나가 잘못 눌려 사라지는 일은 없어야 하기 때문이다.
   */
  private updateDemolish(dt: number, yaw: number): void {
    this.wreckHint = null;
    if (this.modalOpen || this.tillTask || this.stats.dead) {
      this.wreck = null;
      return;
    }

    const p = this.player.position;
    const target = this.buildings.findTarget(
      p.x,
      p.z,
      -Math.sin(yaw),
      -Math.cos(yaw),
      FARM.placeReach,
      DEMOLISH_CONE_COS,
    );

    if (!this.input.isDown('demolish') || !target) {
      if (this.wreck) this.playerHud.setPlaceHint(null, true, 0);
      this.wreck = null;
      // 아직 누르지 않았어도, 뜯을 수 있는 것 앞이면 그렇다고 말해준다
      if (target) {
        this.wreckHint = `X (길게) — ${withJosa(BUILD_LABEL[target.kind] ?? '설치물', '을를')} 철거`;
      }
      return;
    }

    // 대상이 바뀌면 처음부터 다시 — 지나가다 옆엣것이 뜯기면 안 된다
    if (!this.wreck || this.wreck.node !== target) {
      this.wreck = { node: target, t: 0 };
    }

    this.wreck.t += dt;
    const name = BUILD_LABEL[target.kind] ?? '설치물';
    this.playerHud.setPlaceHint(
      `${name} 철거 중`,
      true,
      this.wreck.t / BUILD.demolishTime,
    );

    if (this.wreck.t < BUILD.demolishTime) return;

    const refund = this.buildings.demolish(target);
    this.wreck = null;
    this.playerHud.setPlaceHint(null, true, 0);
    this.audio.place();

    if (!refund) {
      this.playerHud.toast(`${name}을 걷어냈다`, '#8e948a');
      return;
    }
    const dropped = this.inventory.add(refund.id, refund.count);
    const def = itemDef(refund.id);
    this.playerHud.toast(
      dropped > 0
        ? `${name}을 걷어냈다 — 가방이 가득 차 ${def.name}을 잃었다`
        : `${name}을 걷어냈다 · +${refund.count} ${def.name}`,
      dropped > 0 ? '#d98a4a' : '#b9c46a',
    );
  }

  /**
   * 계절이 바뀌는 순간.
   *
   * 이름만 바뀌고 끝나면 달력이지 계절이 아니다. 그래서 바뀔 때마다
   * 무엇이 달라지는지 한 줄로 알리고, 해빙기에는 **풀덤불이 실제로 다시 돋는다** —
   * 이 세계에서 저절로 돌아오는 것은 빗물과 이 풀뿐이다.
   */
  private checkSeasonChange(): void {
    const changed = this.env.takeSeasonChange(this.time);
    if (changed < 0) return;

    const season = this.time.season;
    this.playerHud.toast(`${season.name} — ${season.note}`, season.color);
    this.audio.craft();

    if (season.regrow > 0) {
      const revived = this.resources.regrow('grass', season.regrow);
      if (revived > 0) {
        this.playerHud.toast(`마른 풀이 ${revived}곳에서 다시 돋았다`, '#8fae5a');
      }
    }
  }

  /**
   * 정착지 등급이 올랐다.
   *
   * 보상과 대가를 **같이** 알린다. 사람이 모이는 것과 로봇의 눈에 띄는 것이
   * 같은 한 줄에서 와야, 키우는 일이 그냥 좋은 것이 아니라 선택이 된다.
   */
  private announceRank(rank: number): void {
    const spec = SETTLEMENT.ranks[rank]!;
    this.playerHud.toast(`정착지가 «${spec.name}» 이 되었다`, '#b9c46a');
    this.audio.craft();

    if (spec.settlers > 0) {
      this.playerHud.toast(`사람이 모여든다 — 생존자 ${spec.settlers}명`, '#c2a878');
    }
    if (rank === SETTLEMENT.robotFromRank) {
      // 이 순간이 낮의 성격을 바꾼다. 경고 없이 당하면 억울하다.
      this.playerHud.toast('무언가가 이쪽을 탐지했다 — 낮을 조심해라', '#d85a3c');
    }
  }

  /**
   * 생존자들이 먹은 만큼 창고에서 덜어낸다.
   *
   * 가방이 아니라 **보관함부터** 본다. 손에 든 것을 말없이 가져가면
   * 도둑맞은 기분이 들고, 그건 사람이 늘어난 보람과 정반대다.
   * 창고가 비면 그때는 굶는다 — 굶주린 생존자는 떠난다.
   */
  private feedSettlers(amount: number): void {
    this.settlerHunger += amount;
    if (this.settlerHunger < 1) return;

    const need = Math.floor(this.settlerHunger);
    const took = this.buildings.consumeFromStorage(['grainStew', 'roastedCrop', 'crop'], need);
    this.settlerHunger -= took;

    if (took < need) {
      // 창고가 비었다. 남은 몫은 잊는다 — 빚처럼 쌓이면 창고를 채우는 순간 통째로 사라진다.
      this.settlerHunger = 0;
      this.starvedTicks += 1;
      if (this.starvedTicks % 3 === 1) {
        this.playerHud.toast('생존자들이 굶고 있다 — 보관함에 먹을 것을 채워라', '#d98a4a');
      }
    } else {
      this.starvedTicks = 0;
    }
  }

  private craftContext(): CraftContext {
    return {
      nearWorkbench: this.buildings.nearWorkbench(
        this.player.position.x,
        this.player.position.z,
        BUILD.workbenchRadius,
      ),
      // 물을 끓이려면 실제로 불 앞에 앉아야 한다
      nearCampfire:
        this.buildings.fireDistance(this.player.position.x, this.player.position.z) <=
        BUILD.workbenchRadius,
      unlocked: this.unlocked,
    };
  }

  private tryCraft(recipe: Recipe): void {
    // ---- 불에 올리는 것 — 재료만 먼저 받고 시간을 센다
    if (recipe.cookTime) {
      if (this.cooking) {
        this.playerHud.toast('이미 불에 올려둔 것이 있다', '#d98a4a');
        return;
      }
      const taken = takeInputs(recipe, this.inventory, this.craftContext());
      if (taken) {
        this.playerHud.toast(taken, '#d98a4a');
        return;
      }
      this.cooking = { recipe, t: 0, total: recipe.cookTime };
      // 창을 덮어준다 — 지켜보라고 만든 시간인데 목록을 보고 있으면 의미가 없다
      this.craftPanel.close();
      this.syncPointerForUi();
      this.playerHud.toast(`${withJosa(itemDef(recipe.output).name, '을를')} 불에 올렸다`, '#d9a05a');
      return;
    }

    const err = craft(recipe, this.inventory, this.craftContext());
    if (err) {
      this.playerHud.toast(err, '#d98a4a');
      return;
    }
    this.playerHud.toast(`${withJosa(itemDef(recipe.output).name, '을를')} 만들었다`, '#b9c46a');
  }

  /**
   * 불 위의 것을 굴린다.
   *
   * 자리를 뜨거나 불이 꺼지면 그만둔다 — 재료는 그대로 돌려준다.
   * 손해가 나면 아무도 불 앞에 앉지 않는다.
   */
  private updateCooking(dt: number): void {
    const job = this.cooking;
    if (!job) return;

    if (this.stats.dead) {
      this.cooking = null;
      return;
    }

    const near =
      this.buildings.fireDistance(this.player.position.x, this.player.position.z) <=
      BUILD.workbenchRadius + COOK.leaveSlack;
    if (!near) {
      this.cooking = null;
      returnInputs(job.recipe, this.inventory);
      this.playerHud.toast('불에서 멀어져 그만두었다 — 재료는 돌려받았다', '#d98a4a');
      return;
    }

    job.t += dt;
    if (job.t < job.total) return;

    this.cooking = null;
    giveOutput(job.recipe, this.inventory);
    this.audio.craft();
    this.playerHud.toast(
      `${withJosa(itemDef(job.recipe.output).name, '이가')} 다 되었다`,
      '#b9c46a',
    );
  }

  /** 선택한 칸의 아이템을 먹거나, 마시거나, 읽는다 */
  private consumeSelected(): void {
    const slot = this.inventory.selectedSlot;
    if (!slot) return;

    // 식물 도감 — 펼쳐 읽는다. 없어지지 않으므로 몇 번이고 다시 본다.
    if (slot.id === 'codex') {
      this.audio.ui(true);
      this.codexPanel.show();
      this.syncPointerForUi();
      return;
    }

    // 조감도 데이터 — 읽으면 만들 줄 몰랐던 것 하나가 열린다
    if (slot.id === 'blueprint') {
      // 단말에는 설계만 있는 게 아니다. 남은 기록도 함께 딸려 나온다 —
      // 설계를 다 배운 뒤에도 단말을 찾아다닐 이유가 여기서 생긴다.
      const recipe = nextLockedRecipe(this.unlocked);
      const read = this.archive.reveal(this.storyContext());
      const fragment = read && 'fragment' in read ? read.fragment : null;
      const blocked = read && 'blocked' in read ? read.blocked : null;

      if (!recipe && !read) {
        this.playerHud.toast('더 읽어낼 것이 없다', '#8e948a');
        return;
      }
      // 설계도 없고 다음 막도 잠겨 있으면 단말을 태우지 않는다.
      // 아무것도 못 얻고 자료만 사라지면 그건 그냥 손해다.
      if (!recipe && blocked) {
        this.playerHud.toast(`이 단말은 더 읽히지 않는다 — ${blocked}`, '#8e948a');
        return;
      }

      this.inventory.takeOneSelected();
      if (recipe) {
        this.unlocked.add(recipe.id);
        this.playerHud.toast(`설계를 읽었다 — ${itemDef(recipe.output).name}`, '#9fc0e0');
      }
      if (blocked) {
        this.playerHud.toast(`기록은 잠겨 있다 — ${blocked}`, '#8e948a');
      }
      if (fragment) {
        this.audio.craft();
        this.playerHud.toast(`기록을 되찾았다 — ${fragment.title}`, '#b9c46a');
        // 바로 펼쳐서 보여준다. 스쳐 지나가면 이야기가 남지 않는다.
        this.archivePanel.show(fragment);
        this.syncPointerForUi();
        this.checkStoryComplete();
      }
      return;
    }

    // 종자고 열쇠 — 정체는 알아냈지만 열 문을 아직 찾지 못했다.
    // "쓸 수 없다"로 뭉뚱그리면 고장으로 읽힌다. 무엇이 남았는지 말해준다.
    if (slot.id === 'vaultKey') {
      this.playerHud.toast('종자고 열쇠 — 열 문을 아직 찾지 못했다', '#b9c46a');
      return;
    }

    const def = itemDef(slot.id);
    if (!def.consume) {
      this.playerHud.toast(`${def.name} — 지금은 쓸 수 없다`, '#8e948a');
      return;
    }

    this.inventory.takeOneSelected();
    this.stats.apply(def.consume);
    this.playerHud.toast(def.consume.note, def.color);
  }

  /**
   * 선택한 칸을 통째로 버린다.
   *
   * 가방이 12칸뿐이라 쓸모없는 것 하나가 칸을 물고 있으면 채집이 막힌다.
   * 되돌릴 수 없으므로 한 칸씩만 비운다.
   */
  private dropSelected(): void {
    const slot = this.inventory.selectedSlot;
    if (!slot) return;
    const def = itemDef(slot.id);
    const count = slot.count;
    this.inventory.slots[this.inventory.selectedIndex] = null;
    this.inventory.touch();
    this.playerHud.toast(`${def.name} ${count}개를 버렸다`, '#8e948a');
  }

  /**
   * 나침반 표지 갱신.
   *
   * 거점 설비만 띄운다 — 자원 노드까지 올리면 띠가 가득 차서
   * 정작 돌아갈 곳이 묻혀 버린다.
   */
  private updateCompass(): void {
    const p = this.player.position;
    this.compassMarks.length = 0;

    // 설치물이 늘거나 줄었을 때만 다시 모은다
    if (this.landmarkRevision !== this.buildings.revision) {
      this.landmarkRevision = this.buildings.revision;
      this.buildings.landmarks(this.landmarkCache);
    }

    for (const mark of this.landmarkCache) {
      const dx = mark.x - p.x;
      const dz = mark.z - p.z;
      const style = LANDMARK_STYLE[mark.kind];
      if (!style) continue;
      // 꺼진 불은 잿빛으로 — 띠만 보고도 어느 불이 죽었는지 알 수 있어야 한다
      const out = mark.kind === 'campfire' && (mark.source?.fuel ?? 1) <= 0;
      this.compassMarks.push({
        angle: Math.atan2(dx, dz),
        distance: Math.hypot(dx, dz),
        glyph: style.glyph,
        color: out ? '#6b6560' : style.color,
      });
    }

    // 첨탑에서 눈에 담아둔 자원.
    //
    // 가까운 것 몇 개만 띄운다. 훑은 곳이 늘수록 표지가 쌓이는데, 전부 띄우면
    // 띠가 가득 차서 정작 돌아갈 거점이 묻힌다 — 표지는 많을수록 쓸모가 준다.
    if (this.surveyed.size > 0) {
      const near: CompassMark[] = [];
      for (const n of this.surveyed) {
        const node = this.resources.nodes[n];
        if (!node || !node.active) continue;
        const dx = node.x - p.x;
        const dz = node.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > MAST.markRange) continue;
        near.push({
          angle: Math.atan2(dx, dz),
          distance: dist,
          glyph: node.kind === 'soil' ? '土' : '記',
          color: node.kind === 'soil' ? '#8a6a3a' : '#9fc0e0',
        });
      }
      near.sort((a, b) => a.distance - b.distance);
      for (let i = 0; i < Math.min(near.length, MAST.markLimit); i++) {
        this.compassMarks.push(near[i]!);
      }
    }

    // 아직 오르지 않은 첨탑 — 오르면 그 일대가 읽힌다는 것을 알려주는 표지다
    for (const m of this.masts.masts) {
      if (m.surveyed) continue;
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      this.compassMarks.push({
        angle: Math.atan2(dx, dz),
        distance: Math.hypot(dx, dz),
        glyph: '塔',
        color: '#9aa86a',
      });
    }

    // 폐허 구조물 셋.
    //
    // 발견은 눈으로 한다 — 초록 유리, 하늘에 걸린 물탱크, 통째로 열린 격납고
    // 문. 셋 다 폐허의 회색 안에서 멀리서도 눈에 걸리는 실루엣이다.
    // 나침반은 **다시 찾아갈 때**만 거든다. 처음부터 띄우면 "저기로 가라"는
    // 지시가 되어, 뒤지다 마주치는 장면이 사라진다 (종자고와 같은 이유다).
    //
    // 상태가 아니라 **거리로** 판정하므로 죽거나 이어받을 때 지울 것이 없다.
    for (const [site, range, glyph, color] of [
      [this.greenhouse, GREENHOUSE.markRange, '溫', '#7fae7a'],
      [this.waterTower, WATER_TOWER.markRange, '水', '#6f9ab0'],
      [this.hangar, HANGAR.markRange, '庫', '#b08a58'],
    ] as Array<[{ x: number; z: number }, number, string, string]>) {
      const dx = site.x - p.x;
      const dz = site.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      this.compassMarks.push({ angle: Math.atan2(dx, dz), distance: dist, glyph, color });
    }

    // 종자고.
    //
    // 열쇠를 손에 넣기 전에는 띄우지 않는다. 정체도 모르는 문 하나에
    // 표지가 박혀 있으면 "저기로 가라"는 지시가 되고, 그러면 폐허를 뒤지다
    // 우연히 마주치는 장면이 사라진다. 열쇠를 쥔 다음부터는 반대다 —
    // 200m 를 헤매게 두면 그건 발굴이 아니라 술래잡기다.
    if (this.inventory.countOf('vaultKey') > 0 || this.vault.isOpen) {
      const dx = this.vault.x - p.x;
      const dz = this.vault.z - p.z;
      this.compassMarks.push({
        angle: Math.atan2(dx, dz),
        distance: Math.hypot(dx, dz),
        glyph: '⚿',
        color: this.vault.isOpen ? '#6b7560' : '#b9c46a',
      });
    }

    // 가까운 것부터 — 겹칠 때 중요한 것이 위로 온다
    this.compassMarks.sort((a, b) => a.distance - b.distance);
    this.compass.update(this.camera.yaw, this.compassMarks);
  }

  /** 보관함 ↔ 가방 한 칸 이동 */
  private moveStorage(fromBox: boolean, index: number): void {
    const box = this.storagePanel.current;
    if (!box) return;
    if (fromBox) {
      transfer(box.slots, index, inventorySink(this.inventory));
    } else {
      transfer(this.inventory.slots, index, box);
    }
    // 옮기고 나면 양쪽 다 조각난 더미가 남는다. 그대로 두면 12칸이 금세 잠긴다.
    box.compact();
    this.inventory.compact();
    this.inventory.touch();
    this.storagePanel.refreshIfOpen();
  }

  /**
   * 보관함 창에서 칸 하나를 버린다.
   *
   * 핫바 배정과 무관하게 칸 번호로 지운다 — 배정되지 않은 물건은
   * 손도 댈 수 없던 것이 "버릴 수가 없다"의 정체였다.
   */
  private dropFromPanel(fromBox: boolean, index: number): void {
    const box = this.storagePanel.current;
    const dropped = fromBox ? (box?.dropAt(index) ?? null) : this.inventory.dropAt(index);
    if (!dropped) return;
    const def = itemDef(dropped.id);
    this.playerHud.toast(`${def.name} ${dropped.count}개를 버렸다`, '#8e948a');
    this.inventory.touch();
    this.storagePanel.refreshIfOpen();
  }

  private simulate(dt: number): void {
    this.accumulator += dt;

    let jumpPressed = this.input.wasPressed('jump');
    let steps = 0;

    while (this.accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
      this.player.step(PHYSICS_STEP, this.input, this.camera.yaw, jumpPressed);
      jumpPressed = false; // 한 프레임의 점프 입력은 한 번만 소비한다
      this.accumulator -= PHYSICS_STEP;
      steps++;
    }

    // 따라잡지 못할 만큼 밀렸다면 누적분을 버린다 (죽음의 나선 방지)
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0;
  }

  private updateHud(dt: number): void {
    const s = this.hudState;
    const p = this.player;

    s.day = this.time.day;
    s.season = `${this.time.season.name} ${this.time.dayOfSeason}일`;
    s.seasonColor = this.time.season.color;

    const town = this.settlement.current;
    s.settlement = town.name;
    s.settlementHint = town.next ?? '';
    s.clock = this.time.clockText;

    // 나빠지는 세계와 되살린 몫을 한 줄에 나란히 둔다 — 이게 경주라는 뜻이다
    const relief = this.env.relief;
    s.hazard =
      `${this.env.density.toFixed(2)}배` +
      (relief > 0.005 ? ` (되살림 −${relief.toFixed(2)})` : '');
    s.hazardWarn = this.env.density > HAZARD.warnAt;
    // 궂은 날과 실내 여부를 시간대 옆에 적는다
    const wx = this.weather.label;
    const indoors = this.shelter > 0.5 ? ' · 실내' : '';
    s.phase = (wx ? `${this.time.phaseName} · ${wx}` : this.time.phaseName) + indoors;
    s.dayProgress = this.time.phase;
    s.isNight = this.time.isNight;

    s.fps = this.fps;
    s.position.copy(p.position);
    s.speed = p.horizontalSpeed;
    s.grounded = p.grounded;
    s.sliding = p.sliding;
    s.soil = this.terrain.sampleSoilRichness(p.position.x, p.position.z);

    const info = this.ctx.renderer.info.render;
    s.drawCalls = info.calls;
    s.triangles = info.triangles;
    s.saveTarget = this.api.unknownStatus ? '확인 중' : this.api.online ? '서버' : '로컬';
    s.creatures = this.creatures.aliveCount;
    const b = this.buildings.stats;
    s.base = {
      ripe: b.ripe,
      dry: b.dry,
      empty: b.empty,
      filled: b.filled,
      firesOut: b.firesOut,
      firesLow: b.firesLow,
      compostReady: b.compostReady,
    };
    this.playerHud.setBase(s.base);
    s.lookMode = this.input.locked
      ? '잠금'
      : this.input.lockError
        ? `드래그 (${this.input.lockError})`
        : '드래그';

    this.hud.update(dt, s);
  }

  // ---------------------------------------------------------------- 정리

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.hud.dispose();
    this.vault?.dispose();
    this.masts?.dispose();
    this.greenhouse?.dispose();
    this.waterTower?.dispose();
    this.hangar?.dispose();
    this.overlays.dispose();
    this.playerHud?.dispose();
    this.compass?.dispose();
    this.craftPanel?.dispose();
    this.storagePanel?.dispose();
    this.buildings?.dispose();
    this.terrain?.dispose();
    this.ruins?.dispose();
    this.resources?.dispose();
    this.creatures?.dispose();
    this.dust?.dispose();
    this.flora?.dispose();
    this.skyline?.dispose();
    this.weather?.dispose();
    this.audio.dispose();
    this.sky?.dispose();
    this.player?.character.dispose();
    this.ctx.dispose();
    this.container.replaceChildren();
  }
}

/**
 * 브라우저가 실제로 한 프레임을 그릴 때까지 기다린다.
 *
 * 배경 탭에서는 requestAnimationFrame이 아예 발화하지 않으므로 타이머로 함께 경주시킨다.
 * 이게 없으면 보이지 않는 탭에서 로딩이 영원히 멈춘다.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 60);
  });
}
