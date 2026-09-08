import { BUILD, FARM, GATHER, PLANT, TIME, TOOL_GATHER_MULT } from '../config';
import { DEG } from '../util/math';
import { NODE_SPEC, type ResourceNode, type ResourceNodes } from '../world/ResourceNodes';
import { Buildings, type Placed } from '../world/Buildings';
import type { Inventory } from './Inventory';
import { itemDef, type ItemId } from './Items';

export interface InteractEvent {
  /** 어떤 행동의 결과인지 — 통계 집계에 쓴다 */
  kind?: 'gather' | 'harvest' | 'refuel' | 'restore';
  /** 화면에 띄울 문구 */
  message: string;
  color?: string;
}

type Action =
  | { type: 'gather'; node: ResourceNode }
  | { type: 'plant'; plot: Placed }
  | { type: 'water'; plot: Placed }
  | { type: 'harvest'; plot: Placed }
  | { type: 'draw'; collector: Placed }
  | { type: 'refuel'; fire: Placed }
  | { type: 'gate'; gate: Placed }
  | { type: 'feedCompost'; bin: Placed; item: ItemId }
  | { type: 'takeCompost'; bin: Placed }
  | { type: 'feedPlant'; plant: Placed }
  | { type: 'takePlant'; plant: Placed }
  | { type: 'openStorage'; box: Placed };

interface Target {
  /** 실제로 할 일. null 이면 프롬프트에 상태만 띄우고 아무 일도 하지 않는다 */
  action: Action | null;
  label: string;
  duration: number;
}

/**
 * `E` 하나로 처리되는 모든 상호작용.
 *
 * 조준한 대상이 무엇인지, 그리고 지금 가방에 무엇이 있는지를 함께 보고
 * "다음에 해야 할 한 가지"를 자동으로 고른다.
 * 밭 앞에서 씨앗을 들고 있으면 심고, 물을 들고 있으면 주고, 다 자랐으면 거둔다.
 * 키를 여러 개 외우게 하지 않기 위한 선택이다.
 */
export class InteractionSystem {
  /**
   * 수확 때 더 나오는 알곡.
   *
   * 종자고를 열면 올라간다. 보존 구역이 지키고 있던 것은 결국 씨앗이었으므로,
   * 그 보상도 밭에서 돌아와야 앞뒤가 맞는다 — 밭이 없는 사람에게는
   * 아무것도 아니고, 밭을 넓혀 온 사람에게는 지금까지의 노동이 한 번 더 값을 한다.
   */
  harvestBonus = 0;
  target: Target | null = null;
  progress = 0;
  busy = false;

  /** 물뿌리개에 남은 횟수 */
  private canCharges = 0;

  private readonly nodes: ResourceNodes;
  private readonly buildings: Buildings;
  private readonly inventory: Inventory;
  private readonly coneCos = Math.cos(GATHER.aimConeDeg * DEG);

  private onEventCb?: (e: InteractEvent) => void;
  private onOpenStorage?: (box: Placed) => void;
  /** 도구를 한 번 썼다고 알린다 */
  private onToolUsed?: (tool: 'pickaxe' | 'wateringCan') => void;

  constructor(nodes: ResourceNodes, buildings: Buildings, inventory: Inventory) {
    this.nodes = nodes;
    this.buildings = buildings;
    this.inventory = inventory;
  }

  onEvent(cb: (e: InteractEvent) => void): void {
    this.onEventCb = cb;
  }

  onOpenStorageBox(cb: (box: Placed) => void): void {
    this.onOpenStorage = cb;
  }

  onToolUse(cb: (tool: 'pickaxe' | 'wateringCan') => void): void {
    this.onToolUsed = cb;
  }

  get promptLabel(): string | null {
    return this.target?.label ?? null;
  }

  /** 스탯 소모 판정에 쓰는 "노동 중" 여부 */
  get laboring(): boolean {
    return this.busy;
  }

