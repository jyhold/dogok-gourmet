import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { aggregate, toKstStamp, stampToDate } from '@/lib/stats';
import { loadStats, invalidateStatsCache } from '@/lib/statsSheet';
import { writeStat, sinkStatus } from '@/lib/statsSink';

// ── 관리자 통계 조회 (기획서 §11.6) ─────────────────────────
// POST로만 받는다 — 키가 URL·브라우저 기록·리퍼러에 남지 않도록.
// 페이지는 공개지만 데이터는 이 라우트가 지킨다.

/** 길이 노출까지 막는 상수시간 비교 */
function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // 길이가 달라도 동일 시간 소비 (자기 자신과 비교 후 false)
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.STATS_KEY ?? '';
  if (!expected) {
    return NextResponse.json({ error: 'STATS_KEY 미설정 — 환경변수를 먼저 넣으세요' }, { status: 500 });
  }

  let body: { key?: string; selftest?: boolean; refresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  if (!keyMatches(body.key ?? '', expected)) {
    return NextResponse.json({ error: '키가 올바르지 않습니다' }, { status: 401 });
  }

  // 셀프테스트: stats 탭에 프로브 1행을 실제로 써보고 '어디에 쓰였는지' 확인한다.
  // Apps Script가 구버전이면 restaurants로 폴백되므로, 켜기 전에 이걸로 먼저 검증한다.
  if (body.selftest) {
    const res = await writeStat(
      { event: 'visit', visitor: 'v-selftest0', mode: '', place: '(셀프테스트)', detail: 'selftest=1' },
      true, // STATS_ENABLED/프로덕션 가드 우회 — 검증이 목적
    );
    invalidateStatsCache();
    return NextResponse.json({
      selftest: res,
      hint: res.ok
        ? 'stats 탭에 정상 기록됨. 이제 STATS_ENABLED=TRUE로 켜세요. (이 프로브 행은 지워도 됩니다)'
        : `실패 — ${res.wroteTo ? `'${res.wroteTo}' 탭에 쓰였습니다. 그 탭 마지막 행을 삭제하세요.` : ''}`,
    });
  }

  if (body.refresh) invalidateStatsCache();

  try {
    const rows = await loadStats();
    const today = stampToDate(toKstStamp(new Date()))!;
    return NextResponse.json({
      summary: aggregate(rows, today),
      today,
      health: {
        enabled: (process.env.STATS_ENABLED ?? '').toUpperCase() === 'TRUE',
        mock: (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE',
        ...sinkStatus(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `stats 탭을 읽지 못했습니다 — ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
