# 문서 색인

문서가 한 파일에 1,500줄로 몰려 있어서 갈래별로 나눴다.
읽는 사람이 넷이라 폴더도 넷이다 — 무엇을 알고 싶은지에 따라 들어갈 곳이 다르다.

| 폴더 | 누구를 위한 것인가 |
|---|---|
| [`design/`](#design--왜-이렇게-설계했나) | 기획을 이어받는 사람. **왜** 이렇게 만들었는가 |
| [`game/`](#game--지금-무엇이-어떻게-도는가) | 플레이하는 사람. **무엇이** 어떻게 도는가 |
| [`dev/`](#dev--코드를-만지는-사람) | 코드를 만지는 사람. 구조·훅·서버 |
| [`log/`](#log--기록) | 이어받는 사람. 무엇을 했고 무엇이 남았나 |

---

## design — 왜 이렇게 설계했나

기획서를 장 번호 그대로 쪼갰다. **코드 주석이 `기획서 3.7` 처럼 장 번호로 참조하므로
번호는 절대 바꾸지 않는다.**

| | 장 | 내용 |
|---|---|---|
| [01-foundation.md](design/01-foundation.md) | 1 | 확정 사항 · 핵심 재미 한 문장 |
| [02-world.md](design/02-world.md) | 2 | 세계관 · 스토리 · 설정이 만들어낸 설계상의 이점 |
| [03-systems.md](design/03-systems.md) | 3 | **핵심 시스템 아홉 갈래** — 생존 스탯부터 시간·세이브까지 |
| [04-prototype.md](design/04-prototype.md) | 4 | 프로토타입 범위 (v0.1~v0.4) |
| [05-roadmap.md](design/05-roadmap.md) | 5 | 로드맵 · 남은 우선순위 |
| [06-open-questions.md](design/06-open-questions.md) | 6 | 남은 검토 사항 |
| [07-risks.md](design/07-risks.md) | 7 | 리스크 |
| [08-quality.md](design/08-quality.md) | 8 | 품질 설계 · **반복해서 지킬 규칙(8.3)** · 성능 예산 |
| [09-visual.md](design/09-visual.md) | — | 시각 방향 부록 — "단조롭다" 진단과 값싼 개선 우선순위. GAME_PLANNING 장 번호는 안 씀(9장은 log가 씀) |

가장 자주 열게 되는 것은 **[8.3 반복해서 지킬 규칙](design/08-quality.md)** 이다.
작업하다 실제로 발목을 잡혔던 것만 모아둔 목록이라, 새 기능을 붙이기 전에 한 번 훑으면
같은 자리에 두 번 빠지지 않는다.

## game — 지금 무엇이 어떻게 도는가

| | 내용 |
|---|---|
| [overview.md](game/overview.md) | 지금 구현된 것 전부 · 핵심 루프 |
| [survival.md](game/survival.md) | 체온과 포자병 — 가방이 아니라 거점이 답하는 시계 |
| [fire-and-food.md](game/fire-and-food.md) | 화톳불과 요리 — 먹여야 타는 불, 불 앞을 지켜야 되는 밥 |
| [farming.md](game/farming.md) | 농사와 퇴비 — 흙이 늘어나는 유일한 순간 |
| [soil-plant.md](game/soil-plant.md) | 토양 재생 플랜트 — 부순 것을 되돌린다 (v0.6) |
| [environment.md](game/environment.md) | 계절과 환경 악화 곡선 — 두 곡선의 경주 |
| [settlement.md](game/settlement.md) | 정착지 · 생존자 · 낮의 로봇 군단 |
| [exploration.md](game/exploration.md) | 관측 첨탑 · 이야기 3막 · 종자고 |
| [legacy.md](game/legacy.md) | 죽음 — 잃는 것과 남는 것 |
| [limits.md](game/limits.md) | 알려진 한계 |

## dev — 코드를 만지는 사람

| | 내용 |
|---|---|
| [architecture.md](dev/architecture.md) | 파일 구조와 각 모듈이 맡은 것 |
| [console.md](dev/console.md) | `__eden` 개발용 콘솔 훅 |
| [backend.md](dev/backend.md) | 의존성 없는 Node 백엔드와 세이브 규약 |
| [platform.md](dev/platform.md) | 프로토타입에서 유통까지 — 배포·계정·마이그레이션 선택지 |

규칙과 성능 예산은 기획서 쪽에 있다 → [08-quality.md](design/08-quality.md)

## log — 기록

| | 내용 |
|---|---|
| [status.md](log/status.md) | 어디까지 왔나 · 지금까지 만든 것 표 |
| [playtest-v0.3.1.md](log/playtest-v0.3.1.md) | 1차 플레이 피드백 열 건과 처리 |
| [playtest-v0.4.1.md](log/playtest-v0.4.1.md) | 2차 — 절반이 "고쳤는데 아무도 몰랐던 것"이었다 |
| [v0.5-notes.md](log/v0.5-notes.md) | 무한 지형을 접은 이유 · 관측 첨탑 · 이야기 완료 |
