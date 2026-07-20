'use client';

import { useEffect, useState } from 'react';
import type { Candidate, Mode } from '@/lib/types';
import { track } from '@/lib/clientTrack';
import { formatDetail, type ReportReason } from '@/lib/stats';
import DotIcon from './DotIcon';

/** 신고 사유 버튼 정의 (라벨은 사용자 표시, value는 detail의 reason=) */
const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'closed', label: '🚫 폐점' },
  { value: 'no_lunch', label: '🕛 점심영업X' },
  { value: 'other', label: '❓ 기타' },
];

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
  // 예산 슬롯은 항상 price_tier만 표시 — 관리자DB값 우선, 없으면 카카오 추정(priceEstimated).
  // priceNote(자유 텍스트, 예: '인당 1.5만')는 여기에 섞지 않는다(표기 통일).
  const priceText = c.priceTier;

  // 신고 — 폐점/점심영업X 등 문제 매장 제보(§11.5). 결과가 바뀌면 새 가게이므로 초기화.
  // reportOpen: 사유 버튼 펼침(= 탭 후 확인 단계). reported: 접수 완료.
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    setReportOpen(false);
    setReported(false);
  }, [c.id]);

  const evt = { mode, place: c.name, categorySub: c.categorySub };
  const submitReport = (reason: ReportReason) => {
    if (reported) return; // 한 번만 집계 (연타로 부풀지 않게)
    setReported(true);
    setReportOpen(false);
    track('report', { ...evt, detail: formatDetail({ reason }) });
  };

  return (
    <div className="result-card frame">
      <div className="result-head">
        <DotIcon sub={c.categorySub} size={44} />
        <div className="result-title">
          <div className="cat">
            {c.categoryMain} · {c.categorySub}
          </div>
          <h2>{c.name}</h2>
        </div>
        {isDessert && (c.iceAmericano != null || c.recommended || c.visited) && (
          <div className="dessert-corner">
            {c.iceAmericano != null && (
              <div className="aa-index" title="아이스 아메리카노 가격 (아아INDEX)">
                <span className="aa-index-label">아아INDEX</span>
                <span className="aa-index-val">{c.iceAmericano.toLocaleString()}원</span>
              </div>
            )}
            {c.recommended && <span className="visited-badge">👍 미식가 추천</span>}
            {c.visited && <span className="visited-badge">✅ 직접 방문</span>}
          </div>
        )}
      </div>

      <div className="meta-line">
        <span>{accessLine(c)}</span>
        {/* 후식은 예산 개념이 없어(항상 '보통' 플레이스홀더) 예산 슬롯을 숨긴다 */}
        {!isDessert && (
          <span>
            💰 <b>{priceText}</b>
            {c.priceEstimated && ' (추정)'}
          </span>
        )}
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

      {/* 점심: 미식가 평점(별점). 후식은 우상단 코너에 추천/방문 배지 + 아아INDEX */}
      {!isDessert && c.rating != null && (
        <div className="rating-slot">
          <span className="rating-label">⭐ 미식가 평점</span>
          <StarRating rating={c.rating} />
          <span className="rating-num pixel-en">{c.rating}/10</span>
          {c.visited && <span className="visited-badge">✅ 직접 방문 인증</span>}
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {c.phone && (
          <span className="hint" style={{ alignSelf: 'center' }}>
            ☎ {c.phone}
          </span>
        )}
        <a
          className="btn btn-ghost"
          href={naverMapUrl(c)}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('map', evt)}
        >
          네이버지도에서 보기
        </a>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className={`btn btn-report${reported ? ' reported' : ''}`}
          onClick={() => !reported && setReportOpen((v) => !v)}
          aria-pressed={reportOpen}
          disabled={reported}
          title={reported ? '신고 접수됨' : '폐점·점심 미영업 등 문제가 있으면 신고해주세요'}
        >
          {reported ? '✅ 신고 접수됨' : '🚨 신고하기'}
        </button>
        <button className="btn btn-lg" style={{ flex: 1 }} onClick={onReroll} disabled={!canReroll}>
          🎰 다시 돌리기
        </button>
      </div>

      {/* 사유 선택(= 확인 단계): 신고하기 탭 시 펼쳐지고, 사유를 골라야 접수된다 */}
      {reportOpen && !reported && (
        <div className="report-reasons">
          <span className="report-reasons-label">어떤 문제인가요?</span>
          <div className="report-reasons-btns">
            {REPORT_REASONS.map((r) => (
              <button key={r.value} className="btn btn-ghost btn-xs" onClick={() => submitReport(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!canReroll && <p className="hint">후보를 모두 봤어요! 필터를 바꿔보세요.</p>}
    </div>
  );
}
