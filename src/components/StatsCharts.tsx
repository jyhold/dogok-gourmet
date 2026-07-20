'use client';

import { useState } from 'react';
import type { Counted, StatsSummary } from '@/lib/stats';

// ── 차트 팔레트 ───────────────────────────────────────────
// 앱의 Tiny Town 파스텔(--tomato/--sky/--mustard)은 UI 장식용이라 마크로 쓰면
// 밝기·채도·대비 검증에 전부 걸린다(회색으로 읽히거나 배경과 안 갈림).
// → 같은 색상 계열을 마크용으로 진하게 스냅한 값. dataviz 검증기 4개 항목 통과:
//   밝기대역 PASS · 채도하한 PASS · 색각 분리 PASS(최악 인접쌍 ΔE 19.0 protan) · 대비 PASS(≥3:1)
export const CHART = {
  tomato: '#c24a37', // = --tomato-dark (앱 토큰 그대로)
  sky: '#1b7fb5',
  leaf: '#4f7d3f', // 단일 계열(크기) 막대 전용
  gold: '#a06a00',
};

/** 모드 색은 '순위'가 아니라 '대상'에 고정한다 — 정렬이 바뀌어도 색이 따라 움직이면 안 됨 */
const MODE_COLOR: Record<string, string> = {
  'lunch-solo': CHART.tomato,
  'lunch-group': CHART.sky,
  dessert: CHART.gold,
};
const MODE_LABEL: Record<string, string> = {
  'lunch-solo': '🍜 혼밥',
  'lunch-group': '👥 점심약속',
  dessert: '🍰 커피/디저트',
};

export const pct = (v: number) => `${Math.round(v * 100)}%`;

