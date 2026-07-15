// ── 통계 이벤트 쓰기 (구글 시트 stats 탭) ──────────────────
// 기획서 §11.2 — 기존 Apps Script는 허용 목록에 없는 탭이 오면 '에러 대신 restaurants로 폴백'한다.
// 그 상태로 stats를 보내면 방문할 때마다 관리자DB가 오염된다. 그래서 3중으로 잠근다:
//   1) STATS_ENABLED=TRUE 여야 쓴다 (셀프테스트 통과 후 사람이 켬)
//   2) 개발 환경에서는 쓰지 않는다 (로컬 테스트가 통계를 오염시키지 않게)
//   3) 응답의 sheet가 'stats'가 아니면 즉시 영구 비활성화 — 한 번 잘못 가면 더는 안 보낸다
import { buildStatsRow, type TrackInput } from './stats';

export interface SinkResult {
  ok: boolean;
  /** 웹훅이 실제로 쓴 탭 (Apps Script 응답 그대로) */
  wroteTo?: string;
  error?: string;
  skipped?: string;
}

const TARGET_TAB = 'stats';

/**
 * 잘못된 탭에 쓴 사실이 확인되면 켜지는 차단 플래그.
 * 서버리스 인스턴스 수명 동안 유지 — 콜드스타트마다 초기화되지만,
 * 그래도 '한 인스턴스가 계속 오염시키는' 최악은 막는다.
 */
let poisoned = false;
let poisonReason = '';

export function sinkStatus(): { poisoned: boolean; reason: string } {
  return { poisoned, reason: poisonReason };
}

function enabled(): boolean {
  return (process.env.STATS_ENABLED ?? '').toUpperCase() === 'TRUE';
}

/** 프로덕션에서만 기록 (로컬 dev 트래픽이 통계에 섞이지 않도록) */
function isProd(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

/**
 * 이벤트 1건을 stats 탭에 append.
 * @param force 셀프테스트용 — STATS_ENABLED/프로덕션 가드를 우회 (poisoned 차단은 우회 못 함)
 */
export async function writeStat(e: TrackInput, force = false): Promise<SinkResult> {
  if (poisoned) return { ok: false, error: `차단됨: ${poisonReason}` };
  if (!force) {
    if (!enabled()) return { ok: false, skipped: 'STATS_ENABLED 아님' };
    if (!isProd()) return { ok: false, skipped: '개발 환경' };
  }

  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };

  const row = buildStatsRow(e, new Date());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, sheet: TARGET_TAB, rows: [row] }),
    });
    if (!res.ok) return { ok: false, error: `웹훅 ${res.status}` };

    const j = (await res.json().catch(() => ({}))) as {
      added?: number;
      sheet?: string;
      error?: string;
    };
    if (j.error) return { ok: false, error: `웹훅 응답: ${j.error}` };

    // ★ 핵심 방어 — 어디에 썼는지 반드시 확인한다. 추정 금지.
    if (j.sheet !== TARGET_TAB) {
      poisoned = true;
      poisonReason =
        `웹훅이 '${j.sheet ?? '(응답 없음)'}' 탭에 씀 — Apps Script의 ALLOWED에 'stats'가 없어 ` +
        `restaurants로 폴백했을 가능성. 그 탭의 마지막 행을 확인·삭제하고, docs/sheet-sync-setup.md의 ` +
        `최신 doPost로 교체 후 새 배포하세요. (이후 기록은 중단됨)`;
      console.error('[stats] 🚨', poisonReason);
      return { ok: false, wroteTo: j.sheet, error: poisonReason };
    }
    if (typeof j.added !== 'number') {
      return { ok: false, error: '웹훅 응답에 added 없음 — Apps Script 배포 버전 확인 필요' };
    }
    return { ok: true, wroteTo: j.sheet };
  } catch (err) {
    return { ok: false, error: `웹훅 호출 실패: ${(err as Error).message}` };
  }
}
