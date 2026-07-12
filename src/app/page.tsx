'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate, Mode, WeatherInfo } from '@/lib/types';
import ModeSelect from '@/components/ModeSelect';
import FilterPanel, { type FilterState } from '@/components/FilterPanel';
import SlotMachine from '@/components/SlotMachine';
import ResultCard from '@/components/ResultCard';
import Mascot from '@/components/Mascot';
import DotIcon from '@/components/DotIcon';
import { applyFilters, boostVisited, weightedPick } from '@/lib/roulette';

type Screen = 'mode' | 'filter' | 'spinning' | 'result';

const LS_KEY = 'lunch-roulette-filter';

const DEFAULT_FILTER: FilterState = {
  priceTier: null,
  distance: 'bike',
  excludedSubs: [],
  prioritizeVisited: false,
};

function defaultMeal(): 'lunch' | 'dinner' {
  const h = new Date().getHours();
  return h < 14 ? 'lunch' : 'dinner';
}

// ── 날씨 기반 추천 메뉴 (메인 하단 마스코트 말풍선) ──
const REC_WARM = ['국밥·탕', '라멘·우동', '면류(칼국수·냉면)', '짜장·짬뽕'];
const REC_COOL = ['면류(칼국수·냉면)', '쌀국수·베트남', '샐러드·포케', '초밥·회'];
const REC_HEARTY = ['찌개·백반', '마라·훠궈', '고기구이', '돈카츠·카레'];
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

  const weatherAppliedRef = useRef(false);
  const distanceTouchedRef = useRef(false);

  // ── 초기화: 저장된 필터 복원 + 날씨 ──
  // 사내용이라 위치인식 미사용 — 항상 군인공제회관(고정 시작점) 기준.
  useEffect(() => {
    setMounted(true);
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

  // ── 악천후 자동 전환 (사용자가 거리 안 만졌을 때만) ──
  useEffect(() => {
    if (!weather || weatherAppliedRef.current) return;
    weatherAppliedRef.current = true;
    if (weather.badWeather && !distanceTouchedRef.current) {
      setFilter((f) => ({ ...f, distance: 'taxi' }));
      showToast(weather.message ?? '☔ 악천후 — 택시로 전환했어요', true, true);
    }
  }, [weather]);

  const showToast = (text: string, warn: boolean, rain = false) => {
    setToast({ text, warn, rain });
    setTimeout(() => setToast(null), 3500);
  };

  // 필터 저장
  const updateFilter = (next: FilterState) => {
    if (next.distance !== filter.distance) distanceTouchedRef.current = true;
    setFilter(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };

  const pickMode = (m: Mode) => {
    setMode(m);
    setScreen('filter');
    // 새 모드 = 세션 초기화
    setSeenIds([]);
    setCandidates([]);
  };

  // ── 후보 로드 (모드·거리 조합. 시작점은 서버가 군인공제회관 고정) ──
  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    if (!mode) return [];
    const params = new URLSearchParams({ mode, distance: filter.distance });
    const res = await fetch(`/api/nearby?${params}`);
    const data = await res.json();
    if (mode === 'dinner-team' && data.teamFallback) {
      showToast('단체석 등록 업장이 적어 미확인 보조 후보를 포함했어요', false);
    }
    setCandidates(data.candidates ?? []);
    return data.candidates ?? [];
  }, [mode, filter.distance]);

  // ── 돌리기 ──
  const spin = useCallback(
    async (prevSeen: string[]) => {
      setLoading(true);
      let pool = candidates;
      // 후보 미로드거나 비었으면 로드
      if (pool.length === 0) {
        pool = await loadCandidates();
      }
      setLoading(false);

      const available = applyFilters(pool, {
        excludedSubs: filter.excludedSubs,
        priceTier: mode === 'lunch-solo' || mode === 'lunch-group' ? filter.priceTier : null,
        seenIds: prevSeen,
      });

      if (available.length === 0) {
        // 세션 소진 → seen 리셋 후 재시도 1회
        if (prevSeen.length > 0) {
          const reset = applyFilters(pool, {
            excludedSubs: filter.excludedSubs,
            priceTier:
              mode === 'lunch-solo' || mode === 'lunch-group' ? filter.priceTier : null,
            seenIds: [],
          });
          if (reset.length > 0) {
            setSeenIds([]);
            const w = weightedPick(boostVisited(reset, filter.prioritizeVisited))!;
            setWinner(w);
            setSeenIds([w.id]);
            setSpinKey((k) => k + 1);
            setScreen('spinning');
            return;
          }
        }
        setWinner(null);
        setScreen('result');
        return;
      }

      const w = weightedPick(boostVisited(available, filter.prioritizeVisited))!;
      setWinner(w);
      setSeenIds((s) => [...s, w.id]);
      setSpinKey((k) => k + 1);
      setScreen('spinning');
    },
    [candidates, filter, mode, loadCandidates],
  );

  const startSpin = () => spin(seenIds);
  const reroll = () => spin(seenIds);

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
