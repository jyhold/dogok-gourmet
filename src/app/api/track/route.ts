import { NextRequest, NextResponse } from 'next/server';
import { STAT_EVENTS, type StatEvent, type TrackInput } from '@/lib/stats';
import { writeStat } from '@/lib/statsSink';

// ── 통계 이벤트 수집 (기획서 §11.4) ─────────────────────────
// 클라이언트가 fire-and-forget으로 호출. 실패해도 사용자 경험에 영향 없어야 하므로
// 어떤 경우에도 200을 돌려주고, 결과는 본문에만 담는다.
// 시크릿은 서버에만 있고 클라이언트는 이 라우트만 안다.

export async function POST(req: NextRequest) {
  let body: Partial<TrackInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' });
  }

  const event = body.event as StatEvent;
  if (!STAT_EVENTS.includes(event)) {
    return NextResponse.json({ ok: false, error: 'bad event' });
  }
  // visitor는 클라이언트가 만든 익명 난수 — 개인정보 아님. 형식만 최소 검증.
  const visitor = (body.visitor ?? '').trim();
  if (!/^v-[a-z0-9]{6,32}$/.test(visitor)) {
    return NextResponse.json({ ok: false, error: 'bad visitor' });
  }

  const res = await writeStat({
    event,
    visitor,
    mode: body.mode,
    place: body.place,
    categorySub: body.categorySub,
    detail: body.detail,
  });

  // skipped(비활성/개발환경)는 정상 — 조용히 넘긴다.
  return NextResponse.json(res);
}
