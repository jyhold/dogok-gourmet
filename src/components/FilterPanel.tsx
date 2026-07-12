'use client';

import type { DistanceMode, Mode, PriceTier } from '@/lib/types';
import { CATEGORY_TREE } from '@/lib/categories';

export interface FilterState {
  priceTier: PriceTier | null;
  distance: DistanceMode;
  excludedSubs: string[];
  /** 미식가 방문 인증 맛집을 룰렛에서 우선(가중치↑) */
  prioritizeVisited: boolean;
}

interface Props {
  mode: Mode;
  value: FilterState;
  onChange: (next: FilterState) => void;
}

const PRICE_OPTIONS: { tier: PriceTier; label: string }[] = [
  { tier: '가성비', label: '가성비 ~1만' },
  { tier: '보통', label: '보통 2~3만' },
  { tier: '플렉스', label: '플렉스 3만~' },
];

const DIST_OPTIONS: { d: DistanceMode; label: string }[] = [
  { d: 'walk', label: '🚶 도보 1.3km' },
  { d: 'bike', label: '🚲 따릉이 2km' },
  { d: 'taxi', label: '🚕 택시 5km' },
];

export default function FilterPanel({ mode, value, onChange }: Props) {
  // 번개모임/팀회식은 예산 필터 숨김/잠금 (기획서 §2 #9)
  const showPrice = mode === 'lunch-solo' || mode === 'lunch-group';

  const toggleSub = (sub: string) => {
    const has = value.excludedSubs.includes(sub);
    onChange({
      ...value,
      excludedSubs: has
        ? value.excludedSubs.filter((s) => s !== sub)
        : [...value.excludedSubs, sub],
    });
  };

  return (
    <div>
      <button
        type="button"
        className="check-row"
        role="checkbox"
        aria-checked={value.prioritizeVisited}
        onClick={() => onChange({ ...value, prioritizeVisited: !value.prioritizeVisited })}
      >
        <span className="check-box">{value.prioritizeVisited ? '✓' : ''}</span>
        <span className="check-text">
          ⭐ 미식가 인증 맛집 우선
          <span className="check-desc">직접 방문·검증한 맛집이 더 잘 나와요</span>
        </span>
      </button>

      {showPrice && (
        <>
          <div className="section-label">💰 예산</div>
          <div className="row">
            {PRICE_OPTIONS.map((p) => (
              <button
                key={p.tier}
                className="chip"
                aria-pressed={value.priceTier === p.tier}
                onClick={() =>
                  onChange({
                    ...value,
                    priceTier: value.priceTier === p.tier ? null : p.tier,
                  })
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
      {mode === 'dinner-team' && (
        <p className="hint" style={{ textAlign: 'left', marginTop: 8 }}>
          🍻 팀회식: 인당 5만+α · 단체석 업장만 후보
        </p>
      )}
      {mode === 'dinner-flash' && (
        <p className="hint" style={{ textAlign: 'left', marginTop: 8 }}>
          ⚡ 번개모임: 가격 무관 전체 후보
        </p>
      )}

      <div className="section-label">🚦 거리 (이동수단)</div>
      <div className="row">
        {DIST_OPTIONS.map((o) => (
          <button
            key={o.d}
            className="chip"
            aria-pressed={value.distance === o.d}
            onClick={() => onChange({ ...value, distance: o.d })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="section-label">🚫 제외 메뉴 (탭해서 빼기)</div>
      {CATEGORY_TREE.map((cat) => (
        <div key={cat.main} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
            {cat.main}
          </div>
          <div className="row">
            {cat.subs.map((sub) => (
              <button
                key={sub}
                className="chip excluded"
                aria-pressed={value.excludedSubs.includes(sub)}
                onClick={() => toggleSub(sub)}
              >
                {sub}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
