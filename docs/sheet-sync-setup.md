# 시트 자동 동기화 세팅 (카카오 신규 → 관리자DB)

> 매일 정오(KST) 카카오 주변 검색 결과 중 **시트에 없는 신규 식당**을 자동으로 `restaurants` 탭에 추가.
> 잡음 필터(카페·베이커리 제외, 치킨·호프=저녁)와 중복 제거는 시드와 동일 로직.
> 코드는 완료됨. 아래는 사용자가 하는 일회성 세팅.

## 흐름
```
Vercel Cron(매일) → /api/sync → 카카오 검색 → 시트에 없는 신규만 필터 → Apps Script 웹훅 → 시트에 append
```

## 1. Apps Script 웹훅 만들기 (시트 쓰기 통로)
1. 구글 시트 열기 → 상단 **확장 프로그램 → Apps Script**
2. 기본 코드 지우고 아래를 붙여넣기. **`SECRET`을 임의의 긴 문자열**로 바꾸기(예: `dogok-9f3k2xQ7...`) — 이 값을 기억해 두세요.

```javascript
// 도곡한 미식가 — 시트 자동 추가 웹훅
const SECRET = '여기에_긴_비밀문자열';  // 아래 SHEET_WEBHOOK_SECRET과 반드시 동일

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json({ error: 'unauthorized' });
    const sheet = SpreadsheetApp.getActive().getSheetByName('restaurants');
    if (!sheet) return json({ error: 'restaurants 탭 없음' });
    const rows = body.rows || [];
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    return json({ added: rows.length });
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

(로컬에서도 테스트하려면 `.env.local`에 같은 3개를 넣으면 됨)

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
- 결과 예: `{"scanned":45,"fresh":3,"added":3,"skipped":42}`
  - scanned=카카오에서 훑은 수, fresh=시트에 없던 신규, added=실제 추가, skipped=중복·필터 제외
- 시트 `restaurants` 탭 맨 아래에 신규 행이 붙었는지 확인.
- 추가된 행은 이름·카테고리·좌표·전화만 채워짐 → 메뉴·평점은 나중에 큐레이션.

## 참고 / 한계
- 카카오 카테고리 검색(FD6)의 **가장 가까운 45곳**을 훑음. 사무실 근처에 새로 생긴 곳은 자연히 잡힘. 반경 밖 먼 곳까지 싹 훑진 않음(그건 필요 시 `scripts/seed-sheet.mts` 수동 실행).
- 하루 1회. Vercel Hobby 플랜은 cron 최소 주기가 1일이라 딱 맞음.
- 카페·베이커리·정체불명(기타)은 자동 추가 안 됨(시드 필터 재사용). 치킨·호프는 `meal_type=저녁`으로 추가.
- 이미 있는 식당은 이름+50m 중복 판정으로 제외 → 중복 안 쌓임.
