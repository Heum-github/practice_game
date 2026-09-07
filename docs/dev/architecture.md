[← 문서 색인](../index.md) · [README](../../README.md)

---

## 구조

```
src/
  config.ts            모든 튜닝 값 (밸런싱은 여기서만)
  core/
    Game.ts            시스템 조립과 게임 루프
    GameTime.ts        하루 15분 시계, 태양 고도, 네 계절
    Input.ts           키보드·마우스·포인터 락
  world/
    Terrain.ts         지형 생성 + 높이/노멀/흙 샘플링
    Ruins.ts           폐허 절차 생성 (인스턴싱)
    ResourceNodes.ts   채집 노드 배치·렌더·소진
    Buildings.ts       밭·집수기·방벽·문·화톳불 — 설치·성장·불빛·연료·철거
    Creatures.ts       야간 변이 생물 — 배회·추격·공격·빛 회피
    Sky.ts             하늘·조명·별·포자·환경맵
    Weather.ts         맑음·비·먼지폭풍 (계절이 비율을 정한다)
    Environment.ts     환경 악화 곡선 — 나빠지는 세계와 되살린 몫
    Settlement.ts      정착지 등급 — 두른 넓이를 물 흘리기로 잰다
    Settlers.ts        모여든 생존자 — 밀린 집안일을 하고, 먹는다
    Dust.ts            발밑에서 피어오르는 먼지
    Collision.ts       AABB 저장소 + 합성 조회 (폐허·건축물 분리)
    StructureShell.ts  손으로 세운 구조물의 공용 뼈대 — 경사에 앉히는 규칙이 여기 한 번만 적혀 있다
    SeedVault.ts       종자고 — 이야기가 가리키는 문
    SurveyMast.ts      관측 첨탑 셋 — 오르면 그 일대가 나침반에 박힌다
    Greenhouse.ts      온실 잔해 — 흙과 마른 풀이 몰려 있다
    WaterTower.ts      급수탑 — 터진 탱크 밑에 빗물이 고여 있다
    Hangar.ts          정비 격납고 — 잔해 산더미, 대신 낮에 로봇이 깨어난다
  gameplay/
    Items.ts           아이템 정의
    Inventory.ts       12칸 인벤토리 + 핫바
    SurvivalStats.ts   체력·포만감·수분·체온·포자병
    Interaction.ts     E 하나로 통합된 상호작용 (채집·농사·물 뜨기)
    Placement.ts       밭 구획 배치 · 미리보기 · 회전
    Recipes.ts         제작 레시피 · 단계 게이팅
    Tools.ts           도구 마모와 부식
    Storage.ts         보관함 내용물 · 칸 이동 · 더미 합치기
    SaveState.ts       세이브 데이터 형태
    Legacy.ts          죽음을 넘어 남는 것 — 설계·기록·되살린 흙
  player/
    Gait.ts              보행 주기 모델 (관절별 위상 곡선)
    PlayerController.ts  이동 물리와 충돌 해결
    PlayerCharacter.ts   로우폴리 리그 + 절차적 애니메이션
    ThirdPersonCamera.ts 궤도 카메라 + 충돌 회피
  net/Api.ts            백엔드 클라이언트 (실패 시 localStorage로 대체)
  render/RenderContext.ts
  ui/                  HUD, 나침반, 제작·보관함·기록·도감 창, 공용 설명 상자, 오버레이
  util/                노이즈, 수학, 시드 난수, 상자 병합, 한국어 조사
server/
  index.js             HTTP API (node:http)
  db.js                저장소 (node:sqlite)
scripts/dev.mjs        프런트 + 백엔드 동시 실행
```
