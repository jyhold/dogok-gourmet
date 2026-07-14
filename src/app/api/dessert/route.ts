import { NextRequest, NextResponse } from 'next/server';
import type { Coords } from '@/lib/types';
import { buildDessertCandidates } from '@/lib/candidates';
import { COMPANY_COORDS, inServiceArea } from '@/lib/geo';

/**
 * 후식 후보 검색 — 현재 위치 반경 500m (부족 시 1km 확장).
 * GET ?lat=&lng= : 유효한 좌표면 그 위치 기준, 없거나 서비스 지역 밖이면 군인공제회관 폴백.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get('lat'));
  const lng = Number(sp.get('lng'));

  let center: Coords = COMPANY_COORDS;
  let usedFallback = true;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const coords = { lat, lng };
    if (inServiceArea(coords)) {
      center = coords;
      usedFallback = false;
    }
  }

  try {
    const { candidates, expanded, radius } = await buildDessertCandidates(center);
    return NextResponse.json({
      center,
      // 위치를 못 받아 군인공제회관 기준으로 폴백했는지 (프론트 안내용)
      locationFallback: usedFallback,
      expanded,
      radius,
      count: candidates.length,
      candidates,
    });
  } catch (err) {
    console.error('[/api/dessert]', err);
    return NextResponse.json({ error: '후식 후보 구성 실패' }, { status: 500 });
  }
}
