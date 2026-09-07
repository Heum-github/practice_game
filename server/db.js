import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 저장소.
 *
 * Node 24에 내장된 node:sqlite를 쓴다 — 의존성 없이 진짜 데이터베이스를 얻는다.
 * 게임이 싱글플레이라 스키마는 작지만, 세이브와 기록을 서버가 들고 있으면
 * 브라우저 저장소를 지워도 살아남고 나중에 계정·기기 간 이어하기로 확장할 수 있다.
 */
export function openDb(file = 'data/eden.sqlite') {
  const path = resolve(process.cwd(), file);
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS saves (
      player_id   TEXT PRIMARY KEY,
      version     INTEGER NOT NULL,
      seed        INTEGER NOT NULL,
      day         INTEGER NOT NULL,
      payload     TEXT    NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id   TEXT    NOT NULL,
      seed        INTEGER NOT NULL,
      days        INTEGER NOT NULL,
      cause       TEXT    NOT NULL,
      plots       INTEGER NOT NULL DEFAULT 0,
      harvests    INTEGER NOT NULL DEFAULT 0,
      gathered    INTEGER NOT NULL DEFAULT 0,
      ended_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS runs_days ON runs(days DESC);
  `);

  return {
    raw: db,

    getSave(playerId) {
      const row = db
        .prepare('SELECT version, seed, day, payload, updated_at FROM saves WHERE player_id = ?')
        .get(playerId);
      if (!row) return null;
      return {
        version: row.version,
        seed: row.seed,
        day: row.day,
        updatedAt: row.updated_at,
        state: JSON.parse(row.payload),
      };
    },

    putSave(playerId, { version, seed, day, state }) {
      db.prepare(
        `INSERT INTO saves (player_id, version, seed, day, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           version = excluded.version,
           seed = excluded.seed,
           day = excluded.day,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      ).run(playerId, version, seed, day, JSON.stringify(state), Date.now());
    },

    deleteSave(playerId) {
      db.prepare('DELETE FROM saves WHERE player_id = ?').run(playerId);
    },

    addRun(playerId, { seed, days, cause, plots = 0, harvests = 0, gathered = 0 }) {
      db.prepare(
        `INSERT INTO runs (player_id, seed, days, cause, plots, harvests, gathered, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(playerId, seed, days, cause, plots, harvests, gathered, Date.now());
    },

    /** 명예의 전당 — 가장 오래 버틴 기록들 */
    topRuns(limit = 10) {
      return db
        .prepare(
          `SELECT player_id, seed, days, cause, plots, harvests, gathered, ended_at
           FROM runs ORDER BY days DESC, harvests DESC, ended_at ASC LIMIT ?`,
        )
        .all(limit)
        .map((r) => ({
          playerId: r.player_id,
          seed: r.seed,
          days: r.days,
          cause: r.cause,
          plots: r.plots,
          harvests: r.harvests,
          gathered: r.gathered,
          endedAt: r.ended_at,
        }));
    },

    /** 이 플레이어의 개인 기록 */
    playerBest(playerId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS runs, MAX(days) AS bestDays, MAX(harvests) AS bestHarvests
           FROM runs WHERE player_id = ?`,
        )
        .get(playerId);
      return {
        runs: row?.runs ?? 0,
        bestDays: row?.bestDays ?? 0,
        bestHarvests: row?.bestHarvests ?? 0,
      };
    },

    close() {
      db.close();
    },
  };
}
