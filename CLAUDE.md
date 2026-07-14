# 도곡한 미식가 — Claude Code 작업 가이드 (경량 요약)

> 앱 이름: **도곡한 미식가** (도곡동 군인공제회관 앞 맛집 룰렛).
> 전체 기획안은 `docs/plan.md`. 상세가 필요할 때만 해당 섹션을 부분 읽기 할 것. (토큰 절약 §9.1)

## 한 줄
군인공제회관(도곡동) 앞 직장인용 슬롯머신식 랜덤 맛집 추천 웹앱. Next.js(App Router)+Vercel. 런타임 Claude API 호출 0.
**점심은 위치인식 미사용 — 시작점 항상 군인공제회관 고정** (`COMPANY_COORDS`). **후식만 예외: 브라우저 현재 위치 반경 300m** (거부 시 군인공제회관 500m 폴백).

## 모드 (최상위 점심/후식 — v1.12에서 저녁 폐지)
- `lunch-solo` 혼밥: 혼밥친화 카테고리 가중치↑, 다인전제 제외, `solo_friendly` 추가 가중치
- `lunch-group` 점심약속: 전 카테고리, 예산 3단계 필터
- (점심 공통) **대분류 '기타' 제외** — 치킨·호프·매칭실패는 점심 룰렛에 미출현. 매칭 실패 sub 라벨은 '기타'. 점심은 `meal_type`이 점심/둘다인 행만.
- `dessert` 후식: **하위 분기 없음**. 현재 위치 반경 300m(군인공제회관 폴백 시 500m, 부족 시 1km 자동 확장). 카카오 CE7(카페) + `coffee` 시트. 예산·거리 필터 없음, 제외 메뉴(후식 5종)만. `recommended` 우선 부스트.

## 외부 API (전부 서버 API Route 뒤, 키 노출 금지)
- 카카오 로컬(REST) — 반경 검색. 점심=FD6(음식점) `/api/nearby`, 후식=CE7(카페) `/api/dessert?lat=&lng=`. 5분 캐시(격자+groupCode 키).
- 기상청 초단기실황+특보 — 악천후 판정. `/api/weather`. 30분 캐시. 격자 고정 nx=61,ny=125.
- 구글 시트 gviz CSV — 관리자DB. 식당=`restaurants` 탭 `/api/restaurants`, 후식=`coffee` 탭(env `GOOGLE_COFFEE_SHEET_TAB`). 10분 캐시.

`USE_MOCK=TRUE`(기본)면 전부 `src/lib/mockData.ts`로 대체 → Phase 0 키 없이 개발. (후식 mock: `MOCK_CAFES`, `MOCK_KAKAO_CAFES`)

## 미식가 평점·인증 (v1.10, v1.12)
- **식당**: 시트 `visited`(방문 검증), `rating`(0~10 저장, 표시는 ÷2=별5, 반개). 결과 카드 별점 슬롯 + '✅ 직접 방문 인증' 배지. 필터 '⭐ 미식가 인증 맛집 우선' → `boostVisited` visited 가중치 ×6.
- **후식(coffee 시트)**: 평점 대신 `visited`+`recommended`(추천 T/F). 결과 카드에 '👍 미식가 추천'/'✅ 직접 방문' 배지(별점 없음). 필터 '👍 미식가 추천 우선' → `boostRecommended` recommended 가중치 ×6.
- 메인 하단 마스코트: `weatherLine`+`recommendSub`(날씨 기반 추천). page.tsx.

## 코드 지도
- `src/lib/types.ts` 도메인 타입 (Restaurant/Candidate/모드/거리)
- `src/lib/categories.ts` 2단계 카테고리 28종(일식 장어요리, 한식 칼국수/냉면·갈비탕 분리 포함) + 카카오 매핑(세부→대분류→기타. **규칙은 배열 순서대로 첫 매치 채택 — 냉면·갈비탕이 국밥·탕('탕')·고기구이('갈비')보다 위, 일반 '국수'는 칼국수·쌀국수보다 아래여야 함**) + 예산추정 + 혼밥휴리스틱 + **후식 5종(`DESSERT_SUBS`)·`mapKakaoCafe`(CE7)**
- `src/lib/geo.ts` 하버사인×1.3 보정, 서비스 바운딩박스, 행정구역 필터, 회사좌표 fallback
- `src/lib/sheet.ts`(식당) · **`src/lib/coffeeSheet.ts`(후식, `loadCafes`)** · `src/lib/kakao.ts`(groupCode FD6/CE7) · `src/lib/weather.ts` 외부 소스 로더 (mock 폴백 내장)
- `src/lib/candidates.ts` ★ 점심 `buildCandidates` + **후식 `buildDessertCandidates`(위치 300m/폴백 500m·자동확장)** + 중복병합(이름+50m, DB우선) + 가중치
- `src/lib/roulette.ts` 프론트 필터 + 가중치 추첨(`boostVisited`/**`boostRecommended`**)
- `src/app/api/*` (nearby=점심 · **dessert=후식** · restaurants · weather · sync) · `src/app/page.tsx` 오케스트레이터(후식은 `getPosition` geolocation) · `src/components/*` UI

## 디자인
Tiny Town 도트(픽셀) 감성. CSS만으로 9-patch 프레임·픽셀 버튼(이미지 0). 폰트 Galmuri11+Press Start 2P+Pretendard.
- **카테고리 도트 아이콘 (식사 27종 + 후식 5종 coffee/bakery/cake/donut/icecream + fallback)** — `scripts/gen-icons.mjs`(문자 그리드→PNG, 재실행 가능), `public/assets/icons/*.png`, 매핑 `src/lib/icons.ts`, 렌더 `src/components/DotIcon.tsx`.
- **마스코트 '도곡이'(젓가락 든 꼬마 직장인, 24×24)** — `scripts/gen-mascot.mjs`, `public/assets/mascot/mascot-{happy,sad,rain}.png`, 렌더 `src/components/Mascot.tsx`. happy=인사/로딩, sad=빈결과, rain=악천후.
- 에셋 수정=그리드 편집 후 gen 재실행. 검수=`scripts/preview-icons.mjs`·`preview-mascot.mjs`. 유료 생성도구 미사용(§3.4).

## 병목 회피 규칙 (핵심만)
1. 메뉴/가격/단체석은 관리자DB가 유일 소스. 카카오는 카테고리·거리·전화만.
2. 카카오 카테고리 매핑 실패 → '기타'. 예산은 카테고리 추정(`~` 표기).
3. 점심은 위치인식 미사용(시작점 군인공제회관 고정). **후식만 예외 — 브라우저 현재 위치 반경 300m, 거부 시 군인공제회관 500m 폴백.**
4. 거리 반경 상한 = **직선거리(하버사인)** 기준: 도보 1.3km / 따릉이 2km / 택시 5km. '도보 예상 분' 표시에만 ×1.3 보정. 길찾기 API 미사용.
   - **관리자DB `access_mode`(시트 T열, 1=도보/2=따릉이/3=택시) 우선** — 값이 있으면 직선거리 무시하고 `선택 등급 ≥ access_mode`로 노출, null이면 기존 직선거리. 판정은 `geo.ts` `reachableInMode`. curated 후보에만 적용.

## 개발 규칙
- 스펙 변경은 코드보다 `docs/plan.md` 먼저 수정 후 반영.
- `npm run dev` 로컬 / `npm test` 필터 로직 테스트 / Vercel 배포.
- 진행 상황은 `PROGRESS.md`에 기록 (세션 인수인계용).
