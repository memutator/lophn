# remove-documents-ui

문서의 판·비교·복원·tracking·series·정리(organize) 화면과 그 shell main 통로를 지운다. 문서가 디스크 파일 하나가 되어 이 화면들은 대체 없이 없어진다. 문서를 열고 고치는 편집기 본체와 파일 읽기·쓰기는 지우지 않는다(wave 3 screens-project가 새 통로로 다시 잇는다).

- 단위: remove-documents (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/editor/compare/`
  - `packages/shell/renderer/editor/versions/`
  - `packages/shell/renderer/editor/problems-gutter/`
  - `packages/shell/renderer/editor/link-picker/`
  - `packages/shell/renderer/workspace/tracking/`
  - `packages/shell/renderer/desktop/lophn-space/documents/`
  - `packages/shell/renderer/desktop/lophn-space/series/`
  - `packages/shell/renderer/desktop/lophn-space/organize/`
  - `packages/shell/main/editor/restore.ts`
  - `packages/shell/main/editor/create.ts`
  - `packages/shell/main/editor/place.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 module을 쓰던 곳을 고치는 것이다):
  - shell main: `packages/shell/main/editor/ipc.ts`, `core-port.ts`, `packages/shell/main/desktop/main.ts`(creator·restorer·placer 조립)
  - IPC 계약: `packages/shell/ipc/editor.ts`(`EDITOR_RESTORE_CHANNEL`, `EDITOR_CREATE_CHANNEL`, `EDITOR_PLACE_CHANNEL`과 schema·type), `packages/shell/preload/editor-api.ts`(`restore`, `create`, `place`)
  - 편집기 renderer: `packages/shell/renderer/editor/{document-view.tsx, markdown-editor.tsx, live-preview.ts, core-source.ts, source.ts, window-deps.ts, model.ts, save-state.ts, draft-document.ts}`, `packages/shell/renderer/editor/info-panel/info-panel.tsx`
  - workspace: `packages/shell/renderer/workspace/workspace.tsx`(TrackingStrip, compares, versionsTick, showCompare)
  - Workspace: `packages/shell/renderer/desktop/{entry.tsx, main.tsx}`, `desktop/dev-mock/{documents.ts, mod.ts}`, `desktop/lophn-space/{lophn-space.tsx, model.ts, screens.ts, core-source.ts, source.ts}`, `desktop/lophn-space/testdata/fake-source.ts`, `desktop/lophn-space/projects/{project-detail.tsx, projects-screen.tsx}`
- 읽을 것:
  - spec: 없음. 근거는 삭제 목록 — `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장("문서의 판", "series 화면과 registry", "place 없는 문서", "문서 주소 체계")
  - inventory: `I1.9#5`, `U1.3#4`, `U1.3#5`, `U1.3#6`, `U1.3#8`, `U1.3#9`, `U1.3#10`, `U1.5#1`, `U1.5#2`, `U1.5#3` (`../assignment.md`에서 이 task가 맡은 줄 전부). 표는 `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 1.3, 1.5장과 `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 1.9장
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다). `EDITOR_RESTORE/CREATE/PLACE` 채널 상수를 없애므로 IPC 계약 file이 줄어든다

## 할 일

