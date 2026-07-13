import { NextRequest, NextResponse } from 'next/server';
import { syncNewRestaurants, pingWebhook } from '@/lib/sheetSync';

// 카카오 신규 식당을 시트에 자동 추가.
// Vercel Cron이 하루 1회 호출(Authorization: Bearer ${CRON_SECRET} 자동 첨부).
// 수동 테스트: /api/sync?key=<CRON_SECRET>
// 웹훅 쓰기 점검: /api/sync?key=<CRON_SECRET>&ping=1 (테스트 행 1개 추가)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const key = req.nextUrl.searchParams.get('key');
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (req.nextUrl.searchParams.get('ping') === '1') {
    return NextResponse.json(await pingWebhook());
  }

  const result = await syncNewRestaurants();
  return NextResponse.json(result);
}
