# places-sessions-search

project 키워드 검색을 새로 짓는다. 색인 없이, 검색할 때 project의 text 파일을 훑어 찾는다. 새 module 폴더 `packages/core/projects/search/`이다. 옛 FTS5 색인 검색(`search.query`·`search.status`, `outline-and-search/worker/search.ts`)은 wave 1이 지운 상태로 시작한다.

- 단위: places-sessions (wave 3)
- 선행: places-sessions-projects (`registry/mod.ts`가 `gitignoreExcludes`·`symlinkEscapesRoot`를 내놓고, `projects/register.ts`·`mod.ts`를 새 모양으로 정리한 뒤여야 한다)
- 소유(이 task만 고친다):
  - `packages/core/projects/search/` (새로. 소유 바꾸기: places-sessions)
  - `packages/core/projects/register.ts` (검색 read 등록 한 줄만)
  - `packages/core/projects/mod.ts` (검색 export 한 줄만)
- 읽을 것:
  - 요구: req-1476~1480(검색), req-1481~1483은 폐기 — `/home/pyosechang/projects/lophn/project-docs/requirements/core-projects.yaml`
  - inventory: `I3.10#1`
  - 규칙: `dev/code.md`(순수 판정과 바깥 IO를 나눈다), `dev/testing.md`
  - 지금 코드: `core/projects/registry/rules.ts`(`gitignoreExcludes`, `symlinkEscapesRoot`), `core/deno.json`의 `ignore` 의존, `core/projects/register.ts`의 `apiReads` 등록
- 계약:
  - 쓰는 것: `protocol/projects/project-search.ts`(`projectSearch`, `projectSearchInputSchema`, `projectSearchMatchSchema`), `core/projects/registry`의 `gitignoreExcludes`·`symlinkEscapesRoot`·project 폴더 읽기(`registry/mod.ts`)
  - 내놓는 것: `search/mod.ts`의 `projectSearchRead(deps)`(`ApiReadDefinition<typeof projectSearch>`)

## 할 일

1. `search/model.ts`(순수): 훑기 규칙.
   - 대소문자를 무시하는 부분 문자열 일치. 질의와 줄을 NFC로 맞춘 뒤 `toLowerCase()`로 비교한다(req-1476~1480).
   - 결과는 `{folder_path, path, line, text, start, end}`이다. `text`는 그 줄의 snippet(앞뒤를 잘라 200자 안쪽), `start`·`end`는 `text` 안 일치 위치다. 정렬은 등록 폴더 순서 → 경로(code unit 순) → 줄 번호.
   - text 파일 판별: 앞 8KB에 NUL이 없고 UTF-8로 읽힌다. 큰 파일 상한(예: 5MB)을 정하고 넘으면 건너뛴다. 값은 정해진 것이 없으므로 보고 "정한 것"에 적는다.
   - `.git` 폴더는 건너뛴다. `.gitignore`가 뺀 경로는 건너뛴다. 중첩 `.gitignore`도 따른다(순회 중 만나는 `.gitignore`를 `GitignoreRule`로 모은다. 가장 깊은 파일부터 적용하는 `gitignoreExcludes`의 규칙을 그대로 쓴다).
   - snippet redaction, 건너뛴 파일 알림, place·format·score·summary는 하지 않는다.
2. `search/work.ts`(바깥 IO): 등록 폴더(`folder`로 좁힐 수 있음)를 걸으며 파일을 읽는다.
   - 폴더 존재 확인은 `registry`의 읽기를 쓴다. 폴더가 디스크에 없으면 그 폴더만 건너뛰고 나머지는 계속한다.
   - 연결 폴더 밖을 가리키는 symlink는 따라가지 않는다(`symlinkEscapesRoot`).
   - 도는 동안 파일이 사라지면(ENOENT) 그 파일을 건너뛴다. 오류로 멈추지 않는다.
   - 검색 직전에 만든 파일의 단어가 바로 찾아지고 지운 파일은 바로 사라진다(색인이 없으므로 저절로 그렇다).
   - 페이지: `limit`(기본 200, 최대 1000)개를 채우면 멈추고 `next_cursor`에 (폴더 순번, 경로, 줄)을 담는다. 같은 입력의 다음 호출은 그 뒤부터 이어 훑는다.
   - 큰 project에서 연달아 호출될 때 마지막만 쓰이게 하는 취소는 요구가 폐기되어(req-1481) 만들지 않는다. 호출 취소(`AbortSignal`)가 handler에 오면 훑기를 멈추는 정도만 받는다.
3. `search/mod.ts`: `projectSearchRead(deps)`. `ApiReadDefinition`이다. 사람만 호출한다(actors `["user"]`). `register.ts`의 `apiReads`에 한 줄 올린다.
4. test: `search_test.ts` 한 파일, 임시 폴더로 표를 돈다.
   - "`.gitignore`가 뺀 파일과 `.git` 안, 연결 폴더 밖으로 나가는 symlink의 파일은 결과에 없다"
   - "NFC가 다른 한글 질의와 대소문자가 다른 질의도 같은 줄을 찾고, 결과는 경로 순서 다음 줄 순서다"

- (lead가 더함, places-sessions-projects가 넘긴 것) project registry가 `searchScopeOf(folders, folder?)`를 내놓는다. 폴더를 안 주면 등록 폴더 전부, 주면 등록 폴더나 그 아래 절대 경로를 시작 폴더로 준다(밖이면 `invalid_input`). `loadProject`, `gitignoreExcludes`, `symlinkEscapesRoot`도 있다. `rules.ts`의 `hardExclusion`·`WRITE_TEMP_PREFIX`는 지워졌으니 `.git` 건너뛰기는 search가 직접 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "gitignore와 .git, 밖으로 나가는 symlink는 훑지 않는다"
- 남지 않음: `grep -rn "fts5\|FTS5\|search_status\|searchQuery" packages/core/projects`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`·`registry.ts`의 `ROUTES`에 `PROJECT_SEARCH_ROUTES`를 올린다(lead). `core/projects/register.ts`의 `apiReads`
- 안 쓰게 된 export: 없음
- 정한 것: 큰 파일 상한, text 판별 규칙, snippet 길이, 페이지 cursor 모양
- 계약 바꾸기 요청(wave 3): `projectSearch` 입력에 모자란 칸이 있으면 여기에 적는다
