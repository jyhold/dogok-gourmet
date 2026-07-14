# 시트 자동 동기화 세팅 (카카오 신규 → 관리자DB)

> 매일 정오(KST) 카카오 주변 검색 결과 중 **시트에 없는 신규 매장**을 자동 추가.
> - **식당**: 반경 4개구(서초·강남·동작·송파) FD6 검색 → `restaurants` 탭 (카페·베이커리 제외, 치킨·호프=저녁)
> - **후식(v1.12)**: 군인공제회관 **반경 1km CE7(카페)** 검색 → `coffee` 탭 (5종 카테고리 매핑)
> 중복 제거는 두 경우 동일(정규화 이름 완전일치=거리 무관, 부분일치=150m). 한 번의 `/api/sync` 호출로 둘 다 실행.
> 코드는 완료됨. 아래는 사용자가 하는 일회성 세팅.

## 흐름
```
Vercel Cron(매일) → /api/sync → 카카오 검색(FD6+CE7) → 시트에 없는 신규만 필터
                              → Apps Script 웹훅(sheet 지정) → restaurants / coffee 탭에 append
```

## 0. `coffee` 탭 준비 (후식 동기화 대상)
후식 동기화가 append하려면 시트에 **`coffee` 탭**이 있어야 하고, **1행에 헤더**가 있어야 합니다(빈 탭이면 헤더 없이 데이터만 쌓임). `coffee` 탭 A1에 아래 헤더 행을 붙여넣으세요(탭 구분 → 셀 자동 분리):

```
name	category_sub	signature_menu	price_note	address	lat	lng	comment	active	weight	phone	visited	recommended	아아INDEX
```

## 1. Apps Script 웹훅 만들기 (시트 쓰기 통로)
1. 구글 시트 열기 → 상단 **확장 프로그램 → Apps Script**
2. 기본 코드 지우고 아래를 붙여넣기. **`SECRET`을 임의의 긴 문자열**로 바꾸기(예: `dogok-9f3k2xQ7...`) — 이 값을 기억해 두세요.
   (기존에 이미 배포했다면 `doPost`만 아래 버전으로 교체 후 **새 배포**하면 됩니다. `sheet` 미지정 시 `restaurants`로 동작해 기존 호환.)

```javascript
// 도곡한 미식가 — 시트 자동 추가 웹훅 (restaurants + coffee 공용)
const SECRET = '여기에_긴_비밀문자열';  // 아래 SHEET_WEBHOOK_SECRET과 반드시 동일
const ALLOWED = ['restaurants', 'coffee'];  // 쓰기 허용 탭

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json({ error: 'unauthorized' });
    const name = ALLOWED.indexOf(body.sheet) >= 0 ? body.sheet : 'restaurants'; // 기본 restaurants
    const sheet = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sheet) return json({ error: name + ' 탭 없음' });
    const rows = body.rows || [];
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    return json({ added: rows.length, sheet: name });
  } catch (err) {
    return json({ error: String(err) });
  }
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. **배포 → 새 배포** → 유형(톱니바퀴) **웹 앱** 선택
   - 실행 계정: **나(본인)**
   - 액세스 권한: **모든 사용자(Anyone)**  ← 외부(Vercel)에서 호출하려면 필수
   - **배포** → 권한 승인 팝업 뜨면 본인 계정으로 **승인**
4. 표시되는 **웹 앱 URL**(`…/exec`로 끝남) 복사 → 이게 `SHEET_WEBHOOK_URL`.

> 보안: URL과 SECRET을 알아야만 행 추가 가능. 둘 다 비공개로 관리하세요.

## 2. Vercel 환경변수 3개 추가
Vercel → dogok-gourmet → Settings → Environment Variables:

| Key | Value |
|---|---|
| `SHEET_WEBHOOK_URL` | 1번에서 복사한 웹앱 URL |
| `SHEET_WEBHOOK_SECRET` | Apps Script의 `SECRET`과 **동일** |
| `CRON_SECRET` | 아무 긴 랜덤 문자열 (예: `cron-7Xk2...`) |

> 후식 동기화는 위 3개(웹훅 URL·시크릿·CRON)를 **그대로 재활용**합니다. 추가 환경변수 없음.
> (탭 이름을 바꿨다면 `GOOGLE_COFFEE_SHEET_TAB`도 지정 — 기본 `coffee`)

(로컬에서도 테스트하려면 `.env.local`에 같은 값들을 넣으면 됨)

## 3. 배포
```bash
git push
```
→ Vercel 재배포 시 `vercel.json`의 cron이 등록됩니다 (매일 03:00 UTC = 정오 KST).

## 4. 바로 테스트 (기다리지 않고)
배포 후 브라우저에서 (`<CRON_SECRET>`만 본인 값으로):
```
https://dogok-gourmet.vercel.app/api/sync?key=<CRON_SECRET>
```
- 결과 예: `{"restaurants":{"scanned":45,"fresh":3,"added":3,"skipped":42},"coffee":{"scanned":30,"fresh":8,"added":8,"skipped":22}}`
  - 각 블록: scanned=카카오에서 훑은 수, fresh=시트에 없던 신규, added=실제 추가, skipped=중복·반경 제외
- 웹훅 쓰기만 점검: `?key=<CRON_SECRET>&ping=1`(restaurants), `?key=<CRON_SECRET>&ping=coffee`(coffee) — 각 탭에 `__동기화_테스트__` 행 1개 추가(active=FALSE, 확인 후 삭제).
- `restaurants` / `coffee` 탭 맨 아래에 신규 행이 붙었는지 확인.
- 추가된 행은 이름·카테고리·좌표·전화만 채워짐 → 메뉴·추천은 나중에 큐레이션.

## 참고 / 한계
- **식당**(FD6): 4개구 내 가장 가까운 45곳. 카페·베이커리·기타 제외, 치킨·호프는 `meal_type=저녁`.
- **후식**(CE7): 군인공제회관 **반경 1km** 카페 가장 가까운 45곳. 5종 카테고리로 매핑(실패 시 커피·음료). `visited`/`recommended`는 FALSE로 들어가니 방문 후 손으로 TRUE 지정.
- 하루 1회(Vercel Hobby cron 최소 주기 1일). 한 번의 `/api/sync`로 식당+후식 동시 실행 → cron은 1개면 충분.
- 이미 있는 매장은 중복 판정으로 제외 → 중복 안 쌓임. 매일 돌면서 신규만 축적.
  - **정규화 이름(공백·지점 접미사 제거) 완전일치면 좌표와 무관하게 중복**으로 본다 → 시트 좌표가 카카오와 수십 m 어긋나거나, 좌표·카테고리 누락으로 파서가 스킵한 행이어도 재추가되지 않음. (원본 CSV 상호명까지 비교) 이름이 부분만 겹치는 경우(지점 구분)엔 150m 이내일 때만 중복 처리. 로직: `src/lib/syncDedupe.ts`.
- 넓은 반경으로 한 번에 크게 긁고 싶으면 수동 스크립트: 식당 `scripts/seed-sheet.mts`, 후식 `scripts/seed-coffee.mts`(둘 다 `.env.local`에 `KAKAO_REST_KEY` 필요).
