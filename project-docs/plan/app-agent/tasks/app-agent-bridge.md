# app-agent-bridge

앱 화면의 bridge(`lophnApp`)에 agent session을 여는 것, ACP snapshot과 update를 받는 것, ACP 입력을 보내는 것을 더한다. shell main이 그것을 그 앱 place로 묶어 사람 자격으로 core에 넘긴다.

- 단위: app-agent (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/shell/preload/app-tool.ts`
  - `packages/shell/ipc/app-agent.ts`(새 file)
  - `packages/shell/main/app-frame/app-agent.ts`(새 file)
  - `packages/shell/main/app-frame/app-agent_test.ts`(새 file)
  - `packages/shell/main/app-frame/app-ipc.ts`
- 읽을 것:
  - 계획: `project-docs/plan/app-agent/README.md`의 정한 것 1~3
  - architecture: `project-docs/architecture/acp.md`, `app-call.md`(앱 bridge, operation 호출이 사람 자격으로 가는 법), `annotation.md`(shell이 앱 place의 session에 보내는 본보기)
  - 본보기: `packages/shell/main/app-frame/app-call.ts`(view의 앱과 place를 고정하고 core에 넘기는 법)
  - route: `packages/protocol/lophn-agent/agent-sessions.ts`의 `OpenSession`, `packages/protocol/acp/routes.ts`의 `AcpSnapshot`, `AcpSend`, event `AcpUpdated`
- 계약:
  - 쓰는 것: 위 route와 event. 모양은 바꾸지 않는다.
  - 내놓는 것(`lophnApp`에 더하는 것, `app-bridge-types.ts`):
    - `agent.open({agent: string}) → Promise<Result<{session}>>`: 그 앱 place에 그 agent의 새 session을 연다.
    - `agent.snapshot(session) → Promise<Result<AcpState>>`
    - `agent.onUpdate(listener: (session, update: AcpUpdate) => void) → unsubscribe`
    - `agent.send(input: AcpInput) → Promise<Result<void>>`
    - session이 그 앱 place의 것이 아니면 모두 `forbidden`이다.

## 할 일

1. preload와 IPC: 위 넷을 더한다. view마다 묶인 앱 id는 `app-call.ts`가 쓰는 binding을 그대로 쓴다(앱 code가 앱 id를 고르지 못한다).
2. shell main(`app-agent.ts`): 사람 자격으로 core에 넘긴다. 여는 session의 place는 늘 그 view의 앱이다. snapshot·send는 session의 place가 그 앱인지 보고 아니면 `forbidden`이다. update는 그 앱 place의 session 것만 그 view로 보낸다.
3. 보내는 body 크기는 `AcpSend`의 상한을 따른다. 앱 bridge에서 따로 자르지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`app-agent_test.ts`): "앱 view는 다른 앱이나 project의 session을 열지도 읽지도 보내지도 못하고 `forbidden`을 받는다. 그 앱 place의 update만 받는다".
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.
