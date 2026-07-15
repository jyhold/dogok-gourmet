# 🗂️ 예비 시트(candidates) + 구글 교차검증 설정 (기획서 §12)

신규 매장을 자동으로 발견하되, **큐레이션 DB는 깨끗하게 지키고 비용은 통제하는** 파이프라인입니다.

```
카카오 격자 스캔 (무료, 하루 1회 자동)
      ↓ 신규만
[candidates 예비 시트]   ← 룰렛은 이 시트를 절대 안 봄
      ↓ 수동 실행 (배치 상한) — 돈이 나가는 유일한 지점
구글 Places 교차검증 (평점·리뷰수)
      ↓ 통과분만 자동 승격
[restaurants]  ← 룰렛이 보는 유일한 소스
```

---

## 왜 이렇게 하나

**문제**: 카카오 로컬 API는 한 질의당 **최대 45건**만 준다. 그래서 매일 도는 동기화가 반경 전체를
45곳으로만 보고 있었다 — 사실상 신규 매장을 못 찾았다.

| 반경 | 실제 음식점 | 예전 방식 | 격자 스캔 |
|---|---|---|---|
| 1.3km (도보권) | 844곳 | 45곳 | **845곳** |
| 2km (따릉이) | 3,479곳 | 45곳 | **2,617곳**(4개구 필터 후) |

**그런데** 2,000곳을 그대로 `restaurants`에 넣으면 손으로 큐레이션한 236행이 미검증 행에 묻힌다.
→ 예비 시트에 가두고, 구글 평점으로 거른 것만 올린다.

---

## 1) `candidates` 탭 만들기

시트 하단 **+** → 탭 이름 정확히 **`candidates`** (소문자).

**A1에 아래 한 줄 붙여넣기** (24열, 탭 구분):

```
name	category_main	category_sub	signature_menu	price_tier	price_note	address	lat	lng	comment	active	weight	meal_type	group_seating	group_capacity	phone	solo_friendly	visited	rating	access_mode	google_rating	google_reviews	verdict	checked_at
```

> **A~T는 restaurants와 완전히 동일**합니다. 승격이 '앞 20열 그대로 복사'가 되도록 맞춘 것이라
> **순서를 바꾸면 안 됩니다.** 뒤 4열(U~X)만 검증용입니다.

| 열 | 뜻 |
|---|---|
| `google_rating` (U) | 구글 평점 0~5. 비어 있으면 미검증 |
| `google_reviews` (V) | 구글 리뷰수 |
| `verdict` (W) | 빈칸=미검증 / `pass` / `fail` / `miss`(구글에서 못 찾음) / `promoted`(승격 완료) |
| `checked_at` (X) | 검증 시각 `YYYYMMDD-HHmmss` |

> ⚠️ **탭을 안 만들고 돌리면** — 구글 시트는 없는 탭을 요청하면 404가 아니라 **첫 번째 탭(restaurants)
> 내용을 돌려줍니다.** 코드가 헤더의 `verdict`를 확인해 막지만, 탭 이름·헤더를 정확히 맞춰주세요.

## 2) Apps Script 교체

[sheet-sync-setup.md](sheet-sync-setup.md)의 최신 `doPost`로 교체 → **배포 → 새 배포**. 바뀐 점:

- `ALLOWED`에 `candidates` 추가
- **`replace` 모드** 추가 (검증 결과 되쓰기용) — **candidates 탭에서만** 동작하게 막아뒀습니다.
  restaurants를 실수로 날릴 수 없는 구조입니다.

확인: `/api/sync?key=<CRON_SECRET>&ping=candidates` → `{"ok":true,"wroteTo":"candidates"}` 면 정상
(테스트 행 1개가 들어가니 지우세요).

## 3) 스캔 확인 (돈 안 듦)

```
/api/sync?key=<CRON_SECRET>&dry=1
```

시트에 쓰지 않고 몇 곳을 찾았는지만 보고합니다:

```json
{"candidates":{"scanned":2617,"fresh":2128,"scan":{"calls":466,"saturated":0}}}
```

- `saturated: 0` = 45건 한계에 걸린 셀 없음 = **전부 회수**
- 문제 없으면 크론이 다음 정오에 자동으로 채웁니다. 지금 바로 채우려면 `dry=1` 없이 호출하세요.

---

