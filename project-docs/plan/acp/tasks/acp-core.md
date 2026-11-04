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

## lead가 더함 (acp-protocol 보고에서)

- 추가 소유: `packages/protocol/acp/**`. core가 채워야 할 칸이 schema와 맞지 않으면 고친다(acp-input은 wave 4라 겹치지 않는다). 고치면 `project-docs/architecture/acp.md`의 해당 줄도 같이 고친다(추가 소유).
- `acp.md` "core가 해야 할 것"의 `AcpContext` 다섯(`seq`, `tool`, `questions`, `agentOf`, `decision`)을 채운다. `seq`는 항목이 대화에 들 때 저장하는 session 순번이고 snapshot이 같은 값을 낸다(새 ledger step). 줄에 선 메시지는 가져갈 때 받는다.
- `hidden_added`는 AgentEvent가 없으니 rewind 때 core가 직접 낸다.
- 지금 `message_recorded`는 본문이 없어(`complete: false`) turn이 끝날 때마다 `reread`가 선다. core는 기록을 아니 저장된 본문을 갱신에 실어 다시 읽지 않아도 snapshot과 같은 상태가 나오게 한다(wave 3 위험 test "갱신을 접은 상태와 snapshot이 같다"의 바탕). 실은 본문도 redaction 규칙을 지킨다.
- `app_card` part(`visual.show`)를 ACP에서 어떻게 낼지 정하고 `acp.md`에 적는다.
- `MessageReceived.body`가 block이 되면 `acpUpdatesOf`의 text block 싸기를 지운다.
