'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StatsSummary } from '@/lib/stats';
import { BarList, DailyChart, ModeChart, TopPlaces, TopRejected, TopReported, pct } from '@/components/StatsCharts';
import Mascot from '@/components/Mascot';

// ── 관리자 통계 대시보드 (기획서 §11) ───────────────────────
// 페이지 자체는 공개지만 데이터는 /api/stats가 지킨다. 키는 POST 본문으로만 보내
// URL·브라우저 기록·리퍼러에 남지 않게 한다.

const SS_KEY = 'dogok-stats-key';

interface Health {
  enabled: boolean;
  mock: boolean;
  poisoned: boolean;
  reason: string;
}
interface StatsRes {
  summary: StatsSummary;
  today: string;
  health: Health;
}

const PRICE_LABEL: Record<string, string> = { 가성비: '가성비', 보통: '일반', 플렉스: '플렉스' };
const DIST_LABEL: Record<string, string> = { walk: '🚶 도보', bike: '🚲 따릉이', taxi: '🚕 택시' };

export default function StatsPage() {
  const [key, setKey] = useState('');
  const [data, setData] = useState<StatsRes | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [selftest, setSelftest] = useState<string | null>(null);

  const load = useCallback(async (k: string, refresh = false) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: k, refresh }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? '불러오지 못했어요');
        setData(null);
        if (res.status === 401) sessionStorage.removeItem(SS_KEY);
        return;
      }
      sessionStorage.setItem(SS_KEY, k);
      setData(j);
    } catch {
      setErr('네트워크 오류');
    } finally {
      setBusy(false);
    }
  }, []);

  // 세션에 키가 있으면 자동 로드 (새로고침마다 재입력하지 않도록)
  useEffect(() => {
    const saved = sessionStorage.getItem(SS_KEY);
    if (saved) {
      setKey(saved);
      void load(saved);
    }
  }, [load]);

  const runSelftest = async () => {
    setBusy(true);
    setSelftest(null);
    try {
      const res = await fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, selftest: true }),
      });
      const j = await res.json();
      setSelftest(
        j.selftest?.ok
          ? `✅ ${j.hint}`
          : `✖ ${j.selftest?.error ?? j.selftest?.skipped ?? '실패'}\n${j.hint ?? ''}`,
      );
    } finally {
      setBusy(false);
    }
  };

  // ── 잠금 화면 ──
  if (!data) {
    return (
      <main className="stage">
        <div className="title-bar">
          <h1>📊 도곡한 미식가 통계</h1>
          <p>관리자 전용</p>
        </div>
        <div className="frame gate">
          <Mascot state={err ? 'sad' : 'happy'} size={72} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(key);
            }}
          >
            <label className="gate-label" htmlFor="stats-key">
              관리자 키
            </label>
            <input
              id="stats-key"
              className="gate-input"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="STATS_KEY"
              autoComplete="current-password"
              autoFocus
            />
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !key}>
              {busy ? '확인 중…' : '들어가기'}
            </button>
          </form>
          {err && <p className="gate-err">{err}</p>}
        </div>
      </main>
    );
  }

  const s = data.summary;
  const h = data.health;

  return (
    <main className="stage stats-page">
      <div className="title-bar">
        <h1>📊 도곡한 미식가 통계</h1>
        <p>
          {data.today} 기준 · 총 {s.totalRows}건
          {s.lastEventAt && ` · 마지막 기록 ${s.lastEventAt.slice(4, 6)}/${s.lastEventAt.slice(6, 8)} ${s.lastEventAt.slice(9, 11)}:${s.lastEventAt.slice(11, 13)}`}
        </p>
      </div>

      <div className="stats-actions">
        <button className="btn btn-ghost btn-xs" onClick={() => load(key, true)} disabled={busy}>
          {busy ? '…' : '↻ 새로고침'}
        </button>
        <button className="btn btn-ghost btn-xs" onClick={runSelftest} disabled={busy}>
          🔧 수집 셀프테스트
        </button>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => {
            sessionStorage.removeItem(SS_KEY);
            setData(null);
            setKey('');
          }}
        >
          잠그기
        </button>
      </div>

      {selftest && <pre className="selftest">{selftest}</pre>}

      {h.mock && (
        <p className="banner">🧪 mock 모드 — 아래는 가짜 데이터입니다 (USE_MOCK=TRUE)</p>
      )}
      {!h.mock && !h.enabled && (
        <p className="banner warn">
          ⚠️ 수집이 꺼져 있습니다 — 새 기록이 쌓이지 않아요. 셀프테스트를 통과한 뒤 Vercel 환경변수에
          <b> STATS_ENABLED=TRUE</b>를 넣고 재배포하세요.
        </p>
      )}
      {h.poisoned && <p className="banner warn">🚨 {h.reason}</p>}

      {/* 요약 — 차트가 아니라 숫자 그 자체가 답인 지표들 */}
      <div className="kpi-grid">
        <Kpi label="누적 방문자" value={s.visitors} unit="명" />
        <Kpi label="오늘 방문자" value={s.visitorsToday} unit="명" />
        <Kpi label="총 룰렛" value={s.spins} unit="회" />
        <Kpi label="누적 신고" value={s.reports} unit="건" />
        <Kpi label="지도 클릭율" value={pct(s.mapRate)} sub={`${s.maps}/${s.spins}`} />
        <Kpi label="재추첨률" value={pct(s.respinRate)} sub={`${s.respins}/${s.spins}`} />
        <Kpi label="기피율" value={pct(s.rejectRate)} sub={`${s.rejects}/${s.spins}`} />
      </div>

      <Section title="📈 일별 추이" hint="최근 14일">
        <DailyChart daily={s.daily} />
      </Section>

      <Section title="🎰 모드별 룰렛">
        <ModeChart byMode={s.byMode} />
      </Section>

      <Section title="🏆 당첨 TOP 10">
        <TopPlaces places={s.topPlaces} />
      </Section>

      <Section title="🚨 신고 TOP 매장" hint="폐점·점심 미영업 신고 · 수기 제외 판단용">
        <TopReported reported={s.topReported} />
      </Section>

      <Section title="🚫 기피 식당 TOP 10" hint="다시 돌리기로 버려진 횟수 · 기피율=버림÷노출">
        <TopRejected rejected={s.topRejected} />
      </Section>

      <Section title="🍽️ 카테고리 분포">
        <BarList items={s.byCategory} />
      </Section>

      <Section title="⚙️ 필터 사용">
        <div className="filter-grid">
          <div>
            <div className="sub-label">예산 (점심)</div>
            <BarList items={s.byPrice} label={(k) => PRICE_LABEL[k] ?? k} empty="선택 없음" max={4} />
          </div>
          <div>
            <div className="sub-label">거리 (점심)</div>
            <BarList items={s.byDistance} label={(k) => DIST_LABEL[k] ?? k} empty="선택 없음" max={4} />
          </div>
          <div>
            <div className="sub-label">인증·추천 우선</div>
            <BarList
              items={[
                { key: '켬', count: s.prioritize.on },
                { key: '끔', count: s.prioritize.off },
              ].filter((i) => i.count > 0)}
              max={2}
            />
          </div>
        </div>
      </Section>

      <p className="hint" style={{ marginTop: 24, textAlign: 'center' }}>
        방문자는 브라우저에 저장된 익명 난수로 구분해요 — 개인정보는 수집하지 않습니다.
      </p>
    </main>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: number | string; unit?: string; sub?: string }) {
  return (
    <div className="kpi frame">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="stat-section frame">
      <div className="section-title">
        {title}
        {hint && <span className="hint"> {hint}</span>}
      </div>
      {children}
    </section>
  );
}
