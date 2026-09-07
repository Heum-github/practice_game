import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { openDb } from './db.js';

/**
 * 에덴의 포자 백엔드.
 *
 * 프레임워크 없이 node:http + node:sqlite만 쓴다. 이 게임이 서버에게 맡길 일은
 * 셋뿐이라 그 이상은 필요 없다.
 *
 *   1. 세이브 보관   — 브라우저 저장소를 지워도, 기기를 바꿔도 살아남는다
 *   2. 월드 시드 발급 — 무엇을 플레이할지는 서버가 정한다
 *   3. 생존 기록      — 클라이언트가 집계할 수 없는 것 (다른 사람과의 비교)
 *
 * 시뮬레이션 자체는 서버로 보내지 않는다. 싱글플레이 게임에서 이동과 물리를
 * 왕복시키면 조작감만 잃고 얻는 게 없다.
 */

/**
 * 전용 변수를 쓴다. 범용 PORT를 읽으면 개발 환경이 프런트엔드용으로 설정해 둔 값을
 * 백엔드가 가로채 Vite를 다른 포트로 밀어내는 사고가 난다.
 */
const PORT = Number(process.env.EDEN_PORT ?? 8787);
const MAX_BODY = 1_000_000; // 세이브 하나가 이보다 커질 일은 없다
const SAVE_VERSION = 1;

const db = openDb(process.env.EDEN_DB ?? 'data/eden.sqlite');

// ---------------------------------------------------------------- 유틸

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('본문이 너무 큽니다'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 형식이 아닙니다'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 플레이어 식별.
 * 계정 개념이 없으므로 클라이언트가 들고 있는 UUID를 그대로 쓴다.
 * 형식이 어긋나면 거절한다 — 임의 문자열이 키가 되면 저장소가 오염된다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function playerIdOf(req, url) {
  const id = req.headers['x-player-id'] ?? url.searchParams.get('player');
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
}

// ---------------------------------------------------------------- 라우팅

const routes = {
  'GET /api/health': (_req, res) => {
    send(res, 200, { ok: true, saveVersion: SAVE_VERSION, time: Date.now() });
  },

  /** 새 플레이어 등록 — 식별자와 월드 시드를 발급한다 */
  'POST /api/session': async (_req, res) => {
    send(res, 200, {
      playerId: randomUUID(),
      seed: Math.floor(Math.random() * 2 ** 31),
      saveVersion: SAVE_VERSION,
    });
  },

  'GET /api/save': (req, res, url) => {
    const playerId = playerIdOf(req, url);
    if (!playerId) return send(res, 400, { error: '플레이어 식별자가 필요합니다' });

    const save = db.getSave(playerId);
    if (!save) return send(res, 404, { error: '세이브가 없습니다' });
    if (save.version !== SAVE_VERSION) {
      return send(res, 409, { error: '세이브 버전이 맞지 않습니다', version: save.version });
    }
    send(res, 200, save);
  },

  'PUT /api/save': async (req, res, url) => {
    const playerId = playerIdOf(req, url);
    if (!playerId) return send(res, 400, { error: '플레이어 식별자가 필요합니다' });

    const body = await readBody(req);
    if (typeof body.seed !== 'number' || typeof body.day !== 'number' || !body.state) {
      return send(res, 400, { error: 'seed · day · state 가 필요합니다' });
    }

    db.putSave(playerId, {
      version: SAVE_VERSION,
      seed: body.seed,
      day: body.day,
      state: body.state,
    });
    send(res, 200, { ok: true, savedAt: Date.now() });
  },

  'DELETE /api/save': (req, res, url) => {
    const playerId = playerIdOf(req, url);
    if (!playerId) return send(res, 400, { error: '플레이어 식별자가 필요합니다' });
    db.deleteSave(playerId);
    send(res, 200, { ok: true });
  },

  /** 사망 기록 — 완전 초기화 규칙이라 죽음이 곧 한 판의 끝이다 */
  'POST /api/runs': async (req, res, url) => {
    const playerId = playerIdOf(req, url);
    if (!playerId) return send(res, 400, { error: '플레이어 식별자가 필요합니다' });

    const body = await readBody(req);
    const days = Number(body.days);
    if (!Number.isFinite(days) || days < 1) {
      return send(res, 400, { error: 'days 가 필요합니다' });
    }

    db.addRun(playerId, {
      seed: Number(body.seed) || 0,
      days: Math.floor(days),
      cause: String(body.cause ?? '알 수 없음').slice(0, 24),
      plots: Math.max(0, Math.floor(Number(body.plots) || 0)),
      harvests: Math.max(0, Math.floor(Number(body.harvests) || 0)),
      gathered: Math.max(0, Math.floor(Number(body.gathered) || 0)),
    });
    // 죽으면 세이브는 사라진다 — 기획상 사망은 완전 초기화다
    db.deleteSave(playerId);

    send(res, 200, { ok: true, best: db.playerBest(playerId) });
  },

  'GET /api/records': (req, res, url) => {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const playerId = playerIdOf(req, url);
    send(res, 200, {
      top: db.topRuns(limit),
      me: playerId ? db.playerBest(playerId) : null,
    });
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // 개발 중에는 Vite(5173)에서 직접 부를 수 있어야 한다
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-player-id');
  res.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: '없는 경로입니다' });

  Promise.resolve(handler(req, res, url)).catch((err) => {
    console.error('[eden] 요청 처리 실패', err);
    if (!res.headersSent) send(res, 500, { error: String(err.message ?? err) });
  });
});

server.listen(PORT, () => {
  console.log(`[eden] 백엔드 http://localhost:${PORT} 에서 대기 중`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
