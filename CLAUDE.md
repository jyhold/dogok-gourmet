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
- 기상청 초단기실황+특보 — 악천후 판정. `/api/weather`. 30분 캐시. 격자 고정 nx=61,ny=125. **날씨는 안내·추천 전용 — 필터를 자동으로 바꾸지 않는다(v1.14에서 악천후→택시 자동전환 폐지).**
- 구글 시트 gviz CSV — 관리자DB. 식당=`restaurants` 탭 `/api/restaurants`, 후식=`coffee` 탭(env `GOOGLE_COFFEE_SHEET_TAB`). 10분 캐시.

`USE_MOCK=TRUE`(기본)면 전부 `src/lib/mockData.ts`로 대체 → Phase 0 키 없이 개발. (후식 mock: `MOCK_CAFES`, `MOCK_KAKAO_CAFES`)

## 미식가 평점·인증 (v1.10, v1.12)
- **식당**: 시트 `visited`(방문 검증), `rating`(0~10 저장, 표시는 ÷2=별5, 반개). 결과 카드 별점 슬롯 + '✅ 직접 방문 인증' 배지. 필터 '⭐ 미식가 인증 맛집 우선' → `boostVisited` visited 가중치 ×6.
- **후식(coffee 시트)**: 평점 대신 `visited`+`recommended`(추천 T/F). 결과 카드에 '👍 미식가 추천'/'✅ 직접 방문' 배지(별점 없음). 필터 '👍 미식가 추천 우선' → `boostRecommended` recommended 가중치 ×6.
- 메인 하단 마스코트: `weatherLine`+`recommendSub`(날씨 기반 추천). page.tsx.

## 예비 시트 candidates (v1.16, `docs/candidates-setup.md`)
신규 매장 자동 발견 파이프라인. **카카오 격자 스캔(무료·크론) → `candidates` → 구글 검증(수동·배치) → pass만 → `restaurants`(룰렛)**.
- **카카오는 한 질의당 45건이 하드 상한** — 도보권에 844곳이 있는데 45곳만 보고 있었다. `kakaoScan.ts` `scanAll`이 사각 쿼드트리로 쪼개 전부 회수(2km에서 466호출·9.2초·포화 0). `kakao.ts` `searchNearby`(45건·5분 캐시)는 **룰렛 실시간용으로 그대로 둔다**.
- **candidates 24열: A~T가 restaurants와 동일**(승격=앞 20열 복사) + google_rating/google_reviews/verdict/checked_at. 순서 바꾸면 승격이 깨진다.
- **구글 평점은 Text Search Enterprise($35/1000·무료 월 1000)** — 카카오엔 평점 필드가 없다. 비용 안전규칙: ①수동 스크립트만 ②키는 `.env.local`만(Vercel 금지) ③**탈락분도 verdict에 기록**해 재조회 금지.
- **gviz는 없는 탭을 요청하면 200 + 첫 탭(restaurants) 내용을 준다** — `candidatesSheet.ts`가 헤더 W열=`verdict`로 검증. Apps Script 폴백과 같은 부류의 함정.
- `replace` 모드는 Apps Script에서 **candidates 전용**으로 막아둠(restaurants 실수 삭제 방지).

## 관리자 통계 (v1.13, `docs/stats-setup.md`)
`/stats` — 페이지 내 비밀번호(`STATS_KEY`) 입력 후 방문자·룰렛·좋아요·지도클릭 통계. 저장소는 시트 `stats` 탭(7열), 쓰기는 기존 Apps Script 웹훅 재사용.
- **⚠️ Apps Script는 모르는 탭을 restaurants로 조용히 폴백했었다** — `ALLOWED`에 `stats` 추가 + 폴백 제거가 선행 조건. `statsSink.ts`가 응답의 `sheet`를 검증해 다르면 영구 차단(관리자DB 오염 방지). `STATS_ENABLED=TRUE`로 이중 잠금.
- `ts`는 `YYYYMMDD-HHmmss`(KST) — ISO로 쓰면 시트가 날짜 셀로 바꿔 되읽을 때 깨진다.
- 수집은 프로덕션에서만 (로컬 dev 트래픽 제외). `USE_MOCK=TRUE`면 `MOCK_STAT_ROWS`로 대시보드 개발 가능.
- 차트 색은 앱 파스텔이 아니라 **검증 통과한 마크용 팔레트**(`StatsCharts.tsx` `CHART`) — 파스텔은 밝기·채도·대비 검증에 전부 걸린다.

## 코드 지도
- `src/lib/types.ts` 도메인 타입 (Restaurant/Candidate/모드/거리)
- `src/lib/categories.ts` 2단계 카테고리 30종(일식 장어요리, 한식 칼국수/냉면·갈비탕/샤브샤브, 아시안 홍콩·딤섬 포함) + 카카오 매핑(세부→대분류→기타. **규칙은 배열 순서대로 첫 매치 채택 — 샤브샤브가 칼국수보다 위(등촌샤브칼국수), 냉면·갈비탕이 국밥·탕('탕')·고기구이('갈비')보다 위, 일반 '국수'는 칼국수·쌀국수보다 아래여야 함**)
  - 카카오는 **샤브샤브를 최상위 대분류**로 준다(`음식점 > 샤브샤브`) — 한식 밑이 아니므로 전용 규칙 필수. 없으면 기타로 떨어져 점심 룰렛에서 통째로 누락됨. + 예산추정 + 혼밥휴리스틱 + **후식 5종(`DESSERT_SUBS`)·`mapKakaoCafe`(CE7)**
