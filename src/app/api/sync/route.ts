import { NextRequest, NextResponse } from 'next/server';
import { syncNewRestaurants, pingWebhook, SCAN_RADIUS_M } from '@/lib/sheetSync';
import { syncNewCafes } from '@/lib/coffeeSync';

// 카카오 신규 매장 자동 발견 (식당 → candidates 예비 시트 / 후식 카페 → coffee).
// Vercel Cron이 하루 1회 호출(Authorization: Bearer ${CRON_SECRET} 자동 첨부).
//
// 식당은 격자 스캔(scanAll)이라 API 호출이 수백 회·수 초 걸린다. Hobby 함수 상한이 300초라 여유.
//
// 수동 테스트: /api/sync?key=<CRON_SECRET>
//   드라이런:  /api/sync?key=<CRON_SECRET>&dry=1   ← 시트에 쓰지 않고 '신규 몇 곳인지'만 확인
//   웹훅 점검: /api/sync?key=<CRON_SECRET>&ping=candidates|restaurants|coffee
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
  if (ping === '1' || ping === 'restaurants') return NextResponse.json(await pingWebhook('restaurants'));
  if (ping === 'coffee') return NextResponse.json(await pingWebhook('coffee'));
  if (ping === 'candidates') return NextResponse.json(await pingWebhook('candidates'));

  // 드라이런: 스캔·중복판정만 하고 시트엔 손대지 않는다 (탭·Apps Script 준비 전 점검용)
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  if (dry) {
    return NextResponse.json({ candidates: await syncNewRestaurants(SCAN_RADIUS_M, true), dry: true });
  }

  // 식당(FD6 격자 스캔 → candidates 예비 시트) + 후식 카페(CE7, 1km → coffee)
  const [candidates, coffee] = await Promise.all([syncNewRestaurants(), syncNewCafes()]);
  return NextResponse.json({ candidates, coffee });
}
