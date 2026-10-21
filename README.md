# 데이트맵

인스타에서 본 데이트 장소를 공유 버튼 한 번으로 커플 공동 지도에 모으는 개인용 앱입니다. PRD 1단계(P0)를 구현했습니다.

## 들어 있는 것

| 기능 | 위치 |
| --- | --- |
| 공유 시트 → 서버 (F-01) | `src/app/api/share/route.ts` |
| 캡션 수집: og 메타 → oEmbed → 붙여넣기 (F-02) | `src/lib/instagram.ts` |
| 추출 모듈 규격과 라우터 (F-15) | `src/lib/extract/` |
| 캡션·위치 태그·이미지 모듈 (F-03, F-16) | `src/lib/extract/modules/` |
| 영상 모듈 자리 (F-17, 꺼져 있음) | `src/lib/extract/modules/video.ts` |
| 카카오 로컬 검색과 후보 순위 (F-04) | `src/lib/kakao.ts` |
| 자동 확정 / 확인 화면 결정 (F-05) | `src/lib/pipeline.ts` |
| 여러 장소 추리기 + 지점 고르기 + 직접 검색 (F-13, F-09) | `src/app/confirm/[sourceId]/` |
| 공동 지도, 상태 4종, 필터, 메모, 핀 지우기 (F-06, F-08, F-10, F-12) | `src/app/MapApp.tsx` |
| 원본 게시물 임베드 (F-14) | `src/app/MapApp.tsx`의 `PlaceSheet` |
| 중복 병합과 "둘 다 저장함" (F-07) | `savePlace`, `/api/places` |

기존 DM 임포트(F-11)는 아직 없습니다.

## 설정 순서 (약 30분)

### 1. Supabase

1. 새 프로젝트를 만듭니다.
2. SQL Editor에 `supabase/schema.sql`을 붙여넣고 실행합니다.
3. 마지막 줄 결과로 나오는 `token`을 적어 둡니다. 단축어와 지도 주소에 씁니다.
4. Project Settings → API에서 `Project URL`과 `service_role` 키를 복사합니다.

### 2. 카카오 디벨로퍼스

1. [developers.kakao.com](https://developers.kakao.com)에서 애플리케이션을 추가합니다.
2. 앱 키에서 **REST API 키**(서버 검색용)와 **JavaScript 키**(지도용)를 복사합니다.
3. 플랫폼 → Web에 사이트 도메인을 등록합니다: 배포 주소(예: `https://datemap-xxx.vercel.app`)와 `http://localhost:3000`.
4. 앱 설정에서 카카오맵(지도·로컬) 사용 설정이 필요하면 켭니다. 지도가 안 뜨면 가장 먼저 이 부분과 도메인 등록을 확인하세요.

### 3. LLM API 키 (Gemini 기본)

[aistudio.google.com](https://aistudio.google.com) → **Get API key**에서 무료 키를 만들어 `GEMINI_API_KEY`에 넣습니다. 모델은 `GEMINI_MODEL`(기본 `gemini-flash-lite-latest`)로 바꿀 수 있습니다. Anthropic을 쓰려면 `LLM_PROVIDER=anthropic`과 `ANTHROPIC_API_KEY`를 넣으세요.

### 4. 배포 (Vercel)

1. 이 폴더를 GitHub 저장소로 올리고 Vercel에서 가져옵니다.
2. `.env.example`의 값을 Environment Variables에 넣습니다. `APP_BASE_URL`은 배포 주소입니다.
3. 배포 후 `https://배포주소/?t=토큰&who=이름`을 사파리로 열고, 공유 → **홈 화면에 추가**를 누릅니다. 두 사람 모두 자기 이름으로 합니다.

로컬에서 먼저 보려면:

```bash
cp .env.example .env.local   # 값 채우기
npm install
npm run dev                  # http://localhost:3000/?t=토큰&who=민지
npm test                     # 단위·흐름 테스트 24개
```

### 5. iOS 단축어 (두 폰 모두)

단축어 앱 → **+** → 이름을 `데이트맵에 저장`으로 하고 아래 동작을 순서대로 추가합니다.

1. 단축어 설정(ⓘ)에서 **공유 시트에서 보기**를 켜고, 받는 입력 유형을 **URL**과 **텍스트**로 둡니다.
2. **URL 내용 가져오기**
   - URL: `https://배포주소/api/share?t=토큰`
   - 방법: `POST`, 요청 본문: `JSON`
   - 필드 `url` (텍스트) = **단축어 입력**
   - 필드 `who` (텍스트) = 내 이름 (예: `민지`)
3. **사전 값 가져오기**: 키 `confirm_url` ← 앞 단계 결과
4. **만약** `사전 값`이 **값이 있음**이면
   - **URL 열기**: `사전 값`
5. **그렇지 않으면**
   - **사전 값 가져오기**: 키 `message` ← 2단계 결과
   - **알림 표시**: `사전 값`
6. **만약 종료**

이제 인스타에서 공유 → **공유…** → `데이트맵에 저장`을 누르면 됩니다. 확실한 한 곳은 알림만 뜨고 바로 저장되고, 여러 곳이거나 지점이 애매하면 확인 화면이 열립니다. 캡션을 못 가져오면 같은 화면에서 캡션을 붙여넣으면 됩니다.

#### 선택: 스크린샷으로 찾기 (이미지 모듈)

캡션에 정보가 없고 사진·자막에만 상호가 있을 때 씁니다. 공유 시트 입력을 **이미지**로 받는 단축어를 하나 더 만들고, 이미지를 **Base64 인코딩**한 뒤 2단계와 같은 요청에 `images` (배열) 필드로 넣습니다. 링크는 클립보드에서 `url`로 넣습니다. 서버는 캡션·위치 태그로 충분하지 않을 때만 이미지 모듈을 부릅니다.

## 추출 모듈 추가하기

모든 모듈은 `src/lib/extract/types.ts`의 `ExtractorModule` 규격을 따릅니다. 입력은 `SourceContext`, 출력은 `PlaceCandidate[]`입니다.

```ts
export const commentModule: ExtractorModule = {
  name: "comment",          // ModuleName에 추가
  cost: "heavy",            // cheap = 항상, heavy = 앞 결과가 부족할 때만
  enabled: true,
  canRun: (ctx) => ...,
  run: async (ctx, { llm }) => [...],
};
```

`src/lib/extract/router.ts`의 `MODULES`에 한 줄 넣으면 라우터가 알아서 부릅니다. 무거운 모듈은 신뢰도 0.6 이상인 후보가 이미 있으면 건너뜁니다(`GOOD_ENOUGH`). DB의 `extractions.module` 체크 제약에도 이름을 추가하세요.

## 알아 둘 점

- 인스타는 서버 요청에 로그인 페이지를 돌려줄 때가 많아 og 캡션 수집이 실패할 수 있습니다. 그래서 붙여넣기 화면을 항상 대비책으로 둡니다. 사용해 보며 `sources.caption_method` 비율로 성공률을 확인하세요.
- 인스타 사진·영상은 서버에 저장하지 않고 공식 임베드로만 보여 줍니다.
- 보드 토큰이 곧 비밀번호입니다. 지도 주소를 다른 사람에게 보내지 마세요.
