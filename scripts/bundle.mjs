/**
 * 화면 없이 게임 모듈을 그대로 불러온다.
 *
 * 브라우저를 못 붙이는 자리에서도 "숫자로 재야 나오는" 것들을 확인하려는 것이다
 * (8.3 의 절반이 그 종류다). vite 가 이미 데려온 esbuild 로 묶으므로
 * 새 의존성은 없다.
 *
 *   const { Buildings } = await load(['world/Buildings']);
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const posix = (p) => p.split(sep).join('/');

/** @param {string[]} modules `src/` 아래 경로 (확장자 없이) */
export async function load(modules) {
  const src = posix(join(process.cwd(), 'src'));
  const dir = mkdtempSync(join(tmpdir(), 'eden-'));
  const entry = join(dir, 'entry.ts');
  const out = join(dir, 'bundle.mjs');
  writeFileSync(entry, modules.map((m) => `export * from '${src}/${m}';`).join('\n'));
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}