- `src/lib/geo.ts` 하버사인×1.3 보정, 서비스 바운딩박스, 행정구역 필터, 회사좌표 fallback
- `src/lib/sheet.ts`(식당) · **`src/lib/coffeeSheet.ts`(후식, `loadCafes`)** · `src/lib/kakao.ts`(groupCode FD6/CE7) · `src/lib/weather.ts` 외부 소스 로더 (mock 폴백 내장)
- **발견 파이프라인**: `kakaoScan.ts`(격자 스캔) · `candidatesSheet.ts`(예비 시트 읽기+헤더 검증) · `googlePlaces.ts`(평점 조회+게이트) · `sheetWebhook.ts`(쓰기 공용, 응답 `sheet` 검증) · `sheetSync.ts`(스캔→candidates) · `scripts/verify-candidates.mts`(**수동 검증+승격, 유일한 과금 지점**)
- `src/lib/candidates.ts` ★ 점심 `buildCandidates` + **후식 `buildDessertCandidates`(위치 300m/폴백 500m·자동확장)** + 중복병합(이름+50m, DB우선) + 가중치
- `src/lib/roulette.ts` 프론트 필터 + 가중치 추첨(`boostVisited`/**`boostRecommended`**)
- **통계**: `src/lib/stats.ts`(타임스탬프·detail 인코딩·`aggregate` 순수함수) · `statsSink.ts`(쓰기+오염방지) · `statsSheet.ts`(읽기) · `clientTrack.ts`(익명ID·sendBeacon) · `src/app/stats/page.tsx` + `components/StatsCharts.tsx`
- `src/app/api/*` (nearby=점심 · **dessert=후식** · restaurants · weather · sync · **track=수집** · **stats=집계**) · `src/app/page.tsx` 오케스트레이터(후식은 `getPosition` geolocation) · `src/components/*` UI

## 디자인
Tiny Town 도트(픽셀) 감성. CSS만으로 9-patch 프레임·픽셀 버튼(이미지 0). 폰트 Galmuri11+Press Start 2P+Pretendard.
- **카테고리 도트 아이콘 (식사 29종 + 후식 5종 coffee/bakery/cake/donut/icecream + fallback)** — `scripts/gen-icons.mjs`(문자 그리드→PNG, 재실행 가능), `public/assets/icons/*.png`, 매핑 `src/lib/icons.ts`, 렌더 `src/components/DotIcon.tsx`.
- **마스코트 '도곡이'(젓가락 든 꼬마 직장인, 24×24)** — `scripts/gen-mascot.mjs`, `public/assets/mascot/mascot-{happy,sad,rain}.png`, 렌더 `src/components/Mascot.tsx`. happy=인사/로딩, sad=빈결과, rain=악천후.
- 에셋 수정=그리드 편집 후 gen 재실행. 검수=`scripts/preview-icons.mjs`·`preview-mascot.mjs`. 유료 생성도구 미사용(§3.4).

## 병목 회피 규칙 (핵심만)
1. 메뉴/가격/단체석은 관리자DB가 유일 소스. 카카오는 카테고리·거리·전화만.
2. 카카오 카테고리 매핑 실패 → '기타'. 예산은 카테고리 추정(`~` 표기).
3. 점심은 위치인식 미사용(시작점 군인공제회관 고정). **후식만 예외 — 브라우저 현재 위치 반경 300m, 거부 시 군인공제회관 500m 폴백.**
4. 거리 반경 상한 = **직선거리(하버사인)** 기준: 도보 1.3km / 따릉이 2km / 택시 5km. '도보 예상 분' 표시에만 ×1.3 보정. 길찾기 API 미사용.
   - **관리자DB `access_mode`(시트 T열, 1=도보/2=따릉이/3=택시) 우선** — 값이 있으면 직선거리 무시하고 `선택 등급 ≥ access_mode`로 노출, null이면 기존 직선거리. 판정은 `geo.ts` `reachableInMode`. curated 후보에만 적용. **1/2/3 외의 값은 조용히 무시되고 직선거리로 처리**되니 오타 주의.
   - **이동수단 선택은 확률에도 반영 (v1.15, `candidates.ts`)** — 반경 컷만으론 택시(5km)가 도보권을 포함해 모드를 바꿔도 코앞만 나왔다. `accessModeWeight`(일치 시 ×3) × `distancePrefWeight`(도보=가까울수록↑ / 택시=멀수록↑ / 따릉이=중립).
     - ⚠️ 시트가 반경 1500m 시드라 **2km 초과 후보 0곳** — 택시의 '멀수록↑'는 대상이 없다. 택시 모드를 살리려면 시트를 3~5km로 재시드 필요.

## 개발 규칙
- 스펙 변경은 코드보다 `docs/plan.md` 먼저 수정 후 반영.
- `npm run dev` 로컬 / `npm test` 필터 로직 테스트 / Vercel 배포.
- 진행 상황은 `PROGRESS.md`에 기록 (세션 인수인계용).
