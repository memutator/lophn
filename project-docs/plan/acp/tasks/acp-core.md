# acp-core

core가 ACP를 만든다: snapshot route와 갱신 transient event. renderer가 하던 해석(tool 종류, 승인 결과, steer, 숨김)을 core로 옮긴다.

- 단위: acp (wave 2)
- 선행: acp-protocol.
- 소유(이 task만 고친다):
  - 새 core wiring(`packages/core/main/daemon/wiring/acp.ts`)과 `assembly.ts`, `session-snapshots.ts`
  - `packages/protocol/lophn-agent/{calls,events}.ts` 등 AgentEvent 정의(`MessageReceived.body`를 block으로)
  - `packages/core/main/daemon/wiring/{approvals,runs,bare-reply}.ts`(body를 block으로 받는 곳)
  - `packages/core/lophn-agent/approvals/**`(승인 결과를 기록에서 만들 수 없으면)
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md`(acp-protocol이 쓴 것), `event.md`
  - 지금 해석: `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`(`readThread` l.570, 이름으로 `ask`, `call.send`, `file.write`, `file.edit`, `release.activate`를 가르는 곳), `live-turns.ts`(redaction)
  - 제품 결정: 계획 README 정한 것 2~5, 7, 8
- 계약:
  - 쓰는 것: `acp-protocol`의 schema와 projection
  - 내놓는 것: route `AcpSnapshot {session}` → `AcpState`, transient event `AcpUpdated {session, update}`

## 할 일

1. snapshot: 기록(messages, turns, tool calls, 대기, 묻기, rewind)에서 `AcpState`를 만든다. tool 종류와 칸을 여기서 정한다.
2. 갱신: AgentEvent를 projection해 `AcpUpdated`로 낸다. 같은 기록에서 snapshot과 갱신이 같은 상태가 되어야 한다.
3. 승인 결과: 지금은 event 길에만 있어 snapshot을 다시 읽으면 사라진다. 기록에서 만들 수 있는지 보고, 없으면 새 ledger step으로 남긴다.
4. `MessageReceived.body`를 block으로 바꾸고 쓰는 wiring을 고친다.
5. harness가 주체인 대기는 여기서 거른다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "ACP snapshot과 갱신에 redaction 안 된 글과 tool 본문이 없다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
