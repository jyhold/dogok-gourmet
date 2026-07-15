// ── 통계 이벤트 전송 (클라이언트) ───────────────────────────
// 기획서 §11.4. 절대 원칙: 실패해도 사용자 경험을 건드리지 않는다 (fire-and-forget).
'use client';

import type { StatEvent } from './stats';

const VISITOR_KEY = 'dogok-visitor';
const VISIT_SENT_KEY = 'dogok-visit-sent';

/**
 * 익명 방문자 ID — localStorage 난수. 개인정보·기기정보 일절 없음.
 * 지우면 새 사람으로 잡히는 수준의 느슨한 식별자(정확한 UV가 아님, §11.7).
 */
export function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v || !/^v-[a-z0-9]{6,32}$/.test(v)) {
      v = 'v-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    // 시크릿 모드 등 localStorage 차단 — 매번 새 ID (기록은 되되 UV는 부정확)
    return 'v-' + Math.random().toString(36).slice(2, 10) + 'x';
  }
}

export interface TrackArgs {
  mode?: string;
  place?: string;
  categorySub?: string;
  detail?: string;
}

/** 이벤트 전송. await 하지 말 것 — 응답을 기다릴 이유가 없다. */
export function track(event: StatEvent, args: TrackArgs = {}): void {
  try {
    const body = JSON.stringify({ event, visitor: visitorId(), ...args });
    // sendBeacon은 페이지를 떠나도 전송이 보장되고 메인 스레드를 막지 않는다.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 통계 실패는 조용히 무시 */
  }
}

/** 세션당 1회만 visit 기록 (새로고침마다 방문자가 늘지 않게) */
export function trackVisitOnce(): void {
  try {
    if (sessionStorage.getItem(VISIT_SENT_KEY)) return;
    sessionStorage.setItem(VISIT_SENT_KEY, '1');
  } catch {
    /* sessionStorage 없으면 그냥 매번 보냄 */
  }
  track('visit');
}
