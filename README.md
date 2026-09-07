# 에덴의 포자 (Eden's Spore)

웹 브라우저에서 돌아가는 3D 오픈월드 생존 게임.
AI가 흙을 걷어간 세계에서 눈을 뜨고, 남은 흙을 긁어모아 다시 농사를 짓는다.

현재 단계: **v0.5 — 이야기가 세 막으로 열리고, 걷는 일이 지도를 만든다**

## 실행

```bash
npm install
```

```bash
npm run dev
```

프런트엔드(5173)와 백엔드(8787)가 함께 뜬다.
브라우저에서 `http://localhost:5173` 을 열고 화면을 클릭하면 시작된다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 프런트 + 백엔드 동시 실행 |
| `npm run dev:client` | 프런트만 (백엔드 없이도 게임은 돌아간다) |
| `npm run server` | 백엔드만 |
| `npm run build` | 타입 검사 + 프로덕션 번들 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | 타입 검사만 |

## 조작

| 키 | 동작 |
|---|---|
| `W` `A` `S` `D` | 이동 (카메라 기준) |
| `Shift` | 달리기 |
| `Space` | 점프 |
| `E` (길게) | 채집 · 파종 · 급수 · 수확 · 물 뜨기 · 연료 넣기 · **문 여닫기** |
| 좌클릭 | 설치할 것을 들었으면 설치, 아니면 **공격** |
| `X` (길게) | **철거** — 조준한 설치물을 걷어내고 자재를 돌려받는다 |
| `R` | 방향 — 밭 구획 회전, **방벽·문의 축** (자동 → 가로 → 세로) |
| — | 관측 첨탑은 **올라서면** 훑는다. 누를 것이 없다 |
| `F` | 먹기 · 마시기 · 설계 읽기 · **도감 펼치기** |
| `1` ~ `6` | 핫바 슬롯 선택 |
| `Tab` | 가방 열기 |
| `C` | 제작창 |
| `Q` | 선택한 칸 버리기 |
| `M` | 소리 켜기·끄기 |
| `J` | 기록 — 찾아낸 이야기 조각 |
| `Esc` | 열린 창 닫기 / 커서 해제 |
| 마우스 | 시점 회전 |
| 휠 | 카메라 거리 |
| `T` (누르는 동안) | 시간 90배속 — 낮/밤 확인용 |
| `Esc` | 커서 해제 (일시정지) |

**마우스는 클릭 없이 시점을 따라간다.** 화면을 한 번 누르면 커서가 잠기고,
그 뒤로는 마우스를 움직이는 대로 시점이 돈다. 브라우저가 잠금을 거절하는
환경(임베드된 iframe 등)에서는 자동으로 드래그 조작으로 떨어지며, HUD 우하단
`시점` 항목이 지금 어느 쪽인지와 거절 사유를 보여준다. 클릭할 때마다 다시
잠금을 시도하므로 한 번 놓쳐도 회복된다.

가방·제작창·보관함을 열면 **커서가 돌아오고 세상이 멈춘다.** 창을 띄운 채로
마우스가 시점을 돌리면 아무것도 고를 수 없고, 메뉴를 읽는 동안 물려 죽는 것은
긴장이 아니라 그냥 억울한 일이기 때문이다. 창을 닫으면 커서를 다시 잡는다.


## 문서

문서가 한 파일에 몰려 있어서 갈래별로 나눴다 → **[docs/index.md](docs/index.md)**

| 알고 싶은 것 | 갈 곳 |
|---|---|
| 지금 뭐가 돌아가나 | [docs/game/overview.md](docs/game/overview.md) |
| 왜 이렇게 설계했나 | [GAME_PLANNING.md](GAME_PLANNING.md) (기획서 목차) |
| 코드 구조 | [docs/dev/architecture.md](docs/dev/architecture.md) |
| 개발용 콘솔 훅 | [docs/dev/console.md](docs/dev/console.md) |
| 다음에 뭘 하나 | [docs/design/05-roadmap.md](docs/design/05-roadmap.md) |
| 어디까지 왔나 | [docs/log/status.md](docs/log/status.md) |

### 시스템별로 보려면

[생존(체온·포자병)](docs/game/survival.md) ·
[화톳불과 요리](docs/game/fire-and-food.md) ·
[농사와 퇴비](docs/game/farming.md) ·
[계절과 환경 악화](docs/game/environment.md) ·
[정착지와 위협](docs/game/settlement.md) ·
[탐험 · 이야기 · 종자고](docs/game/exploration.md) ·
[죽음과 계승](docs/game/legacy.md) ·
[알려진 한계](docs/game/limits.md)

### 새 기능을 붙이기 전에

[8.3 반복해서 지킬 규칙](docs/design/08-quality.md) 을 한 번 훑는다.
작업하다 실제로 발목을 잡혔던 것만 모아둔 목록이라, 같은 자리에 두 번 빠지지 않는다.
