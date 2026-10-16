# approvals-tool-judgment

agent의 tool call이 실행되기 앞단에서 Gate를 부르는 입구를 새로 둔다. 호출을 intent로 바꾸고, `Approvals.judge`의 답(막음, 실행, 물음)에 따라 막거나 실행하거나 turn 안 request를 열어 사람의 결정을 기다린다. 허락 뒤 실행 직전에 intent가 같은지 다시 본다. 옛 판정표(`judge()`, 이유 코드 열여섯, 사람 요청 계보, 거절 억제, session 허락 계산, 판정 기록 `ToolDecision`)는 Gate로 대신하고 지운다.

- 단위: approvals (wave 3)
- 선행: approvals-requests (`Approvals`의 `judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`가 있어야 한다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tool-judgment/`
- 읽을 것:
  - spec: S2 5·6장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`. tool 이름 규칙은 S4 3·4장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`(앱 app-api `app__<앱>__<api>`, 외부 MCP tool `mcp__<server>__<tool>`)
  - inventory: `I1.2#6`, `I1.2#12`, `I1.2#13`, `I1.10#12`, `I2.2#16`, `I2.2#20`, `I3.2#13`, `I3.2#16` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 3장 #3(Gate는 core 한 곳. agent runtime은 Gate가 걸리는 tool을 실행하기 전에 core에 묻는다. file·shell·web은 Gate가 없다), #41(tool 이름 철자), 2.5의 B2 줄
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/lophn-agent/tool-judgment/{model,work,session-grant,app-judgment,builtin-binding}.ts`, 이것을 부르는 곳 `packages/core/lophn-agent/run-loop/{prepare,core-ports}.ts`, `packages/core/lophn-agent/tools/{toolkit,app-toolkit}.ts`, `packages/core/lophn-agent/waiting-and-recovery/{work,recovery-work}.ts`
- 계약:
  - 쓰는 것: `packages/protocol/approvals/`의 `Intent`, `GateVerdict`, `TurnDecision`, `INTENT_KINDS`. `packages/core/approvals/ports.ts`의 `Approvals`. tool 이름·효과 표는 contract-agent-tools가 `packages/protocol/lophn-agent/`에 고정한 tool 정의(`tool-calls.ts`, `tool-values.ts`)를 쓴다.
  - 내놓는 것: `createToolGate(deps)`와 `ToolGate.check(call)`, `settingsEditIntent(what, id, session)`. run-loop(router)와 tools(agent-tools)가 쓴다. 결과 type `ToolGateResult = { kind: "run" } | { kind: "denied", reason: GateDenyReason } | { kind: "rejected", reason: string | null } | { kind: "cancelled", cause } | { kind: "changed" }`.

## 할 일

1. 새 입구 — `core/lophn-agent/tool-judgment/tool-gate.ts`(새), `I2.2#16`, `I3.2#16`, S2 5장
   - `createToolGate({ approvals, resolve })`. `resolve(call)`는 호출에서 intent의 `kind`, `target`, `effect`를 읽는 주입 함수다: 앱 app-api는 tool 이름에서 앱과 api를 풀고 효과를 활성 release 선언(blueprint)에서 읽는다. 외부 MCP tool은 `readOnlyHint`가 참이면 `read`, 아니면 `external`이다. 읽지 못하거나 정의가 사라졌으면 `err`이고 호출은 막힌다.
   - `ToolGate.check({ session, turn, toolCall, agent: AgentRef, tool, input })`(`AgentRef`는 `protocol/lophn-agent/places.ts`):
     1. `resolve`로 intent를 만든다. `actor: { kind: "agent", agent, session }`, `origin: { kind: "turn", session, turn, tool_call }`, `input`은 정규화한 입력이다(agent가 쓴 설명 글을 intent에 넣지 않는다: 카드 내용은 program이 intent에서 만든다).
     2. `approvals.judge(intent)`. deny면 `denied`로 돌려준다(이유가 부른 쪽에 간다).
     3. run이면 `{ kind: "run" }`.
     4. ask면 `approvals.openTurnRequest(intent)`로 request를 열고 `waitTurnDecision(request.id)`로 기다린다. `allow`는 실행 직전에 `resolve`로 intent를 다시 만들어 `consumeTurnAllow(request.id, current)`를 부른다. `conflict`(대상, 입력, 활성 release가 달라졌거나 이미 쓰임)이면 실행하지 않고 `{ kind: "changed" }`로 돌려준다(`I2.2#20`, req-0310). `reject`는 `{ kind: "rejected", reason }`, `cancelled`는 `{ kind: "cancelled", cause }`다.
   - Gate를 부르지 않는 tool(file·shell·web, 읽기 tool, 질문 tool, call·reply·cancel)은 이 입구를 거치지 않는다. 어느 tool이 거치는지는 `resolve`가 정하고, 거치지 않으면 `check`를 부르지 않는 것이 호출자(run-loop)의 일이다.
2. 설정 고치기 intent — `intents.ts`(새), `I3.2#13`, S2 5장 마지막
   - `settingsEditIntent({ what, id, session, turn, toolCall, agent })`이 `kind: "settings_edit"` intent를 만든다. file tool로 `LOPHN.md`를 쓰는 것은 설정 고치기로 본다. 지침 파일은 `LOPHN.md`뿐이다. agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다. 경로가 `LOPHN.md`인지 가르는 것은 호출자(file tool 실행기, agent-tools 몫)다. 이 task는 intent를 만드는 함수와 `LOPHN.md` 판정 보조 `isInstructionFile(path)`(파일 이름이 `LOPHN.md`인지만)를 준다.
3. 옛 판정표를 지운다 — `I1.2#6`, `I1.2#12`, `I1.2#13`, `I1.10#12`
   - 지울 file과 export: `model.ts`(`judge`, `Judgment`, `Verdict`, `ReasonCode`, `CallFacts`, `Origin`, `Reversibility`, `TargetFact`, `DecisionEffect`, `lowerBySessionGrant`, `refusalKey`, `sameLineage`, `BasisSnapshot`, `sameBasis`, `sameToolBasis`), `work.ts`(`createToolJudgment`, 판정 기록 `decideToolCall` 호출, 계보 조회 `refused_before`, `approvalTtlMs`, "Operator의 쓰기 대상 문서가 담당 place에 있는지" 확인 `document.get` 읽기), `session-grant.ts`(`findSessionGrant`), `builtin-binding.ts`, `app-judgment.ts`, `app-context-judgment.ts`, `core-call.ts`의 쓰이지 않게 된 부분, `mod.ts`의 해당 export.
   - 지우는 조건: 쓰는 곳이 없을 때만 지운다. 지금 쓰는 곳은 `run-loop/prepare.ts`, `run-loop/core-ports.ts`(router), `waiting-and-recovery/{work,recovery-work}.ts`(router), `tools/{toolkit,app-toolkit}.ts`(agent-tools)다. `grep -rn "tool-judgment" packages/core --include=*.ts`로 이 폴더 밖 사용처를 센다. 남아 있으면 그 export는 지우지 않고 file과 줄과 소유 단위를 보고한다(그 단위가 새 `ToolGate`로 옮기면 cleanup이 지운다). 새 file은 옛 export와 이름이 겹치지 않게 둔다.
   - 지우는 것의 이유: Gate는 grant만 본다. role·assignment·origin·listed·roleAllows 사실을 입력으로 받지 않는다(S2 5장). 되돌릴 수 있는 쓰기를 사람 요청 계보에서만 allow하던 규칙, 같은 계보에서 거절한 같은 요청의 재요청 금지(req-0308 rejected)는 없어진다.
4. 위험 test
   - `packages/core/lophn-agent/tool-judgment/tool-gate_test.ts` 하나, 이름은 "허락은 그 intent에 한 번만 쓰이고 실행 직전에 달라졌으면 실행하지 않는다". 진짜 `createApprovals`를 쓰지 않고 `Approvals` fake(`judge`가 ask, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`가 지문 비교)로: ① `once` 허락 → `run`. ② 허락 뒤 `resolve`가 다른 입력을 돌려주면(`consumeTurnAllow`가 `conflict`) `changed`이고 실행되지 않는다. ③ 같은 request를 두 번 소비하면 둘째는 `changed`다. ④ `reject`(이유 포함)는 `rejected`로 이유가 그대로 가고, `cancelled`는 거절과 구별된다. ⑤ `judge`가 deny면 `denied`다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "허락은 그 intent에 한 번만 쓰이고 실행 직전에 달라졌으면 실행하지 않는다"
- 남지 않음: 사용처가 없어 지운 것만 해당한다. `grep -rn "refusalKey\|sameLineage\|lowerBySessionGrant\|findSessionGrant" packages/core`가 0줄이다. 못 지운 것은 보고에 file 목록으로 적는다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 위 3의 지우지 못한 것(`createToolJudgment` 등)과 그 사용처. `protocol/lophn-agent/tool-calls.ts`·`tool-values.ts`의 `ToolDecision`(`comparison_basis` 포함)은 contract-agent-tools가 줄인다.
- 정한 것: 허락 뒤 intent가 달라졌을 때 결과를 `{ kind: "changed" }`로 따로 둔다(거절도 막음도 아니라서). run-loop가 이것을 tool 오류 결과로 model에 돌려준다.
- 계약 바꾸기 요청(wave 3): 없으면 없음
- 넘길 줄: `I3.2#13`의 file tool 실행기가 `settingsEditIntent`를 부르는 연결 → agent-tools. `I3.2#16`의 호출 지점 가운데 run-loop가 `ToolGate.check`를 부르는 연결 → router, 앱 호출 경로(S5)의 Gate 호출 → app-calls, Router의 agent call Gate 호출 → router, activation 처리의 Gate 호출 → releases-problems. `I1.2#6`의 `lophn-agent/register.ts`(`approvalRunLineage` port 채우기) → agent-definition