1. 소유 폴더와 파일을 지운다. (U1.3#4~#10, U1.5#1~#3, I1.9#5)
   - renderer: `editor/{compare, versions, problems-gutter, link-picker}/`, `workspace/tracking/`, `desktop/lophn-space/{documents, series, organize}/`
   - shell main: `main/editor/{restore, create, place}.ts`
2. 추가 소유가 승인됐으면 쓰던 곳을 고친다. 지운 뒤 type check와 lint(unused)가 알려 주는 것이 전부다. 알려진 곳은 아래다.
   - **편집기**: `document-view.tsx`의 `CompareView` 분기·`restoreVersion`·`RestoreAnswer`·`saveProblems`·`VersionSource`, `save-state.ts`의 `keepMineAsVersion`, `info-panel.tsx`의 `VersionsTab`·`info-format` 줄, `markdown-editor.tsx`·`live-preview.ts`의 link-picker와 problems gutter, `core-source.ts`의 `documents.resolve`, `model.ts`의 `documentAddress`, `draft-document.ts`의 series 새 멤버 흐름. 지침 첫 저장(LOPHN.md)이 `draft-document.ts`를 쓰니 series 흐름만 걷는다. 충돌 화면의 `compare` action은 남는다.
   - **workspace.tsx**: `TrackingStrip`, `compares`, `versionsTick`, `showCompare`. 읽기 실패 안내(`loaded.failed`)는 남긴다.
   - **Workspace**: `LOPHN_SCREENS`에서 `documents`를 뺀다. `DEFAULT_SCREEN`이 `documents`이므로 `projects`로 바꾼다. `screens.ts`, `lophn-space.tsx`의 Documents·organize·series 렌더, `projects/project-detail.tsx`의 `ExportPanel`·`DocumentPanel`, `projects/projects-screen.tsx`의 organize 쓰임, `core-source.ts`·`source.ts`·`testdata/fake-source.ts`의 series·document 항목, `dev-mock/documents.ts`·`dev-mock/mod.ts`, `entry.tsx`·`main.tsx`의 tracking·organize source 연결. `desktop/router.ts`와 `desktop/screens`의 문서 route는 "등록할 것"으로 적고, check가 깨지지 않을 만큼만 뺀다.
   - **공유 css**: `lophn-space/documents/documents.module.css`를 `projects/`의 두 화면이 쓴다. 쓰는 쪽(`projects/`) 옆으로 옮긴다.
   - **shell main**: `main/desktop/main.ts`의 creator·restorer·placer 조립, `main/editor/ipc.ts`의 세 handler와 deps, `core-port.ts`의 `restore`·`create`·`place` port, `ipc/editor.ts`와 `preload/editor-api.ts`의 세 채널과 schema. `core-port.ts`가 core `documents` route를 부르는 나머지(파일 읽기·쓰기)는 core가 곧 지워지지만 이 task에서는 남긴다. wave 3 screens-project가 새 통로로 바꾼다.
3. wording key는 고치지 않는다(wording-split의 생성물). 쓰는 곳 없는 key는 cleanup이 지운다.
4. `grep -rn "compare\|versions\|tracking\|series\|organize" packages/shell`로 문자열로만 남은 route 이름(`"documents"`, `"series"`, `lophn://` 링크 종류)을 찾는다. check가 못 잡는다.
5. `deno task check`를 돈다(shell main은 npm check가 따로 돈다).

## 끝남

- `deno task check`가 통과한다. 화면 파일을 지웠으니 `deno task wireframes`가 깨지지 않는지도 본다. 깨지면 gallery `pages.ts`의 해당 page를 보고에 적고, 이 task에서는 빌드가 되는 최소만 뺀다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "EDITOR_RESTORE_CHANNEL\|EDITOR_CREATE_CHANNEL\|EDITOR_PLACE_CHANNEL\|TrackingStrip\|CompareView\|VersionsTab\|SeriesPanel\|DocumentPanel\|ExportPanel" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `desktop/router.ts`와 Workspace 화면 목록(문서·series·organize route), gallery `pages.ts`·`frames/screens.tsx`에서 지운 page, `lophn://` 링크 종류(문서·series)
- 안 쓰게 된 export: 지운 화면이 쓰던 `desktop/lophn-space/model.ts`·`editor/model.ts`의 series·document 이름 규칙 함수(`documentNameForKey`, `NEXT_RULE` 등)가 남았으면 이름을 적는다
- 정한 것: `DEFAULT_SCREEN`을 무엇으로 바꿨는지, 공유 css를 어디로 옮겼는지
- 계약 바꾸기 요청: 없음(이 task가 IPC 채널 세 개를 없앤 것을 contract-shell에 알린다)
