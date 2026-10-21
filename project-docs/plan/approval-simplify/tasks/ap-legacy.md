# ap-legacy

handler 없는 옛 approval route 아홉이 든 `packages/protocol/approvals/approvals.ts`(370줄)를 지우고, 그 route를 가리키던 runtime 자격 목록과 shell route 목록을 고친다.

- 단위: legacy (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/approvals/approvals.ts`(지운다)
  - `packages/protocol/approvals/mod.ts`(지운 file의 export 줄만)
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/shell/main/desktop/core/routes.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/approval.md` "지금 코드"(`approvals.ts` 370줄은 handler 없는 옛 route 9개), "지우는 것"(`packages/protocol/approvals/approvals.ts`)
  - architecture: `project-docs/architecture/agent-definition.md`("agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `run-loop`, `core-api`, `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/lophn-agent`, `packages/shell/main`
  - 코드
    - `packages/protocol/approvals/approvals.ts`: export `approvalActionSchema`, `approvalUseSchema`, `approvalsGet`, `approvalsList`, `approvalsText`, `createApprovalRequest`, `cancelApprovalRequest`, `applyApprovedAction`, `APPROVAL_ROUTES`(그 밖에 export 없는 grant·reject·expire command 셋)
    - `packages/core/lophn-agent/run-loop/runtime-access.ts`: `RUNTIME_MACHINE_ROUTES`(runtime machine 자격의 상한), `EXTERNAL_TOOL_OPERATIONS`(외부 MCP tool의 agent 상한), `AGENT_BASE_OPERATIONS`
    - 이 목록을 쓰는 곳(고치지 않는다): `packages/core/main/agent-runtime/core-http.ts`, `packages/core/lophn-agent/run-loop/runtime.ts`의 `agentRuntimePolicies`, `packages/core/agent-roles/credentials.ts`
    - `packages/shell/main/desktop/core/routes.ts`(`SHELL_ROUTES`)와 그것을 읽는 `packages/shell/main/desktop/core/allowlist.ts`(read·command는 목록에 있으면 renderer에 열린다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `APPROVAL_ROUTES`, `approvalsGet`, `approvalsList`, `approvalsText`, `createApprovalRequest`, `cancelApprovalRequest`, `applyApprovedAction`, `approvalActionSchema`, `approvalUseSchema`가 없다. runtime machine 자격(`RUNTIME_MACHINE_ROUTES`)과 agent 상한(`EXTERNAL_TOOL_OPERATIONS`)에서 그 route가 빠진다.

## 할 일

지우기 전에 위 export 이름을 `git grep -nw`로 찾아, 아래 둘 밖에 import하는 곳이 없는지 본다(2026-10-21 main 기준으로는 없다). 있으면 지우지 말고 file:줄을 보고한다.

1. `packages/protocol/approvals/approvals.ts`를 지운다.
2. `packages/protocol/approvals/mod.ts`에서 `export * from "./approvals.ts";` 한 줄을 지운다. 다른 줄은 그대로다.
3. `packages/core/lophn-agent/run-loop/runtime-access.ts`
   - import에서 `applyApprovedAction`, `approvalsGet`, `approvalsList`, `approvalsText`, `cancelApprovalRequest`, `createApprovalRequest`를 뺀다. `agentGrantsGet`과 `toolGateCheck`는 남긴다(앞은 ap-assign-tools가 바꾼다).
   - `RUNTIME_MACHINE_ROUTES`에서 `approvalsGet`, `approvalsList`, `approvalsText`, `applyApprovedAction`, `cancelApprovalRequest` 다섯 줄을 지운다.
   - `EXTERNAL_TOOL_OPERATIONS`를 `[EXTERNAL_TOOL_CONTRACT]`로 줄이고 위 주석에서 "approval request 생성" 부분을 지운다. 상수는 남긴다(`runtime.ts`·`AGENT_BASE_OPERATIONS`가 쓴다).
   - 정한 것: `AGENT_BASE_OPERATIONS`의 주석은 고치지 않는다. 이유: 지운 route를 말하지 않는다.
4. `packages/shell/main/desktop/core/routes.ts`
   - import에서 `APPROVAL_ROUTES`를 빼고, `SHELL_ROUTES`에서 `...APPROVAL_ROUTES.filter(...)` 줄을 지운다.
   - 위 주석에서 "요청 읽기"와 "요청을 만들고 적용하는 command는 사람 화면이 부르지 않는다"를 지운다. `APPROVAL_DECISION_ROUTES`와 `AGENT_GRANT_ROUTES` 줄은 남긴다(ap-assign-store, ap-ask-turn, ap-cleanup이 바꾼다).
5. 지운 이름의 소유 밖 흔적은 고치지 않고 보고한다(ap-cleanup이 지운다). 2026-10-21 main 기준:
   - `packages/core/server/server.ts`의 `CONTROL_OPERATIONS`(`cancel_approval_request`, `reject_approval_request`, `expire_approval_request` 문자열)
   - `packages/core/lophn-agent/run-loop/runtime.ts`의 `agentRuntimePolicies` 위 주석(`create_approval_request`)
   - `packages/core/apps/control.ts`의 `SUPERVISOR_OPERATIONS` 주석(`apply_approved_action`)
   - `packages/protocol/server/registration.ts`의 `dispatchable`·`dispatchOnly` 주석(`apply_approved_action`)

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 쓰는 곳 없는 route와 상한 줄을 지운다(권한을 좁히는 쪽이다).
- 남지 않음: `git grep -nwE "APPROVAL_ROUTES|approvalsGet|approvalsList|approvalsText|createApprovalRequest|cancelApprovalRequest|applyApprovedAction|approvalActionSchema|approvalUseSchema" -- packages tools tests`가 0줄이다.
- `git grep -n "approvals.ts" -- packages/protocol/approvals/mod.ts`가 0줄이다.
- 소유 밖 문자열 흔적(할 일 5)은 남아도 된다. 보고에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 `packages/protocol/approvals/mod.ts`의 지운 줄을 직접 고친다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 남은 옛 이름: 할 일 5의 소유 밖 흔적을 file:줄로
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
