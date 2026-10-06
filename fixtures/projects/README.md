# documents fixture

documents 테스트가 쓰는 예시 project 폴더. `scenarios.ts`가 이 폴더를 임시 폴더로 복사하고, 앞으로 일어날 일을 사본에 만들어 준다. 원본은 테스트가 고치지 않는다.

`.gitattributes`가 `* -text`라서 BOM·CRLF·분해형 한글 바이트가 git checkout 뒤에도 그대로다. fixture 안의 `.gitignore`는 저장소에 넣으면 무시 규칙이 저장소 전체에 걸리므로 `_gitignore`로 저장하고, `copyFixture()`가 사본을 만들 때 이름을 되돌린다.

## fixture

- `notes-basic/` — Markdown 추출 재료. `**/*.md` 밖 파일, `.gitignore`와 그에 걸리는 파일, 하위 폴더 두 단, BOM·CRLF·분해형 한글. documents/formats 추출 테스트(projects#R3–R5, formats#R10–R16)가 쓴다.
- `multi-folder/` — 두 root에 같은 상대 경로 `notes/plan.md`, 그 안에 또 다른 등록 후보인 중첩 폴더. projects tracking 규칙 테스트와 file-tracking 관측 테스트가 쓴다.
- `mixed-formats/` — HTML(script·style·template·nav·textarea·hidden·aria-hidden·section id·title fallback)·XHTML·plain text·PDF·PNG·알 수 없는 data. formats#R2, R10–R16의 형식별 저장과 추출 테스트가 쓴다.
- `weekly-report/` — series 정렬과 다음 이름 재료. 정수 증가(`P001`, `P002`)와 소수판(`0.2`, `0.9`, `0.10`, `0.2.1`), 자유 이름 key. series#R5, R8 테스트가 쓴다.
- `two-apps/` — 앱 source 폴더 둘(`app-a`, `app-b`). 각자 blueprint(이름이 그 앱 ID)·source·계획 문서가 있다. coding-agent connection의 앱 하나 범위·대상 앱 찾기·제출 root 시험(connection#R5, R10, R11)이 쓴다.
- `korean-search/` — 긴 한국어 합성어(`데이터베이스마이그레이션계획서`)와 두 글자 단어(`문서`, `용어`). outline-and-search#R11 한국어 검색 테스트가 쓴다.

## helper (`scenarios.ts`)

- `fixturePath(name)` — fixture 원본의 절대 경로.
- `copyFixture(name, dest?)` — 바이트 그대로 임시 폴더로 복사하고 `_gitignore`를 `.gitignore`로 되돌린다.
- `editExternally(root, rel, content)` — lophn 밖에서 파일 내용을 고친 상황을 만든다.
- `deleteAndRecreate(root, rel, content)` — 지우고 같은 경로에 새 파일을 만든다(file-tracking 관측 테스트).
- `renameFile(root, from, to)` — 이름만 바꾸는 상황.
- `addOutsideSymlink(root, rel)` — 등록 root 밖을 가리키는 symlink를 만들고 바깥 폴더 경로를 돌려준다.
- `addGitDir(root, rel?)` — `.git/`에 `HEAD`·`config`·`notes.md`를 만든다. 저장소에는 넣지 못하는 것이므로 helper가 만든다.
- `addLophnDataDir(root, rel?)` — lophn 데이터 폴더(`.lophn/`)에 `lophn.db` 자리와 `documents/x.md`를 만든다.
- `removePermission(root, rel)` — 파일 권한을 000으로 떼고 되돌리는 함수를 돌려준다.
- `modifyKeepingSizeAndMtime(root, rel)` — size와 mtime을 그대로 두고 바이트만 바꾼다.
- `removeFixtureCopy(root)` — root 아래 권한을 되돌리고 임시 폴더를 지운다.
