# acp-input

화면의 대화 조작(보내기, 멈추기, 다시 하기, 묻기 답, 승인 결정, 대기 고치기)을 `AcpInput`으로 보낸다.

- 단위: acp (wave 4)
- 선행: acp-chat-screen.
- 소유(이 task만 고친다):
  - `packages/protocol/acp/**`(입력 route)
  - core의 입력 route 처리(`packages/core/main/daemon/wiring/acp.ts`)
  - `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`
  - `project-docs/architecture/{acp,agent-chat,event}.md`
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md`, `approval.md`
  - 제품 결정: 계획 README 정한 것 6
- 계약:
  - 쓰는 것: 지금 route(`SendMessage`, stop, retry, answer, decide, queue)
  - 내놓는 것: route `AcpSend`(입력 하나를 받아 지금 route로 보낸다)

## 할 일

1. `AcpInput`의 각 꼴을 지금 route로 보내는 입구 하나. 권한과 자격은 지금 route의 것을 그대로 쓴다.
2. renderer 조작을 그 입구로.
3. 문서: `acp.md` 완성, `agent-chat.md`, `event.md`.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(지금 route의 test가 권한을 본다)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
