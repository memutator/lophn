# wf-call-tool

`approval-simplify`가 gate와 `gate_allowed`를 지운 뒤의 call tool에 `workflow`(prompt 절의 workflow 열쇠) 입력을 연다. 받으면 `ctx.workflows.read()`로 보내는 agent의 참가자 이름을 찾아 SendCall에 `workflow`와 `participant`를 싣는다.

- 단위: call (wave 2)
- 선행: wf-contract-shapes
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/call.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것"의 "보낼 때 바로 아는 배달 실패는 … call tool 결과로만 돌려준다"와 "받은 메시지는 허락이 아니다"), `project-docs/architecture/agent-definition.md`("tool 정의가 바뀌었나는 정의에서 계산한다", "효과는 model에 보이는 정의에 넣지 않는다", "tool 목록은 session을 시작할 때 고정한다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/workflow/README.md`의 "뼈대 검토에서 정한 것"("workflow의 key", "call에 workflow를 다는 법"), `project-docs/products/roadmap/workflow.md`의 "lophn이 하지 않는 일"(연락처 밖의 call을 막지 않는다)
  - 계약: `project-docs/plan/workflow/tasks/wf-contract-shapes.md`의 "읽기 port"와 "봉투", `project-docs/plan/workflow/tasks/wf-envelope-carry.md`의 "SendCall에서 둘 가운데 하나만 오면 `invalid_input`이다"
  - 코드: `packages/core/lophn-agent/tools/work.ts`의 `executeToolCall`(handler가 `err`를 내면 문장을 `FAILURE_SUMMARIES`의 고정 문장으로 바꾼다), `packages/core/lophn-agent/tools/fit-result.ts`의 `fitted`, `packages/protocol/lophn-agent/tool-values.ts`의 `toolResultSchema`(`summary`는 400자까지)
- 계약:
  - 쓰는 것:
    - `ToolContext.workflows`(`WorkflowReader`), `WorkflowMembership`(`packages/protocol/lophn-agent/workflow-file.ts`)
    - SendCall 입력의 `workflow?`·`participant?`(`packages/protocol/lophn-agent/calls.ts`)
  - 내놓는 것:
    - model에 보이는 call 입력에 `workflow?: string`(`<domain>/<name>`). `participant`는 model 입력에 없고 tool이 채운다.
    - 이 agent가 참가자가 아닌 workflow면 보내지 않고 `invalid_input`으로 돌려준다. 결과에 자기 workflow 열쇠 목록을 붙인다.
    - `workflow` 없는 call은 지금과 같다. 연락처 밖의 상대에게 보내는 call도 막지 않는다.
    - tool 설명에 `workflow`의 뜻을 한 줄 더한다.

## 할 일

1. 시작 전에 앞 일이 land했는지 본다. 아니면 고치지 말고 멈춰 보고한다.
   - `grep -n "gate_allowed\|gate:" packages/core/lophn-agent/tools/bundles/call.ts`가 0줄이다(`approval-simplify`).
   - `grep -n "workflows" packages/core/lophn-agent/tools/tool-context.ts`가 `workflows: WorkflowReader`를 낸다(wf-contract-shapes).
   - `callToolInput`의 `omit`에 `workflow`와 `participant`가 있다(wf-contract-shapes).
2. `packages/core/lophn-agent/tools/bundles/call.ts`의 `callToolInput`에서 `omit`에 `dedup`과 `participant`만 남긴다. `workflow`는 model 입력으로 연다.
   - 주석은 왜만 쓴다: `participant`는 model이 꾸미지 못하게 보내는 agent 자신으로 채운다.
   - 입력 schema는 strict라, model이 `participant`를 주면 지금 입력 검사(`executeToolCall`의 `checkInput`)가 막는다.
3. `call` tool의 handler(`agent-tools`).
   - `input.workflow`가 없으면 지금과 같이 보낸다.
   - 있으면 `ctx.workflows.read()`를 부른다. 실패하면 보내지 않고 그 `Result`를 그대로 돌려준다.
   - `read.value.memberships`에서 `key === input.workflow`인 것 하나를 찾는다. 열쇠는 정확히 맞춘다.
   - 찾았으면 `ctx.router.send({ ...input, workflow: membership.key, participant: membership.participant, dedup: ctx.tool_call })`로 보낸다. 결과 글(`call … is …`, `failed: …`, closed hint)은 지금과 같다.
   - 못 찾았으면 보내지 않고 `{ ...fitted(summary, content, ["your_workflows"]), status: "failure" }`를 `ok`로 돌려준다.
     - summary는 `call not sent: you are not a participant of that workflow` 같은 고정 문장이다.
     - content는 `{ state: "not_sent", code: "invalid_input", workflow: input.workflow, your_workflows: <memberships의 key 목록> }`이다.
   - 받는 곳(`to`)을 그 workflow의 참가자나 `membership.contacts`와 대조하지 않는다. 연락처 밖의 call도 보낸다.
4. `call` tool의 `description`에서 `body: … refs: …` 문장 뒤에 한 문장을 더한다.
   - 뜻: workflow는 이 call이 Workflows 절의 workflow에 속할 때만 그 열쇠(`<domain>/<name>`)를 준다. 받는 쪽은 workflow와 보낸 참가자 이름을 본다.
   - 예: `"workflow: only when this call is part of a workflow in your Workflows section, its key (<domain>/<name>); the receiver then sees the workflow and your participant name. "`
5. `routes`는 바꾸지 않는다. reader가 부르는 읽기(`domainList`, `projectApi.list`, `appList`, `agentDefinitionList`)는 `packages/core/agent-roles/credentials.ts`의 `PLACE_READS`에 있어 모든 role의 operation 상한에 이미 든다.
6. test는 쓰지 않는다(아래 "끝남"의 이유).

정한 것:
- 참가자가 아닌 workflow는 handler `err`가 아니라 status `failure`인 tool 결과로 돌려준다. `invalid_input`은 content의 `code`에 싣는다. 이유: `executeToolCall`이 handler 오류의 문장과 `details`를 고정 문장 "tool input is not valid"로 바꿔, 열쇠 목록이 model에 닿지 않는다. 같은 file의 배달 실패도 이유를 결과 content로 돌려준다.
- workflow를 읽지 못하면 꼬리표 없이 보내지 않는다. 이유: 꼬리표 없이 가면 받는 쪽이 보낸 참가자를 모른다. call은 효과가 read라 `unavailable`이면 run-loop가 같은 tool call로 한 번 더 부른다(`packages/core/lophn-agent/run-loop/retry.ts`). 보내지 않았으니 call이 겹치지 않는다.
- summary에 model이 준 열쇠를 넣지 않는다. 이유: `toolResultSchema`의 summary는 400자까지다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. `participant`를 model이 줄 수 없는 것은 strict 입력 schema의 `omit`이 보장한다(`write-test`: schema가 보장하는 것은 test하지 않는다). 참가자 검사는 꼬리표가 틀린 것을 막을 뿐 권한 경계가 아니다(README "call에 workflow를 다는 법").
- `grep -n "participant" packages/core/lophn-agent/tools/bundles/call.ts`가 `omit` 줄, 주석, handler가 채우는 줄에서만 나온다.
- 막지 않음: `grep -n "contacts" packages/core/lophn-agent/tools/bundles/call.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
