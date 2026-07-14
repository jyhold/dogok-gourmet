'use client';

import type { Candidate, Mode } from '@/lib/types';
import DotIcon from './DotIcon';

interface Props {
  candidate: Candidate;
  mode: Mode;
  onReroll: () => void;
  canReroll: boolean;
}

/** 네이버지도에서 상호 검색 (모바일은 네이버지도 앱 연결 유도) */
function naverMapUrl(c: Candidate): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(c.name)}`;
}

/** 미식가 평점(0~10) → 별 5개. 채움 = clamp(rating/2 - i, 0, 1) → 반개 지원. */
function StarRating({ rating }: { rating: number }) {
  const stars = rating / 2; // 0~5
  return (
    <span className="stars" aria-label={`10점 만점에 ${rating}점`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, stars - i));
        return (
          <span className="star" key={i}>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
            ★
          </span>
        );
      })}
    </span>
  );
}

/** 이동수단 안내 라벨. accessMode(관리자 지정)가 있으면 그 수단으로 표기, 없으면 도보 예상 분 */
function accessLine(c: Candidate) {
  if (c.accessMode === 'taxi') return <>🚕 택시 이동 (약 {c.distanceM}m)</>;
  if (c.accessMode === 'bike') return <>🚲 따릉이 이동 (약 {c.distanceM}m)</>;
  return (
    <>
      📍 도보 <b>{c.walkMinutes}분</b> (약 {c.distanceM}m)
    </>
  );
}

export default function ResultCard({ candidate: c, mode, onReroll, canReroll }: Props) {
  const isDessert = mode === 'dessert';
  const priceText = c.priceNote ?? c.priceTier;

  return (
    <div className="result-card frame">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <DotIcon sub={c.categorySub} size={44} />
        <div>
          <div className="cat">
            {c.categoryMain} · {c.categorySub}
          </div>
          <h2>{c.name}</h2>
        </div>
      </div>

      <div className="meta-line">
        <span>{accessLine(c)}</span>
        <span>
          💰 <b>{priceText}</b>
          {c.priceEstimated && ' (추정)'}
        </span>
      </div>

      {c.comment && <div className="comment">💬 {c.comment}</div>}

      <div className="menu-slot">
        <div className="menu-slot-label">🍽️ 시그니처 메뉴</div>
        {c.signatureMenu ? (
          <div className="menu-slot-val">{c.signatureMenu}</div>
        ) : (
          <div className="menu-slot-empty">메뉴 정보 준비 중이에요</div>
        )}
      </div>

      {/* 점심: 미식가 평점(별점). 후식: 추천/방문 배지 */}
      {!isDessert && c.rating != null && (
        <div className="rating-slot">
          <span className="rating-label">⭐ 미식가 평점</span>
          <StarRating rating={c.rating} />
          <span className="rating-num pixel-en">{c.rating}/10</span>
          {c.visited && <span className="visited-badge">✅ 직접 방문 인증</span>}
        </div>
      )}
      {isDessert && (c.recommended || c.visited) && (
        <div className="rating-slot">
          {c.recommended && <span className="visited-badge">👍 미식가 추천</span>}
          {c.visited && <span className="visited-badge">✅ 직접 방문 인증</span>}
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {c.phone && (
          <span className="hint" style={{ alignSelf: 'center' }}>
            ☎ {c.phone}
          </span>
        )}
        <a className="btn btn-ghost" href={naverMapUrl(c)} target="_blank" rel="noreferrer">
          네이버지도에서 보기
        </a>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-lg" style={{ flex: 1 }} onClick={onReroll} disabled={!canReroll}>
          🎰 다시 돌리기
        </button>
      </div>
      {!canReroll && <p className="hint">후보를 모두 봤어요! 필터를 바꿔보세요.</p>}
    </div>
  );
}
