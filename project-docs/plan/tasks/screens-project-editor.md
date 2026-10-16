# screens-project-editor

문서 탭을 "파일 탭"으로 바꾼다. 탭 key는 파일 경로이고 project 안팎 어느 파일이든 연다. 확장자로 viewer를 고른다: md는 지금의 live preview 편집기, JSON·YAML·코드 같은 text는 CodeMirror 편집기, 이미지와 pdf는 보기만 한다. 저장은 디스크 저장과 충돌 둘뿐이다(판, 비교, 복원, 형식 검사 없음). 정보 panel은 탭 안의 overlay다. 밖에서 바뀜과 충돌은 탭 위쪽 toast다. 지우기 확인은 화면 가운데 modal이다. wireframe 코드(`documents.tsx`, `project-files/viewers.tsx`, `notices.tsx`)를 renderer `editor/`로 옮긴다.

- 단위: screens-project (wave 3)
- 선행: `screens-project-sidebar`(`desktop/dev-seed.ts`를 차례로 고친다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/editor/` 전체
  - `packages/shell/renderer/workspace/kinds/document-editor.tsx`
  - `packages/shell/renderer/desktop/dev-seed.ts`의 `EditorDeps` 조립 부분(추가 소유, lead 승인 2026-10-16: `desktop/`은 screens-workspace 소유이고 `WorkspaceSource` 부분은 screens-project-sidebar가 고친다. 같은 file의 다른 줄이라 겹치면 lead가 푼다)
  - `tools/wireframes/frames/compositions/documents.tsx`, `project-files/viewers.tsx`, `project-files/notices.tsx`
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
  - (lead 준비) packages/shell/renderer/deno.json의 CodeMirror 언어 팩 `@codemirror/lang-json`, `@codemirror/lang-yaml`. 의존성은 lead가 더하고 `stack.md`에 이유를 적는다. 이 task는 시작 전에 더해졌는지 확인하고 없으면 멈추고 보고한다.
- 읽을 것:
  - spec: S4 5장(지침 층: project `LOPHN.md`는 일반 파일) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `U1.3#7`(문서 머리 메타 줄의 판 번호), `U2.3#7`, `U2.3#8`, `U2.3#9`, `U2.3#10`, `U2.3#11`, `U2.3#12`, `U2.3#13`, `U2.3#14`, `U2.3#16`(지침 [Instructions] 진입), `U3.3#4`, `U3.3#5`, `U3.3#6`, `U3.3#7`(project 밖 파일 열기: 탭 쪽), `U3.3#9`(줄 번호로 열기: 열린 탭이 그 줄로 scroll하는 쪽), `U6.4#6`, `U6.1#1`, `I2.10#18`(목차 parser 통합)
  - inventory(다른 단위 줄이지만 file이 이 폴더에 있어 같이 맞춘다): `U1.3#18`(문구 가운데 `document.*`의 compare·version·restore·saver·diff 약 60키), `U2.5#5`·`I2.11#3`(`editor/reading-width.ts`가 `settings.get/apply`를 revision과 함께 부르는 것 → 새 설정 선언 모델의 읽기와 쓰기)
  - 결정: `../README.md` 3장 #93(편집기의 파일 읽고 쓰기는 shell main이 직접, 충돌은 내용 hash로 안다)
  - 지금 코드: `editor/document-view.tsx`(799줄), `save-state.ts`(689줄), `sessions.ts`(308줄), `save-status.tsx`(292줄), `conflict/{conflict-view.tsx, compare.ts}`, `notice-bar.tsx`, `info-panel/info-panel.tsx`(157줄), `document-head.tsx`, `document-menu.ts`, `instructions-entry.tsx`(414줄), `draft-document.ts`, `core-source.ts`(262줄), `source.ts`, `model.ts`(`joinPage`, `documentAddress`), `leave-dialog.ts`, `reading-width.ts`, `window-deps.ts`, `workspace/kinds/document-editor.tsx`
  - 본보기(화면): `tools/wireframes/frames/compositions/documents.tsx`(`ViewBar` 310줄~, `DocumentPane` 350줄~, `DocActions` 454줄~), `project-files/viewers.tsx`(`TextEditor`, `ImageViewer`, `PdfViewer`), `project-files/notices.tsx`(`SaveMark`, `ReloadedToast`, `ConflictToast`, `ConflictCompare`), `project-files/file-data.ts`(`fileKindOf`, 저장 상태 `saved | saving | conflict`), `project-files/pages.tsx`(`MarkdownEditing`, `TextFiles`, `MediaFiles`, `OutsideFile`, `FileReloaded`, `FileConflict`, `FileConflictCompare`, `FileDeleteConfirm`, `InstructionsFile`, `DocumentInfoContexts`)
- 계약:
  - 쓰는 것:
    - `packages/shell/ipc/files.ts`와 `preload/files-api.ts`(contract-shell): renderer의 `lophnFiles`(`FilesApi`: `list`, `read`(`{text, hash}`), `readBytes`(이미지·pdf), `write`(`{path, base_hash | null, text}` → `{hash}` 또는 `conflict`), `rename`, `delete`, `watch(paths)`, `onChanged(listener)`(`{path, hash | null}`), `counts`, `onCloseRequest(listener)`, `answerClose`). 오류 code는 `invalid_input | forbidden | not_found | conflict | unavailable | unsupported | too_large`. 상한은 글 8MiB, 보기용 바이트 64MiB. 이름과 모양은 고정된 파일을 따른다.
    - `FILE_PICK_CHANNEL`(`FolderPickerApi.pickFile()`): project 밖 파일을 OS dialog로 고른다(contract-shell). 열기 입구는 palette(screens-workspace)와 새 탭 menu다.
    - `packages/protocol/projects/outline-markdown.ts`의 `parseOutline`(공용 md 목차 parser. 화면이 가진 본문에 부를 때마다 부른다)
    - `ipc/instructions.ts`(contract-agent-tools): 전역·project 지침 파일 경로
    - `@lophn/design/components`의 `Toast`, `Dialog`, `Tabs`, `Menu`, `FileIcon`(ui-chrome)
  - 내놓는 것:
    - `workspace/kinds/document-editor.tsx`: 탭 kind. key는 파일 경로. `layout-map.ts`(screens-project-window)가 복원에 쓴다.
    - `editor/document-view.tsx`: `DocumentView({ path, ... })`와 `EditorDeps`
    - `editor/fake-source.ts`: wireframe `file-data.ts`의 `textOf`·`factsOf`·`metaOf`를 옮긴 fake 파일 통로(gallery와 `desktop/dev-seed.ts`가 쓴다)
    - 지금 외부(`desktop/entry.tsx`, `desktop/main.tsx`, `app-frame/app-detail/app-detail.tsx`, `desktop/lophn-space/lophn-space.tsx`)가 쓰는 export `windowEditorDeps`, `windowInstructionsSource`, `InstructionsButton`, `EditorSessions`, `readingWidthStore`의 이름은 이 task에서 지우지 않고 새 구현으로 유지한다(앱 층 지침 진입 `InstructionsButton`은 screens-app-space가 쓰지 않게 된 뒤 cleanup이 지운다).

## 할 일

0. 공통 규칙. `workspace/workspace.tsx`와 `kinds/host.ts`(screens-project-window가 이 task 뒤에 고친다)가 `editor/`의 export를 아직 쓴다(`CompareTarget`, `DocumentTabMeta`, `DocumentInfoPanel`, `EditorDeps`, `DocumentView` 등). 그 이름들은 window task가 부르는 쪽을 바꿀 때까지 type으로 남긴다(값은 새 모양으로 줄여도 된다). 남긴 목록을 보고에 적는다. 어느 경우에도 `deno task check`가 통과해야 한다.
1. 탭 key와 읽기를 파일 경로로 바꾼다.
   - `kinds/document-editor.tsx`의 `DOC_ID`, `openDocument`, `documents.list`에 잡힌 문서만 연다는 규칙을 없앤다. key는 경로, 이미 열려 있으면 고르기만 한다. 근거: `U2.3#6`(layout 쪽은 window task).
   - 읽기는 디스크 파일을 한 번 읽는다(12,000 codepoint page와 cursor, 판 고정 읽기 `joinPage`·`BodyState.version`을 없앤다). `editor/source.ts`·`core-source.ts`를 경로 기반으로 다시 쓴다. 근거: `U2.3#7`.
   - project 밖 파일도 연다(탭에 "Outside project" 표시, 위쪽 breadcrumb). 열기는 OS dialog나 palette 입력이 경로를 넘긴다(그 입구는 screens-workspace의 palette). 근거: `U3.3#7`.
2. viewer를 확장자로 고른다(`viewers/viewer.tsx`, `fileKindOf`). md → 기존 live preview 편집기(`markdown-editor.tsx`), 이미지·pdf → 보기만(`viewers/image-viewer.tsx`, `viewers/pdf-viewer.tsx`), 그 밖 → text 편집기(`viewers/text-editor.tsx`, CodeMirror. JSON·YAML은 언어 팩, 나머지는 평문). 열 수 없는 형식은 안내를 보인다. 이미지·pdf 바이트는 `readBytes`로 받아 renderer가 blob URL로 그린다(content type은 main이 준다). 8MiB가 넘는 text(`too_large`)는 읽기만 하게 안내한다. 근거: `U3.3#4`, `U3.3#5`, `U3.3#6`, `U2.3#10`.
3. 저장 흐름을 줄인다. `save-state.ts`를 디스크 저장과 충돌만 아는 모양으로 다시 쓴다.
   - 입력이 멈추면 디스크에 쓴다(`FilesApi.write`). 쓸 때는 마지막으로 읽거나 쓴 hash를 `base_hash`로 보낸다. 디스크가 그 사이 바뀌었으면 main이 `conflict`로 거절하고 파일은 그대로다. 그러면 충돌로 둔다(초안은 그대로). 새 파일이면 `base_hash`가 `null`이다.
   - 결과를 모르는 쓰기(`unavailable`)는 같은 글을 다시 쓰지 않고 `read`로 지금 hash를 읽는다. 읽은 글이 내가 보낸 글과 같으면 저장된 것이고, 내 이전 hash와 같으면 안 써진 것이고, 그 밖이면 충돌이다.
   - 상태는 `saved | saving | conflict`(와 실패·offline)다. 기록 확인, version 확정, 형식 검사, `against: "newest"`, "내 것을 새 판으로 남기기"는 없앤다.
   - 저장 중 수와 창 닫기 guard(`sessions.ts`, `leave-dialog.ts`, main의 close guard)는 남긴다.
   근거: `U2.3#11`, `I1.10#16`(main 쪽 version 준비 제거는 screens-project-main).
4. 밖에서 바뀐 파일과 충돌을 toast로 다룬다. 밖(다른 편집기, git)에서 바뀌면, 고치지 않은 파일은 다시 읽어 새 내용을 보이고 "File reloaded" toast를 띄운다. 고치는 중이면 충돌 toast를 띄우고 [Keep mine]·[Take theirs]·[Compare]로 어느 쪽을 남길지 고르게 한다. toast는 그 탭 본문 위쪽에 붙고 색 다른 띠나 상자를 두지 않는다. `notice-bar.tsx`는 design `Toast`로 바꾼다. `conflict/`의 `against: "newest"` 분기는 지운다. 근거: `U2.3#12`, `U6.4#6`.
5. 문서 탭 모양을 옮긴다. 본문이 탭 바로 아래부터 시작하고 조작은 탭 안 맨 위의 view bar(한 줄)에 있다: 저장 상태(`SaveMark`), Edit, Info, … menu. 판 번호와 형식 문제 표시는 없다. 파일 지우기는 …menu의 Delete가 화면 가운데 modal(`Dialog`)로 확인한다. 편집 중에는 focus 테두리가 없다. 근거: `U6.4#6`, `U1.3#7`.
6. 정보 panel을 탭 안 overlay로 옮긴다(위 border가 있는 panel이 그 칸 오른쪽에 붙는다). 탭은 Info와 Contexts 둘이다. Info는 경로, 크기, 바뀐 시각이고 Outline이 같이 보인다(판 번호·주체·개수, 원본 연결, 보관, format 줄은 없다). Contexts 탭은 `workspace/contexts/document-contexts.tsx`(screens-contexts 소유)의 component를 `host.contexts`로 받아 끼운다. 열림 상태는 탭 안 state다(작업대의 `infoShown`을 쓰지 않는다). 근거: `U2.3#13`, `U2.3#14`.
7. Outline은 화면이 가진 본문에 `parseOutline`을 부른다(편집 중에도 갱신한다. core의 `outline.document` 읽기와 page 이음은 없다). 읽기 위치 기억(`noteReadPosition`)의 section key는 이 parser의 key다. 근거: `U2.3#8`, `U2.3#9`, `I2.10#18`.
8. 지침 진입을 일반 파일로 바꾼다. `instructions-entry.tsx`와 `draft-document.ts`를 줄인다: 연결된 문서 id로 풀고 없으면 빈 draft를 붙들던 흐름을 없앤다. project의 `LOPHN.md`는 일반 경로 파일이라 host가 `openFile`로 일반 파일 탭에 연다(없는 파일은 빈 buffer로 열고 첫 저장이 파일을 만든다). 전역 지침 경로는 `InstructionsApi`가 준다. 앱 층 진입은 없앤다. `windowInstructionsSource`·`InstructionsButton`·`InstructionsIntent` 같은 외부 import 이름은 위 계약대로 유지한다. 근거: `U2.3#16`.
9. `reading-width.ts`를 새 설정 선언 모델의 읽기·쓰기(revision 없이 값 하나)로 고친다. `window-deps.ts`에서 `versions` 통로를 걷는다.
10. 문구를 wording key로 바꾼다(영역 `document`). 판·비교·복원·저장 주체·diff 관련 약 60키와 `document.*`의 형식 문제 key는 쓰는 곳이 없어지므로 지운다. 근거: `U1.3#18`. key는 `catalog/project.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/project.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
11. 검색 결과에서 열 때 줄을 받는다. `kinds/document-editor.tsx`가 탭 필드 `line`(1부터)을 받아 열자마자 그 줄로 scroll하고(읽기 모드와 편집 모드 모두. 지금은 편집 모드의 `revealLine`뿐이다) 줄을 잠깐 표시한다. 검색 탭(`screens-project-search`)이 `line`을 넘긴다. 근거: `U3.3#9`.
12. gallery: `documents.tsx`의 `DocumentPane`·`ViewBar`·`DocActions`, `project-files/viewers.tsx`, `notices.tsx`가 renderer component와 `editor/fake-source.ts`로 그리게 다시 쓴다. `notices.tsx`의 단추가 오른쪽 끝인 toast look-alike는 design `Toast`로 바꾼다(ui-chrome-components가 넘긴 일). export 이름과 props는 유지한다(`project-app.tsx`, `project-files/pages.tsx`, `bodies.tsx`가 import한다). `file-data.ts`는 sidebar·search도 읽으므로 이 task가 지우지 않는다(window task가 정리한다). 필요한 data는 `fake-source.ts`로 복사한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "충돌 상태에서는 사람이 고르기 전까지 디스크에 쓰지 않고 초안이 그대로 남는다. 밖에서 바뀐 파일(`onChanged`)은 고치지 않았을 때만 자동으로 다시 읽고, 고치는 중이면 충돌이 된다. 결과를 모르는 쓰기는 다시 쓰지 않고 `read`한 hash로 저장됨·안 써짐·충돌을 가른다" — `editor/save-state_test.ts`(순수 함수, 가짜 port와 수동 clock, 사건 표 하나).
- 남지 않음: `grep -rn "versionNumber\|keepMineAsVersion\|restoreVersion\|against: \"newest\"\|DOC_ID\|documents\.list\|documents\.get" packages/shell/renderer/editor packages/shell/renderer/workspace/kinds/document-editor.tsx`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-document-tab`, `new-document-editing`, `new-document-tab-info`, `new-document-tab-contexts`, `new-viewer-text`, `new-viewer-media`, `new-file-reloaded`, `new-file-conflict`, `new-file-conflict-compare`, `new-file-delete`, `new-file-outside`, `new-instructions-file`이 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `packages/shell/renderer/deno.json`의 언어 팩 두 개(lead가 시작 전에 더한다). 영역 `document`의 지운 key와 새 key. `desktop/dev-seed.ts`(screens-project-sidebar가 고친다)가 `editor/fake-source.ts`를 쓰는지 lead가 확인.
- 안 쓰게 된 export: `editor/source.ts`의 `DocumentInfo.version`·`BodyState`·`linkTargets`·`resolveLink`, `model.ts`의 `joinPage`·`documentAddress`, `window-deps.ts`의 `versions`, `workspace/kinds/host.ts`의 `DocumentSlice` 칸 가운데 `rows`·`compareOf`·`showCompare`·`versionsChanged`·`infoShown`·`toggleInfo`(window task가 걷는다)
- 정한 것: 이미지·pdf를 그리는 방법(blob URL, `<img>`, `<embed>`)과 크기 한도, 없는 `LOPHN.md`를 빈 buffer로 여는 규칙, CodeMirror 언어 팩을 JSON·YAML 둘로 한 것
- 계약 바꾸기 요청(wave 3): `FilesApi`에 모자란 것이 있으면 여기 적는다