## 4) 구글 Places 키 발급

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 만들기 (예: `dogok-gourmet`)
2. **API 및 서비스 → 라이브러리** → **Places API (New)** 검색 → **사용 설정**
3. **결제 계정 연결** (카드 등록 필요 — 아래 비용 참고)
4. **사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키** → 복사
5. 그 키의 **API 제한** → **Places API (New)** 만 선택 (다른 API로 새어나가지 않게)
6. `.env.local`에 추가:
   ```
   GOOGLE_PLACES_KEY=여기에_키
   ```

> **Vercel에는 넣지 마세요.** 검증은 수동 스크립트로만 돌리므로 서버엔 필요 없습니다.
> 서버가 실수로 호출할 경로를 아예 없애는 것이 가장 확실한 비용 안전장치입니다.

### 💰 비용 (2026-07 확인)

평점·리뷰수(`rating`/`userRatingCount`)는 **Enterprise 등급** 필드라 아래 단가입니다:

| SKU | 단가 | 무료 한도 |
|---|---|---|
| **Text Search Enterprise** | **$35 / 1,000회** | **월 1,000회** |

- 1건 조회 = 1회. **월 1,000건까지 무료.**
- 예비 후보 2,128곳을 전부 검증하면 1,128건이 유료 → **약 $39**.
  → 급하지 않으면 **한 달에 1,000건씩** 나눠 돌리면 $0입니다.
- **검증한 곳은 시트에 기록되어 다시 조회하지 않습니다.** 이게 핵심입니다 —
  탈락분을 안 남기면 매일 같은 2,000곳을 재조회해 월 $2,000이 넘습니다.

## 5) 검증 + 승격 실행

```bash
npx tsx scripts/verify-candidates.mts 5 --dry          # 대상만 보기 (호출 0, $0)
npx tsx scripts/verify-candidates.mts 20 --max-dist 800  # 800m 이내 20건부터
npx tsx scripts/verify-candidates.mts 100              # 익숙해지면 100건씩
```

실행하면 **먼저 비용을 알려주고** 시작합니다:

```
■ candidates 2128행 · 미검증 2128행
   이번 대상: 20건 (배치 20)
   통과 기준: 평점 ≥ 4 또는 리뷰 ≥ 200
■ 비용 (구글 Text Search Enterprise $35/1,000 · 무료 월 1000회)
   이번 실행: 최대 20회 → 무료 한도 내면 $0, 전부 유료면 $0.70
```

그 다음 한 건씩 결과를 보여주고:

```
   1/20 ✅ 광화문국밥 도곡점      ★4.3 (리뷰 512)
   2/20 ·  어느식당              ★3.6 (리뷰 41)
   3/20 ❓ 신규오픈집            매칭실패(no-result)
■ 결과: pass 12 · fail 6 · miss 2
✓ restaurants에 12곳 승격
✓ candidates 2128행 갱신 (검증 결과 기록)
```

- `pass` → **restaurants에 자동 승격** (승격 직전 중복 재확인)
- `fail`/`miss` → candidates에 기록만. 다시 조회하지 않습니다
- 승격된 행은 `verdict=promoted`로 표시됩니다

### 기준 조정

기본값은 **평점 ≥ 4.0 또는 리뷰 ≥ 200**입니다. 한국 로컬 식당은 구글 리뷰가 적은 편이라
실제 수치를 보고 조정하세요. `.env.local`:

```
MIN_GOOGLE_RATING=4.0
MIN_GOOGLE_REVIEWS=200
```

## 6) 승격 후 할 일

승격된 행은 자동값만 채워져 있습니다. 시간 날 때 손으로:

- `signature_menu` — 시그니처 메뉴
- `solo_friendly` — **`FALSE`면 혼밥 룰렛에 안 나옵니다** (엄격 모드)
- `access_mode` — 1=도보 / 2=따릉이 / 3=택시 (비우면 직선거리). **1/2/3 외의 값은 조용히 무시됩니다**
- `visited` / `rating` — 직접 가보셨다면

---

## 문제가 생기면

| 증상 | 원인 |
|---|---|
| `'candidates' 탭이 없거나 헤더가 다릅니다` | 탭 이름 오타 또는 헤더 24열 미붙여넣기 |
| `replace는 candidates 탭만 허용` | 정상 — 안전장치가 작동한 것 |
| `요청한 'candidates'가 아니라 'restaurants'에 기록됨` | Apps Script가 구버전. 새 배포 필요 + restaurants 마지막 행 삭제 |
| `웹훅 응답에 replaced 없음` | Apps Script가 `replace` 모드를 모름 = 구버전 |
| 매칭실패(`miss`)가 너무 많음 | 구글에 없는 신규 매장이거나 상호가 다름. 손으로 판단하세요 |
