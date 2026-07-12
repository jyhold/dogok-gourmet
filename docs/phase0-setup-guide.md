# Phase 0 셋업 — 빠른 참조

> 초보자용 단계별 인터랙티브 가이드(진행률 저장·복사 버튼)는 별도 아티팩트로 제공됨.
> 이 문서는 정확한 복사값과 핵심 규칙만 담은 프로젝트 내 레퍼런스.

얻을 것: **카카오 REST 키 + JS 키**, **기상청 서비스키**, **구글 시트 1개**. 전부 무료.
현재 앱은 `USE_MOCK=TRUE`로 mock 동작 중 → 아래를 끝내고 `USE_MOCK=FALSE`로 전환하면 실데이터.

## 1. 카카오 (developers.kakao.com)
1. 로그인 → 내 애플리케이션 → 애플리케이션 추가하기 (앱 이름 "도곡한 미식가").
2. 앱 > **앱 키** 화면에서 **REST API 키** 복사 → `.env.local`의 `KAKAO_REST_KEY` (서버 전용, 비공개).
3. **⚠️ 필수: 카카오맵 서비스 활성화** — 왼쪽 메뉴 **카카오맵** → **활성화 설정 ON**.
   - 안 켜면 맛집 검색이 403(`disabled OPEN_MAP_AND_LOCAL service`)으로 거부됨. 로컬 검색 API가 이 서비스 소속이라 REST 키만으로는 안 되고 이 토글이 필요.
4. **(선택, 현재 불필요)** JavaScript 키 / Web 플랫폼 등록:
   - `NEXT_PUBLIC_KAKAO_JS_KEY`와 Web 플랫폼(`http://localhost:3000`)은 **현재 코드에서 미사용** → 비워둬도 정상.
   - 지도를 화면에 직접 임베드하는 선택 기능을 붙일 때만: 앱 키 화면 왼쪽 메뉴 **플랫폼** → Web 영역 → 사이트 도메인 등록.

## 2. 기상청 (data.go.kr, 공공데이터포털)
1. 로그인 → 검색 "기상청 단기예보" → **"기상청_단기예보 ((구) 동네예보) 조회서비스"**.
2. **활용신청** (개발계정 보통 자동승인, ~1일 가능).
3. 마이페이지 > 오픈API > 개발계정 > 해당 서비스 → **일반 인증키 (Decoding)** 복사 → `KMA_SERVICE_KEY`.
   - ⚠️ 반드시 **Decoding** 키(앱이 자동 URL 인코딩). Encoding 키 넣으면 실패.
   - 키가 비어 있어도 앱은 정상 — 날씨 기능만 조용히 비활성.

## 3. 구글 시트 (sheets.google.com)

### 3-A. (권장) 카카오로 시트 자동 채우기 → 나중에 손으로 큐레이션
좌표를 일일이 찾지 않도록, 카카오 검색으로 초안을 뽑는 스크립트 제공. **REST 키(1번)만 있으면** 됨.
```
npx tsx scripts/seed-sheet.mts          # 반경 2500m (기본)
npx tsx scripts/seed-sheet.mts 4000     # 더 넓게
```
- 결과: 프로젝트 루트에 **`phase0-seed.tsv`** 생성. 열어서 전체 복사 → 시트 `restaurants` 탭 **A1**에 붙여넣기(헤더 포함).
- 자동으로 채워지는 칸: `name` / `category_main`·`sub` / `address` / **`lat`·`lng`** / `phone` / `price_tier`(카테고리 추정) / `active`=TRUE / `weight`=1 / `meal_type`=둘다.
- 손으로 채울 칸(비어 있음): `signature_menu` / `price_note` / `comment` / `group_seating` / `group_capacity` / `solo_friendly` / `visited` / `rating`.
- 검토 팁: `category_main/sub`·`price_tier`는 카카오 카테고리 기반 **추정**이라 틀린 게 있으면 고치고, `meal_type`(점심/저녁)·`group_seating`·`solo_friendly`도 실제에 맞게 수정. 서초·강남·동작·송파 내 결과만 포함됨.
- 이 방법을 쓰면 아래 **1~2·5번은 스크립트가 대신** 해준 셈. 3-B의 공유(6번)·시트 ID(7번)만 하면 됨.

