[← 문서 색인](../index.md) · [README](../../README.md)

---

## 개발용 콘솔 훅

개발 빌드에서만 `window.__eden` 이 열린다.

```js
__eden.setPhase(0.5)      // 정오로 시간 이동 (0=자정, 0.5=정오)
__eden.teleport(40, -20)  // 좌표로 순간이동
__eden.tick(60)           // 프레임 강제 진행 (배경 탭 디버깅용)
__eden.pick(0, 0)         // 화면 중앙에 무엇이 있는지
__eden.give('soil', 10)   // 아이템 지급
__eden.setStats({thirst:0}) // 스탯 강제 설정 (탈수·아사·저체온·발병 시험)
__eden.setStats({spore:99.99}) // 곧 발병 — 노출이 넘치는 순간을 본다
__eden.body()             // 지금 몸이 놓인 자리 (체온·노출·병세·지붕·불)
__eden.fires()            // 화톳불마다 남은 연료 (분)
__eden.setFuel(0)         // 모든 불을 끈다 — 꺼진 밤을 바로 만들어 본다
__eden.world()            // 계절·연차·포자 농도·되살림 (두 곡선의 현재값)
__eden.skipDays(15)       // 다음 계절로 건너뛴다
__eden.setRestored(50)    // 되살린 흙을 강제로 넣어 상승 곡선을 본다
__eden.setRestored(50, 4) // 지난 생이 한 해를 난 상태 — 회차 2의 1일차를 흉내 낸다
__eden.town()             // 정착지 등급·설비·두른 넓이·생존자
__eden.story()            // 이야기 — 막마다 열렸는지, 잠겼다면 무엇 때문인지
__eden.read(3)            // 기록을 세 편 읽어본다 (막의 문에 걸리면 이유를 돌려준다)
__eden.masts()            // 관측 첨탑 셋 — 좌표·높이·올라가 봤는지
__eden.gotoMast(1)        // 첨탑 꼭대기로 올려보낸다
__eden.surveyed()         // 눈에 담아둔 자원 수
__eden.vault()            // 종자고 — 좌표·거리·열렸는지·열쇠를 들었는지
__eden.gotoVault()        // 종자고 문 앞으로 이동
__eden.sites()            // 폐허 구조물 셋 — 좌표·경사·want 대비 실제로 깔린 자원 개수
__eden.gotoSite('hangar') // 구조물 앞으로 이동, 건물을 마주본다
                          //   'greenhouse' | 'waterTower' | 'hangar'
__eden.legacy()           // 죽음을 넘어 남은 것 (회차·설계·기록·되살린 흙·종자고)
__eden.kill()             // 지금 죽는다 — 계승 화면을 바로 본다
__eden.clearLegacy()      // 유산을 지우고 첫 생으로
__eden.gotoNode('water')  // 가장 가까운 자원으로 이동
__eden.resources()        // 남은 노드 통계
__eden.buildings()        // 밭·집수기 통계
__eden.plants()           // 토양 재생 플랜트 — 대마다 넣어둔 몫·꺼낼 흙·다음 한 줌까지
                          //   noisyHere 가 true 면 지금 선 자리가 낮에 로봇을 부른다
__eden.setTimeScale(300)  // 시간 배속 고정 (작물 성장 확인용)
```
