import './style.css';
import { Game } from './core/Game';

const container = document.getElementById('app');
if (!container) throw new Error('#app 컨테이너를 찾을 수 없습니다');

const game = new Game(container);

void game.boot().catch((err: unknown) => {
  console.error('[에덴의 포자] 부팅 실패', err);
  container.innerHTML = `
    <div style="display:grid;place-items:center;height:100%;font-family:monospace;color:#d98a4a;padding:24px;text-align:center">
      게임을 시작하지 못했습니다.<br><br>
      <span style="color:#8e948a;font-size:12px">${String(err)}</span>
    </div>`;
});

// Vite HMR — 모듈이 교체될 때 이전 게임 인스턴스를 확실히 정리한다
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
