import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 개발 서버 두 개를 한 번에 띄운다 — 백엔드(8787)와 Vite(5173).
 *
 * `npm run server & vite` 같은 셸 트릭을 쓰지 않는 이유는 Windows cmd에서
 * `&`가 백그라운드가 아니라 순차 실행이기 때문이다. 그러면 백엔드가 끝나기를
 * 기다리느라 Vite가 영영 뜨지 않는다.
 */

// Windows에서는 .cmd 래퍼를 shell 없이 spawn할 수 없다 (EINVAL).
// vite의 JS 진입점을 node로 직접 실행하면 플랫폼을 가리지 않는다.
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

const procs = [
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit', env: process.env }),
];

let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of procs) {
    if (!p.killed) p.kill();
  }
  process.exit(code);
}

for (const p of procs) {
  // 한쪽이 죽으면 다른 쪽도 정리한다 — 반쪽만 살아 있으면 헷갈린다
  p.on('exit', (code) => shutdown(code ?? 0));
  p.on('error', (err) => {
    console.error('[eden] 프로세스 시작 실패', err);
    shutdown(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}