// ── 가로 막대 (단일 계열 = 크기 비교) ────────────────────
export function BarList({
  items,
  color = CHART.leaf,
  label,
  empty = '아직 기록이 없어요',
  max = 8,
}: {
  items: Counted[];
  color?: string;
  label?: (key: string) => string;
  empty?: string;
  max?: number;
}) {
  if (items.length === 0) return <p className="hint">{empty}</p>;
  const top = items.slice(0, max);
  const peak = Math.max(...top.map((i) => i.count), 1);
  const total = items.reduce((a, b) => a + b.count, 0);

  return (
    <div className="bar-list">
      {top.map((i) => (
        <div className="bar-row" key={i.key} title={`${label ? label(i.key) : i.key}: ${i.count}회 (${pct(i.count / total)})`}>
          <span className="bar-label">{label ? label(i.key) : i.key}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(i.count / peak) * 100}%`, background: color }} />
          </span>
          <span className="bar-val">
            {i.count}
            <span className="bar-pct">{pct(i.count / total)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 일별 추이 (2계열 = 방문자·룰렛) ───────────────────────
// 계열이 2개 → 범례 필수(색만으로 식별시키지 않는다) + 표 보기 제공
export function DailyChart({ daily }: { daily: StatsSummary['daily'] }) {
  const [asTable, setAsTable] = useState(false);
  if (daily.length === 0) return <p className="hint">아직 기록이 없어요</p>;

  const peak = Math.max(...daily.flatMap((d) => [d.visitors, d.spins]), 1);
  const days = daily.slice(-14); // 최근 2주

  return (
    <>
      <div className="chart-head">
        <div className="legend">
          <span className="lg"><i style={{ background: CHART.sky }} />방문자</span>
          <span className="lg"><i style={{ background: CHART.tomato }} />룰렛</span>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => setAsTable((v) => !v)}>
          {asTable ? '그래프로' : '표로'}
        </button>
      </div>

      {asTable ? (
        <table className="stat-table">
          <thead>
            <tr><th>날짜</th><th>방문자</th><th>룰렛</th></tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date}>
                <td>{d.date.slice(5)}</td>
                <td>{d.visitors}</td>
                <td>{d.spins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="daily">
          {days.map((d) => (
            <div className="day" key={d.date}>
              <div className="day-bars">
                <span
                  className="vbar"
                  style={{ height: `${(d.visitors / peak) * 100}%`, background: CHART.sky }}
                  title={`${d.date} 방문자 ${d.visitors}명`}
                />
                <span
                  className="vbar"
                  style={{ height: `${(d.spins / peak) * 100}%`, background: CHART.tomato }}
                  title={`${d.date} 룰렛 ${d.spins}회`}
                />
              </div>
              <span className="day-label">{d.date.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ModeChart({ byMode }: { byMode: Counted[] }) {
  if (byMode.length === 0) return <p className="hint">아직 기록이 없어요</p>;
  const peak = Math.max(...byMode.map((i) => i.count), 1);
  const total = byMode.reduce((a, b) => a + b.count, 0);
  return (
    <div className="bar-list">
      {byMode.map((m) => (
        <div className="bar-row" key={m.key} title={`${MODE_LABEL[m.key] ?? m.key}: ${m.count}회`}>
          <span className="bar-label">{MODE_LABEL[m.key] ?? (m.key || '(모드 없음)')}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(m.count / peak) * 100}%`, background: MODE_COLOR[m.key] ?? CHART.leaf }}
            />
          </span>
          <span className="bar-val">
            {m.count}
            <span className="bar-pct">{pct(m.count / total)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function TopPlaces({ places }: { places: StatsSummary['topPlaces'] }) {
  if (places.length === 0) return <p className="hint">아직 기록이 없어요</p>;
  const peak = Math.max(...places.map((p) => p.count), 1);
  return (
    <table className="stat-table top-places">
      <thead>
        <tr>
          <th>#</th><th>가게</th><th>당첨</th>
        </tr>
      </thead>
      <tbody>
        {places.map((p, i) => (
          <tr key={p.key}>
            <td className="rank">{i + 1}</td>
            <td>
              <span className="place-name">{p.key || '(이름 없음)'}</span>
              <span className="mini-track">
                <span className="mini-fill" style={{ width: `${(p.count / peak) * 100}%`, background: CHART.leaf }} />
              </span>
            </td>
            <td>{p.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 신고 TOP 매장 (폐점·점심영업X 제보) ────────────────────
// 사용자가 결과 카드에서 신고한 문제 매장. 사유(폐점/점심X/기타)를 분해해
// 관리자가 룰렛에서 수기 제외할 대상을 고르게 한다. 경고색 tomato.
export function TopReported({ reported }: { reported: StatsSummary['topReported'] }) {
  if (reported.length === 0) return <p className="hint">아직 신고가 없어요</p>;
  const peak = Math.max(...reported.map((p) => p.count), 1);
  const num = (n: number) => (n > 0 ? n : <span className="hint">-</span>);
  return (
    <table className="stat-table top-places">
      <thead>
        <tr>
          <th>#</th><th>가게</th><th>신고</th><th>폐점</th><th>점심X</th><th>기타</th>
        </tr>
      </thead>
      <tbody>
        {reported.map((p, i) => (
          <tr key={p.key}>
            <td className="rank">{i + 1}</td>
            <td>
              <span className="place-name">{p.key || '(이름 없음)'}</span>
              <span className="mini-track">
                <span className="mini-fill" style={{ width: `${(p.count / peak) * 100}%`, background: CHART.tomato }} />
              </span>
            </td>
            <td>{p.count}</td>
            <td>{num(p.closed)}</td>
            <td>{num(p.noLunch)}</td>
            <td>{num(p.other)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 기피 식당 (다시 돌리기로 버려진 횟수) ──────────────────
// 버림 횟수만으론 '많이 노출돼 많이 버려진 것'과 '적게 나왔는데 버려진 것'이 안 갈린다.
// 노출(당첨) 대비 기피율을 함께 보여줘 수기 제외 판단을 돕는다. 경고 뉘앙스라 tomato.
export function TopRejected({ rejected }: { rejected: StatsSummary['topRejected'] }) {
  if (rejected.length === 0) return <p className="hint">아직 버려진 기록이 없어요</p>;
  const peak = Math.max(...rejected.map((p) => p.count), 1);
  return (
    <table className="stat-table top-places">
      <thead>
        <tr>
          <th>#</th><th>가게</th><th>버림</th><th>노출</th><th>기피율</th>
        </tr>
      </thead>
      <tbody>
        {rejected.map((p, i) => (
          <tr key={p.key}>
            <td className="rank">{i + 1}</td>
            <td>
              <span className="place-name">{p.key || '(이름 없음)'}</span>
              <span className="mini-track">
                <span className="mini-fill" style={{ width: `${(p.count / peak) * 100}%`, background: CHART.tomato }} />
              </span>
            </td>
            <td>{p.count}</td>
            <td>{p.spins > 0 ? p.spins : <span className="hint">-</span>}</td>
            <td>{p.spins > 0 ? pct(p.rate) : <span className="hint">-</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
