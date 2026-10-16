# fix-runtime-gate

agent-definition-register(`516742af`)가 보고했다: agent runtime child의 tool port 가운데 `gate`와 `questions`가 닫혀 있다. Approvals(`judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`)와 질문 대기는 core main thread 메모리에만 있고 runtime이 부를 route가 없다. 그래서 Gate를 거치는 tool(쓰기, external, `call`, `LOPHN.md` 편집, app-api)과 `ask`가 runtime에서 돌지 않는다. lead가 fix로 돌린다.

- 단위: approvals (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - 새 memory route 둘의 계약(`protocol/approvals/` 또는 `protocol/lophn-agent/`)과 core handler(`main/daemon/wiring/approvals.ts`에서 main thread의 Approvals·질문 대기에 잇는 줄)
  - runtime 쪽 port 구현: `main/agent-runtime/product-driver.ts`의 tool ports `gate`·`questions` 줄, `run-loop/runtime-access.ts`의 agent·machine route 목록
- 읽을 것: `core/lophn-agent/tool-judgment/tool-gate.ts`, `core/approvals/`(turn requests, `SessionAllowances`), `tools/bundles/ask.ts`(`ctx.questions.ask`, `QuestionWait`), `tools/work.ts`(`executeToolCall`의 gate 호출), `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, spec `approval.md`(turn 허락), `agent-definition.md` 4장(ask)
- 계약: 아래 할 일이 정하는 모양. 새 route는 lead가 registry에 올린다.

## 할 일

1. **Gate 한 번에:** runtime이 tool 실행 직전에 부르는 memory route 하나(예: `tool_gate/check`, actor agent). 입력은 `ToolGateCall`(session, turn, tool_call, intent의 kind·target·effect·input), 출력은 `ToolGateResult`(allowed | denied | changed). core handler가 main thread에서 `createToolGate`의 `check`를 그대로 돌린다(묻기·사람 결정 기다리기·소비까지 core 안에서). agent credential의 session·turn과 입력의 session·turn이 다르면 forbidden.
2. **ask 한 번에:** runtime이 `ask` 질문 묶음을 올리고 풀릴 때까지 기다리는 memory route 하나(actor agent). core handler가 main thread의 질문 대기(`QuestionWait`)에 넣고 `AskResult`를 돌려준다. turn이 끝나거나 session이 닫히면 취소 결과.
3. runtime의 tool ports `gate`·`questions`를 이 두 route 호출로 채운다. 긴 기다림이 HTTP timeout에 걸리지 않게 한다(지금 runtime의 core 호출 방식을 보고 가장 단순한 길: 긴 timeout 또는 짧은 poll).
4. rewind pre-image 기록은 places-sessions-rewind 몫이다. 건드리지 않는다.

## 끝남

- `deno task check:full`이 통과한다. core가 같은 data root로 두 번 뜬다.
- 위험 test: "다른 session·turn의 자격으로는 Gate route가 허락을 소비하지 못한다" 1개.

## 보고

- 바꾼 file, 새 route(registry에 올릴 것), 기다림 방식, 계약 바꾸기 요청(없으면 "없음")
