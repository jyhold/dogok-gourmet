import { NextRequest, NextResponse } from 'next/server';
import { getWeather } from '@/lib/weather';
import type { WeatherInfo } from '@/lib/types';

export async function GET(req: NextRequest) {
  // 개발용: ?mockBad=1 이면 악천후 시나리오 강제 (mock 모드 UI 확인)
  if (req.nextUrl.searchParams.get('mockBad') === '1') {
    const bad: WeatherInfo = {
      precipitationType: 1,
      temperature: 19,
      warnings: [],
      badWeather: true,
      unavailable: false,
    };
    return NextResponse.json(bad);
  }
  const info = await getWeather();
  return NextResponse.json(info);
}
