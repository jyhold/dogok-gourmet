# 도곡한 미식가 — Claude Code 작업 가이드 (경량 요약)

> 앱 이름: **도곡한 미식가** (도곡동 군인공제회관 앞 맛집 룰렛).
> 전체 기획안은 `docs/plan.md`. 상세가 필요할 때만 해당 섹션을 부분 읽기 할 것. (토큰 절약 §9.1)

## 한 줄
군인공제회관(도곡동) 앞 직장인용 슬롯머신식 랜덤 맛집 추천 웹앱. Next.js(App Router)+Vercel. 런타임 Claude API 호출 0.
**사내용이라 위치인식 미사용 — 시작점은 항상 군인공제회관 고정** (`COMPANY_COORDS`).

## 모드 4종 (최상위 점심/저녁 → 하위 분기)
- `lunch-solo` 혼밥: 혼밥친화 카테고리 가중치↑, 다인전제 제외, `solo_friendly` 추가 가중치
- `lunch-group` 점심약속: 전 카테고리, 예산 3단계 필터
- (점심 공통) **대분류 '기타' 제외** — 치킨·호프·매칭실패는 점심 룰렛에 미출현(저녁 모드엔 등장). 매칭 실패 sub 라벨은 '기타'.
- `dinner-flash` 번개모임: 예산 무관, 점심형 카테고리 가중치↓
- `dinner-team` 팀회식: 관리자DB `group_seating=TRUE`만 메인, 카카오는 회식형만 '단체석 미확인' 보조

## 외부 API 3종 (전부 서버 API Route 뒤, 키 노출 금지)
- 카카오 로컬(REST) — 반경 음식점 검색. `/api/nearby`. 5분 캐시.
- 기상청 초단기실황+특보 — 악천후 판정. `/api/weather`. 30분 캐시. 격자 고정 nx=61,ny=125.
- 구글 시트 gviz CSV — 관리자DB. `/api/restaurants`. 10분 캐시.

`USE_MOCK=TRUE`(기본)면 3종 모두 `src/lib/mockData.ts`로 대체 → Phase 0 키 없이 개발.

## 미식가 평점·인증 (v1.10)
- 시트 R열 `visited`(방문 검증), S열 `rating`(0~10 저장, 표시는 ÷2=별5, 반개). 결과 카드 하단 별점 슬롯 + '✅ 직접 방문 인증' 배지 (rating 있을 때만).
- 필터 '⭐ 미식가 인증 맛집 우선' 체크박스 → `boostVisited`(roulette.ts)로 visited 가중치 ×6.
- 메인 하단 마스코트: `weatherLine`+`recommendSub`(날씨 기반 추천). page.tsx.

## 코드 지도
- `src/lib/types.ts` 도메인 타입 (Restaurant/Candidate/모드/거리)
- `src/lib/categories.ts` 2단계 카테고리 25종(일식 장어요리 포함) + 카카오 매핑(세부→대분류→기타) + 예산추정 + 혼밥휴리스틱
- `src/lib/geo.ts` 하버사인×1.3 보정, 서비스 바운딩박스, 행정구역 필터, 회사좌표 fallback
- `src/lib/sheet.ts` `src/lib/kakao.ts` `src/lib/weather.ts` 외부 소스 로더 (mock 폴백 내장)
- `src/lib/candidates.ts` ★ 모드별 후보구성 + 중복병합(이름+50m, DB우선) + 가중치
- `src/lib/roulette.ts` 프론트 필터 + 가중치 추첨
- `src/app/api/*` 3개 라우트 · `src/app/page.tsx` 오케스트레이터 · `src/components/*` UI

## 디자인
Tiny Town 도트(픽셀) 감성. CSS만으로 9-patch 프레임·픽셀 버튼(이미지 0). 폰트 Galmuri11+Press Start 2P+Pretendard.
- **카테고리 도트 아이콘 24종+fallback** — `scripts/gen-icons.mjs`(문자 그리드→PNG, 재실행 가능), `public/assets/icons/*.png`, 매핑 `src/lib/icons.ts`, 렌더 `src/components/DotIcon.tsx`.
- **마스코트 '도곡이'(젓가락 든 꼬마 직장인, 24×24)** — `scripts/gen-mascot.mjs`, `public/assets/mascot/mascot-{happy,sad,rain}.png`, 렌더 `src/components/Mascot.tsx`. happy=인사/로딩, sad=빈결과, rain=악천후.
- 에셋 수정=그리드 편집 후 gen 재실행. 검수=`scripts/preview-icons.mjs`·`preview-mascot.mjs`. 유료 생성도구 미사용(§3.4).

## 병목 회피 규칙 (핵심만)
1. 메뉴/가격/단체석은 관리자DB가 유일 소스. 카카오는 카테고리·거리·전화만.
2. 카카오 카테고리 매핑 실패 → '기타'. 예산은 카테고리 추정(`~` 표기).
3. 위치인식 미사용 — 시작점 항상 군인공제회관 고정.
4. 거리 반경 상한 = **직선거리(하버사인)** 기준: 도보 1.3km / 따릉이 2km / 택시 5km. '도보 예상 분' 표시에만 ×1.3 보정. 길찾기 API 미사용.

## 개발 규칙
- 스펙 변경은 코드보다 `docs/plan.md` 먼저 수정 후 반영.
- `npm run dev` 로컬 / `npm test` 필터 로직 테스트 / Vercel 배포.
- 진행 상황은 `PROGRESS.md`에 기록 (세션 인수인계용).
