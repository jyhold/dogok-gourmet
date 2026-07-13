import { NextRequest, NextResponse } from 'next/server';
import { syncNewRestaurants } from '@/lib/sheetSync';

// 카카오 신규 식당을 시트에 자동 추가.
// Vercel Cron이 하루 1회 호출(Authorization: Bearer ${CRON_SECRET} 자동 첨부).
// 수동 테스트: /api/sync?key=<CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const key = req.nextUrl.searchParams.get('key');
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const result = await syncNewRestaurants();
  return NextResponse.json(result);
}
