# explorer-clipboard

Explorer에서 Ctrl/Cmd+C·X·V·D로 파일을 복사·잘라내기·붙여넣기·복제한다. 앱 안 clipboard 상태와 OS 글 clipboard를 같이 쓴다. OS에서 복사한 경로 목록과 이미지도 붙여넣는다.

- 단위: explorer (wave 2)
- 선행: `files-transfer`, `explorer-multi-select`
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/explorer.tsx`
  - `packages/shell/renderer/workspace/sidebar/explorer-row.tsx`
  - `packages/shell/renderer/workspace/sidebar/explorer.module.css`
  - `packages/shell/renderer/workspace/sidebar/explorer-paste.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`(Files panel), `project-docs/architecture/agent-chat.md` 16번(document 본문 이미지는 이 계획이 따로 정한다)
  - 앞 task가 만든 것: `packages/shell/renderer/workspace/files/paste-names.ts`의 `freeName`, `WorkspaceSource`의 `copy(from, to)`·`writeBytes(path, bytes)`(files-transfer brief 계약)
  - 지금 코드: `explorer.tsx`의 `menuItems`·`runMenu`·`onKeyDown`·`onDrop`, `explorer-multi-select`가 바꾼 선택 상태
- 계약:
  - clipboard 상태는 Explorer 밖으로 나가지 않는다(모듈 상태도, Context도 만들지 않는다). 컴포넌트 state다.
  - 새 IPC를 만들지 않는다. 쓰는 것은 `WorkspaceSource.copy`·`rename`(잘라내기 붙여넣기)·`writeBytes`(이미지)와 `navigator.clipboard.writeText`다.
  - 붙여넣기 이름은 `freeName`이 정한다. 이름 규칙을 여기서 다시 쓰지 않는다.
- 할 일:
  1. clipboard state를 컴포넌트에 둔다:
     ```ts
     type Clipboard = {
       readonly mode: "copy" | "cut";
       readonly paths: readonly string[];
     };
     ```
  2. `Copy`(Ctrl/Cmd+C): 지금 선택(없으면 focus 줄)의 절대 경로들을 `text/plain`으로 `systemClipboard.writeText`에 쓴다(줄바꿈으로 잇는다). state에 `{mode:"copy", paths}`를 둔다. 잘라낸 표시를 지운다. 동작이 없으면 아무것도 하지 않는다(`return`, preventDefault 안 함).
  3. `Cut`(Ctrl/Cmd+X): state에 `{mode:"cut", paths}`를 두고, OS clipboard에는 **쓰지 않는다**(잘라내기는 앱 안 동작이다. VS Code도 경로를 쓰지 않는다). 잘라낸 줄은 `data-cut`으로 흐리게 보인다(CSS: `opacity: 0.55`, 선택 시엔 `[data-selected]`가 이긴다).
  4. `Paste`(Ctrl/Cmd+V): tree와 이름 없는 빈 자리에서 듣는다.
     - 앱 state가 있으면 그것을 먼저 쓴다. 대상 폴더는 지금 고른 줄 기준(`targetFolder`)이다. cut이면 고른 것마다 `onMove(from, joinPath(toDir, name))`이고 옮긴 뒤 state를 비운다. copy면 고른 것마다 `source.copy(from, joinPath(toDir, freeName(...)))`. name은 대상 폴더의 `tree.entriesOf(toDir)` 이름과 이번 반복에서 만든 이름을 같이 본다. 붙여넣기가 끝나면 `tree.refresh()`·`tree.expand(toDir)`·새 경로 선택.
     - state가 비었으면 OS clipboard를 쓴다. `paste` 이벤트의 `clipboardData`만 쓴다(`navigator.clipboard.read`는 쓰지 않는다).
       - `clipboardData.files`에 이미지가 있으면 그것들을 붙여넣는다: 파일 이름은 File.name(없으면 `image.png`), `file.arrayBuffer()` → `new Uint8Array` → `source.writeBytes(joinPath(toDir, freeName(name, taken, "number")))`. 파일 이름의 확장자는 MIME으로 정한다(png/jpeg/gif/webp).
       - 아니면 `clipboardData.getData("text/plain")`을 줄로 나눠 절대 경로(`^(\/|[A-Za-z]:[\\/])`)만 고른다. 각각 basename을 `freeName(..., "copy")`로 비켜 간 뒤 `source.copy(path, joinPath(toDir, 이름))`. 하나도 없으면 아무것도 하지 않는다(preventDefault는 부르지 않는다 — 터미널·편집기 붙여넣기를 막지 않게).
     - 붙여넣은 개수를 `project-workspace.notice.explorer-pasted`로 status로 보인다(`role="status"` 문단, 지금 `folderFailed` 자리와 같은 모양). 실패가 있으면 `project-workspace.error.explorer-paste-failed`를 보인다.
  5. `Duplicate`(Ctrl/Cmd+D): 선택(없으면 focus 줄)의 copy와 같은 일을 대상 = 같은 폴더로 한다. menu에 `Duplicate`를 넣는다(`explorer-duplicate` key).
  6. 오른쪽 클릭 menu 순서를 다음으로 바꾼다(빈 자리 menu에서는 Copy/Cut/Paste만 대상이 루트 기준으로 동작한다):
     `New File`, `New Folder` | `Cut`, `Copy`, `Paste`, `Duplicate` | `Reveal in File Manager`, (`Open in Terminal` 폴더만) | `Copy Path`, `Copy Relative Path` | `Rename`, `Delete`.
     `Paste`는 붙여넣을 것이 있을 때만 두지 않는다(`source.copy`는 state 없이도 되므로 늘 둔다).
  7. 키보드 처리에 위 키를 더한다. `onKeyDown`에서 `metaKey/ctrlKey` 분기를 지금 구조에 맞춰 정리한다. 이름 입력 줄(`data-editing`)은 그대로 자기 키만 받는다(`stopPropagation` 이미 있음).
  8. `explorer-paste.ts`에 순수 helper를 둔다: 텍스트에서 경로 목록 뽑기(`pathsFromText(text): string[]`), MIME→확장자(`EXTENSION_OF_MIME`), File.name 보정(`imageNameOf(file)`). 화면 component에 이 규칙을 흩지 않는다.
- 끝남:
  - `npm run check:full`이 통과한다.
  - 위험 test: `explorer-paste.ts`의 `pathsFromText`가 절대 경로만 고르고 줄바꿈·CRLF·앞뒤 공백을 견딘다(file 하나).
  - `grep -rn "navigator.clipboard.read" packages/shell`가 0줄이다.
- 보고:
  - 바꾼 file
  - 통과한 check
  - 등록할 것: lead가 `ui:explorer-copy`·`ui:explorer-cut`·`ui:explorer-paste`·`ui:explorer-duplicate`를 flows에 올린다. 그 목록을 적는다.
  - 안 쓰게 된 export
  - 정한 것: cut이 OS clipboard를 안 쓰는 것, 빈 자리 paste 대상
  - 넘길 줄
  - 계약 바꾸기 요청
  - **무겁게 짠 것**: 없으면 "없음"
  - **알려진 미완 동작**: 없으면 "없음"
