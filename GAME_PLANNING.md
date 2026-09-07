# GAME_PLANNING.md

> 3D 웹 오픈월드 생존 게임 (가제: **에덴의 포자**)
> 최초 작성 2026-08-29 · 상태: v0.5 「세계」 진행 중

기획서가 750줄까지 자라서 장별로 쪼갰다. 이 파일은 **목차**다 —
내용은 [`docs/design/`](docs/design/) 에 있고, 장 번호는 그대로다.

**코드 주석이 `기획서 3.7` 처럼 장 번호로 참조한다. 번호는 바꾸지 않는다.**

| 장 | 문서 | 무엇이 적혀 있나 |
|---|---|---|
| 1 | [확정 사항](docs/design/01-foundation.md) | 장르·시점·플랫폼, 그리고 핵심 재미 한 문장 |
| 2 | [세계관 · 스토리](docs/design/02-world.md) | 흙이 사라진 세계, 기억을 잃은 개척자, 설정이 만들어낸 설계상의 이점 |
| 3 | [핵심 시스템 설계](docs/design/03-systems.md) | 생존 스탯 · 자원 경제 · 제작 · 농사 · 건설 · 위협 · 환경 악화 · 스토리 · 시간 |
| 4 | [프로토타입 범위](docs/design/04-prototype.md) | v0.1~v0.4 에서 무엇을 넣었나 |
| 5 | [로드맵](docs/design/05-roadmap.md) | 단계별 검증 질문과 남은 우선순위 |
| 6 | [남은 검토 사항](docs/design/06-open-questions.md) | 아직 결정하지 않은 것 |
| 7 | [리스크](docs/design/07-risks.md) | 무너질 수 있는 지점과 완충안 |
| 8 | [품질 설계](docs/design/08-quality.md) | 다섯 축 · **반복해서 지킬 규칙(8.3)** · 성능 예산(8.4) |
| 9 | [현황과 기록](docs/log/) | 지금까지 만든 것, 플레이 피드백, 결정 기록 |

## 자주 찾는 것

- **새 기능을 붙이기 전에** → [8.3 반복해서 지킬 규칙](docs/design/08-quality.md)
  작업하다 실제로 발목을 잡혔던 것만 모아둔 목록이다
- **다음에 뭘 해야 하나** → [5. 로드맵](docs/design/05-roadmap.md)
- **지금 뭐가 돌아가나** → [docs/game/overview.md](docs/game/overview.md)
- **왜 이 시스템이 이렇게 생겼나** → [3. 핵심 시스템 설계](docs/design/03-systems.md)

전체 문서 색인은 [docs/index.md](docs/index.md) 에 있다.