### 3-B. 직접 만들기 (또는 자동 채우기 후 공유 설정)
1. 빈 시트 생성 → 하단 탭 이름을 **`restaurants`** (소문자)로 변경.
2. **A1**에 아래 헤더 붙여넣기 (탭 구분 → A~S 19열로 자동 분배). 이 줄은 수정 금지.

```
name	category_main	category_sub	signature_menu	price_tier	price_note	address	lat	lng	comment	active	weight	meal_type	group_seating	group_capacity	phone	solo_friendly	visited	rating
```

3. **A2**부터 맛집 입력 (예시 2줄, 탭 구분):

```
양재역 한우국밥	한식	국밥·탕	한우 소고기국밥	가성비	인당 1.1만	서울 서초구 남부순환로 2795	37.4845	127.0348	점심 웨이팅 있지만 회전 빠름	TRUE	2	둘다	FALSE		02-576-1234	TRUE	TRUE	9
서초 화로갈비	한식	고기구이	한우 모둠구이 코스	회식	인당 5.5만	서울 서초구 서초대로 302	37.4933	127.0246	단체룸 완비. 회식 단골	TRUE	2	저녁	TRUE	24	02-3473-2000	FALSE	TRUE	9
```

4. **좌표 필수**: `lat`·`lng`가 없는 행은 앱에서 무시됨(Phase 1 규칙). 구글지도에서 위치 우클릭 → 맨 위 `37.484, 127.034` 클릭(복사) → 앞=lat(H), 뒤=lng(I).
5. 우상단 **공유** → 일반 액세스 **"링크가 있는 모든 사용자 · 뷰어"** → 완료.
6. URL `.../spreadsheets/d/`**`{ID}`**`/edit`의 가운데 문자열 → `GOOGLE_SHEET_ID`.
7. 공개 확인(브라우저): `https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet=restaurants` → CSV가 보이면 OK.

### 열 규칙 요약
- 필수: `name`, `category_main`, `category_sub`, `lat`, `lng`.
- `price_tier`: 가성비 / 맛집 / 플렉스 / 회식. `meal_type`: 점심 / 저녁 / 둘다.
- `active` TRUE=등장. `weight` 기본 1, 추천 2~3.
- `group_seating` TRUE=팀회식 후보. `solo_friendly` TRUE=혼밥 우대.
- `visited` TRUE=결과 카드 '✅ 직접 방문 인증'. `rating` 0~10(표시는 별 5개, ÷2).
- 카테고리 24종(정확히 일치해야, 아니면 '기타'): `src/lib/categories.ts` `CATEGORY_TREE` 또는 plan.md §3.3.

## 4. `.env.local` 연결
```
KAKAO_REST_KEY=            # 카카오 REST API 키
NEXT_PUBLIC_KAKAO_JS_KEY=  # 카카오 JavaScript 키
KMA_SERVICE_KEY=           # 기상청 Decoding 키 (승인 후)
GOOGLE_SHEET_ID=           # 구글 시트 ID
GOOGLE_SHEET_TAB=restaurants
USE_MOCK=FALSE
```
저장 → dev 서버 재시작(Ctrl+C 후 `npm run dev`, .env는 재시작해야 반영) → 룰렛에 시트 맛집이 나오면 성공. 시트 수정은 최대 10분 캐시 후 반영.

## 보안
- `.env.local`은 커밋 금지(이미 `.gitignore`). REST/기상청 키는 서버 전용. JS 키는 도메인 제한으로 공개돼도 안전.