  /** 지금 동작에 어울리는 캐릭터 자세 */
  get actionKind(): 'none' | 'swing' | 'tend' {
    if (!this.busy || !this.target?.action) return 'none';
    switch (this.target.action.type) {
      case 'gather':
      case 'harvest':
        return 'swing';
      default:
        return 'tend';
    }
  }

  cancel(): void {
    this.target = null;
    this.progress = 0;
    this.busy = false;
  }

  reset(): void {
    this.cancel();
    this.canCharges = 0;
  }

  // ---------------------------------------------------------------- 프레임

  update(
    dt: number,
    holding: boolean,
    px: number,
    pz: number,
    fx: number,
    fz: number,
  ): void {
    const found = this.resolveTarget(px, pz, fx, fz);

    // 대상이나 할 일이 바뀌면 진행 중이던 작업은 버린다
    if (!sameTarget(found, this.target)) {
      this.target = found;
      this.progress = 0;
    } else if (found) {
      // 라벨·소요시간은 최신값으로 갱신 (가방 상태가 바뀔 수 있다)
      this.target = { ...found };
    }

    // 할 일이 없는 안내용 대상은 눌러도 채워지지 않는다
    if (!this.target || !this.target.action || !holding) {
      this.busy = false;
      if (this.progress > 0) this.progress = Math.max(0, this.progress - dt * 1.6);
      return;
    }

    this.busy = true;
    this.progress += dt / this.target.duration;
    if (this.progress < 1) return;

    this.progress = 0;
    this.execute(this.target.action);
    this.target = this.resolveTarget(px, pz, fx, fz);
    this.busy = false;
  }

  // ---------------------------------------------------------------- 대상 선택

  private resolveTarget(px: number, pz: number, fx: number, fz: number): Target | null {
    // 설치물이 자원 노드보다 우선한다 — 밭 위에 잔해가 겹쳐 있어도 밭을 다룰 수 있게
    const placed = this.buildings.findTarget(px, pz, fx, fz, GATHER.reach, this.coneCos);
    if (placed) {
      const t = this.targetForPlaced(placed);
      if (t) return t;
    }

    const node = this.nodes.findTarget(px, pz, fx, fz, GATHER.reach, this.coneCos);
    if (!node) return null;

    const spec = NODE_SPEC[node.kind];
    return {
      action: { type: 'gather', node },
      label: `${spec.label} ${spec.verb}`,
      duration: spec.duration / (this.hasTool('pickaxe') ? TOOL_GATHER_MULT : 1),
    };
  }

