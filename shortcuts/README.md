# 데이트맵에 저장

아이폰 공유 시트에서 인스타그램 링크를 데이트맵의 장소 저장 화면으로 전달하는 단축어입니다. URLs·Text 입력을 받고 첫 번째 URL을 인코딩해 `/add?url=…`을 엽니다. 링크가 없으면 `/add`를 엽니다.

단축어에는 배포 주소만 들어 있습니다. PIN·세션·API 키를 넣지 않으며, 클립보드나 사진을 읽지 않습니다. 링크 분석과 저장은 기존 앱의 인증 흐름을 거칩니다.

## 아이폰에 추가하기

1. 데이트맵 설정에서 **아이폰 단축어 추가**를 누릅니다.
2. Apple의 설치 화면에서 단축어 내용을 확인합니다.
3. **단축어 추가**를 눌러 마무리합니다.

현재 설치 링크: [데이트맵에 저장](https://www.icloud.com/shortcuts/6f8893730bdd41bebc20e0a5caa129ab).

추가한 뒤 인스타 게시물의 **공유 → 더보기 → 데이트맵에 저장**을 선택합니다. 앱의 설치 버튼은 이 iCloud 링크를 사용합니다. `public/shortcuts/datemap-instagram.shortcut`은 유지관리·백업용 서명 파일로 보관합니다.

## 재생성

Python 3 표준 라이브러리만 사용합니다.

```sh
python3 scripts/generate-instagram-shortcut.py
python3 scripts/generate-instagram-shortcut.py --check
```

다른 배포 주소를 사용하려면 `--base-url https://example.com`을 지정합니다. 생성 결과는 `instagram-save.unsigned.shortcut`이며 아직 아이폰 설치용으로 서명되지 않은 binary plist입니다.

## 서명과 iCloud 공유

macOS에서 Apple의 `shortcuts sign`으로 별도 서명합니다. 생성 스크립트는 서명·설치하거나 개인 단축어 저장소를 읽고 수정하지 않습니다.

```sh
mkdir -p public/shortcuts
shortcuts sign --mode anyone \
  --input shortcuts/instagram-save.unsigned.shortcut \
  --output public/shortcuts/datemap-instagram.shortcut
```

서명한 파일을 공유본으로 만드는 순서입니다.

1. Mac에서 `public/shortcuts/datemap-instagram.shortcut`을 열어 단축어 앱에 추가합니다.
2. 가져온 단축어의 이름을 **데이트맵에 저장**으로 바꿉니다. 이 환경에서는 파일명이 가져오기 이름으로 사용되고 plist의 `WFWorkflowName`은 반영되지 않았습니다.
3. 아래 동작을 확인한 뒤 단축어의 **공유 → iCloud 링크 복사**로 공유 링크를 만듭니다.
4. `src/components/ShortcutInstall.tsx`의 설치 주소와 루트 README·이 문서의 링크를 새 주소로 맞춥니다.

공유하기 전 다음을 확인합니다.

- 이름이 `데이트맵에 저장`이고 공유 시트에서 URL·텍스트를 받습니다.
- 인스타 URL이 쿼리 파라미터 하나로 전달됩니다. `?`, `&`, `#`가 포함된 링크도 원래 링크를 보존합니다.
- URL이 없는 입력은 장소 저장 화면을 엽니다.
- 설치된 단축어에는 외부 코드를 실행하거나 앱 API에 직접 쓰는 동작이 없습니다.

생성기의 구조 검증은 변수 참조·문자열 변수 위치·조건 분기 연결과 재현 가능한 파일 생성만 확인합니다. 서명 성공이나 실제 iPhone 공유 시트 실행을 대신하지 않습니다.

iCloud 링크는 공유 시점의 단축어 내용을 담고 있습니다. 배포 주소나 동작을 바꾸면 원본 재생성·서명과 새 공유본 생성을 모두 다시 진행해야 합니다. 유지관리 파일이나 웹 앱만 배포해서는 기존 iCloud 링크가 바뀌지 않습니다. 기기에 설치한 단축어도 자동 갱신되지 않으므로 사용자가 새 공유 링크를 열어 다시 추가해야 합니다. [Apple의 단축어 공유 안내](https://support.apple.com/guide/shortcuts/apdf01f8c054/ios)도 참고할 수 있습니다.

## 형식 근거

- macOS에 포함된 `WorkflowKit.framework/Versions/A/Resources/Gallery.bundle/Contents/Resources/*.wflow`: Apple의 plist·변수 직렬화 형식
- [ShortcutsBench 액션 파라미터 자료](https://github.com/EachSheep/ShortcutsBench/blob/master/data/all_api2parasummary.json): Get URLs·Get Item from List·URL Encode 파라미터
- [Shortcuts Playground의 검증된 형식 안내](https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/BEST_PRACTICES.md): 공유 입력·조건 분기·텍스트 변수 연결
