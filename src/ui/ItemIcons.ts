import type { ItemId } from '../gameplay/Items';

/**
 * 아이템 아이콘.
 *
 * 칸에 글자를 적으면 "흙"인지 "물"인지 읽어야 알 수 있다. 급할 때는 못 읽는다.
 * 모양은 읽지 않아도 알아본다 — 그래서 전부 그림으로 바꾼다.
 *
 * 외부 이미지를 쓰지 않고 SVG 로 그린다. 파일이 늘지 않고, 어느 해상도에서도
 * 뭉개지지 않으며, 색을 CSS 로 바꿔 끼울 수 있다.
 *
 * `currentColor` 를 쓰는 곳은 아이템 고유색이 들어간다 (칸에서 color 를 준다).
 */

const ICONS: Record<ItemId, string> = {
  // 찌그러진 금속판 두 장
  scrap: `<path d="M3 15l6-9 5 3-2 4 7-2 2 5-11 3z" fill="currentColor" opacity=".85"/>
    <path d="M3 15l6-9 5 3" fill="none" stroke="#0006" stroke-width="1.2"/>`,

  // 흙무더기 — 알갱이가 섞인 둔덕
  soil: `<path d="M2 18c2-5 5-7 10-7s8 2 10 7z" fill="currentColor"/>
    <circle cx="9" cy="14" r="1.3" fill="#0004"/><circle cx="14" cy="15.5" r="1" fill="#0004"/>
    <circle cx="11.5" cy="17" r=".9" fill="#0003"/>`,

  // 고인 빗물 — 웅덩이와 파문
  stagnantWater: `<ellipse cx="12" cy="15" rx="9" ry="5" fill="currentColor" opacity=".9"/>
    <ellipse cx="12" cy="14.4" rx="5" ry="2.6" fill="none" stroke="#fff5" stroke-width="1"/>
    <ellipse cx="12" cy="13.8" rx="2" ry="1" fill="#fff6"/>`,

  // 통조림 — 뚜껑이 딴 깡통
  cannedFood: `<rect x="7" y="7" width="10" height="13" rx="1.4" fill="currentColor"/>
    <ellipse cx="12" cy="7" rx="5" ry="1.8" fill="#fff3"/>
    <path d="M8 11h8M8 14h8" stroke="#0004" stroke-width="1.2"/>`,

  // 씨앗 — 눈물 모양 둘
  seed: `<path d="M10 20c-4-3-4-9 0-13 4 4 4 10 0 13z" fill="currentColor"/>
    <path d="M15.5 18c-2.6-2-2.6-6 0-8.5 2.6 2.5 2.6 6.5 0 8.5z" fill="currentColor" opacity=".6"/>`,

  // 종자고 열쇠 — 잎 모양 손잡이가 달린 인증 키
  vaultKey: `<circle cx="8" cy="9" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M8 4.8c2.4 1.6 2.4 4.6 0 6.2-2.4-1.6-2.4-4.6 0-6.2z" fill="currentColor" opacity=".55"/>
    <path d="M11 12l8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M16 17l2.4-2.4M18.4 19.4l2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,

  // 의문의 물체 — 육각 결정과 빛
  relic: `<path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" fill="currentColor" opacity=".9"/>
    <path d="M12 8l3.5 2.2v4.4L12 16.8 8.5 14.6v-4.4z" fill="#fff8"/>
    <path d="M12 3v5M12 17v4" stroke="#fff6" stroke-width="1"/>`,

  // 수확물 — 이삭
  crop: `<path d="M12 21V9" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 9c0-3 2-5 4-5 0 3-1.6 5-4 5zM12 9c0-3-2-5-4-5 0 3 1.6 5 4 5z" fill="currentColor"/>
    <path d="M12 14c0-2.4 1.7-4 3.4-4 0 2.4-1.4 4-3.4 4zM12 14c0-2.4-1.7-4-3.4-4 0 2.4 1.4 4 3.4 4z"
      fill="currentColor" opacity=".7"/>`,

  // 곡괭이
  pickaxe: `<path d="M4 8c5-4 11-4 16 0" fill="none" stroke="currentColor" stroke-width="2.6"
      stroke-linecap="round"/>
    <path d="M12 6.2L11 21" stroke="#8a6b45" stroke-width="2.2" stroke-linecap="round"/>`,

  // 물뿌리개
  wateringCan: `<rect x="6" y="9" width="9" height="9" rx="1.6" fill="currentColor"/>
    <path d="M15 11l5-3v8l-5-2z" fill="currentColor" opacity=".75"/>
    <path d="M7 9c0-3 5-3 5 0" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="20" cy="19" r="1" fill="#7fb6d9"/><circle cx="18" cy="21" r=".8" fill="#7fb6d9"/>`,

  // 빗물 집수기 — 깔때기와 통
  rainCollector: `<path d="M4 5h16l-5 6H9z" fill="currentColor" opacity=".8"/>
    <rect x="8" y="11" width="8" height="9" rx="1.2" fill="currentColor"/>
    <path d="M8 16h8" stroke="#0004" stroke-width="1.2"/>`,

  // 방벽 — 쌓은 블록
  wall: `<rect x="3" y="7" width="18" height="4.2" rx=".6" fill="currentColor"/>
    <rect x="3" y="12.6" width="18" height="4.2" rx=".6" fill="currentColor" opacity=".8"/>
    <path d="M9 7v4.2M15 12.6v4.2M12 7v4.2" stroke="#0005" stroke-width="1"/>`,

  // 잔해 함정 — 마주 선 톱니
  trap: `<path d="M3 17h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M5 16l2-5 2 5 2-5 2 5 2-5 2 5z" fill="currentColor"/>
    <path d="M6 8.5l2 4 2-4 2 4 2-4 2 4" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linejoin="round" opacity=".7"/>`,

  // 퇴비 더미 — 테를 두른 통 안에 삭은 더미, 위로 새싹
  compostBin: `<path d="M4 11h16v7a2 2 0 01-2 2H6a2 2 0 01-2-2z" fill="currentColor"/>
    <path d="M3.4 10h17.2v2H3.4z" fill="currentColor" opacity=".65"/>
    <path d="M6 14.5c1.6-1.2 4-1.8 6-1.8s4.4.6 6 1.8" fill="none" stroke="#2b2314" stroke-width="1.3"/>
    <path d="M12 10V6" stroke="#8fae5a" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M12 7c0-2 1.6-3.2 3-3.2 0 2-1.2 3.2-3 3.2zM12 8.4c0-1.7-1.4-2.8-2.6-2.8 0 1.7 1 2.8 2.6 2.8z"
      fill="#8fae5a"/>`,

  // 여닫이 문 — 문틀과 살짝 열린 문짝
  gate: `<path d="M4 3v18M20 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M4 3h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M6.5 5h8v15h-8z" fill="currentColor" opacity=".75"/>
    <circle cx="12.6" cy="13" r="1" fill="#0007"/>`,

  // 화톳불
  campfire: `<path d="M12 4c3 4 4 6 4 8a4 4 0 11-8 0c0-2 1-4 4-8z" fill="currentColor"/>
    <path d="M12 10c1.4 2 2 3 2 4a2 2 0 11-4 0c0-1 .6-2 2-4z" fill="#ffe08a"/>
    <path d="M5 20l14-3M19 20L5 17" stroke="#7a5c3a" stroke-width="1.8" stroke-linecap="round"/>`,

  // 작업대
  workbench: `<rect x="3" y="8" width="18" height="3" rx=".6" fill="currentColor"/>
    <path d="M5 11v9M19 11v9" stroke="currentColor" stroke-width="2"/>
    <path d="M6 15h12" stroke="currentColor" stroke-width="1.4" opacity=".7"/>
    <path d="M13 5l4 3-4 1z" fill="#9aa2ab"/>`,

  // 보관함
  storageBox: `<rect x="3" y="9" width="18" height="10" rx="1.2" fill="currentColor"/>
    <rect x="3" y="7" width="18" height="3" rx="1" fill="currentColor" opacity=".75"/>
    <rect x="10.6" y="11" width="2.8" height="4" rx=".6" fill="#0005"/>`,

  // 구운 보리 — 그을린 알곡 더미
  roastedCrop: `<path d="M4 17c1.5-3 4.5-4.5 8-4.5s6.5 1.5 8 4.5z" fill="currentColor"/>
    <ellipse cx="8.5" cy="14.6" rx="1.5" ry="1.1" fill="#5a3a1c" opacity=".7"/>
    <ellipse cx="13" cy="13.8" rx="1.5" ry="1.1" fill="#5a3a1c" opacity=".55"/>
    <path d="M9 8.5c-.8-1.3 0-2.4 0-3.4M12.5 8c-.8-1.3 0-2.4 0-3.4"
      fill="none" stroke="#fff6" stroke-width="1.1" stroke-linecap="round"/>`,

  // 보리죽 — 김이 오르는 그릇
  grainStew: `<path d="M3 12h18c0 5-4 8.5-9 8.5S3 17 3 12z" fill="currentColor"/>
    <path d="M3 12h18" stroke="#0004" stroke-width="1.2"/>
    <ellipse cx="9" cy="14.5" rx="1.3" ry=".9" fill="#8a6a34" opacity=".8"/>
    <ellipse cx="14" cy="15.5" rx="1.1" ry=".8" fill="#8a6a34" opacity=".6"/>
    <path d="M9 8.5c-1-1.5 0-2.8 0-3.8M13 8c-1-1.5 0-2.8 0-3.8"
      fill="none" stroke="#fff7" stroke-width="1.2" stroke-linecap="round"/>`,

  // 식물 도감 — 잎이 그려진 책
  codex: `<path d="M4 4h7v16H4z" fill="currentColor" opacity=".85"/>
    <path d="M13 4h7v16h-7z" fill="currentColor" opacity=".6"/>
    <path d="M12 3.4v17.2" stroke="#0006" stroke-width="1.4"/>
    <path d="M16.5 14c0-2.6 1.8-4.4 3.4-4.4 0 2.6-1.6 4.4-3.4 4.4z" fill="#e8f0c8"/>
    <path d="M6 8h4M6 11h3" stroke="#fff8" stroke-width="1.1"/>`,

  // 마른 풀 — 묶어 세운 풀단
  driedGrass: `<path d="M12 21c-1-5-1-10 .5-17M12 21c-3-4-5-8-6-13M12 21c3-4 5-8 6-13M12 21c-1.6-4-3.6-7-6-9M12 21c1.6-4 3.6-7 6-9"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M7.5 16.5h9" stroke="#6b5a2e" stroke-width="2" stroke-linecap="round"/>`,

  // 끓인 물 — 김이 오르는 잔
  boiledWater: `<path d="M6 10h11v6a5 5 0 01-5 5H11a5 5 0 01-5-5z" fill="currentColor"/>
    <path d="M17 11.5h2.4a2 2 0 010 4H17" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M9.5 7c-1-1.4 0-2.6 0-3.6M12.5 7c-1-1.4 0-2.6 0-3.6M15 7.4c-.8-1.1 0-2 0-2.8"
      fill="none" stroke="#fff7" stroke-width="1.2" stroke-linecap="round"/>`,

  // 포자 억제제 — 약병
  medicine: `<rect x="9" y="3" width="6" height="3" rx=".8" fill="currentColor" opacity=".7"/>
    <path d="M8 6h8v11a4 4 0 01-4 4 4 4 0 01-4-4z" fill="currentColor"/>
    <path d="M12 10v6M9 13h6" stroke="#fff9" stroke-width="1.6" stroke-linecap="round"/>`,

  // 설계도
  blueprint: `<rect x="4" y="4" width="16" height="16" rx="1.4" fill="currentColor" opacity=".85"/>
    <path d="M7 8h10M7 12h6M7 16h8" stroke="#fff9" stroke-width="1.3"/>`,

  // 강화 곡괭이 — 날이 두껍고 빛난다
  hardenedPickaxe: `<path d="M3 8c5.5-4.5 12.5-4.5 18 0" fill="none" stroke="currentColor"
      stroke-width="3.4" stroke-linecap="round"/>
    <path d="M12 6L11 21" stroke="#8a6b45" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M17 3.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="#ffe9a8"/>`,
};

/** 24×24 좌표계의 SVG 마크업 */
export function itemIcon(id: ItemId): string {
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">${ICONS[id]}</svg>`;
}
