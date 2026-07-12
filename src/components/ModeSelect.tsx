'use client';

import { useState } from 'react';
import type { Mode } from '@/lib/types';

interface Props {
  /** 시각 기준 기본 식사 (lunch/dinner) */
  defaultMeal: 'lunch' | 'dinner';
  onPick: (mode: Mode) => void;
}

const LUNCH_MODES = [
  { mode: 'lunch-solo' as Mode, emoji: '🍜', name: '혼밥', desc: '1인 좌석·빠른 회전 우대' },
  { mode: 'lunch-group' as Mode, emoji: '👥', name: '점심약속', desc: '동료·거래처와 함께' },
];
const DINNER_MODES = [
  { mode: 'dinner-flash' as Mode, emoji: '⚡', name: '번개모임', desc: '소수 지인, 가격 무관' },
  { mode: 'dinner-team' as Mode, emoji: '🍻', name: '팀회식', desc: '인당 5만+α, 단체석' },
];

export default function ModeSelect({ defaultMeal, onPick }: Props) {
  const [meal, setMeal] = useState<'lunch' | 'dinner'>(defaultMeal);
  const modes = meal === 'lunch' ? LUNCH_MODES : DINNER_MODES;

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
          aria-selected={meal === 'dinner'}
          onClick={() => setMeal('dinner')}
        >
          🌙 저녁
        </button>
      </div>

      <div className="grid-2">
        {modes.map((m) => (
          <button key={m.mode} className="mode-card frame" onClick={() => onPick(m.mode)}>
            <span className="emoji">{m.emoji}</span>
            <span className="mode-name">{m.name}</span>
            <span className="mode-desc">{m.desc}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        지금 {defaultMeal === 'lunch' ? '점심' : '저녁'} 시간대로 열었어요 · 탭으로 전환 가능
      </p>
    </div>
  );
}
