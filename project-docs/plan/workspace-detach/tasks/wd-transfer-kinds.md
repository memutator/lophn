# wd-transfer-kinds

terminal, document_editor, agent 탭 kind에 `transfer`/`receive`를 선언한다. terminal은 PTY 참조(`terminal_ref`, `generation`)를, editor는 보내기 전 flush(실패하면 옮기지 않음)를, agent는 그 session의 composer draft를 창 사이로 넘긴다. 나머지 kind(`contexts`, `context`, `search`, `agents`)는 선언하지 않는다: `toStored` 값으로 다시 연다. app_panel은 `wd-native-move`가 한다.

- 단위: wd-transfer-kinds (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/kinds/document-editor.tsx`
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/editor/sessions.ts`
  - `packages/shell/renderer/editor/transfer.ts`
  - `packages/shell/renderer/editor/transfer_test.ts`
  - `packages/shell/renderer/terminal/store.ts`
  - `packages/shell/renderer/conversation/drafts.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(탭 옮기기: terminal, editor, agent)와 "지금 코드"(terminal, editor, agent 항목), "단계"의 test
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/coding-agent.md`(terminal 탭, coding session ↔ 터미널 탭)
  - 규칙: `.claude/skills/write-test/SKILL.md`
  - 지금 코드(이 brief는 아래를 열어 확인한 것이다):
    - terminal: `renderer/terminal/store.ts`의 `TerminalStore`(`get`, `update`, `request`, `requestFromCore`. 창마다 `sessionStorage`로 `TerminalEntry`를 복원한다), `renderer/terminal/terminal-tab.tsx`(처음 그릴 때 `current.terminalRef`가 있으면 `snapshot({ after_seq: 0 })`로 다시 그리고, 없고 `requested && phase.kind === "opening"`이면 새 PTY를 연다. 입력은 `active`일 때 `terminal.focus`로 등록된 webContents만 보낸다)
    - editor: `renderer/editor/sessions.ts`의 `EditorSessions`(`attach`, `detach(path)`는 void이고 flush 결과를 알리지 않는다, `leave(path)`는 사람에게 묻는다), `renderer/editor/save-state.ts`의 `SaveSession.flush(): Promise<boolean>`(디스크가 편집기 글을 가졌으면 true)
    - agent: `renderer/conversation/drafts.ts`의 `DraftStore`(`draft(key)`, `save(key, patch)`. key는 session id이고 session이 없는 새 탭은 `new:…`다. `agent-view-model.ts`의 `newSessionKey`), `renderer/workspace/agent/tab-fields.ts`(`sessionOf`), `renderer/conversation/delivery-state.ts`(`Outgoing`)
    - `renderer/workspace/kinds/terminal.tsx`·`document-editor.tsx`·`agent.tsx`의 kind 선언
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-contract`의 `TabKindDef.transfer`/`receive`, `TabTransfer`(`ipc/detached.ts`), `TabHost`.
  - 내놓는 것: 세 kind가 `transfer`/`receive`를 선언한다. `wd-project-side`·`wd-window-ui`는 kind 이름으로 가르지 않고 `tabKindOf(tab.kind)?.transfer`를 부른다.

```ts
// renderer/editor/sessions.ts — EditorSessions에 더한다
/** 그 파일의 마지막 고침을 지금 쓴다. session이 없으면 true. 디스크가 편집기 글을 가졌을 때만 true다(쓰기 실패·충돌·결과 불명이면 false이고 글은 session에 남는다). 사람에게 묻지 않는다. */
flush(path: string): Promise<boolean>;

// renderer/editor/transfer.ts
/** 옮겨도 되면 value가 null인 transfer, 아니면 null(탭은 그대로, 글을 잃지 않는다). */
export function transferEditor(sessions: Pick<EditorSessions, "flush">, path: string): Promise<TabTransfer | null>;
```

## 할 일

1. `sessions.ts`: `flush(path)`. 근거: roadmap은 `detach(path)`로 flush한다고 쓰지만 `detach`는 void라 실패를 알 수 없고 views 수를 줄이는 일도 한다. 그래서 결과를 돌려주는 `flush`를 따로 둔다. 파일 탭이 아직 mount된 채여서 entry는 지우지 않는다(`views`를 건드리지 않는다). 쓰고 나면 `#changed(path)`로 알린다.
2. `transfer.ts`: `transferEditor`. `flush`가 false면 null, true면 `{ value: null, views: [] }`.
3. `document-editor.tsx`: `transfer(tab, host)`는 `host.props.editor`가 없으면 `{ value: null, views: [] }`, 있으면 `transferEditor(editor.sessions, tab.key)`. `receive`는 두지 않는다(받는 창은 disk에서 다시 연다). 플러시가 실패했을 때 사람에게 따로 알리지 않는다(저장 실패는 파일 탭이 이미 보인다).
4. `terminal.tsx`: `transfer`는 `host.props.terminal?.store.get(tab.key)`가 `terminalRef`를 가지면 `{ value: { terminal_ref, generation, folder_ref, session }, views: [] }`, 아니면(시작 전·통로 없음) `{ value: null, views: [] }`. `receive`는 `store.adopt(tab.key, …)`(아래)를 부른다. 값의 모양을 확인하고 맞지 않으면 아무것도 하지 않는다. 보내는 창의 store 항목은 지우지 않는다(보내기가 실패해 탭이 남을 수 있다).
   - `store.ts`: `TerminalStore.adopt(key, { terminalRef, generation, folderRef, session })`. `requested: true`, `phase: { kind: "opening" }`로 항목을 정한다(`TerminalTab`이 처음 그릴 때 `terminalRef`가 있으면 snapshot을 0부터 받아 phase를 정한다). `#changed()`로 sessionStorage에 저장한다.
5. `agent.tsx`: `transfer`는 `host.agentView`가 없으면 `{ value: null, views: [] }`. 있으면 그 탭의 draft를 담는다: `sessionOf(tab)`가 있으면 그 key 하나, 없으면(새 session 탭) `new:`로 시작하는 key 전부(store는 탭의 key를 모른다). `receive`는 받은 draft를 `drafts.save(key, …)`로 넣되, 받는 창의 같은 key에 이미 글(`text !== ""`)이 있으면 덮지 않는다.
   - `drafts.ts`: `DraftStore.entries(match: (key: string) => boolean): [string, Draft][]`와 받는 쪽이 쓸 `save`(이미 있다)로 충분하면 새 method를 더하지 않는다. `Draft`가 JSON이 아닌 값을 가지면(`Outgoing`을 확인한다) 그 칸은 싣지 않는다.
6. test: `transfer_test.ts` 하나. 쓰기가 실패하는 fake 파일 통로로 만든 `EditorSessions`에서 글을 고친 뒤 `transferEditor`가 null을 내고 `isUnsettled(path)`가 계속 true다(탭을 두고 글은 session에 남는다). 쓰기가 되는 통로에서는 null이 아니다. fake는 필요한 만큼만 만든다. Electron·subprocess를 띄우지 않는다.

## 정한 것

- flush가 실패하면 알림 없이 탭을 그대로 둔다(agent). roadmap이 "옮기지 않고 탭을 그대로 둔다"고만 정했고, 저장 실패는 파일 탭이 이미 보인다.
- terminal의 `transfer` 값에 `phase`·출력은 싣지 않는다(agent). 받는 창이 `snapshot`을 0부터 받아 다시 그린다.
- 새 session 탭의 draft는 `new:` key 전부를 넘긴다(agent). `DraftStore`가 탭이 아니라 session key로 되어 있고 새 session의 key를 만드는 `newSessionKey`는 agent 화면이 읽은 값을 요구해서다. 받는 창의 글을 덮지 않으므로 해가 없다.
- 위 값이 한 번에 64KiB(IPC 상한)를 넘으면 옮기기가 `invalid_input`으로 실패하고 탭은 그대로 남는다. 이 task는 따로 줄이지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "editor 옮기기에서 flush가 실패하면 null을 내서 탭이 남고 글이 session에 남는다"(`transfer_test.ts`).
- 남지 않음: 없음(더하는 것뿐이다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 창 사이 이동은 Electron 두 창이 있어야 보여서 손으로 확인하지 못한 것을 적는다. lead가 손으로 본다.
