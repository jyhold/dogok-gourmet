import { NextRequest, NextResponse } from 'next/server';
import type { DistanceMode, Mode } from '@/lib/types';
import { buildCandidates } from '@/lib/candidates';
import { COMPANY_COORDS } from '@/lib/geo';

// 점심 전용 (후식은 /api/dessert). 저녁 모드 폐지.
type LunchMode = Extract<Mode, 'lunch-solo' | 'lunch-group'>;
const VALID_MODES: LunchMode[] = ['lunch-solo', 'lunch-group'];
const VALID_DIST: DistanceMode[] = ['walk', 'bike', 'taxi'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') as LunchMode;
  const distance = (sp.get('distance') ?? 'bike') as DistanceMode;

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: 'mode 파라미터 오류' }, { status: 400 });
  }
  if (!VALID_DIST.includes(distance)) {
    return NextResponse.json({ error: 'distance 파라미터 오류' }, { status: 400 });
  }

  // 점심: 시작점은 항상 군인공제회관 고정 (위치인식 미사용)
  const center = COMPANY_COORDS;

  try {
    const { candidates } = await buildCandidates(center, mode, distance);
    return NextResponse.json({
      center,
      count: candidates.length,
      candidates,
    });
  } catch (err) {
    console.error('[/api/nearby]', err);
    return NextResponse.json({ error: '후보 구성 실패' }, { status: 500 });
  }
}
