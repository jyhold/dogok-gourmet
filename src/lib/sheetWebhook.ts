// ── Apps Script 웹훅 공용 호출부 ───────────────────────────
// 시트 쓰기는 전부 이 문을 통한다. 핵심은 **응답의 sheet를 반드시 확인**하는 것:
// 예전 doPost는 모르는 탭이 오면 에러 대신 restaurants로 조용히 폴백해서,
// coffee가 안 들어가는 문제와 관리자DB 오염 위험을 동시에 만들었다. 추정 금지, 확인만 믿는다.

export type WebhookMode = 'append' | 'replace';

export interface WebhookResult {
  ok: boolean;
  /** Apps Script가 '실제로 썼다'고 응답한 탭. 요청과 다르면 실패로 친다 */
  wroteTo?: string;
  added?: number;
  replaced?: number;
  error?: string;
}

/**
 * 한 번에 보낼 최대 행 수. 격자 스캔은 2,000행 넘게 나올 수 있는데 통째로 보내면
 * POST 본문이 수백 KB가 되고 Apps Script 실행 시간(6분)에 가까워진다 → 나눠 보낸다.
 */
const CHUNK = 500;

/** 대량 append를 CHUNK 단위로 나눠 보낸다. 중간 실패 시 '몇 행까지 들어갔는지' 사실대로 반환. */
export async function postRowsChunked(sheet: string, rows: string[][]): Promise<WebhookResult> {
  let added = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await postRows(sheet, rows.slice(i, i + CHUNK), 'append');
    if (!res.ok) {
      return {
        ...res,
        added,
        error: `${res.error} (${added}/${rows.length}행까지 들어간 뒤 중단)`,
      };
    }
    added += res.added ?? 0;
  }
  return { ok: true, wroteTo: sheet, added };
}

/**
 * 시트에 행 쓰기.
 * @param sheet 대상 탭 — Apps Script ALLOWED에 있어야 한다
 * @param mode append=끝에 붙이기 / replace=헤더 빼고 전체 교체(candidates 전용)
 */
export async function postRows(
  sheet: string,
  rows: string[][],
  mode: WebhookMode = 'append',
): Promise<WebhookResult> {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, sheet, mode, rows }),
    });
    if (!res.ok) return { ok: false, error: `웹훅 ${res.status}` };

    const j = (await res.json().catch(() => ({}))) as {
      added?: number;
      replaced?: number;
      sheet?: string;
      error?: string;
    };
    if (j.error) return { ok: false, error: `웹훅 응답: ${j.error}` };

    // ★ 어디에 썼는지 확인. 다르면 Apps Script가 구버전(조용한 폴백)이라는 신호.
    if (j.sheet !== sheet) {
      return {
        ok: false,
        wroteTo: j.sheet ?? '(응답에 sheet 없음)',
        error:
          `요청한 '${sheet}'가 아니라 '${j.sheet ?? '?'}'에 기록됨 — Apps Script가 구버전입니다. ` +
          `docs/sheet-sync-setup.md의 최신 doPost로 교체 후 '새 배포'하세요. ` +
          `(그 탭 마지막 행들을 확인·삭제하세요)`,
      };
    }

    const n = mode === 'replace' ? j.replaced : j.added;
    if (typeof n !== 'number') {
      return {
        ok: false,
        wroteTo: j.sheet,
        error: `웹훅 응답에 ${mode === 'replace' ? 'replaced' : 'added'} 없음 — Apps Script가 ${mode} 모드를 모릅니다(구버전)`,
      };
    }
    return { ok: true, wroteTo: j.sheet, added: j.added, replaced: j.replaced };
  } catch (err) {
    return { ok: false, error: `웹훅 호출 실패: ${(err as Error).message}` };
  }
}