  private targetForPlaced(p: Placed): Target | null {
    if (p.kind === 'storage') {
      return {
        action: { type: 'openStorage', box: p },
        label: '보관함을 연다',
        duration: 0.25,
      };
    }

    if (p.kind === 'gate') {
      return {
        action: { type: 'gate', gate: p },
        label: p.openGate ? '문을 닫는다' : '문을 연다',
        duration: 0.2,
      };
    }

    if (p.kind === 'campfire') {
      if (p.fuel >= BUILD.fuelCapacity) return null;
      if (this.inventory.countOf('driedGrass') <= 0) {
        // 넣을 것이 없으면 프롬프트 대신 상태만 알린다 —
        // 꺼진 불 앞에서 아무 안내도 없으면 고장 난 것으로 보인다
        if (p.fuel > 0) return null;
        return { action: null, label: '불이 꺼졌다 — 마른 풀이 필요하다', duration: 0 };
      }
      const label =
        p.fuel <= 0 ? '불을 다시 피운다' : `불에 마른 풀을 넣는다 (${fuelText(p.fuel)})`;
      return { action: { type: 'refuel', fire: p }, label, duration: BUILD.refuelTime };
    }

    if (p.kind === 'compost') {
      // 다 삭은 흙이 있으면 그것부터 꺼낸다 — 넣는 것보다 받는 것이 급하다
      if (p.stored > 0) {
        return {
          action: { type: 'takeCompost', bin: p },
          label: `삭은 흙을 꺼낸다 (${p.stored})`,
          duration: FARM.compostTime,
        };
      }
      const feed = this.organicInHand();
      if (!feed) {
        if (p.moisture > 0) {
          const left = ((1 - p.growth) + (p.moisture - 1)) * FARM.compostDays;
          return { action: null, label: `삭는 중 — 다음 한 줌까지 ${dayText(left)}`, duration: 0 };
        }
        return { action: null, label: '퇴비 더미가 비었다 — 마른 풀이나 작물을 넣는다', duration: 0 };
      }
      if (p.moisture >= FARM.compostInputMax) {
        return { action: null, label: '퇴비 더미가 가득 찼다', duration: 0 };
      }
      const def = itemDef(feed);
      return {
        action: { type: 'feedCompost', bin: p, item: feed },
        label: `${def.name}을 퇴비에 넣는다 (${Math.round(p.moisture)}/${FARM.compostInputMax})`,
        duration: FARM.compostTime,
      };
    }

    if (p.kind === 'plant') {
      // 꺼낼 흙이 있으면 그것부터 — 퇴비와 같은 순서다
      if (p.stored > 0) {
        return {
          action: { type: 'takePlant', plant: p },
          label: `되돌린 흙을 꺼낸다 (${p.stored})`,
          duration: PLANT.feedTime,
        };
      }
      if (this.inventory.countOf('scrap') < PLANT.scrapPerSoil) {
        if (p.moisture > 0) {
          // 8.3 "대가가 화면에 안 나오면 대가가 아니다" — 도는 동안은
          // 로봇을 부르고 있다는 사실이 여기서 읽혀야 한다.
          const left = ((1 - p.growth) + (p.moisture - 1)) * PLANT.daysPerSoil;
          return {
            action: null,
            label: `돌아가는 중 — 낮에 로봇을 부른다 · 다음 흙까지 ${dayText(left)}`,
            duration: 0,
          };
        }
        return {
          action: null,
          label: `잔해가 모자라다 — 한 몫에 ${PLANT.scrapPerSoil}개가 필요하다`,
          duration: 0,
        };
      }
      if (p.moisture >= PLANT.inputMax) {
        return { action: null, label: '플랜트가 가득 찼다', duration: 0 };
      }
      return {
        action: { type: 'feedPlant', plant: p },
        label: `잔해를 플랜트에 밀어 넣는다 (${Math.round(p.moisture)}/${PLANT.inputMax})`,
        duration: PLANT.feedTime,
      };
    }

    if (p.kind === 'collector') {
      if (p.stored <= 0) return null;
      return {
        action: { type: 'draw', collector: p },
        label: `빗물 집수기에서 물을 뜬다 (${p.stored})`,
        duration: FARM.drawWaterTime,
      };
    }

    if (p.stage === 'ripe') {
      return {
        action: { type: 'harvest', plot: p },
        label: '다 자란 작물을 거둔다',
        duration: FARM.harvestTime,
      };
    }

    if (p.stage === 'empty') {
      if (this.inventory.countOf('seed') <= 0) return null;
      return {
        action: { type: 'plant', plot: p },
        label: '씨앗을 심는다',
        duration: FARM.plantTime,
      };
    }

    // planted — 물이 마르면 자라지 않는다
    if (p.moisture > 0) return null;
    if (!this.canWater()) return null;
    return {
      action: { type: 'water', plot: p },
      label: '물을 준다',
      duration: FARM.waterTime,
    };
  }

  /** 선택된 핫바 칸에 해당 도구가 있는지 */
  private hasTool(tool: 'pickaxe' | 'wateringCan'): boolean {
    const slot = this.inventory.selectedSlot;
    return !!slot && itemDef(slot.id).tool === tool;
  }

  /**
   * 퇴비에 넣을 수 있는 것 중 지금 손에 든 것.
   *
   * 든 것을 먼저 보고, 없으면 가방에서 찾는다. 작물이 마른 풀보다 알차지만
   * 먹을 것을 흙으로 돌리는 셈이라 — 그 저울질은 플레이어에게 맡긴다.
   */
  private organicInHand(): ItemId | null {
    const held = this.inventory.selectedSlot?.id;
    if (held && COMPOST_VALUE[held]) return held;
    for (const id of Object.keys(COMPOST_VALUE) as ItemId[]) {
      if (this.inventory.countOf(id) > 0) return id;
    }
    return null;
  }

