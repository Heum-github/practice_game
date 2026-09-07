import type { SaveState } from '../gameplay/SaveState';

const PLAYER_KEY = 'eden.playerId';
const LOCAL_SAVE_KEY = 'eden.save';
const BASE = '/api';

export interface RunRecord {
  playerId: string;
  seed: number;
  days: number;
  cause: string;
  plots: number;
  harvests: number;
  gathered: number;
  endedAt: number;
}

export interface Records {
  top: RunRecord[];
  me: { runs: number; bestDays: number; bestHarvests: number } | null;
}

export interface StoredSave {
  version: number;
  seed: number;
  day: number;
  updatedAt: number;
  state: SaveState;
}

/**
 * 백엔드 클라이언트.
 *
 * 서버는 있으면 좋은 것이지 전제가 아니다. 통신이 실패하면 조용히
 * localStorage로 떨어진다 — 서버가 꺼져 있다고 게임이 멈추면 안 된다.
 * `online` 으로 지금 어느 쪽에 저장되고 있는지 알 수 있다.
 */
export class Api {
  /** 마지막 통신이 성공했는지 */
  online = false;
  /** 서버에 한 번이라도 닿아본 적이 있는지 */
  private probed = false;

  readonly playerId: string;

  constructor() {
    this.playerId = Api.ensurePlayerId();
  }

  private static ensurePlayerId(): string {
    try {
      const existing = localStorage.getItem(PLAYER_KEY);
      if (existing) return existing;
      const id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
      return id;
    } catch {
      // 저장소가 막힌 환경 (시크릿 창 등) — 세션 동안만 유효한 식별자
      return crypto.randomUUID();
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-player-id': this.playerId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      this.online = true;
      this.probed = true;

      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      this.online = false;
      this.probed = true;
      return null;
    }
  }

  async health(): Promise<boolean> {
    const r = await this.request<{ ok: boolean }>('GET', '/health');
    return r?.ok === true;
  }

  // ---------------------------------------------------------------- 세이브

  async loadSave(): Promise<StoredSave | null> {
    const remote = await this.request<StoredSave>('GET', '/save');
    if (remote) return remote;
    if (this.online) return null; // 서버는 살아 있고 세이브가 없는 것
    return Api.readLocal();
  }

  async saveGame(seed: number, day: number, state: SaveState): Promise<void> {
    const payload: StoredSave = {
      version: 1,
      seed,
      day,
      updatedAt: Date.now(),
      state,
    };
    // 서버가 있든 없든 로컬에는 항상 남긴다 — 서버가 나중에 죽어도 이어서 할 수 있다
    Api.writeLocal(payload);
    await this.request('PUT', '/save', { seed, day, state });
  }

  async clearSave(): Promise<void> {
    Api.clearLocal();
    await this.request('DELETE', '/save');
  }

  // ---------------------------------------------------------------- 기록

  async reportDeath(run: {
    seed: number;
    days: number;
    cause: string;
    plots: number;
    harvests: number;
    gathered: number;
  }): Promise<void> {
    Api.clearLocal();
    await this.request('POST', '/runs', run);
  }

  async records(limit = 8): Promise<Records | null> {
    return this.request<Records>('GET', `/records?limit=${limit}`);
  }

  /** 서버에 아직 닿아보지 않았다면 true */
  get unknownStatus(): boolean {
    return !this.probed;
  }

  // ---------------------------------------------------------------- 로컬 대체

  private static readLocal(): StoredSave | null {
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      return raw ? (JSON.parse(raw) as StoredSave) : null;
    } catch {
      return null;
    }
  }

  private static writeLocal(save: StoredSave): void {
    try {
      localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(save));
    } catch {
      /* 저장소가 가득 찼거나 막혔다 — 서버 저장에 기댄다 */
    }
  }

  private static clearLocal(): void {
    try {
      localStorage.removeItem(LOCAL_SAVE_KEY);
    } catch {
      /* 무시 */
    }
  }
}
