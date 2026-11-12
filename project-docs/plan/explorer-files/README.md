# explorer-files

- 목표: Explorer를 VS Code처럼 쓴다. 파일 여러 개를 고르고, 앱 안에서 잘라내기·복사·붙여넣기·복제하고, 경로 목록을 글 clipboard에 쓰고, OS에서 복사한 경로와 이미지를 붙여넣는다. md 편집기에 붙여넣은 이미지는 파일 옆에 png로 저장하고 커서에 링크를 넣는다.
- 재료: `project-docs/architecture/workspace-layout.md`(Files panel), `project-docs/architecture/agent-chat.md` 16번(chat image는 불러오지 않는다. 문서 본문은 다르다), `project-docs/products/change-log/0.16/explorer-copy-clipboard-permission.yaml`(shell 창은 clipboard 쓰기만 허락된다), `project-docs/products/change-log/0.2/explorer-vscode-trash-delete.yaml`(Explorer의 지금 모양).
- 범위 밖: OS 파일 관리자와 파일 자체를 주고받는 clipboard(Linux MIME·Wayland 갈래), 폴더 이름 filter, 정렬 고르기, drag 후보정, 다중 탭 열기, 되돌리기(undo).
- 정한 것:
  - clipboard 읽기는 main IPC를 열지 않는다. main frame의 `paste` 이벤트 `clipboardData`(글·이미지 File)로 받는다. renderer의 `navigator.clipboard.read`는 지금 permission이 거절하고, 그 거절을 풀지 않는다. (agent: 좁은 통로 하나만 여는 것보다 이미 되는 DOM 통로가 작다)
  - 복사·잘라내기는 경로 목록을 `text/plain`으로 OS clipboard에도 쓴다(터미널·편집기에 붙일 수 있다). 앱 안 clipboard 상태가 있으면 그것을 먼저 쓴다. (사람)
  - 붙여넣기는 복사본을 만든다. 같은 이름이 있으면 `a copy.md`, `a copy 2.md`로 비켜 간다. 잘라내기는 옮기기(열린 탭을 따라 옮기는 기존 `onMove` 길)다. (agent)
  - 한 번 클릭은 지금처럼 탭을 연다. Ctrl/Cmd+클릭은 그 줄을 선택에 더하고 빼고, Shift+클릭은 마지막 기준 줄부터 범위를 고른다. (agent: 지금 손버릇을 지키고 다중 선택만 더한다)
  - 이미지는 원래 이름을 지키고 겹치면 `image 2.png`다. Explorer에 붙이면 폴더에 저장하고, md에 붙이면 그 파일 옆에 저장하고 `![](./<이름>)`을 커서에 넣는다. (사람)
  - 문서 본문의 상대 경로 이미지는 불러와 그린다(블롭 URL). agent 답의 image URL 정책(`agent-chat.md` 16번)은 그대로다. (agent)

## task

| wave | id | 단위 | 선행 | 한 줄 |
|---|---|---|---|---|
| 1 | `files-transfer` | files | 없음 | `shell:file-copy`·`shell:file-write-bytes`, `WorkspaceSource.copy/writeBytes`, 붙여넣기 이름 규칙(`renderer/files/names.ts`) |
| 1 | `explorer-multi-select` | explorer | 없음 | Explorer 다중 선택(클릭·Shift·Ctrl/Cmd·키보드), 여러 개 지우기·경로 복사·끌기 |
| 2 | `explorer-clipboard` | explorer | `files-transfer`, `explorer-multi-select` | Ctrl/Cmd+C·X·V·D, menu 항목, 붙여넣기(앱 안 복사·잘라내기, OS 글 경로, 이미지) |
| 2 | `editor-image-paste` | editor | `files-transfer` | md에 붙여넣은 이미지를 옆에 저장하고 링크 삽입, 상대 경로 이미지 그리기 |

## lead가 할 일

- wave 0(이미 함): `packages/design/i18n/catalog/project.ts`에 이 계획의 문구 key를 먼저 넣어 catalog 충돌을 없앤다.
- merge 때마다: 새 IPC(`shell:file-copy`, `shell:file-write-bytes`)를 `project-docs/flows/areas/ipc.yaml`의 links와 `projects.yaml` flow에 잇고, `ui:explorer-*` 동작과 `tests/shell.yaml` 줄을 맞춘다. gallery(`project-files/pages.tsx`)에 다중 선택·붙여넣기 견본 page를 더하고 `npm run wireframes`로 찍어 본다.
- 끝났을 때: change-log 항목(`0.23/`), architecture(`workspace-layout.md`의 Files panel에 clipboard 규칙 한 줄, `agent-chat.md`와 다른 문서 본문 이미지의 구분), 이슈 닫기.