  private canWater(): boolean {
    if (this.canCharges > 0 && this.hasTool('wateringCan')) return true;
    return this.inventory.countOf('stagnantWater') > 0;
  }

  // ---------------------------------------------------------------- 실행

  private emit(message: string, color?: string, kind?: InteractEvent['kind']): void {
    this.onEventCb?.({ message, color, kind });
  }

  private take(id: ItemId): boolean {
    const index = this.inventory.slots.findIndex((s) => s?.id === id);
    if (index < 0) return false;
    this.inventory.takeOne(index);
    return true;
  }

  private execute(action: Action): void {
    switch (action.type) {
      case 'gather': {
        const gained = this.nodes.harvest(action.node);
        if (!gained) return;
        if (this.hasTool('pickaxe')) this.onToolUsed?.('pickaxe');
        const def = itemDef(gained.item);
        const dropped = this.inventory.add(gained.item, gained.count);
        if (gained.count - dropped > 0) {
          this.emit(`+${gained.count - dropped} ${def.name}`, def.color, 'gather');
        }
        if (dropped > 0) this.emit('가방이 가득 찼다', '#d98a4a');
        return;
      }

      case 'refuel': {
        const wasOut = action.fire.fuel <= 0;
        if (!this.take('driedGrass')) return;
        this.buildings.refuel(action.fire, BUILD.fuelPerGrass);
        this.emit(wasOut ? '불이 다시 붙었다' : '불이 살아난다', '#d98a4a', 'refuel');
        return;
      }

      case 'feedCompost': {
        if (!this.take(action.item)) return;
        const bin = action.bin;
        bin.moisture = Math.min(
          FARM.compostInputMax,
          bin.moisture + (COMPOST_VALUE[action.item] ?? 1),
        );
        this.buildings.refresh(bin);
        this.emit(`${itemDef(action.item).name}을 삭힌다`, '#7d6a3e');
        return;
      }

      case 'takeCompost': {
        const bin = action.bin;
        if (bin.stored <= 0) return;
        const dropped = this.inventory.add('soil', 1);
        if (dropped > 0) {
          this.emit('가방이 가득 찼다', '#d98a4a');
          return;
        }
        bin.stored -= 1;
        this.buildings.refresh(bin);
        // 이 세계에서 흙이 늘어나는 유일한 순간이다.
        // 환경 악화 곡선의 "상승 곡선"이 여기서 한 칸 오른다 (기획서 3.7).
        this.emit('+1 흙 — 되살린 것이다', '#a3763f', 'restore');
        return;
      }

      case 'feedPlant': {
        if (!this.inventory.remove('scrap', PLANT.scrapPerSoil)) return;
        const plant = action.plant;
        plant.moisture = Math.min(PLANT.inputMax, plant.moisture + 1);
        this.buildings.refresh(plant);
        this.emit('잔해를 플랜트에 밀어 넣었다', '#8f9a6b');
        return;
      }

      case 'takePlant': {
        const plant = action.plant;
        if (plant.stored <= 0) return;
        const dropped = this.inventory.add('soil', 1);
        if (dropped > 0) {
          this.emit('가방이 가득 찼다', '#d98a4a');
          return;
        }
        plant.stored -= 1;
        this.buildings.refresh(plant);
        // 퇴비와 같은 순간이다 — 되살린 흙이 여기서도 한 줌 는다.
        this.emit('+1 흙 — 부순 것을 되돌렸다', '#8f9a6b', 'restore');
        return;
      }

      case 'gate': {
        const open = this.buildings.toggleGate(action.gate);
        this.emit(open ? '문을 열었다' : '문을 닫았다', '#a9926a');
        return;
      }

      case 'plant': {
        if (!this.take('seed')) return;
        action.plot.stage = 'planted';
        action.plot.growth = 0;
        this.buildings.refresh(action.plot);
        this.emit('씨앗을 심었다', '#8fae5a');
        return;
      }

      case 'water': {
        if (this.canCharges > 0 && this.hasTool('wateringCan')) {
          this.canCharges--;
        } else {
          if (!this.take('stagnantWater')) return;
          // 물뿌리개를 들고 있으면 한 통으로 여러 번 쓴다
          if (this.hasTool('wateringCan')) {
            this.canCharges = FARM.wateringCanUses - 1;
            this.onToolUsed?.('wateringCan');
            this.emit('물뿌리개를 채웠다', '#7fb0c4');
          }
        }
        Buildings.water(action.plot);
        this.buildings.refresh(action.plot);
        return;
      }

      case 'harvest': {
        const plot = action.plot;
        plot.stage = 'empty';
        plot.growth = 0;
        plot.moisture = 0;
        this.buildings.refresh(plot);

        // 수확량은 땅의 비옥도가 정한다 — 좋은 밭을 고른 보람이 여기서 돌아온다.
        // 종자고를 연 뒤로는 개량종이 한 줌 더 얹는다.
        const amount = Buildings.yieldOf(plot.fertility) + this.harvestBonus;
        const dropped = this.inventory.add('crop', amount);
        this.inventory.add('seed', FARM.seedYield);
        // 알곡을 털고 남은 대는 탄다. 농장이 커질수록 불을 스스로 먹여 살리게 되는
        // 지점이 여기다 — 초반의 "풀을 베러 나가는 일"이 중반에는 저절로 해결된다.
        this.inventory.add('driedGrass', FARM.stalkYield);
        this.emit(
          `+${amount - dropped} 기초 작물 · +${FARM.seedYield} 씨앗 · +${FARM.stalkYield} 마른 풀`,
          '#9dbd63',
          'harvest',
        );
        if (dropped > 0) this.emit('가방이 가득 찼다', '#d98a4a');
        return;
      }

      case 'openStorage': {
        this.onOpenStorage?.(action.box);
        return;
      }

      case 'draw': {
        const c = action.collector;
        if (c.stored <= 0) return;
        c.stored -= 1;
        const dropped = this.inventory.add('stagnantWater', 1);
        if (dropped > 0) {
          c.stored += 1;
          this.emit('가방이 가득 찼다', '#d98a4a');
          return;
        }
        this.emit('+1 고인 물', '#5b8fa8');
        return;
      }
    }
  }
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.action === null || b.action === null) return a.action === b.action && a.label === b.label;
  if (a.action.type !== b.action.type) return false;
  const ka = subject(a.action);
  const kb = subject(b.action);
  return ka === kb;
}

