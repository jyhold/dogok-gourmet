'use client';

import type { Candidate, Mode } from '@/lib/types';
import DotIcon from './DotIcon';

interface Props {
  candidate: Candidate;
  mode: Mode;
  onReroll: () => void;
  canReroll: boolean;
}

function kakaoMapUrl(c: Candidate): string {
  if (c.kakaoPlaceUrl) return c.kakaoPlaceUrl;
  return `https://map.kakao.com/link/search/${encodeURIComponent(c.name)}`;
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

export default function ResultCard({ candidate: c, mode, onReroll, canReroll }: Props) {
  const isTeam = mode === 'dinner-team';
  const priceText = c.priceNote ?? c.priceTier;

  return (
    <div className="result-card frame">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <DotIcon sub={c.categorySub} size={44} />
          <div>
            <div className="cat">
              {c.categoryMain} · {c.categorySub}
            </div>
            <h2>{c.name}</h2>
          </div>
        </div>
        {c.curated && <span className="badge-crown">👑 추천</span>}
      </div>

      {c.signatureMenu && (
        <div className="menu">
          🍽️ <b>{c.signatureMenu}</b>
        </div>
      )}

      <div className="meta-line">
        <span>
          📍 도보 <b>{c.walkMinutes}분</b> (약 {c.distanceM}m)
        </span>
        <span>
          💰 <b>{priceText}</b>
          {c.priceEstimated && ' (추정)'}
        </span>
      </div>

      {isTeam && c.groupSeating && (
        <div className="meta-line">
          <span>
            👥 단체석 {c.groupCapacity ? <b>~{c.groupCapacity}명</b> : '구비'}
          </span>
        </div>
      )}
      {isTeam && c.groupUnconfirmed && (
        <div className="meta-line">
          <span style={{ color: 'var(--ink-soft)' }}>⚠️ 단체석 미확인 — 전화로 확인 권장</span>
        </div>
      )}

      {c.comment && <div className="comment">💬 {c.comment}</div>}

      {c.rating != null && (
        <div className="rating-slot">
          <span className="rating-label">⭐ 미식가 평점</span>
          <StarRating rating={c.rating} />
          <span className="rating-num pixel-en">{c.rating}/10</span>
          {c.visited && <span className="visited-badge">✅ 직접 방문 인증</span>}
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {isTeam && c.phone && (
          <a className="btn btn-primary" href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}>
            📞 바로 전화 예약
          </a>
        )}
        {!isTeam && c.phone && (
          <span className="hint" style={{ alignSelf: 'center' }}>
            ☎ {c.phone}
          </span>
        )}
        <a className="btn btn-ghost" href={kakaoMapUrl(c)} target="_blank" rel="noreferrer">
          카카오맵에서 보기
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
