import { NextResponse } from 'next/server';
import { loadRestaurants } from '@/lib/sheet';

// 관리자DB(구글 시트) 전체 로드. 10분 캐시는 loadRestaurants 내부.
export async function GET() {
  try {
    const data = await loadRestaurants();
    return NextResponse.json({ count: data.length, restaurants: data });
  } catch (err) {
    console.error('[/api/restaurants]', err);
    return NextResponse.json({ error: '관리자DB 로드 실패' }, { status: 500 });
  }
}
