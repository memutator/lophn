# screens-project-search

Search 탭 kind에 project 키워드 검색을 더하고, rail과 새 탭(+)의 Search 단추가 이것을 열게 한다. 키워드 검색은 검색어, 폴더 하나로 좁히기, 결과는 파일 경로 순 다음 줄 순, 일치한 부분이 든 snippet이고, 결과를 누르면 그 줄에서 파일이 열린다. context 없이 열리고 취소, 건너뛴 파일 안내, 더 보기 단추는 없다. 같은 `search` kind가 context의 선언된 검색(Context 탭의 Searches에서 열린다)도 계속 그린다. 둘의 차이는 layout 값에 `context`가 있느냐다.

- 단위: screens-project (wave 3)
- 선행: `screens-project-sidebar`(`workspace/source.ts`를 차례로 고친다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/search.tsx`
  - `packages/shell/renderer/workspace/search/` (새로)
  - `packages/shell/main/workspace/kinds/search.ts`
  - `packages/shell/renderer/workspace/source.ts`·`core-source.ts`에 `searchSource?: FileSearchSource` 한 칸과 그 조립 한 줄(추가 소유, lead 승인 2026-10-16: screens-project-sidebar 소유 file이다. 더하기만 한다. 겹치면 lead가 푼다)
  - `tools/wireframes/frames/compositions/project-files/file-search.tsx`
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - inventory: `U3.3#8`, `U3.3#9`(검색 결과의 줄로 열기: 이 task는 줄을 넘기는 쪽이고 열린 탭이 그 줄로 scroll하는 쪽은 screens-project-editor), `U6.1#1`
  - inventory(다른 단위에서 넘어온 줄): `U2.3#21`(Search 탭이 context에 묶임: layout이 `context`를 필수로 갖고 없으면 Contexts 탭이 대신 열림 → 키워드 검색은 context 없이 열린다. screens-contexts 줄이지만 `kinds/search.tsx`가 이 task 파일이다), `U1.3#12`의 `kinds/search.tsx` 부분(Search 탭의 [Ask …] 단추 `onAsk`. 하위 탭 쪽은 screens-contexts-views)
  - 결정: `../README.md` 3장 #57
  - 지금 코드: `workspace/kinds/search.tsx`(181줄: `openSearch`, `openSearchFor`, `openSearchShortcut`, `searchKind`가 `../contexts/search-tab.tsx`의 `SearchTab`을 그린다), `main/workspace/kinds/search.ts`(103줄: layout에 `context`, `declared_search`, `inputs`, `page`, `saved_view`)
  - 본보기(화면): `tools/wireframes/frames/compositions/project-files/file-search.tsx`(120줄), `project-files/file-data.ts`(`searchFiles`, `SEARCH_FOLDERS`, `CorpusLine`), `files.module.css`의 finder 규칙, `project-files/pages.tsx`(`FileSearchResults`, `FileSearchFolder`, `FileSearchOpened`), `project-app.tsx`(`search:files`와 `search:declared`가 같은 kind의 두 탭)
- 계약:
  - 쓰는 것:
    - `packages/protocol/projects/search.ts`(contract-calls-places): project 키워드 검색 route의 입력(검색어, 폴더 하나, 대소문자 무시 부분 문자열)과 결과(경로, 줄, 일치한 부분이 든 snippet. 경로 순서 다음 줄 순서). 이름은 고정된 파일을 따른다.
    - `packages/shell/ipc/workspace.ts`(contract-shell): layout 값의 search 탭 모양
    - `@lophn/design/components`의 `Input`, `Select`, `Field`
  - 내놓는 것:
    - `workspace/search/file-search.tsx`: `FileSearch({ project, initialQuery?, initialFolder?, onOpen(path, line) })`
    - `workspace/search/fake-source.ts`: wireframe `searchFiles`·`SEARCH_FOLDERS`를 옮긴 fake 검색 통로(gallery와 `desktop/dev-seed.ts`가 쓴다)
    - `kinds/search.tsx`: 두 갈래를 그리는 탭 kind. `openSearch`, `openSearchFor`(선언된 검색)의 이름과 인자는 그대로 둔다.
    - `openSearchShortcut(host)`: 이제 키워드 검색 탭을 연다(열려 있는 키워드 검색 탭이 있으면 그 탭을 고른다).

## 할 일

1. 검색 통로. `workspace/search/source.ts`에 `FileSearchSource`(`search({ project, query, folder? })`)를 두고 core 구현(`workspace/search/core-source.ts`)은 `CoreSource.call`로 고정된 route(`project.search`)를 부른다. `WorkspaceSource.searchSource`로 탭 kind에 넘기고 kind는 `host.props.source.searchSource`로 읽는다. 폴더 선택지는 project의 연결 폴더와 하위 폴더에서 온다(`WorkspaceSource` 읽기를 쓴다. screens-project-sidebar가 만든 `ProjectView.folders`). 결과 순서는 route가 이미 정해 준다. 근거: `U3.3#8`.
2. `FileSearch`를 옮긴다. 입력 form(Find in files, Folder 선택), 요약 줄("N matches in M files · by path, then line", 빈 검색어면 "Type text to search the files in this project."), 파일별 묶음(경로와 개수), 줄 행(줄 번호와 snippet에서 일치한 부분을 `<mark>`로). 결과 행을 누르면 `onOpen(path, line)`을 부르고 그 행이 눌린 모양(`aria-current`)이 된다. "No matches." 안내를 둔다. 근거: `U3.3#8`.
3. 열기. 결과를 누르면 `host.openTab`으로 그 경로의 파일 탭(`kind: "document_editor"`, key는 경로)을 `fields: { line }`와 함께 연다. 이미 열려 있으면 그 탭을 고르고 `patchTab`으로 `line`을 올린다. 근거: `U3.3#9`.
4. `kinds/search.tsx`가 두 갈래를 그린다. 탭의 `context`가 있으면 지금처럼 `SearchTab`(선언된 검색)을, 없으면 `FileSearch`를 그린다. 탭 제목은 키워드 검색이 "Search"다. `fromStored`/`toStored`/`hint`는 `context`가 없는 모양(`query`, `folder`)을 더한다. `onAsk`·`askContextEngineer`를 선언된 검색 탭에 넘기던 것은 지운다. `openSearchShortcut`이 context가 하나도 없으면 Contexts 탭을 대신 열던 것을 없앤다(키워드 검색은 context가 필요 없다). 근거: `U2.3#21`, `U1.3#12`.
5. layout. `main/workspace/kinds/search.ts`의 layout을 두 모양의 합집합으로 바꾼다: 선언된 검색(`context`가 있고 `declared_search`, `inputs`, `page`, `saved_view`)과 키워드 검색(`context` 없음, `query`, `folder`). 키워드 검색 복원은 검색을 다시 계산한다(결과는 저장하지 않는다). `hint`·`view`는 키워드 검색이면 context 범위 검사 없이 key만 싣고 검색어는 싣지 않는다. 근거: `U2.3#21`.
6. 문구를 wording key로 바꾼다(영역 `file-search`: `file-search.label.query`, `file-search.label.folder`, `file-search.notice.type-text`, `file-search.notice.no-matches`, `file-search.summary.matches` 등). rail의 Search tooltip은 `contexts.label.rail-search`를 쓰던 것을 `file-search.label.tab`으로 옮긴다(선언된 검색 탭의 제목은 `contexts.*`에 남는다). key는 `catalog/project.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/project.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
7. gallery. `project-files/file-search.tsx`는 export 이름과 props(`FileSearch`)를 유지한 채 renderer `FileSearch`를 fake 통로로 그리게 다시 쓴다(`project-app.tsx`, `project-files/pages.tsx`가 import한다). `file-data.ts`는 다른 task도 읽으므로 이 task가 지우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (검색 화면. 검색 규칙은 core 쪽 test가 본다)
- 남지 않음: `grep -rn "onAsk\|askContextEngineer" packages/shell/renderer/workspace/kinds/search.tsx`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-file-search`, `new-file-search-folder`, `new-file-search-opened`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `catalog/project.ts`의 `file-search.*` key. `kinds/registry.ts`는 kind 이름이 같아 고칠 것이 없다.
- 안 쓰게 된 export: `contexts.label.rail-search`가 rail 쪽에서 쓰이지 않게 되면 그 key
- 정한 것: 검색 입력을 얼마나 기다렸다 부르는지, 결과 한도(route가 한도를 주지 않으면 화면이 몇 개까지 그리는지), layout에서 키워드 검색과 선언된 검색을 구별하는 방법(`context`의 유무)
- 계약 바꾸기 요청(wave 3): 검색 route가 폴더 하나로 좁히기나 snippet을 주지 않으면, layout schema에 키워드 검색 칸이 필요하면 여기 적는다
