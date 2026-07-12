# 배포 가이드 (Phase 3 — GitHub + Vercel)

> 로컬 git 초기 커밋 완료(`main` 브랜치, 70파일, 비밀키 제외). 프로덕션 빌드 통과 확인됨.
> 아래는 계정 로그인이 필요해 사용자가 직접 하는 단계.

## 1. GitHub 저장소 만들기
- github.com 로그인 → 우상단 **+** → **New repository**
- Repository name: 예) `dogok-gourmet`
- **Private** 선택 (사내용 권장. 코드에 키는 없지만 안전하게)
- ⚠️ **"Add a README / .gitignore / license" 는 체크하지 말 것** — 빈 저장소로 생성 (로컬에 이미 있음)
- **Create repository**

## 2. 로컬 → GitHub push
저장소 생성 후 GitHub이 보여주는 **"…or push an existing repository from the command line"** 블록을 복사해 프로젝트 폴더 터미널에서 실행. 형태:
```
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git push -u origin main
```
- 첫 push 때 로그인 창(브라우저)이 뜨면 GitHub 로그인/승인.
- GitHub에서 코드가 보이면 성공.

## 3. Vercel 연결
- vercel.com 로그인 (**GitHub 계정으로 로그인** 추천 → 저장소 접근이 간편)
- **Add New → Project → Import Git Repository** → 방금 만든 저장소 **Import**
- Framework: **Next.js** 자동 감지 (그대로 두기)

## 4. ⚠️ 환경변수 등록 (필수!)
Import 화면의 **Environment Variables**(또는 이후 Settings → Environment Variables)에서 아래 5개 추가.
값은 로컬 `.env.local`에서 그대로 복사:

| Key | Value |
|---|---|
| `KAKAO_REST_KEY` | (.env.local 값) |
| `KMA_SERVICE_KEY` | (.env.local 값) |
| `GOOGLE_SHEET_ID` | (.env.local 값) |
| `GOOGLE_SHEET_TAB` | `restaurants` |
| `USE_MOCK` | `FALSE` |

- `NEXT_PUBLIC_KAKAO_JS_KEY`는 현재 미사용 → 생략 가능.
- ⚠️ **`USE_MOCK`을 `FALSE`로 넣지 않으면 배포본이 mock(가짜) 데이터로 뜹니다** (앱 코드 기본값이 TRUE).

## 5. Deploy
- **Deploy** 클릭 → 1~2분 후 완료 → `https://<프로젝트>.vercel.app` URL 발급.
- 폰으로 열어 룰렛 확인 → 동료에게 URL 공유 🎉

## 이후 운영
- **맛집 추가/수정**: 구글 시트만 고치면 됨 (재배포 불필요, 최대 10분 캐시).
- **코드 수정**: 로컬에서 고치고 `git add -A && git commit -m "..." && git push` → Vercel **자동 재배포**.
- 나중에 카카오맵(지도 임베드)을 붙이면, 그때 Vercel 도메인을 카카오 콘솔 **플랫폼 > Web**에 등록.

## 보안 체크 (완료됨)
- `.env.local`·`REST API.txt`·`phase0-seed.tsv`는 `.gitignore`로 커밋 제외 확인됨.
- `.vercelignore`로 문서·스크립트·키파일은 Vercel 업로드에서도 제외.
- 키는 **Vercel 환경변수에만** 저장 (코드/저장소에는 없음).
