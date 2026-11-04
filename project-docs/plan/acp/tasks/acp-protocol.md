# acp-protocol

protocol에 ACP를 정한다: 상태, 갱신, 입력 schema, 순수 reducer, AgentEvent에서 갱신을 만드는 순수 projection.

- 단위: acp (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - 새 `packages/protocol/acp/**`, `packages/protocol/mod.ts`
  - `packages/shell/renderer/conversation/live-text_test.ts`(reducer test로 옮긴다)
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`, 새 `project-docs/architecture/acp.md`, `project-docs/context-component-registry.yaml`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-chat.md`, `event.md`
  - 지금 화면 model: `packages/shell/renderer/conversation/agent-tab-source.ts`의 `ThreadView`(entries, turn, queued, pending, live, dropped), `agent-tab-data.ts`의 `foldEvent`, `foldDelta`
  - 제품 결정: 계획 README 정한 것 1, 3~6
- 계약:
  - 쓰는 것: `contentBlockSchema`(`packages/protocol/lophn-agent/content-block.ts`), AgentEvent 정의
  - 내놓는 것: `AcpState`, `AcpItem`(순번, 종류: message, tool{edit|call|question|consent|generic}, approval, notice, hidden 표시), `AcpUpdate`, `AcpInput`, `reduceAcp(state, update)`, `acpUpdatesOf(event)`

## 할 일

1. schema: `ThreadView`가 담던 것을 protocol로(정한 것 1, 3, 4, 5). 이름은 화면이 아니라 ACP의 말로.
2. `reduceAcp`: 같은 갱신을 두 번 받아도 같고, 순번이 빠지면 snapshot을 다시 읽으라는 표시를 낸다.
3. `acpUpdatesOf`: 채팅이 쓰던 AgentEvent(MessageReceived, MessageSteered, MessageRemoved, TurnStarted, TurnResumed, TurnEnded, MessageRecorded, ModelOutputStreamed, ToolCallStarted, ToolCallEnded, TurnRequestOpened/Closed, QuestionAsked/Resolved)를 갱신으로.
4. `architecture/acp.md` 첫 판.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "reducer는 같은 갱신을 두 번 받아도 같고 순번이 빠지면 다시 읽기를 낸다"(`live-text_test.ts`를 옮겨 넓힌다)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
