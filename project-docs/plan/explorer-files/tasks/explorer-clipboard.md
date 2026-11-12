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
  - 지금 코드: `explorer.tsx`의 `Selection`·`selectedRows`·`activate`·`menuItems`·`runMenu`·`onKeyDown`·`onDrop`·`askTrash`, `explorer-row.tsx`의 `Row`(지금 props는 `multiSelected`·`onActivate(row, keep, modifiers)`다)
  - 앞 task가 만든 것: `packages/shell/renderer/workspace/files/paste-names.ts`의 `freeName(name, taken, "copy" | "number")`, `WorkspaceSource.copy(from, to)`·`writeBytes(path, bytes)`(둘 다 `FileOpResult`; 둘 다 이미 있는 대상을 덮지 않고 `conflict`, `writeBytes`는 `FILE_VIEW_MAX_BYTES` 초과에 `too_large`)
  - 배경: `project-docs/architecture/workspace-layout.md`(Files panel), `project-docs/architecture/agent-chat.md` 16번(대화의 image URL 규칙. 문서 본문은 이 계획이 따로 정했다)
- 계약:
  - clipboard 상태는 Explorer 밖으로 나가지 않는다(모듈 상태도, Context도 만들지 않는다). 컴포넌트 state다.
  - 새 IPC를 만들지 않는다. 쓰는 것은 `WorkspaceSource.copy`·`rename`(잘라내기 붙여넣기)·`writeBytes`(이미지)와 `systemClipboard.writeText`다.
  - 붙여넣기 이름은 `freeName`이 정한다. 이름 규칙을 여기서 다시 쓰지 않는다.
  - 문구 key는 lead가 `project.ts`에 미리 넣었다: `project-workspace.button.explorer-copy`·`-cut`·`-paste`·`-duplicate`, `project-workspace.error.explorer-paste-failed`, `-paste-unsupported`, `project-workspace.notice.explorer-copied`·`-cut`·`-pasted`(셋은 `{count, plural, ...}`). 새 key를 만들지 않는다.
- 할 일:
  1. clipboard state를 컴포넌트에 둔다:
     ```ts
     type Clipboard = {
       readonly mode: "copy" | "cut";
       readonly paths: readonly string[];
     };
     ```
  2. `Copy`(Ctrl/Cmd+C): 지금 선택(없으면 focus 줄)의 절대 경로들을 `text/plain`으로 `systemClipboard.writeText`에 쓴다(줄바꿈으로 잇는다). state에 `{mode:"copy", paths}`를 둔다. 선택이 비면 아무것도 하지 않는다(`return`, `preventDefault` 안 함). 보인 알림은 `notice.explorer-copied`.
  3. `Cut`(Ctrl/Cmd+X): state에 `{mode:"cut", paths}`를 두고 OS clipboard에는 쓰지 않는다(잘라내기는 앱 안 동작이다). 잘라낸 줄은 `data-cut`으로 흐리게 보인다(CSS `opacity: 0.55`, `[data-selected]`가 이긴다). 알림은 `notice.explorer-cut`.
  4. `Paste`(Ctrl/Cmd+V): 대상 폴더는 `targetFolder(activeRow)`다.
     - **keydown과 paste 이벤트를 겹치지 않게 한다.** 앱 clipboard state가 있으면 keydown에서 `preventDefault`하고 state로 붙여넣는다. state가 비었으면 keydown에서 아무것도 하지 않고(`return`) `paste` 이벤트에 맡긴다. 두 곳에서 같은 일을 하지 않는다.
     - state로 붙여넣기: cut이면 고른 것마다 `onMove(from, joinPath(toDir, 이름))`(이름은 `freeName`으로, 대상 폴더에 이미 있는 이름과 이번 반복에 만든 이름을 같이 본다), 끝나면 state를 비운다. copy면 고른 것마다 `source.copy(from, joinPath(toDir, freeName(...)))`. 끝나면 `tree.refresh()`·`tree.expand(toDir)`·새 경로를 선택하고 `show(paths.at(-1), false)`.
     - `paste` 이벤트: Chromium은 focus가 편집 가능한 칸이 아니면 `paste`를 `body`/`document`에 낸다. 그래서 listener를 tree element와 `document` capture 둘 다에 달되, `document` 쪽은 `treeRef.current?.contains(document.activeElement)`일 때만 처리한다(편집기·터미널 attach에 focus가 있으면 절대 가로채지 않는다). 처리하면 `preventDefault`·`stopPropagation`.
       - `clipboardData.files`에 `image/*`가 있으면: 이름은 `file.name`(없으면 `image.png`), 확장자는 MIME(png·jpeg·gif·webp)으로 정하고(`explorer-paste.ts`의 표), `new Uint8Array(await file.arrayBuffer())`를 `source.writeBytes(joinPath(toDir, freeName(name, taken, "number")))`로 쓴다.
       - 아니면 `clipboardData.getData("text/plain")`을 `pathsFromText`로 걸러 각각 `source.copy(path, joinPath(toDir, freeName(baseName, taken, "copy")))`. 하나도 없으면 아무것도 하지 않는다(`preventDefault`도 부르지 않는다).
     - 붙여넣은 개수를 `notice.explorer-pasted`로 `role="status"` 문단에 보인다(`folderFailed` 자리와 같은 모양). 실패한 것이 있으면 `error.explorer-paste-failed`를 보인다. 복사가 하나도 되지 않았고 클립보드에 붙일 것이 없었으면 `error.explorer-paste-unsupported`.
  5. `Duplicate`(Ctrl/Cmd+D): copy와 같은 일을 대상 = 각 줄의 부모 폴더로 한다. menu에도 넣는다.
  6. 오른쪽 클릭 menu 순서를 다음으로 바꾼다(지금 순서를 유지하며 자리만 잡는다):
     `New File`, `New Folder` | `Cut`, `Copy`, `Paste`, `Duplicate` | `Reveal in File Manager`, (`Open in Terminal` 폴더만) | `Copy Path`, `Copy Relative Path` | `Rename`, `Delete`.
  7. `Row`가 잘라낸 표시를 그릴 수 있게 prop 하나(`cut: boolean`)를 더한다. `CrumbBrowse`는 `cut={false}`를 넘긴다(그 file은 남의 것이니 이 한 줄만 고치고 보고의 "넘길 줄"에 적는다).
  8. `explorer-paste.ts`에 순수 helper를 둔다: `pathsFromText(text): string[]`(절대 경로만, CRLF·앞뒤 공백 허용), `EXTENSION_OF_MIME`, `imageNameOf(file)`. 화면 component에 이 규칙을 흩지 않는다.
- 끝남:
  - `npm run check:full`이 통과한다(`boot.sh`도 `boot 1 exit 0`, `boot 2 exit 0`).
  - 위험 test: `explorer-paste.ts`의 `pathsFromText`가 절대 경로만 고르고 줄바꿈·CRLF·공백을 견딘다(file 하나).
  - `grep -rn "navigator.clipboard.read" packages/shell`이 0줄이다.
- 보고:
  - 바꾼 file
  - 통과한 check
  - 등록할 것: lead가 `ui:explorer-copy`·`ui:explorer-cut`·`ui:explorer-paste`·`ui:explorer-duplicate`를 flows에 올린다. 그 목록을 적는다.
  - 안 쓰게 된 export
  - 정한 것: cut이 OS clipboard를 안 쓰는 것, 빈 자리 paste 대상, 알림을 어디에 보이는지
  - 넘길 줄
  - 계약 바꾸기 요청
  - **무겁게 짠 것**: 없으면 "없음"
  - **알려진 미완 동작**: 없으면 "없음"
