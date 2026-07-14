'use client';

import { useState } from 'react';
import type { Mode } from '@/lib/types';

interface Props {
  /** 시각 기준 기본 탭 (lunch/dessert) */
  defaultMeal: 'lunch' | 'dessert';
  onPick: (mode: Mode) => void;
}

const LUNCH_MODES = [
  { mode: 'lunch-solo' as Mode, emoji: '🍜', name: '혼밥', desc: '1인 좌석·빠른 회전 우대' },
  { mode: 'lunch-group' as Mode, emoji: '👥', name: '점심약속', desc: '동료·거래처와 함께' },
];

export default function ModeSelect({ defaultMeal, onPick }: Props) {
  const [meal, setMeal] = useState<'lunch' | 'dessert'>(defaultMeal);

  return (
    <div>
      <div className="tab-row">
        <button
          className="tab"
          aria-selected={meal === 'lunch'}
          onClick={() => setMeal('lunch')}
        >
          🍚 점심
        </button>
        <button
          className="tab"
          aria-selected={meal === 'dessert'}
          onClick={() => setMeal('dessert')}
        >
          🍰 후식
        </button>
      </div>

      {meal === 'lunch' ? (
        <div className="grid-2">
          {LUNCH_MODES.map((m) => (
            <button key={m.mode} className="mode-card frame" onClick={() => onPick(m.mode)}>
              <span className="emoji">{m.emoji}</span>
              <span className="mode-name">{m.name}</span>
              <span className="mode-desc">{m.desc}</span>
            </button>
          ))}
        </div>
      ) : (
        // 후식은 하위 분기 없이 단일 카드 → 바로 필터로
        <div className="grid-1">
          <button className="mode-card frame" onClick={() => onPick('dessert')}>
            <span className="emoji">🍰</span>
            <span className="mode-name">후식</span>
            <span className="mode-desc">점심 후 내 주변 카페·디저트</span>
          </button>
        </div>
      )}

      <p className="hint">
        지금 {defaultMeal === 'lunch' ? '점심' : '후식'} 시간대로 열었어요 · 탭으로 전환 가능
      </p>
    </div>
  );
}
