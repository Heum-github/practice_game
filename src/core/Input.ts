/**
 * 키보드 · 마우스 입력과 포인터 락을 담당한다.
 * 게임 로직은 키 코드를 직접 알 필요 없이 의미 있는 액션만 읽는다.
 */

const ACTION_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  use: ['KeyF'],
  inventory: ['Tab'],
  craft: ['KeyC'],
  journal: ['KeyJ'],
  rotate: ['KeyR'],
  drop: ['KeyQ'],
  demolish: ['KeyX'],
  mute: ['KeyM'],
} as const;

/** 핫바 선택 키 — 1..6 */
const HOTBAR_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];

export type Action = keyof typeof ACTION_KEYS;

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();

  /** 이번 프레임에 누적된 마우스 이동량 (px) */
  mouseDX = 0;
  mouseDY = 0;
  /** 이번 프레임에 누적된 휠 이동량 */
  wheelDelta = 0;

  locked = false;
  /** 포인터 락이 없는 환경에서 드래그로 시점을 돌리는 중 */
  dragging = false;

  private readonly canvas: HTMLElement;
  private onLockChange?: (locked: boolean) => void;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  onPointerLockChange(cb: (locked: boolean) => void): void {
    this.onLockChange = cb;
  }

  /**
   * 포인터 락을 요청한다.
   * 브라우저나 임베드 환경이 거부할 수 있으므로 게임은 락 성공을 전제하지 않는다.
   * 실패하면 드래그 조작으로 자연스럽게 대체된다.
   */
  requestLock(): void {
    if (this.locked) return;

    // 짧은 간격으로 연달아 요청하면 브라우저가 거부한다
    const now = performance.now();
    if (now - this.lastLockRequest < 300) return;
    this.lastLockRequest = now;

    try {
      const p = this.canvas.requestPointerLock() as unknown;
      if (p instanceof Promise) {
        p.then(
          () => {
            this.lockError = null;
          },
          (err: unknown) => {
            this.lockError = err instanceof Error ? err.name : String(err);
          },
        );
      }
    } catch (err) {
      this.lockError = err instanceof Error ? err.name : String(err);
    }
  }

  /** 마지막 락 요청이 실패한 이유 (성공했거나 아직 시도 전이면 null) */
  lockError: string | null = null;
  private lastLockRequest = 0;

  /** 시점 조작이 가능한 상태인지 */
  get looking(): boolean {
    return this.locked || this.dragging;
  }

  isDown(action: Action): boolean {
    for (const code of ACTION_KEYS[action]) {
      if (this.down.has(code)) return true;
    }
    return false;
  }

  /** 임의의 키 코드 직접 조회 — 디버그 단축키용 */
  isKeyDown(code: string): boolean {
    return this.down.has(code);
  }

  /** 이번 프레임에 새로 눌렸는지 (홀드는 false) */
  wasPressed(action: Action): boolean {
    for (const code of ACTION_KEYS[action]) {
      if (this.pressedThisFrame.has(code)) return true;
    }
    return false;
  }

  /** 이번 프레임에 눌린 핫바 번호 (0..5). 없으면 -1 */
  hotbarPressed(): number {
    for (let i = 0; i < HOTBAR_KEYS.length; i++) {
      if (this.pressedThisFrame.has(HOTBAR_KEYS[i]!)) return i;
    }
    return -1;
  }

  /** -1..1 좌우, -1..1 전후 (전진이 +1) */
  moveAxis(): { x: number; z: number } {
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const z = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    return { x, z };
  }

  /** 매 프레임 마지막에 호출 — 1프레임짜리 상태를 비운다 */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.pressedThisFrame.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // 브라우저 스크롤과 포커스 이동 방지
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) {
      e.preventDefault();
    }
    if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
    this.down.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  /** 창 포커스를 잃으면 키가 눌린 채로 남아 캐릭터가 계속 걷는 버그를 막는다 */
  private handleBlur = (): void => {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.dragging = false;
  };

  private handleMouseDown = (): void => {
    this.dragging = true;
  };

  private handleMouseUp = (): void => {
    this.dragging = false;
  };

  private handlePointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.down.clear();
    this.onLockChange?.(this.locked);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked && !this.dragging) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheelDelta += e.deltaY;
  };
}
