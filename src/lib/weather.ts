import type { WeatherInfo } from './types';

// ── 기상청 초단기실황 + 특보 + 악천후 판정 (병목 4) ──────────
// 지역 고정(양재/강남 경계)이라 격자 좌표 상수 하나로 처리 → 위경도 변환 생략.
const GRID_NX = 61;
const GRID_NY = 125;

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

// 날씨는 자주 안 바뀜 → 30분 캐시
const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { data: WeatherInfo; at: number } | null = null;

/** 초단기실황 base_time 계산: 매시 40분 이후 해당 정시 조회 가능. */
function baseDateTime(now: Date): { baseDate: string; baseTime: string } {
  const d = new Date(now.getTime());
  // 40분 전이면 한 시간 전 정시 사용
  if (d.getMinutes() < 40) d.setHours(d.getHours() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return { baseDate: `${yyyy}${mm}${dd}`, baseTime: `${hh}00` };
}

interface KmaItem {
  category: string;
  obsrValue: string;
}

async function fetchNcst(): Promise<{ pty: number; t1h: number | null }> {
  const key = process.env.KMA_SERVICE_KEY;
  if (!key) throw new Error('KMA_SERVICE_KEY 미설정');

  const { baseDate, baseTime } = baseDateTime(new Date());
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '10',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(GRID_NX),
    ny: String(GRID_NY),
  });
  const res = await fetch(
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?${params}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`기상청 실황 실패: ${res.status}`);
  const json = (await res.json()) as {
    response?: { body?: { items?: { item?: KmaItem[] } } };
  };
  const items = json.response?.body?.items?.item ?? [];
  let pty = 0;
  let t1h: number | null = null;
  for (const it of items) {
    if (it.category === 'PTY') pty = Number(it.obsrValue) || 0;
    if (it.category === 'T1H') t1h = Number(it.obsrValue);
  }
  return { pty, t1h };
}

const PTY_LABEL: Record<number, string> = {
  1: '비',
  2: '비/눈',
  3: '눈',
  4: '소나기',
  5: '빗방울',
  6: '빗방울/눈날림',
  7: '눈날림',
};

function buildInfo(pty: number, t1h: number | null, warnings: string[]): WeatherInfo {
  // 사용자에게 보이는 날씨 문구는 프론트(page.tsx weatherLine)가 만든다.
  // 예전엔 여기서 '이동수단을 택시로 바꿨어요' 메시지를 만들었지만 자동 전환이 폐지되며 함께 제거(v1.14).
  return {
    precipitationType: pty,
    temperature: t1h,
    warnings,
    badWeather: pty !== 0 || warnings.length > 0,
    unavailable: false,
  };
}

/** 현재 날씨 + 악천후 판정. 실패 시 조용히 비활성(unavailable). */
export async function getWeather(): Promise<WeatherInfo> {
  if (useMock()) {
    // mock: 맑음 (악천후 시나리오 테스트는 ?mockBad=1로)
    return buildInfo(0, 27, []);
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  try {
    const { pty, t1h } = await fetchNcst();
    // 특보는 별도 API — Phase 2에서 getWthrWrnList 연동. 우선 실황만.
    const info = buildInfo(pty, t1h, []);
    cache = { data: info, at: Date.now() };
    return info;
  } catch (err) {
    console.error('[weather] 실패, 기능 비활성:', err);
    return {
      precipitationType: 0,
      temperature: null,
      warnings: [],
      badWeather: false,
      unavailable: true,
    };
  }
}
