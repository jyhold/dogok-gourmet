'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Candidate, Mode, WeatherInfo } from '@/lib/types';
import { pickQuote, type FoodQuote } from '@/lib/quotes';
import ModeSelect from '@/components/ModeSelect';
import FilterPanel, { type FilterState } from '@/components/FilterPanel';
import SlotMachine from '@/components/SlotMachine';
import ResultCard from '@/components/ResultCard';
import Mascot from '@/components/Mascot';
import DotIcon from '@/components/DotIcon';
import { applyFilters, boostVisited, boostRecommended, weightedPick } from '@/lib/roulette';
import { COMPANY_COORDS } from '@/lib/geo';
import { track, trackVisitOnce } from '@/lib/clientTrack';
import { formatDetail } from '@/lib/stats';

type Screen = 'mode' | 'filter' | 'spinning' | 'result';

const LS_KEY = 'lunch-roulette-filter';

const DEFAULT_FILTER: FilterState = {
  priceTier: null,
  distance: 'bike',
  excludedSubs: [],
  prioritizeVisited: false,
};

function defaultMeal(): 'lunch' | 'dessert' {
  const h = new Date().getHours();
  // 오후 1시 이후엔 식후 후식 탭을 기본으로
  return h < 13 ? 'lunch' : 'dessert';
}

/**
 * 브라우저 현재 위치 조회 (후식 모드용). 거부·실패·타임아웃 시 군인공제회관 폴백.
 * @returns 좌표 + 폴백 여부
 */
