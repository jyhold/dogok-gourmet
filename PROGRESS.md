# 진행 상황 (세션 인수인계)

## 🔄 v1.10 변경 (2026-07-12)
- **미식가 방문 검증 + 주관적 평점** — 시트 R열 `visited`(TRUE/FALSE), S열 `rating`(0~10 정수). `types.ts`·`sheet.ts`(clampRating)·`mockData`·`candidates`·`ResultCard`(StarRating, rating÷2=별5, 반개) 반영. 결과 카드 하단 별점 슬롯 + '✅ 직접 방문 인증' 배지 (rating 있을 때만, 카카오 결과는 미표시).
- **'⭐ 미식가 인증 맛집 우선' 체크박스** — FilterPanel 최상단. 켜면 `boostVisited`(roulette.ts)로 visited 후보 가중치 ×6 (확률 부스트). localStorage 저장. 테스트 2개 추가(총 14).
- **메인 하단 마스코트 씬** — 상단 인사 제거→하단 통합. 말풍선에 날씨(`weatherLine`)+추천 메뉴(`recommendSub`, 날씨 기반 카테고리+도트 아이콘). `mounted` 게이트로 하이드레이션 안전.

## 🔄 v1.9 변경 (2026-07-12)
- 앱 이름 확정: **도곡한 미식가** (제목/메타데이터 반영)
- **위치인식 제거** — 사내용이라 시작점 항상 군인공제회관 고정. page.tsx geolocation·coords 삭제, /api/nearby는 항상 `COMPANY_COORDS`. 병목 3 소멸.
- **거리 필터 재설정** — 도보 1.3km / 따릉이 2km / 택시 5km, **직선거리(하버사인) 상한** 기준 (기존 도로보정 ×1.3은 '도보 예상 분' 표시용에만). `DISTANCE_METERS`(types.ts) 갱신.
- docs/plan.md 전반 반영 (§2 #1, §3.1 플로우, 병목 3·5 등).

## ✅ 완료 — Phase 1: 로컬 목업 핵심 루프 (2026-07-12)

- [x] Next.js(App Router)+TS 프로젝트 셋업, 환경변수 구조(`.env.local.example`, `USE_MOCK`)
- [x] CLAUDE.md 경량본 + docs/plan.md + PROGRESS.md (§9.1 토큰 절약)
- [x] 도메인 타입 (`src/lib/types.ts`)
- [x] 카테고리 24종 + 카카오 매핑 + 예산추정 + 혼밥휴리스틱 (`categories.ts`) — 병목 2·7
- [x] 지오 유틸: 하버사인×1.3, 바운딩박스, 행정구역, 회사 fallback (`geo.ts`) — 병목 3·5
- [x] `/api/restaurants` 시트 로더 + 10분 캐시 + mock 폴백 (`sheet.ts`) — 병목 6
- [x] `/api/nearby` 카카오 검색 + 모드별 후보구성 + 중복병합 (`kakao.ts`,`candidates.ts`) — 병목 1·2·7
- [x] `/api/weather` 기상청 실황 + 악천후 판정 + 30분 캐시 + mock (`weather.ts`) — 병목 4
- [x] 도트 디자인 시스템 CSS (9-patch 프레임·픽셀 버튼·슬롯·토스트, 이미지 0)
- [x] UI: ModeSelect / FilterPanel / SlotMachine / ResultCard / page 오케스트레이터
- [x] 슬롯 애니메이션 + 세션 중복 배제 + 재추첨
- [x] localStorage 필터 기억, 위치권한, 악천후 자동전환 토스트
- [x] 필터 로직 테스트 (`test/logic.test.ts`)

**완료 기준 충족**: localhost에서 모드선택 → 필터 → 돌리기 → 슬롯 → 결과카드 → 다시돌리기 루프가 mock 실데이터로 작동.

## ✅ Phase 0 — 연동 검증 완료 (2026-07-12)
- `.env.local` 실제 키 입력 + `USE_MOCK=FALSE`. 3개 연동 API로 실동작 확인:
  - 카카오 로컬: `/api/nearby` 46곳(카카오 45+DB 1). ⚠️ **카카오맵 서비스 활성화(ON) 필수** — 안 켜면 403 `disabled OPEN_MAP_AND_LOCAL`.
  - 기상청: `/api/weather` 실제 기온 응답(예 32.1℃). KMA는 Decoding 키.
  - 구글 시트: `/api/restaurants` 정상 로드(현재 예시 2곳). 탭명 restaurants, 링크공개 뷰어.
- 가이드: `docs/phase0-setup-guide.md` (+ 인터랙티브 아티팩트) — 카카오맵 활성화·좌표·헤더/.env 복사값 포함.
- 시트 자동 채우기: `npx tsx scripts/seed-sheet.mts [반경m]` → `phase0-seed.tsv` → 시트 A1 붙여넣기.

### 좌표 확정 (2026-07-12)
- `COMPANY_COORDS` 카카오 지오코딩으로 확정: **lat 37.4891, lng 127.0529** (남부순환로 2806, 도곡동 467-13).
  - 기존 근사값(37.4842, 127.0343=양재역)은 실제와 **약 1.7km 오차**였음 → 수정 완료.
- `weather.ts` GRID_NX=61/NY=125는 5km 격자라 1.7km 이동에도 동일 셀 → 그대로 유지(날씨 정상 응답 확인).
- 시드(seed-sheet)는 COMPANY_COORDS를 import하므로 좌표 수정 후 재생성하면 자동으로 도곡 중심.
- [ ] 카카오 개발자 앱 → REST 키 + JS 키 발급
- [ ] 공공데이터포털 → 기상청 단기예보·특보 활용신청
- [ ] 구글 시트 생성 + 스키마(A~Q열) + 맛집 10~20곳 + 링크 공개
- [ ] 팀회식 단골집 10곳(group_seating=TRUE) 선등록
- [ ] 회사 정확 좌표 / 4개구 바운딩박스 / 기상청 격자(nx,ny) 확정
  → 확정 후 `src/lib/geo.ts` COMPANY_COORDS, `src/lib/weather.ts` GRID_NX/NY 갱신
- [ ] `.env.local`에 실제 키 입력 + `USE_MOCK=FALSE`

## ▶ 다음 (Phase 2 — 코드)
- [ ] 기상청 특보 API(getWthrWrnList) 연동 (현재 실황 PTY만)
- [ ] 카카오 지오코딩으로 시트 좌표 빈칸 자동 채움
- [ ] 모바일 반응형 최종 다듬기
- (Geolocation 항목은 v1.9에서 삭제 — 위치인식 미사용)

## ▶ 다음 (Phase 3 — 배포)
- [ ] Vercel 연결 + 환경변수 등록
- [ ] 카카오 콘솔 배포 도메인 등록 (JS 키 제한) ← 보안 필수
- [ ] HTTPS Geolocation 실동작 확인

## 에셋 트랙 (코드와 병행)
- [x] **16×16 도트 아이콘 24종 + fallback 완료** (2026-07-12)
  - 생성 파이프라인: `scripts/gen-icons.mjs` (문자 그리드 → zlib PNG 인코딩, 외부 의존 0, 재실행 가능)
  - 검수 도구: `scripts/preview-icons.mjs <out.png>` (확대 컨택트 시트)
  - 출력: `public/assets/icons/{slug}.png` · 매핑: `src/lib/icons.ts` · 렌더: `src/components/DotIcon.tsx`
  - 슬롯 릴(tile 배경)·결과 카드에 연결. 수정: 그리드 편집 후 gen 재실행.
  - 국물요리는 공통 그릇 템플릿+고명, 나머지는 개별 실루엣. 유료 생성도구 미사용(§3.4 준수).
- [x] **마스코트 도트 캐릭터 '도곡이' 완료** (2026-07-12) — 젓가락 든 꼬마 직장인, 24×24
  - 생성: `scripts/gen-mascot.mjs` (공통 몸체 + 표정/소품 패치). 검수: `scripts/preview-mascot.mjs`
  - 상태 3종: happy(모드화면 인사·로딩 바운스) / sad(빈 결과) / rain(악천후 토스트)
  - 렌더: `src/components/Mascot.tsx`. 연결: page.tsx 인사말풍선·빈결과·토스트, 로딩 시 바운스
- [ ] (선택) 아이콘 디테일 다듬기 — 유사 국물요리(우동/쌀국수/덮밥) 구분도 향상

## 환경 메모
- Node는 `C:\Program Files\nodejs\`에 있으나 PATH 미등록 → 실행 시 PATH 앞에 추가 필요.