function subject(a: Action): object {
  switch (a.type) {
    case 'gather':
      return a.node;
    case 'draw':
      return a.collector;
    case 'refuel':
      return a.fire;
    case 'gate':
      return a.gate;
    case 'feedCompost':
    case 'takeCompost':
      return a.bin;
    case 'feedPlant':
    case 'takePlant':
      return a.plant;
    case 'openStorage':
      return a.box;
    default:
      return a.plot;
  }
}

/** 남은 연료를 사람이 읽는 시간으로 — 숫자보다 "몇 분 남았나"가 판단에 쓰인다 */
function fuelText(fuel: number): string {
  const minutes = Math.max(1, Math.round((fuel * TIME.secondsPerDay) / 60));
  return `${minutes}분 남음`;
}

/**
 * 퇴비에 넣을 수 있는 것과 그 몫.
 *
 * 작물이 마른 풀보다 알차다. 다만 먹을 것을 흙으로 돌리는 셈이라
 * "지금 먹을 것인가, 밭을 넓힐 것인가"라는 저울이 생긴다 —
 * 흙이 유한하던 시절에는 없던 선택이다.
 */
const COMPOST_VALUE: Partial<Record<ItemId, number>> = {
  driedGrass: FARM.compostGrassValue,
  crop: FARM.compostCropValue,
};

/** 남은 시간을 사람이 읽는 말로 (하루 15분) */
function dayText(days: number): string {
  const minutes = Math.max(1, Math.round((days * TIME.secondsPerDay) / 60));
  return `${minutes}분`;
}
