# gui-window

extension이 연 ACP session 하나만 그리는 lophn 창을 만든다. 채팅 화면은 지금 lophn 채팅 component를 그대로 쓰고, source만 core 대신 그 session에서 읽는다. lophn 터미널 탭에서 `claude gui`가 되게 한다.

- 단위: gui (wave 2)
- 선행: gui-protocol. 그 task의 `AcpSessionHandle`과 창을 여는 port를 채운다.
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/gui-window.ts`(새 file)
  - `packages/shell/ipc/harness-gui.ts`(새 file)
  - `packages/shell/preload/harness-gui-api.ts`(새 file)
  - `packages/shell/renderer/conversation/agent-tab-gui-source.ts`(새 file)
  - `packages/shell/renderer/harness-gui/`(새 폴더, 창 entry)
  - `packages/shell/terminal-host/shell-integration.ts`
  - `tools/wireframes/pages/screens/harness-gui.tsx`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui/README.md`의 정한 것 4, 6
  - architecture: `project-docs/architecture/agent-chat.md`, `acp.md`, `terminal-agent.md`(shell 시작 층, `LPN_SHELL_INIT`), `workspace-layout.md`(Detach 창)
  - 채팅 화면: `packages/shell/renderer/conversation/agent-view.tsx`, `agent-tab-source.ts`(`AgentTabSource`), `agent-tab-core-source.ts`(본보기), `agent-tab-fake-source.ts`
  - 창 본보기: `packages/shell/main/desktop/detached/`
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `AcpSessionHandle`(update를 창으로, 입력을 handle로), `AgentTabSource`
  - 내놓는 것: gui-protocol이 둔 창 열기 port의 구현

## 할 일

1. 창: session 하나에 창 하나. 제목은 harness 이름과 cwd 끝 폴더. 창을 닫으면 handle의 `onClose`를 부른다.
2. source(`agent-tab-gui-source.ts`): `AgentTabSource`를 채운다. ACP 상태는 snapshot 없이 update를 `reduceAcp`로 쌓는다. 입력은 IPC로 handle에 보낸다. lophn 전용 기능(model 고르기, rewind, 권한 화면, slash 목록, session 목록)은 source가 없다고 알려 화면이 숨기게 한다. 숨기는 길이 화면에 없으면 가장 작은 칸(예: source의 capability)을 더하고 보고한다.
3. lophn 터미널 탭의 shell 시작 층(`shell-integration.ts`)에 `claude`, `codex`, `opencode` 함수를 더한다: 첫 인자가 `gui`면 `lophn gui <harness> [나머지]`를 부르고, 아니면 원래 명령을 그대로 부른다. 이미 그 이름의 함수가 있는 harness(codex, opencode 등)는 그 함수에 분기를 더한다.
4. wireframe: fake update로 창 하나(흘러나오는 글, 도는 tool, 승인 카드)를 gallery에 둔다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery에 그 창이 보인다.
- 위험 test: 없음(화면). shell 함수가 `gui`가 아닌 인자를 원래 명령에 그대로 넘기는 것은 기존 shell-integration test가 있으면 case를 더한다.
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 화면에서 숨긴 기능 목록을 적는다.

## lead가 더한 것

- (lead가 더함) 창 열기 port는 `packages/shell/main/desktop/wiring/extensions.ts`의 `AcpWindowPort.open(window: AcpWindowHandle)`이다. 구현은 `gui-window.ts`에 두고, 추가 소유로 `packages/shell/main/desktop/main.ts`의 `extensions.register(ctx, {...})` 호출에서 `open` no-op만 바꾼다. `showExtensionSettings`는 이미 있다.
- (lead가 더함) 창은 `window.attach`가 처음부터 다시 보내는 갱신을 `EMPTY_ACP_STATE`에서 `reduceAcp`로 접는다. snapshot은 없다. `reread`가 서도 다시 읽을 것이 없으니 그대로 그린다(빈틈 없는 `seq`는 adapter의 몫이다).
- (lead가 더함) ACP 입력의 `session`(`ses_…`)은 창마다 source가 하나 만들어 채운다. adapter는 보지 않는다. message id(`msg_…`)와 key도 source가 만든다. adapter가 사람 메시지를 그 `id`로 `message_added`한다.
- (lead가 더함) adapter가 시작하지 못하면 `index.ts`가 `turn_started` 없이 `turn_ended`(`outcome: "failed"`, error)를 하나 낸다. 창은 그것을 오류로 그린다.
- (lead가 더함) gallery 등록(`tools/wireframes/pages/index.ts`)은 lead가 한다. 보고의 "등록할 것"에 적는다. 흐름 문서는 `project-docs/architecture/harness-gui.md`다(고치지 않는다. 바꿀 것은 보고에 적는다).