function getPosition(): Promise<{ coords: { lat: number; lng: number }; fallback: boolean }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ coords: COMPANY_COORDS, fallback: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          fallback: false,
        }),
      () => resolve({ coords: COMPANY_COORDS, fallback: true }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

// ── 날씨 기반 추천 메뉴 (메인 하단 마스코트 말풍선) ──
const REC_WARM = ['국밥·탕', '라멘·우동', '칼국수', '짜장·짬뽕'];
const REC_COOL = ['냉면·갈비탕', '쌀국수·베트남', '샐러드·포케', '초밥·회'];
const REC_HEARTY = ['찌개·백반', '마라·훠궈', '고기구이', '돈카츠·카레', '샤브샤브'];
const REC_NICE = ['돈카츠·카레', '파스타·피자', '덮밥', '버거', '초밥·회', '쌀국수·베트남', '국수·우동'];

function recommendSub(w: WeatherInfo | null, hour: number): string {
  let list = REC_NICE;
  if (w && !w.unavailable) {
    if (w.badWeather || w.precipitationType !== 0) list = REC_WARM;
    else if (w.temperature != null && w.temperature >= 28) list = REC_COOL;
    else if (w.temperature != null && w.temperature <= 8) list = REC_HEARTY;
  }
  return list[hour % list.length];
}

const PTY_LABEL: Record<number, string> = {
  1: '비',
  2: '비/눈',
  3: '눈',
  4: '소나기',
  5: '빗방울',
  6: '진눈깨비',
  7: '눈날림',
};

function weatherLine(w: WeatherInfo | null): string {
  if (!w || w.unavailable) return '안녕! 오늘 뭐 먹을까요?';
  const temp = w.temperature != null ? `${w.temperature}℃` : '';
  if (w.precipitationType !== 0) {
    return `☔ 지금 ${PTY_LABEL[w.precipitationType] ?? '비'}${temp ? ` (${temp})` : ''} 와요`;
  }
  if (w.warnings.length > 0) {
    return `⚠️ ${w.warnings.join(', ')}${temp ? ` (${temp})` : ''}`;
  }
  const emoji =
    w.temperature != null && w.temperature >= 28
      ? '🔥'
      : w.temperature != null && w.temperature <= 8
        ? '❄️'
        : '☀️';
  return `${emoji} 지금 ${temp || '날씨'}, 좋아요!`;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('mode');
  const [mode, setMode] = useState<Mode | null>(null);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [toast, setToast] = useState<{ text: string; warn: boolean; rain?: boolean } | null>(
    null,
  );

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [winner, setWinner] = useState<Candidate | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [loading, setLoading] = useState(false);
  // 마운트 후에만 동적 씬(날씨·시각 기반) 렌더 → SSR 하이드레이션 불일치 방지
  const [mounted, setMounted] = useState(false);
  // 미식 명언 — 로드/새로고침마다 마운트 후 랜덤 확정(SSR 불일치 방지)
  const [quote, setQuote] = useState<FoodQuote | null>(null);

  // ── 초기화: 저장된 필터 복원 + 날씨 ──
  // 사내용이라 위치인식 미사용 — 항상 군인공제회관(고정 시작점) 기준.
  useEffect(() => {
    setMounted(true);
    setQuote(pickQuote());
    trackVisitOnce();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setFilter({ ...DEFAULT_FILTER, ...JSON.parse(raw) });
    } catch {
      /* noop */
    }

    // 날씨
    fetch('/api/weather')
      .then((r) => r.json())
      .then((w: WeatherInfo) => setWeather(w))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 악천후 시 거리를 택시로 자동 전환하던 기능은 v1.14에서 폐지.
  // 날씨는 안내(하단 마스코트 말풍선·비 마스코트)와 메뉴 추천에만 쓰고, 이동수단은 사용자가 고른 대로 둔다.

  const showToast = (text: string, warn: boolean, rain = false) => {
    setToast({ text, warn, rain });
    setTimeout(() => setToast(null), 3500);
  };

  // 필터 저장
  const updateFilter = (next: FilterState) => {
    // 거리(이동수단)는 서버가 만드는 후보 '집합'을 바꾼다 — 반경·행정구역·access_mode·거리가중.
    // 바뀌면 기존 풀을 버려 다음 spin이 새 반경으로 재fetch하게 한다(pickMode와 동일).
    // 예산·제외메뉴·인증우선은 프론트(applyFilters/boost)에서 걸러 재fetch가 필요 없다.
    if (next.distance !== filter.distance) {
      setCandidates([]);
      setSeenIds([]);
    }
    setFilter(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };

  // ── 통계 이벤트 (§11.4) — 실패해도 UX에 영향 없는 fire-and-forget ──
  const trackSpin = useCallback(
    (w: Candidate, isRespin: boolean) => {
      const isLunch = mode === 'lunch-solo' || mode === 'lunch-group';
      track('spin', {
        mode: mode ?? '',
        place: w.name,
        categorySub: w.categorySub,
        detail: formatDetail({
          respin: isRespin,
          // 예산·거리는 점심 전용 필터라 후식에선 빈 값(집계에서 자동 제외됨)
          price: isLunch ? filter.priceTier : '',
          dist: isLunch ? filter.distance : '',
          boost: filter.prioritizeVisited,
        }),
      });
    },
    [mode, filter],
  );

  const pickMode = (m: Mode) => {
    setMode(m);
    setScreen('filter');
    // 새 모드 = 세션 초기화
    setSeenIds([]);
    setCandidates([]);
  };

  // ── 후보 로드 ──
  // 점심: 서버가 군인공제회관 고정 시작점 사용 (/api/nearby).
  // 후식: 브라우저 현재 위치 반경 300m (/api/dessert). 권한 거부 시 군인공제회관 500m 폴백.
  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    if (!mode) return [];

    if (mode === 'dessert') {
      const { coords, fallback } = await getPosition();
      const params = new URLSearchParams({
        lat: String(coords.lat),
        lng: String(coords.lng),
      });
      const res = await fetch(`/api/dessert?${params}`);
      const data = await res.json();
      if (fallback || data.locationFallback) {
        showToast('📍 위치를 못 받아 군인공제회관 기준으로 찾았어요', false);
      } else if (data.expanded) {
        showToast('근처가 한산해 반경을 넓혔어요', false);
      }
      setCandidates(data.candidates ?? []);
      return data.candidates ?? [];
    }

    const params = new URLSearchParams({ mode, distance: filter.distance });
    const res = await fetch(`/api/nearby?${params}`);
    const data = await res.json();
    setCandidates(data.candidates ?? []);
    return data.candidates ?? [];
  }, [mode, filter.distance]);

  // ── 돌리기 ──
  const spin = useCallback(
    async (prevSeen: string[], isRespin = false) => {
      setLoading(true);
      let pool = candidates;
      // 후보 미로드거나 비었으면 로드
      if (pool.length === 0) {
        pool = await loadCandidates();
      }
      setLoading(false);

      // 예산·거리 필터는 점심 전용. 후식은 미적용(null/undefined).
      const isLunch = mode === 'lunch-solo' || mode === 'lunch-group';
      const priceTier = isLunch ? filter.priceTier : null;
      const distance = isLunch ? filter.distance : undefined;
      // 우선 부스트: 후식=추천(recommended), 그 외=방문(visited)
      const boost = (list: Candidate[]) =>
        mode === 'dessert'
          ? boostRecommended(list, filter.prioritizeVisited)
          : boostVisited(list, filter.prioritizeVisited);

      const available = applyFilters(pool, {
        excludedSubs: filter.excludedSubs,
        priceTier,
        distance,
        seenIds: prevSeen,
      });

      if (available.length === 0) {
        // 세션 소진 → seen 리셋 후 재시도 1회
        if (prevSeen.length > 0) {
          const reset = applyFilters(pool, {
            excludedSubs: filter.excludedSubs,
            priceTier,
            distance,
            seenIds: [],
          });
          if (reset.length > 0) {
            setSeenIds([]);
            const w = weightedPick(boost(reset))!;
            setWinner(w);
            setSeenIds([w.id]);
            setSpinKey((k) => k + 1);
            setScreen('spinning');
            trackSpin(w, isRespin);
            return;
          }
        }
        setWinner(null);
        setScreen('result');
        return;
      }

      const w = weightedPick(boost(available))!;
      setWinner(w);
      setSeenIds((s) => [...s, w.id]);
      setSpinKey((k) => k + 1);
      setScreen('spinning');
      trackSpin(w, isRespin);
    },
    [candidates, filter, mode, loadCandidates, trackSpin],
  );

  const startSpin = () => spin(seenIds, false);
  const reroll = () => {
    // 다시 돌리기 = 화면에 뜬 식당을 '반려'. spin이 새 winner로 덮기 전에 현재 식당을 기록.
    // 이 식당이 곧 기피 식당 카운트의 대상. fire-and-forget이라 UX 영향 없음.
    if (winner) {
      track('reject', { mode: mode ?? '', place: winner.name, categorySub: winner.categorySub });
    }
    spin(seenIds, true);
  };

  const pool = candidates;
  const recSub = mounted ? recommendSub(weather, new Date().getHours()) : REC_NICE[0];

  return (
    <main className="stage">
      <div className="title-bar">
        <h1>🍽️ 도곡한 미식가</h1>
        <p>오늘 뭐 먹지? 군인공제회관 앞 맛집 슬롯머신</p>
      </div>

      {screen === 'mode' && (
        <>
          <ModeSelect defaultMeal={defaultMeal()} onPick={pickMode} />
          {mounted && (
            <div className="mascot-scene">
              <div className="speech speech-lg">
                <div>{weatherLine(weather)}</div>
                <div className="rec-line">
                  오늘은 <DotIcon sub={recSub} size={22} /> <b>{recSub}</b> 어때요?
                </div>
              </div>
              <Mascot state={weather?.badWeather ? 'rain' : 'happy'} size={104} bounce />
              {quote && (
                <p className="food-quote">
                  “{quote.text}”
                  <span className="food-quote-author">— {quote.author}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {screen === 'filter' && mode && (
        <div>
          <button className="back-link" onClick={() => setScreen('mode')}>
            ← 모드 다시 고르기
          </button>
          <FilterPanel mode={mode} value={filter} onChange={updateFilter} />
          <div style={{ marginTop: 20 }}>
            {loading && (
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <Mascot state="happy" size={48} bounce />
              </div>
            )}
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={startSpin}
              disabled={loading}
            >
              {loading ? '후보 찾는 중…' : '🎰 돌리기!'}
            </button>
          </div>
        </div>
      )}

      {(screen === 'spinning' || screen === 'result') && winner && (
        <div>
          <button className="back-link" onClick={() => setScreen('filter')}>
            ← 필터 바꾸기
          </button>
          {screen === 'spinning' && (
            <SlotMachine
              pool={pool}
              winner={winner}
              spinKey={spinKey}
              onSpinEnd={() => setScreen('result')}
            />
          )}
          {screen === 'result' && (
            <ResultCard
              candidate={winner}
              mode={mode!}
              onReroll={reroll}
              canReroll={true}
            />
          )}
        </div>
      )}

      {screen === 'result' && !winner && (
        <div>
          <button className="back-link" onClick={() => setScreen('filter')}>
            ← 필터 바꾸기
          </button>
          <div className="mascot frame" style={{ padding: 30 }}>
            <Mascot state="sad" size={88} />
            <p style={{ marginTop: 10 }}>조건에 맞는 곳이 없어요</p>
            <p style={{ fontSize: 12 }}>제외 메뉴나 거리를 조정해보세요</p>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.warn ? 'warn' : ''}`}>
          <span className="toast-row">
            {toast.rain && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="toast-mascot"
                src="/assets/mascot/mascot-rain.png"
                alt=""
                width={28}
                height={28}
              />
            )}
            {toast.text}
          </span>
        </div>
      )}
    </main>
  );
}
