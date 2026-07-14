import { NextRequest, NextResponse } from 'next/server';
import { syncNewRestaurants, pingWebhook } from '@/lib/sheetSync';
import { syncNewCafes } from '@/lib/coffeeSync';

// 카카오 신규 매장을 시트에 자동 추가 (식당 + 후식 카페 동시).
// Vercel Cron이 하루 1회 호출(Authorization: Bearer ${CRON_SECRET} 자동 첨부).
// 수동 테스트: /api/sync?key=<CRON_SECRET>
// 웹훅 쓰기 점검: /api/sync?key=<CRON_SECRET>&ping=1 (restaurants 탭 테스트 행)
//                /api/sync?key=<CRON_SECRET>&ping=coffee (coffee 탭 테스트 행)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const key = req.nextUrl.searchParams.get('key');
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const ping = req.nextUrl.searchParams.get('ping');
  if (ping === '1' || ping === 'restaurants') {
    return NextResponse.json(await pingWebhook('restaurants'));
  }
  if (ping === 'coffee') {
    return NextResponse.json(await pingWebhook('coffee'));
  }

  // 식당(FD6, 4개구) + 후식 카페(CE7, 1km) 동시 동기화
  const [restaurants, coffee] = await Promise.all([
    syncNewRestaurants(),
    syncNewCafes(),
  ]);
  return NextResponse.json({ restaurants, coffee });
}
