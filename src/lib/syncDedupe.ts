// ── 시트 자동 동기화 공용 중복 판정 (식당·후식 공용) ──
// 기존 버그: 중복 판정이 (이름 관련) AND (좌표 50m 이내)를 모두 요구해
//   ① 좌표가 50m만 어긋나도(관리자 수기 좌표·다른 지오코딩) 중복을 놓치고,
//   ② 좌표/카테고리 누락으로 파서에서 스킵된 시트 행은 비교 대상(existing)에서 빠져
//      매일 재추가되는 문제가 있었다.
// → 정규화 이름 완전일치는 거리 무관하게 중복 처리 + 좌표 허용치 완화 + 이름-only 행도 커버.
import { haversineMeters } from './geo';

/** 상호 핵심어 정규화 (공백·지점 접미사 제거) — 중복 판정용 */
export function normName(s: string): string {
  return (s ?? '').replace(/\s|점$|본점|지점|역점/g, '');
}

/** 부분일치(지점 구분)일 때 같은 업장으로 볼 좌표 허용치(m). 기존 50m → 완화 */
export const DUP_DISTANCE_M = 150;

/** 중복 비교 대상 한 건. 좌표는 없을 수 있음(파서 스킵/수기 등록 행). */
export interface KnownPlace {
  name: string;
  lat?: number;
  lng?: number;
}

/**
 * 신규 후보가 기존 목록과 중복인가.
 * - 정규화 이름 **완전일치** → 거리 무관 중복 (좌표 없는 행도 커버 → 원인 ②)
 * - 이름 **부분일치** → 좌표가 있는 기존과 `DUP_DISTANCE_M` 이내면 중복 (지점 구분, 완화된 원인 ①)
 */
export function isDuplicatePlace(
  cand: { name: string; lat: number; lng: number },
  existing: KnownPlace[],
): boolean {
  const cn = normName(cand.name);
  for (const e of existing) {
    if (cn && normName(e.name) === cn) return true;
    const sub = e.name.includes(cand.name) || cand.name.includes(e.name);
    if (
      sub &&
      e.lat != null &&
      e.lng != null &&
      haversineMeters({ lat: e.lat, lng: e.lng }, { lat: cand.lat, lng: cand.lng }) <= DUP_DISTANCE_M
    ) {
      return true;
    }
  }
  return false;
}
