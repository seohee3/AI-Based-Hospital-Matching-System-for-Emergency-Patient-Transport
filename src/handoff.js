// ─────────────────────────────────────────────────────────────
// A04 가 끝나면 "다음 담당자"가 이어서 개발할 수 있도록 넘겨주는 값입니다.
// 보고서 전체는 저장/전달하지 않고, 아래 두 값만 전달합니다.
//
//   {
//     ktas: 1~5 (number),
//     requiredFacilities: string[]   src/constants.js 의 FACILITIES 중 선택된 것 (0~3개)
//                                     예) ['중환자실', '심혈관센터']
//   }
//
// 사용법 (다음 담당자):
//   import { subscribeHandoff, getHandoff } from './src/handoff';
//   subscribeHandoff((payload) => { ... });   // A04 의 '병원 매칭 및 호출' 버튼이 눌릴 때마다 호출됨
//   getHandoff();                              // 마지막으로 전달된 값 (없으면 null)
//
// 화면 전환이 필요하면 App.js 의 handleHandoff() 안 TODO 위치에서 setScreen('...') 하세요.
// ─────────────────────────────────────────────────────────────
let current = null;
const listeners = new Set();

export function sendHandoff({ ktas, requiredFacilities }) {
  current = Object.freeze({ ktas, requiredFacilities: [...requiredFacilities] });
  listeners.forEach((fn) => fn(current));
  return current;
}

export function getHandoff() {
  return current;
}

export function subscribeHandoff(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
