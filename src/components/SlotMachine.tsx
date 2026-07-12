'use client';

import { useEffect, useRef, useState } from 'react';
import type { Candidate } from '@/lib/types';
import DotIcon from './DotIcon';

const CELL_H = 92;
const SPIN_MS = 2600;

interface Props {
  /** 릴을 채울 후보 풀 (연출용) */
  pool: Candidate[];
  /** 당첨 후보 */
  winner: Candidate;
  /** 스핀 시작 트리거 (변할 때마다 새 스핀) */
  spinKey: number;
  onSpinEnd: () => void;
}

/** 릴 셀 배열 구성: 랜덤 셀 다수 + 끝부분에 당첨 셀 */
function buildReel(pool: Candidate[], winner: Candidate): Candidate[] {
  const cells: Candidate[] = [];
  const src = pool.length > 0 ? pool : [winner];
  for (let i = 0; i < 28; i++) {
    cells.push(src[Math.floor(Math.random() * src.length)]);
  }
  cells.push(winner); // index 28 = 당첨 정지 위치
  cells.push(src[Math.floor(Math.random() * src.length)]);
  return cells;
}

export default function SlotMachine({ pool, winner, spinKey, onSpinEnd }: Props) {
  const reelRef = useRef<HTMLDivElement>(null);
  const [cells, setCells] = useState<Candidate[]>([]);
  const [showSparkle, setShowSparkle] = useState(false);
  const winnerIndex = 28;

  useEffect(() => {
    const reel = reelRef.current;
    if (!reel) return;

    const newCells = buildReel(pool, winner);
    setCells(newCells);
    setShowSparkle(false);

    // 1) 즉시 상단으로 리셋 (트랜지션 없이)
    reel.style.transition = 'none';
    reel.style.transform = 'translateY(0)';
    // 강제 리플로우 → 다음 프레임에 감속 스핀
    void reel.offsetHeight;

    const raf = requestAnimationFrame(() => {
      reel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
      reel.style.transform = `translateY(-${winnerIndex * CELL_H}px)`;
    });

    const timer = setTimeout(() => {
      setShowSparkle(true);
      onSpinEnd();
    }, SPIN_MS + 60);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  return (
    <div className="slot-machine frame">
      <div className="slot-window">
        <div className="slot-reel" ref={reelRef}>
          {cells.map((c, i) => (
            <div className="slot-cell" key={`${c.id}-${i}`}>
              <DotIcon sub={c.categorySub} size={56} tile />
              <span className="name">{c.name}</span>
            </div>
          ))}
        </div>
        {showSparkle && (
          <>
            <span className="sparkle" style={{ left: '18%', top: '20%' }}>✨</span>
            <span className="sparkle" style={{ left: '78%', top: '30%' }}>⭐</span>
            <span className="sparkle" style={{ left: '50%', top: '12%' }}>💥</span>
          </>
        )}
      </div>
    </div>
  );
}
